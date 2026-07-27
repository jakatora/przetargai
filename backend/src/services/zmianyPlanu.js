/**
 * WYKRYWANIE ZMIAN PLANU I ŁĄCZENIE OGŁOSZENIA Z POZYCJĄ (ulepszenie „Radar planów
 * postępowań: wiedz o przetargu miesiące przed ogłoszeniem", podzadanie 3/6).
 *
 * Kroki 1–2/6 wyławiają pozycje rocznego planu (art. 23 Pzp) i budują plan przygotowań.
 * Ale plan ŻYJE: zamawiający ma obowiązek go aktualizować (przesuwa termin wszczęcia,
 * podbija wartość, zmienia zakres/CPV). A kiedyś to samo zamówienie POJAWIA SIĘ jako
 * realne ogłoszenie w BZP. Ten moduł obsługuje oba zdarzenia — czysto, deterministycznie:
 *
 *   • `wykryjZmiany({pozycjaPrzed, pozycjaPo})` — porównuje dwie migawki tej samej pozycji
 *     planu i zwraca listę zmian: przesunięcie terminu (kierunek + liczba dni), zmiana
 *     wartości (kierunek + delta %), zmiana kodów CPV, zmiana opisu przedmiotu.
 *   • `dopasujOgloszenie({pozycja, ogloszenie})` — ocenia, czy świeże ogłoszenie to właśnie
 *     ten przetarg z planu: pewność 0..100 z czterech sygnałów (CPV + zbieżność wartości +
 *     bliskość terminu + wspólne słowa), etykieta pewne/prawdopodobne/brak i flaga alarmu
 *     „to jest to, na co czekałeś" — zapala się TYLKO przy dopasowaniu pewnym.
 *
 * Świadome decyzje (spójnie z `radarPlanow.js`, `przygotowaniaPlanu.js`):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez płatnego AI.
 *    Zero Date.now — daty liczy `Date.UTC` (arytmetyka, nie zegar), więc ten sam wsad daje
 *    zawsze ten sam wynik i test jest stabilny.
 *  • Termin parsujemy REUŻYWANYM `parsujTermin` z radaru (jeden parser dat dla całego
 *    ulepszenia), CPV — kanonicznym `lib/cpv.js` (nie powielamy buga P-1: kod na dalszej
 *    pozycji sklejonego łańcucha BZP jest widziany), słowa — `lib/textNorm.js` (rdzeniowanie
 *    PL). Powielanie tych matcherów groziłoby rozjazdem oś-czasu / dopasowań.
 */

import { parseCpvCodes, cpvAffinity } from '../lib/cpv.js';
import { matchKeywords, normalize } from '../lib/textNorm.js';
import { parsujTermin } from './radarPlanow.js';

const DZIEN_MS = 86_400_000;

// ─────────────────────────── wagi i progi dopasowania (eksport = testowalność) ──

/** Waga trafienia CPV: affinity (0..1) × WAGA. Najsilniejszy sygnał — bramkuje alarm. */
export const WAGA_CPV_DOPASOWANIE = 50;

/** Pełna waga zbieżności orientacyjnej wartości pozycji i wartości ogłoszenia. */
export const WAGA_WARTOSC = 20;

/** Pełna waga bliskości daty ogłoszenia do przewidywanego terminu wszczęcia. */
export const WAGA_TERMIN = 15;

/** Punkty za każde wspólne słowo (przedmiot pozycji × treść ogłoszenia). */
export const PUNKT_ZA_SLOWO_OGL = 5;

/** Sufit liczonych wspólnych słów — MAX_SLOWA_OGL × PUNKT_ZA_SLOWO_OGL = 15 (jak WAGA_TERMIN). */
export const MAX_SLOWA_OGL = 3;

/** Od tego stosunku (mniejsza/większa) wartości uznajemy za zbieżne (pełne punkty). */
export const PROG_WARTOSC_BLISKA = 0.8;

