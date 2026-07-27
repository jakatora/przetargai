/**
 * DOPASOWANIE POZYCJI PLANU POSTĘPOWAŃ DO PROFILU FIRMY (ulepszenie „Radar planów
 * postępowań: wiedz o przetargu miesiące przed ogłoszeniem", podzadanie 1/6).
 *
 * Każdy zamawiający publiczny musi opublikować roczny plan postępowań (art. 23 Pzp):
 * przedmiot zamówienia, orientacyjną wartość i PRZEWIDYWANY TERMIN WSZCZĘCIA. Radar
 * przegląda te pozycje i wyławia te, które pasują do profilu wykonawcy — na miesiące
 * PRZED ogłoszeniem. Tu jest sam rdzeń: czysta funkcja profil × pozycje → ranking.
 *
 * Sygnały dopasowania (jak w `services/matching.js`, ale bez płatnego AI):
 *   • CPV       — najsilniejszy; reużywamy kanonicznego `lib/cpv.js` (naprawia P-1:
 *                 kod na dalszej pozycji sklejonego łańcucha BZP jest widziany),
 *   • słowa kluczowe w przedmiocie — `lib/textNorm.js` (rdzeniowanie PL: „drogi"↔„droga"),
 *   • zgodność regionu — plan dotyczy zamawiającego z regionu firmy.
 * Wynik 0..100, poziom MOCNE/SLABE, a pozycje poniżej progu SLABE są odcinane.
 * Lista sortowana ROSNĄCO wg przewidywanego terminu wszczęcia (najbliższe na górze —
 * to one wymagają najpilniejszych przygotowań na osi czasu radaru).
 *
 * Świadome decyzje (spójnie z `parametryFinansowe.js`, `dopasowanieSejfSWZ.js`):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez płatnego AI.
 *    `dzisiaj` jest WSTRZYKIWANE parametrem (profil.dzisiaj) — NIE ma Date.now, więc
 *    ta sama para (pozycje, profil) daje zawsze ten sam wynik i test jest stabilny.
 *  • Reużywamy `lib/cpv.js` i `lib/textNorm.js` — to kanoniczne, przetestowane matchery
 *    (obie są czyste, bez I/O). Ponowne wymyślanie CPV groziłoby powrotem buga P-1.
 */

import { cpvAffinity } from '../lib/cpv.js';
import { matchKeywords, normalize } from '../lib/textNorm.js';

// ─────────────────────────── wagi i progi (eksport = testowalność) ──────────

/** Waga trafienia CPV: affinity (0..1) × WAGA_CPV. Najsilniejszy sygnał branżowy. */
export const WAGA_CPV = 60;

/** Punkty za każde trafione słowo kluczowe w przedmiocie zamówienia. */
export const PUNKT_ZA_SLOWO = 12;

/** Sufit liczby liczonych trafień słów — więcej niż tyle nie podbija już wyniku. */
export const MAX_TRAFIEN_SLOWA = 3;

/** Waga zgodności regionu (plan zamawiającego z regionu firmy). */
export const WAGA_REGION = 12;

/** Od tego wyniku (włącznie) dopasowanie jest MOCNE. */
export const PROG_MOCNE = 48;

/** Od tego wyniku (włącznie) dopasowanie jest SLABE; poniżej — odcinamy pozycję. */
export const PROG_SLABE = 20;

// ─────────────────────────── odczyt pól pozycji planu ──────────────────────

/** Przedmiot zamówienia (do dopasowania słów) z pierwszego dostępnego pola. */
function przedmiotZ(pozycja) {
  return pozycja?.przedmiot ?? pozycja?.przedmiotZamowienia ?? pozycja?.opis ?? '';
}

/** Kod(y) CPV pozycji — string BZP-owy lub tablica; puste, gdy brak. */
function cpvZ(pozycja) {
  return pozycja?.cpv ?? pozycja?.cpvCode ?? pozycja?.kodCpv ?? '';
}

/** Region/województwo pozycji (siedziba/miejsce realizacji zamawiającego). */
function regionZ(pozycja) {
  return pozycja?.region ?? pozycja?.wojewodztwo ?? '';
}

// ─────────────────────────── klasyfikacja trafienia CPV ─────────────────────

