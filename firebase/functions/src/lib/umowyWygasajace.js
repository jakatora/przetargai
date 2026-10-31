import { dzialCpv, normWojewodztwo } from './wynikiAgregacja.js';
import { normNip } from './profilKonkurenta.js';
import { WOJEWODZTWA } from './wojewodztwa.js';

/*
 * RADAR WYGASAJĄCYCH UMÓW (2026-10-31, z analizy konkurencji: przetargi.info „umowy wygasające”).
 *
 * Zamawiający, któremu za trzy miesiące kończy się roczna umowa na sprzątanie, ochronę, paliwo
 * albo odbiór odpadów, za chwilę ogłosi ten sam przetarg. Kto wie o tym wcześniej, ma czas na
 * kalkulację, referencje i rozmowę z podwykonawcą. Ogłoszenie o wyniku w BZP podaje datę zawarcia
 * umowy (8.1), wartość (8.2) i okres realizacji (8.3) — `lib/wynikiParser.js` liczy z tego
 * `koniecUmowy` każdej części (98% rozstrzygniętych części w próbce z 28–29.10.2026).
 *
 * Centralny Rejestr Umów (MF) ma tylko umowy od 1.07.2026 i nie ma publicznego API odczytu —
 * dlatego budujemy to z wyników BZP, które już mamy z całego roku.
 *
 * CZYSTA logika: zegar parametrem, bez I/O.
 */

/** Jak daleko w przód patrzymy (dni). 7 miesięcy = typowe przygotowanie do przetargu rocznego. */
export const HORYZONT_DNI = 210;
/** Umowa krótsza niż ~pół roku to zwykle jednorazowy zakup, który się nie powtórzy. */
export const MIN_DLUGOSC_DNI = 180;
/** Ile umów trzymamy w jednym kubełku (najbliżej końca pierwsze). */
export const MAKS_W_KUBELKU = 80;

/*
 * Roboty budowlane zwykle się nie powtarzają (szkoła remontowana raz), chyba że to utrzymanie:
 * bieżące utrzymanie dróg, akcja zima, konserwacja oświetlenia, przeglądy.
 */
const ROBOTY_CYKLICZNE = /utrzymani|konserwacj|bieżąc|zimow|odśnieżan|serwis|przegląd|eksploatacj|całoroczn/i;

const DZIEN_MS = 86_400_000;
const dzienIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const msDnia = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? Date.parse(`${iso}T00:00:00.000Z`) : NaN);

/** Najpóźniejszy koniec umowy wśród nieunieważnionych części — albo null. */
export function koniecUmowyWyniku(wynik) {
  const konce = (wynik?.czesci ?? [])
    .filter((c) => c && !c.uniewaznione && Number.isFinite(msDnia(c.koniecUmowy)))
    .map((c) => c.koniecUmowy);
  return konce.length ? konce.sort().at(-1) : null;
}

/**
 * Czy umowa wróci jako przetarg: trwa co najmniej MIN_DLUGOSC_DNI i nie jest jednorazową robotą
 * budowlaną. Bez daty zawarcia długości nie znamy — wtedy decyduje sam rodzaj.
 */
export function czyCykliczna({ rodzaj, tytul, dataUmowy, koniec }) {
  if (rodzaj === 'Works' && !ROBOTY_CYKLICZNE.test(String(tytul ?? ''))) return false;
  const od = msDnia(String(dataUmowy ?? '').slice(0, 10));
  const doDnia = msDnia(koniec);
  if (!Number.isFinite(doDnia)) return false;
  if (!Number.isFinite(od)) return rodzaj !== 'Works';
  return (doDnia - od) / DZIEN_MS >= MIN_DLUGOSC_DNI;
}

/** Klucz kubełka: dział CPV × województwo (TERYT) albo sam dział (cały kraj). */
export const kluczUmow = (dzial, woj = null) => (woj ? `${dzial}|${woj}` : `${dzial}`);

/**
 * Jedna pozycja radaru z rozstrzygnięcia (umowa jako całość: koniec = najpóźniejsza część).
 * @returns {object|null} null, gdy nie ma końca w oknie albo umowa nie jest cykliczna
 */