/** Od tego stosunku wartości są luźno zbieżne (połowa punktów); poniżej — zero. */
export const PROG_WARTOSC_LUZNA = 0.5;

/** Do tylu dni różnicy termin uznajemy za bliski (pełne punkty). */
export const PROG_TERMIN_BLISKI_DNI = 45;

/** Do tylu dni różnicy termin jest luźno bliski (połowa punktów); dalej — zero. */
export const PROG_TERMIN_LUZNY_DNI = 120;

/** Od tej pewności (włącznie) dopasowanie jest PEWNE → zapala alarm. */
export const PROG_PEWNE = 70;

/** Od tej pewności (włącznie) dopasowanie jest PRAWDOPODOBNE; poniżej — BRAK. */
export const PROG_PRAWDOPODOBNE = 40;

// ─────────────────────────── odczyt pól pozycji / ogłoszenia ───────────────

/** Kod(y) CPV — string BZP-owy lub tablica; puste, gdy brak. */
function cpvZ(x) {
  return x?.cpv ?? x?.cpvCode ?? x?.kodCpv ?? '';
}

/** Przedmiot/tytuł zamówienia z pierwszego dostępnego pola. */
function przedmiotZ(x) {
  return x?.przedmiot ?? x?.przedmiotZamowienia ?? x?.tytul ?? x?.opis ?? '';
}

/** Surowa (nieparsowana) orientacyjna wartość / cena z pierwszego dostępnego pola. */
function wartoscRaw(x) {
  return x?.orientacyjnaWartosc
    ?? x?.wartosc
    ?? x?.wartoscSzacunkowa
    ?? x?.wartoscOrientacyjna
    ?? x?.cena
    ?? x?.cenaBrutto
    ?? null;
}

/** Surowy przewidywany termin wszczęcia (pozycja planu). */
function terminZ(x) {
  return x?.terminWszczecia ?? x?.przewidywanyTerminWszczecia ?? null;
}

/** Surowa data pojawienia się ogłoszenia (publikacja / wszczęcie postępowania). */
function dataOgloszeniaZ(x) {
  return x?.dataPublikacji ?? x?.dataOgloszenia ?? x?.dataWszczecia ?? x?.data ?? null;
}

// ─────────────────────────── parsowanie liczb i dat ─────────────────────────

/**
 * Toleruje kwoty w formacie PL: „1 200 000 zł", „1 200 000,50", spacje twarde/nbsp.
 * Zwraca number albo null, gdy nie da się odczytać żadnej liczby.
 */