/**
 * Nazywa rodzaj trafienia CPV na podstawie affinity z `lib/cpv.js`:
 *   1.0 → 'dokladne' (ten sam kod), 0.6–0.8 → 'prefiks' (węższy prefiks firmy),
 *   >0  → 'dzial' (zgodność tylko na poziomie dwucyfrowego działu), 0 → 'brak'.
 */
function typCpv(affinity) {
  if (affinity >= 1) return 'dokladne';
  if (affinity >= 0.6) return 'prefiks';
  if (affinity > 0) return 'dzial';
  return 'brak';
}

// ─────────────────────────── zgodność regionu ──────────────────────────────

/**
 * Region firmy pasuje do regionu pozycji, gdy po normalizacji jeden zawiera drugi
 * („mazowieckie" ⊂ „województwo mazowieckie"). Pusty region po którejkolwiek
 * stronie = brak sygnału (false), nie dopasowanie.
 */
function regionPasuje(regionProfil, regionPozycja) {
  const a = normalize(regionProfil);
  const b = normalize(regionPozycja);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// ─────────────────────────── termin wszczęcia → klucz sortowania ────────────

const MIESIACE_PL = {
  stycznia: 1, styczen: 1, lutego: 2, luty: 2, marca: 3, marzec: 3,
  kwietnia: 4, kwiecien: 4, maja: 5, maj: 5, czerwca: 6, czerwiec: 6,
  lipca: 7, lipiec: 7, sierpnia: 8, sierpien: 8, wrzesnia: 9, wrzesien: 9,
  pazdziernika: 10, pazdziernik: 10, listopada: 11, listopad: 11,
  grudnia: 12, grudzien: 12,
};

const KWARTAL_RZYMSKI = { i: 1, ii: 2, iii: 3, iv: 4 };

/**
 * Parsuje przewidywany termin wszczęcia do `{rok, miesiac}` (dzień pomijamy — plany
 * rzadko go podają, a do rankingu i liczby miesięcy wystarcza precyzja miesięczna).
 * Obsługuje: ISO „2026-09-01"/„2026-09", kwartał („II kwartał 2026", „2 kw. 2026",
 * „Q2 2026"), nazwę miesiąca („wrzesień 2026") i sam rok („2026"). Zwraca null,
 * gdy nie da się ustalić choćby roku (np. „do ustalenia").
 */
function parsujTermin(wartosc) {
  const t = normalize(wartosc);
  if (!t) return null;

  const iso = /(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(t);
  if (iso) return { rok: Number(iso[1]), miesiac: Number(iso[2]) };

  const rokM = /(\d{4})/.exec(t);
  if (!rokM) return null;
  const rok = Number(rokM[1]);

  // Kwartał. Cyfry roku (4-cyfrowe „2026") NIGDY nie mogą uchodzić za numer kwartału:
  // arabski numer bierzemy tylko gdy stoi PRZED słowem „kwartał"/„kw." albo po „q".
  let numer = null;
  const arab = /([1-4])\s*(?:kwarta|kw\b)/.exec(t);       // „2 kwartał", „2 kw."
  if (arab) numer = Number(arab[1]);
  if (numer == null) {
    const q = /(?<![a-z0-9])q\s*([1-4])(?!\d)/.exec(t);   // „q2", „q 2"
    if (q) numer = Number(q[1]);
  }
  if (numer == null && /kwarta/.test(t)) {                // „II kwartał", „kwartał IV"
    const rzym = /\b(iv|iii|ii|i)\b/.exec(t);
    if (rzym) numer = KWARTAL_RZYMSKI[rzym[1]];
  }
  if (numer != null) return { rok, miesiac: (numer - 1) * 3 + 1 };

  for (const [nazwa, mc] of Object.entries(MIESIACE_PL)) {
    if (t.includes(nazwa)) return { rok, miesiac: mc };
  }

  return { rok, miesiac: 1 }; // sam rok → początek roku
}

/** Sortowalny klucz numeryczny; nieznany termin → +∞ (na koniec listy). */
function kluczTerminu(termin) {
  if (!termin) return Number.POSITIVE_INFINITY;
  return termin.rok * 12 + termin.miesiac;
}

/** Liczba pełnych miesięcy od `dzisiaj` do terminu wszczęcia; null gdy nieznany. */
function miesiaceDo(termin, dzisiaj) {
  if (!termin) return null;
  const d = parsujTermin(dzisiaj);
  if (!d) return null;
  return (termin.rok - d.rok) * 12 + (termin.miesiac - d.miesiac);
}

// ─────────────────────────── ocena jednej pozycji ──────────────────────────

/**
 * Buduje wpis wyniku dla pojedynczej pozycji planu względem profilu, albo null,
 * gdy dopasowanie jest poniżej progu SLABE (pozycję wtedy odcinamy z radaru).
 */
function ocenPozycje(pozycja, profil) {
  const affinity = cpvAffinity(profil.cpv ?? [], cpvZ(pozycja));
  const trafioneSlowa = matchKeywords(profil.slowaKluczowe ?? [], przedmiotZ(pozycja));
  const zgodnoscRegionu = regionPasuje(profil.region, regionZ(pozycja));

  const punktySlowa = Math.min(trafioneSlowa.length, MAX_TRAFIEN_SLOWA) * PUNKT_ZA_SLOWO;
  const wynikSurowy = Math.round(affinity * WAGA_CPV)
    + punktySlowa
    + (zgodnoscRegionu ? WAGA_REGION : 0);
  const wynik = Math.min(100, wynikSurowy);

  if (wynik < PROG_SLABE) return null;

  const typ = typCpv(affinity);
  const powody = [];
  if (typ === 'dokladne') powody.push('Dokładne trafienie kodu CPV z profilem firmy.');
  else if (typ === 'prefiks') powody.push('Zgodność kodu CPV z profilem (dopasowanie prefiksowe).');
  else if (typ === 'dzial') powody.push('Zgodność działu CPV z profilem firmy.');
  if (trafioneSlowa.length) powody.push(`Trafione słowa kluczowe: ${trafioneSlowa.join(', ')}.`);
  if (zgodnoscRegionu) powody.push(`Zgodny region: ${String(profil.region).trim()}.`);

  const termin = parsujTermin(pozycja?.terminWszczecia ?? pozycja?.przewidywanyTerminWszczecia);

  return Object.freeze({
    pozycja,
    wynik,
    poziom: wynik >= PROG_MOCNE ? 'MOCNE' : 'SLABE',
    miesiacyDoWszczecia: miesiaceDo(termin, profil.dzisiaj),
    uzasadnienie: Object.freeze({
      trafienieCpv: Object.freeze({ affinity, typ }),
      trafioneSlowa: Object.freeze([...trafioneSlowa]),
      zgodnoscRegionu,
      powody: Object.freeze(powody),
    }),
    _klucz: kluczTerminu(termin),
  });
}

// ─────────────────────────── funkcja publiczna ──────────────────────────────

/**
 * Dopasowuje pozycje rocznego planu postępowań do profilu wykonawcy.
 *
 * @param {{pozycjePlanow?: Array<object>, profil: {cpv?: string[], slowaKluczowe?: string[],
 *   region?: string, dzisiaj?: string}}} wejscie — `profil.dzisiaj` w formacie „YYYY-MM-DD"
 *   (wstrzykiwane, bez Date.now); pola pozycji: `przedmiot`, `cpv`, `region`, `terminWszczecia`.
 * @returns {Array<Readonly<{pozycja: object, wynik: number, poziom: 'MOCNE'|'SLABE',
 *   miesiacyDoWszczecia: number|null, uzasadnienie: Readonly<{trafienieCpv: {affinity: number,
 *   typ: string}, trafioneSlowa: string[], zgodnoscRegionu: boolean, powody: string[]}>}>>}
 *   Trafienia POSORTOWANE rosnąco wg przewidywanego terminu wszczęcia (przy remisie:
 *   wyższy wynik wyżej), z odciętymi pozycjami poniżej progu SLABE.
 */
export function dopasujPozycjePlanu({ pozycjePlanow, profil } = {}) {
  if (!Array.isArray(pozycjePlanow) || !profil) return [];

  const trafienia = [];
  for (const pozycja of pozycjePlanow) {
    const wpis = ocenPozycje(pozycja, profil);
    if (wpis) trafienia.push(wpis);
  }

  trafienia.sort((a, b) => (a._klucz - b._klucz) || (b.wynik - a.wynik));

  // Klucz sortowania był tylko roboczy — nie wystawiamy go w API.
  return trafienia.map(({ _klucz, ...wpis }) => Object.freeze(wpis));
}