export function pozycjaUmowy(wynik, { odDnia, doDnia }) {
  const koniec = koniecUmowyWyniku(wynik);
  if (!koniec || koniec < odDnia || koniec > doDnia) return null;
  const czesci = (wynik.czesci ?? []).filter((c) => c && !c.uniewaznione && c.koniecUmowy);
  const ostatnia = czesci.find((c) => c.koniecUmowy === koniec) ?? czesci[0];
  if (!czyCykliczna({ rodzaj: wynik.rodzaj, tytul: wynik.tytul, dataUmowy: ostatnia?.dataUmowy, koniec })) return null;
  const zwyciezcy = [];
  const widziane = new Set();
  for (const c of czesci) {
    const nazwa = c.zwyciezca?.nazwa ?? null;
    const nip = normNip(c.zwyciezca?.nip);
    const klucz = nip ?? nazwa;
    if (!klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    if (zwyciezcy.length < 3) zwyciezcy.push({ nazwa, nip });
  }
  const wartosci = czesci.map((c) => c.wartoscUmowy).filter((v) => Number.isFinite(v) && v > 0);
  return {
    id: wynik.externalId ?? null,
    tytul: wynik.tytul ?? null,
    zamawiajacy: wynik.zamawiajacy ?? null,
    zamawiajacy_nip: wynik.zamawiajacyNip ?? wynik.zamawiajacy_nip ?? null,
    miasto: wynik.miasto ?? null,
    wojewodztwo: normWojewodztwo(wynik.wojewodztwo),
    cpv: Array.isArray(wynik.cpv) ? wynik.cpv[0] ?? null : null,
    rodzaj: wynik.rodzaj ?? null,
    koniec,
    data_umowy: ostatnia?.dataUmowy ? String(ostatnia.dataUmowy).slice(0, 10) : null,
    okres: ostatnia?.okresUmowy ?? null,
    wartosc: wartosci.length ? Math.round(wartosci.reduce((s, v) => s + v, 0)) : null,
    zwyciezcy,
    liczba_wykonawcow: widziane.size,
    postepowanie_id: wynik.tenderId ?? wynik.postepowanie_id ?? null,
  };
}

/**
 * Kubełki radaru z rozstrzygnięć, których umowa kończy się w [dzisiaj, dzisiaj + HORYZONT_DNI].
 * Każda umowa trafia do kubełków WSZYSTKICH swoich działów CPV (do 3) — w regionie i w kraju.
 * @returns {Record<string, {klucz: string, dzial: string, wojewodztwo: string|null, umowy: object[]}>}
 */
export function zbudujKubelkiUmow(wyniki, { teraz = Date.now(), horyzontDni = HORYZONT_DNI, maks = MAKS_W_KUBELKU } = {}) {
  const odDnia = dzienIso(teraz);
  const doDnia = dzienIso(teraz + horyzontDni * DZIEN_MS);
  const kubelki = {};
  const dodaj = (klucz, dzial, woj, poz) => {
    const k = (kubelki[klucz] ??= { klucz, dzial, wojewodztwo: woj, umowy: [] });
    k.umowy.push(poz);
  };
  for (const w of Array.isArray(wyniki) ? wyniki : []) {
    const poz = pozycjaUmowy(w, { odDnia, doDnia });
    if (!poz) continue;
    const dzialy = [...new Set((Array.isArray(w.cpv) ? w.cpv : [w.cpv]).map((k) => dzialCpv(k)).filter(Boolean))].slice(0, 3);
    for (const d of dzialy) {
      dodaj(kluczUmow(d), d, null, poz);
      if (poz.wojewodztwo) dodaj(kluczUmow(d, poz.wojewodztwo), d, poz.wojewodztwo, poz);
    }
  }
  for (const k of Object.values(kubelki)) {
    k.liczba = k.umowy.length;
    k.umowy = k.umowy.sort((a, b) => a.koniec.localeCompare(b.koniec) || (b.wartosc ?? 0) - (a.wartosc ?? 0)).slice(0, maks);
    k.od = odDnia;
    k.do = doDnia;
  }
  return kubelki;
}

/** Klucze kubełków dla firmy: działy z karty × regiony (bez regionów — cały kraj). */
export function kluczeUmowUzytkownika(user) {
  const dzialy = [...new Set((user?.cpv_codes ?? []).map((k) => dzialCpv(k)).filter(Boolean))].slice(0, 6);
  const regiony = [...new Set((user?.regiony ?? []).map(normWojewodztwo).filter(Boolean))].slice(0, 4);
  const klucze = regiony.length ? dzialy.flatMap((d) => regiony.map((w) => kluczUmow(d, w))) : dzialy.map((d) => kluczUmow(d));
  return { dzialy, regiony, klucze };
}

/**
 * Lista dla firmy: scalone kubełki, bez powtórzeń, bez umów już zakończonych i bez własnych
 * (firma, która tę umowę wykonuje, wie, kiedy się kończy), najbliżej końca pierwsze.
 */
export function wybierzUmowy({ kubelki, teraz = Date.now(), wlasnyNip = null, limit = 40 }) {
  const dzisiaj = dzienIso(teraz);
  const wlasny = normNip(wlasnyNip);
  const poId = new Map();
  let wKubelkach = 0;
  for (const k of Object.values(kubelki ?? {})) {
    if (!k) continue;
    wKubelkach += Number(k.liczba) || 0;
    for (const u of k.umowy ?? []) {
      if (!u?.id || !u.koniec || u.koniec < dzisiaj || poId.has(u.id)) continue;
      if (wlasny && (u.zwyciezcy ?? []).some((z) => normNip(z.nip) === wlasny)) continue;
      poId.set(u.id, u);
    }
  }
  const umowy = [...poId.values()]
    .sort((a, b) => a.koniec.localeCompare(b.koniec))
    .slice(0, limit)
    .map((u) => ({
      ...u,
      dni_do_konca: Math.round((msDnia(u.koniec) - msDnia(dzisiaj)) / DZIEN_MS),
      region_nazwa: u.wojewodztwo ? WOJEWODZTWA[u.wojewodztwo] ?? null : null,
    }));
  return { umowy, w_kubelkach: wKubelkach };
}