function liczbaZ(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[\s ]/g, '').replace(/z[łl]|pln/gi, '').replace(',', '.');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** „8000000" → „8 000 000 zł" — czytelna kwota do opisu (bez zależności od ICU). */
function formatujZl(n) {
  const grupy = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy} zł`;
}

/**
 * Parsuje wartość do pełnej daty `{rok, miesiac, dzien}` na potrzeby liczenia RÓŻNICY DNI.
 * Pełny ISO „YYYY-MM-DD" daje precyzję dzienną; pozostałe formaty (kwartał, nazwa miesiąca,
 * „YYYY-MM", sam rok) przechodzą przez reużywany `parsujTermin` z precyzją do miesiąca
 * (dzień = 1). Null, gdy nie da się ustalić choćby roku.
 */
function parsujDoDaty(wartosc) {
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(wartosc ?? ''));
  if (iso) return { rok: Number(iso[1]), miesiac: Number(iso[2]), dzien: Number(iso[3]) };
  const t = parsujTermin(wartosc);
  if (!t) return null;
  return { rok: t.rok, miesiac: t.miesiac, dzien: 1 };
}

/** Timestamp UTC (ms) północy danej daty — czysta arytmetyka, bez czytania zegara. */
function naMs(d) {
  return Date.UTC(d.rok, d.miesiac - 1, d.dzien);
}

/** Różnica w pełnych dniach (b − a) między dwiema datami; null gdy którejś brak. */
function roznicaDni(a, b) {
  if (!a || !b) return null;
  return Math.round((naMs(b) - naMs(a)) / DZIEN_MS);
}

// ─────────────────────────── wykryjZmiany: pojedyncze różnice ───────────────

/** Różnica przewidywanego terminu wszczęcia (kierunek + liczba dni), albo null. */
function zmianaTerminu(przed, po) {
  const a = parsujDoDaty(przed);
  const b = parsujDoDaty(po);

  if (a && b) {
    const dni = roznicaDni(a, b);
    if (dni === 0) return null;
    const kierunek = dni > 0 ? 'opozniony' : 'przyspieszony';
    const opis = dni > 0
      ? `Termin wszczęcia przesunięty o ${dni} dni później (${przed} → ${po}).`
      : `Termin wszczęcia przyspieszony o ${-dni} dni (${przed} → ${po}).`;
    return Object.freeze({ typ: 'termin', kierunek, dni, terminPrzed: przed, terminPo: po, opis });
  }

  if (normalize(przed) === normalize(po)) return null;

  let kierunek = 'zmiana';
  if (!a && b) kierunek = 'ustalony';   // z „do ustalenia" na konkretną datę
  else if (a && !b) kierunek = 'wycofany'; // z daty na nieokreśloną
  return Object.freeze({
    typ: 'termin',
    kierunek,
    dni: null,
    terminPrzed: przed ?? null,
    terminPo: po ?? null,
    opis: `Zmiana przewidywanego terminu wszczęcia (${przed ?? '—'} → ${po ?? '—'}).`,
  });
}

/** Różnica orientacyjnej wartości (kierunek + delta i delta %), albo null. */
function zmianaWartosci(przed, po) {
  const a = liczbaZ(przed);
  const b = liczbaZ(po);
  if (a == null && b == null) return null;

  if (a != null && b != null) {
    if (a === b) return null;
    const delta = b - a;
    const kierunek = delta > 0 ? 'wzrost' : 'spadek';
    const deltaProcent = a !== 0 ? Math.round((delta / a) * 100) : null;
    const znak = delta > 0 ? '+' : '';
    return Object.freeze({
      typ: 'wartosc',
      kierunek,
      wartoscPrzed: a,
      wartoscPo: b,
      delta,
      deltaProcent,
      opis: `Orientacyjna wartość: ${kierunek} o ${znak}${deltaProcent ?? '?'}% `
        + `(${formatujZl(a)} → ${formatujZl(b)}).`,
    });
  }

  const kierunek = a == null ? 'ustalona' : 'usunieta';
  return Object.freeze({
    typ: 'wartosc',
    kierunek,
    wartoscPrzed: a,
    wartoscPo: b,
    delta: null,
    deltaProcent: null,
    opis: 'Uzupełniono lub usunięto orientacyjną wartość zamówienia.',
  });
}

/** Różnica zestawu kodów CPV (dodane / usunięte), albo null. */
function zmianaCpv(przed, po) {
  const a = parseCpvCodes(cpvZ(przed));
  const b = parseCpvCodes(cpvZ(po));
  if (a.join(',') === b.join(',')) return null;

  const setA = new Set(a);
  const setB = new Set(b);
  const dodane = b.filter((c) => !setA.has(c));
  const usuniete = a.filter((c) => !setB.has(c));
  return Object.freeze({
    typ: 'cpv',
    cpvPrzed: Object.freeze(a),
    cpvPo: Object.freeze(b),
    dodane: Object.freeze(dodane),
    usuniete: Object.freeze(usuniete),
    opis: `Zmiana kodów CPV (${a.join(', ') || '—'} → ${b.join(', ') || '—'}).`,
  });
}

/** Różnica opisu przedmiotu zamówienia (po normalizacji), albo null. */
function zmianaPrzedmiotu(przed, po) {
  if (normalize(przed) === normalize(po)) return null;
  return Object.freeze({
    typ: 'przedmiot',
    przedmiotPrzed: przed ?? '',
    przedmiotPo: po ?? '',
    opis: 'Zmieniono opis przedmiotu zamówienia.',
  });
}

// ─────────────────────────── funkcja publiczna: wykryjZmiany ────────────────

/**
 * Wykrywa zmiany między dwiema migawkami tej samej pozycji rocznego planu postępowań.
 *
 * @param {{pozycjaPrzed?: object, pozycjaPo?: object}} wejscie — pola pozycji:
 *   `terminWszczecia`, `orientacyjnaWartosc`, `cpv`, `przedmiot` (tolerowane aliasy).
 * @returns {ReadonlyArray<Readonly<object>>} zamrożona lista zmian (typ + kierunek/delta
 *   + opis); pusta, gdy brak zmian albo którejś migawki. Kolejność: termin, wartość,
 *   CPV, przedmiot.
 */
export function wykryjZmiany({ pozycjaPrzed, pozycjaPo } = {}) {
  if (!pozycjaPrzed || !pozycjaPo) return Object.freeze([]);

  const zmiany = [];
  const t = zmianaTerminu(terminZ(pozycjaPrzed), terminZ(pozycjaPo));
  if (t) zmiany.push(t);
  const w = zmianaWartosci(wartoscRaw(pozycjaPrzed), wartoscRaw(pozycjaPo));
  if (w) zmiany.push(w);
  const c = zmianaCpv(pozycjaPrzed, pozycjaPo);
  if (c) zmiany.push(c);
  const p = zmianaPrzedmiotu(przedmiotZ(pozycjaPrzed), przedmiotZ(pozycjaPo));
  if (p) zmiany.push(p);

  return Object.freeze(zmiany);
}

// ─────────────────────────── dopasujOgloszenie: sygnały ─────────────────────

/** Sygnał CPV: affinity (0..1) × waga. */
function sygnalCpv(pozycja, ogloszenie) {
  const affinity = cpvAffinity(cpvZ(pozycja), cpvZ(ogloszenie));
  return Object.freeze({ affinity, punkty: Math.round(affinity * WAGA_CPV_DOPASOWANIE) });
}

/** Sygnał zbieżności wartości: stosunek mniejsza/większa progowany do pełnych/połowy punktów. */
function sygnalWartosci(pozycja, ogloszenie) {
  const wPoz = liczbaZ(wartoscRaw(pozycja));
  const wOgl = liczbaZ(wartoscRaw(ogloszenie));
  if (wPoz == null || wOgl == null || wPoz <= 0 || wOgl <= 0) {
    return Object.freeze({ zbieznosc: null, punkty: 0, wartoscPozycji: wPoz, wartoscOgloszenia: wOgl });
  }
  const zbieznosc = Math.min(wPoz, wOgl) / Math.max(wPoz, wOgl);
  let punkty = 0;
  if (zbieznosc >= PROG_WARTOSC_BLISKA) punkty = WAGA_WARTOSC;
  else if (zbieznosc >= PROG_WARTOSC_LUZNA) punkty = Math.round(WAGA_WARTOSC / 2);
  return Object.freeze({ zbieznosc, punkty, wartoscPozycji: wPoz, wartoscOgloszenia: wOgl });
}

/** Sygnał bliskości terminu: |data ogłoszenia − termin wszczęcia| progowana do punktów. */
function sygnalTerminu(pozycja, ogloszenie) {
  const term = parsujDoDaty(terminZ(pozycja));
  const data = parsujDoDaty(dataOgloszeniaZ(ogloszenie));
  const roznica = roznicaDni(term, data);
  if (roznica == null) return Object.freeze({ dniRoznica: null, punkty: 0 });
  const dni = Math.abs(roznica);
  let punkty = 0;
  if (dni <= PROG_TERMIN_BLISKI_DNI) punkty = WAGA_TERMIN;
  else if (dni <= PROG_TERMIN_LUZNY_DNI) punkty = Math.round(WAGA_TERMIN / 2);
  return Object.freeze({ dniRoznica: dni, punkty });
}

/** Sygnał wspólnych słów: znaczące słowa przedmiotu pozycji trafiające w treść ogłoszenia. */
function sygnalSlow(pozycja, ogloszenie) {
  const slowa = normalize(przedmiotZ(pozycja))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const trafione = matchKeywords(slowa, przedmiotZ(ogloszenie));
  const punkty = Math.min(trafione.length, MAX_SLOWA_OGL) * PUNKT_ZA_SLOWO_OGL;
  return Object.freeze({ trafione: Object.freeze([...trafione]), punkty });
}

// ─────────────────────────── funkcja publiczna: dopasujOgloszenie ───────────

/**
 * Ocenia, czy świeże ogłoszenie to właśnie ten przetarg, na który wskazywała pozycja planu.
 *
 * @param {{pozycja?: object, ogloszenie?: object}} wejscie — pozycja planu (CPV, przedmiot,
 *   orientacyjna wartość, `terminWszczecia`) × ogłoszenie (CPV, przedmiot/tytuł, wartość/cena,
 *   `dataPublikacji`).
 * @returns {Readonly<{pewnosc: number, etykieta: 'pewne'|'prawdopodobne'|'brak', alarm: boolean,
 *   sygnaly: Readonly<{cpv: object, wartosc: object, termin: object, slowa: object}>,
 *   powody: string[], komunikat: string}>} Zamrożony wynik. `alarm` (= „to jest to, na co
 *   czekałeś") zapala się TYLKO przy etykiecie „pewne" — a ta jest nieosiągalna bez CPV.
 */
export function dopasujOgloszenie({ pozycja, ogloszenie } = {}) {
  const poz = pozycja ?? {};
  const ogl = ogloszenie ?? {};

  const cpv = sygnalCpv(poz, ogl);
  const wartosc = sygnalWartosci(poz, ogl);
  const termin = sygnalTerminu(poz, ogl);
  const slowa = sygnalSlow(poz, ogl);

  const pewnosc = Math.min(100, cpv.punkty + wartosc.punkty + termin.punkty + slowa.punkty);

  let etykieta = 'brak';
  if (pewnosc >= PROG_PEWNE) etykieta = 'pewne';
  else if (pewnosc >= PROG_PRAWDOPODOBNE) etykieta = 'prawdopodobne';
  const alarm = etykieta === 'pewne';

  const powody = [];
  if (cpv.punkty > 0) powody.push(`Zgodność CPV (affinity ${cpv.affinity.toFixed(2)}).`);
  if (wartosc.punkty > 0) powody.push(`Zbieżna wartość (${Math.round(wartosc.zbieznosc * 100)}%).`);
  if (termin.punkty > 0) powody.push(`Ogłoszenie blisko planowanego terminu (${termin.dniRoznica} dni).`);
  if (slowa.trafione.length) powody.push(`Wspólne słowa: ${slowa.trafione.join(', ')}.`);
  if (!powody.length) powody.push('Brak zbieżnych sygnałów — to raczej inne zamówienie.');

  let komunikat;
  if (alarm) {
    komunikat = `To jest to, na co czekałeś: ogłoszenie pasuje do pozycji planu (pewność ${pewnosc}%).`;
  } else if (etykieta === 'prawdopodobne') {
    komunikat = `Prawdopodobne dopasowanie (${pewnosc}%) — zweryfikuj ręcznie przed decyzją.`;
  } else {
    komunikat = `Brak dopasowania (${pewnosc}%) — to najpewniej inne zamówienie.`;
  }

  return Object.freeze({
    pewnosc,
    etykieta,
    alarm,
    sygnaly: Object.freeze({ cpv, wartosc, termin, slowa }),
    powody: Object.freeze(powody),
    komunikat,
  });
}
