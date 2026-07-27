/**
 * PLAN PRZYGOTOWAŃ DLA WYKRYTEJ POZYCJI PLANU POSTĘPOWAŃ (ulepszenie „Radar planów
 * postępowań: wiedz o przetargu miesiące przed ogłoszeniem", podzadanie 2/6).
 *
 * Krok 1/6 (`services/radarPlanow.js`) wyławia z rocznego planu (art. 23 Pzp) pozycje
 * pasujące do profilu — na MIESIĄCE przed ogłoszeniem. Tu bierzemy jedną taką pozycję
 * i budujemy z niej konkretny plan działania, tak by w dniu ogłoszenia być gotowym:
 *   • jakie dokumenty i referencje trzeba skompletować (wg CPV i orientacyjnej wartości),
 *   • czy przy tej skali/zakresie potrzebny będzie partner do konsorcjum,
 *   • kiedy zacząć rezerwować moce przerobowe,
 *   • kamienie milowe liczone WSTECZ od przewidywanego terminu wszczęcia,
 *   • jednozdaniowy komunikat „zacznij za ok. X dni; masz Y mies. do wszczęcia".
 *
 * Świadome decyzje (spójnie z `radarPlanow.js`, `parametryFinansowe.js`):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez płatnego AI.
 *    `dzisiaj` jest WSTRZYKIWANE parametrem — NIE ma Date.now, więc ten sam wsad daje
 *    zawsze ten sam wynik i test jest stabilny. `Date.UTC` liczy tylko arytmetykę dat
 *    (nie czyta zegara) — daty kamieni są policzalne i niezależne od strefy.
 *  • Termin wszczęcia parsujemy REUŻYWANYM `parsujTermin` z radaru — jeden parser dat
 *    dla obu kroków, żeby oś czasu radaru i oś przygotowań nigdy się nie rozjechały.
 */

import { cpvDivisions } from '../lib/cpv.js';
import { parsujTermin } from './radarPlanow.js';

const DZIEN_MS = 86_400_000;

// ─────────────────────────── progi i offsety (eksport = testowalność) ──────

/** Od tej orientacyjnej wartości (zł) zamawiający zwykle żąda wadium → dokument + kamień. */
export const PROG_WADIUM = 1_000_000;

/** Od tej wartości (zł) dokładamy dowód sytuacji finansowej i polisę OC adekwatną do skali. */
export const PROG_ZDOLNOSC_FINANSOWA = 3_000_000;

/**
 * Ile dni PRZED przewidywanym terminem wszczęcia przypada każdy kamień milowy.
 * Kolejność malejąca = kolejność w czasie (partner najwcześniej, gotowość tuż przed).
 */
export const KAMIENIE_DNI_PRZED = Object.freeze({
  partner: 120,
  dokumenty: 90,
  moce: 60,
  finansowanie: 30,
  gotowosc: 14,
});

// ─────────────────────────── odczyt pól pozycji / profilu ──────────────────

/** Kod(y) CPV pozycji planu — string BZP-owy lub tablica; puste, gdy brak. */
function cpvZ(pozycja) {
  return pozycja?.cpv ?? pozycja?.cpvCode ?? pozycja?.kodCpv ?? '';
}

/** Orientacyjna wartość zamówienia z pierwszego dostępnego pola (liczba lub tekst PL). */
function wartoscZ(pozycja) {
  return liczbaZ(
    pozycja?.orientacyjnaWartosc
    ?? pozycja?.wartosc
    ?? pozycja?.wartoscSzacunkowa
    ?? pozycja?.wartoscOrientacyjna,
  );
}

/** Samodzielny potencjał firmy (maks. wartość kontraktu do udźwignięcia bez partnera). */
function maksPotencjalZ(profil) {
  return liczbaZ(
    profil?.maksymalnaWartoscKontraktu
    ?? profil?.maksWartoscKontraktu
    ?? profil?.potencjalWartosc,
  );
}

/**
 * Toleruje kwoty w formacie PL: „8 000 000 zł", „1 200 000,50", spacje twarde/nbsp.
 * Zwraca number albo null, gdy nie da się odczytać żadnej liczby.
 */
function liczbaZ(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[\s ]/g, '').replace(/z[łl]|pln/gi, '').replace(',', '.');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** „8000000" → „8 000 000 zł" — czytelna kwota do komunikatu (bez zależności od ICU). */
function formatujZl(n) {
  const grupy = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grupy} zł`;
}

/** Parsuje „YYYY-MM-DD" do `{rok, miesiac, dzien}`; dzień domyślnie 1. Null gdy brak roku. */
function parsujDzien(iso) {
  const m = /(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(iso ?? ''));
  if (!m) return null;
  return { rok: Number(m[1]), miesiac: Number(m[2]), dzien: m[3] ? Number(m[3]) : 1 };
}

/** Timestamp UTC (ms) dla północy danej daty — czysta arytmetyka, bez czytania zegara. */
function naMs(rok, miesiac, dzien) {
  return Date.UTC(rok, miesiac - 1, dzien);
}

/** Timestamp UTC → „YYYY-MM-DD" (niezależnie od strefy — bazujemy na północy UTC). */
function formatIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// ─────────────────────────── katalog dokumentów ────────────────────────────

const DOKUMENTY_BAZOWE = [
  {
    klucz: 'oswiadczenie_wykluczenie',
    nazwa: 'Oświadczenie o niepodleganiu wykluczeniu i spełnianiu warunków (art. 125 ust. 1 Pzp)',
    powod: 'Wymagane w każdym postępowaniu — składane wraz z ofertą.',
  },
  {
    klucz: 'odpis_rejestrowy',
    nazwa: 'Aktualny odpis z KRS lub CEIDG',
    powod: 'Potwierdzenie umocowania i braku podstaw wykluczenia.',
  },
  {
    klucz: 'referencje',
    nazwa: 'Wykaz zrealizowanych zamówień wraz z referencjami',
    powod: 'Warunek doświadczenia — dowód należytego wykonania podobnych zamówień.',
  },
];

/** Dokumenty specyficzne dla dwucyfrowego działu CPV pozycji planu. */
const DOKUMENTY_CPV = {
  45: [
    {
      klucz: 'uprawnienia_budowlane',
      nazwa: 'Uprawnienia budowlane i wykaz osób (kierownik budowy)',
      powod: 'Roboty budowlane (CPV 45) wymagają wykazania osób z uprawnieniami.',
    },
    {
      klucz: 'potencjal_techniczny',
      nazwa: 'Wykaz sprzętu i potencjału technicznego',
      powod: 'Roboty budowlane wymagają wykazania zaplecza sprzętowego.',
    },
  ],
  71: [
    {
      klucz: 'uprawnienia_projektowe',
      nazwa: 'Uprawnienia projektowe i przynależność do izby',
      powod: 'Usługi projektowe (CPV 71) wymagają uprawnień i wpisu do właściwej izby.',
    },
  ],
};

/** Gdy dział CPV nie ma własnego zestawu (albo brak CPV) — ogólny warunek zdolności. */
const DOKUMENTY_CPV_DOMYSLNE = [
  {
    klucz: 'wykaz_osob',
    nazwa: 'Wykaz osób skierowanych do realizacji zamówienia',
    powod: 'Warunek zdolności zawodowej — wykazanie kadry do realizacji.',
  },
];

const DOKUMENT_WADIUM = {
  klucz: 'wadium',
  nazwa: 'Środki lub gwarancja wadialna',
  powod: `Skala zamówienia (≥ ${formatujZl(PROG_WADIUM)}) — zamawiający zwykle żąda wadium.`,
};

const DOKUMENT_ZDOLNOSC = {
  klucz: 'zdolnosc_finansowa',
  nazwa: 'Informacja o zdolności kredytowej / sytuacji finansowej',
  powod: `Duża wartość (≥ ${formatujZl(PROG_ZDOLNOSC_FINANSOWA)}) — częsty warunek zdolności ekonomicznej.`,
};

const DOKUMENT_POLISA = {
  klucz: 'polisa_oc',
  nazwa: 'Polisa OC na sumę adekwatną do skali zamówienia',
  powod: `Duża wartość (≥ ${formatujZl(PROG_ZDOLNOSC_FINANSOWA)}) — wymagane ubezpieczenie odpowiedniej wysokości.`,
};

/**
 * Składa listę dokumentów do skompletowania: bazowe + wg działu CPV + wg wartości.
 * Duplikaty (ten sam `klucz`) łączy do jednego wpisu; `posiadany` bierze z profilu.
 */
function dobierzDokumenty({ dzialy, wartosc, posiadaneSet }) {
  const wybrane = [...DOKUMENTY_BAZOWE];

  const cpvDocs = [];
  for (const d of dzialy) {
    if (DOKUMENTY_CPV[d]) cpvDocs.push(...DOKUMENTY_CPV[d]);
  }
  wybrane.push(...(cpvDocs.length ? cpvDocs : DOKUMENTY_CPV_DOMYSLNE));

  if (wartosc != null && wartosc >= PROG_WADIUM) wybrane.push(DOKUMENT_WADIUM);
  if (wartosc != null && wartosc >= PROG_ZDOLNOSC_FINANSOWA) wybrane.push(DOKUMENT_ZDOLNOSC, DOKUMENT_POLISA);

  const widziane = new Set();
  const dokumenty = [];
  for (const d of wybrane) {
    if (widziane.has(d.klucz)) continue;
    widziane.add(d.klucz);
    dokumenty.push(Object.freeze({ ...d, posiadany: posiadaneSet.has(d.klucz) }));
  }
  return dokumenty;
}

// ─────────────────────────── flaga konsorcjum ──────────────────────────────

/**
 * Rozstrzyga, czy do udźwignięcia pozycji trzeba partnera do konsorcjum, wg dwóch
 * sygnałów względem zasobów w profilu: (1) orientacyjna wartość przekracza samodzielny
 * potencjał firmy, (2) zakres (dział CPV) w ogóle nie pokrywa się z kompetencjami firmy.
 */
function ocenKonsorcjum({ wartosc, maksPotencjal, dzialyPozycji, dzialyProfilu }) {
  const przekraczaWartosc = wartosc != null && maksPotencjal != null && wartosc > maksPotencjal;
  const pozaZakresem = dzialyPozycji.length > 0
    && dzialyProfilu.length > 0
    && !dzialyPozycji.some((d) => dzialyProfilu.includes(d));

  const powody = [];
  if (przekraczaWartosc) {
    powody.push(
      `Orientacyjna wartość (${formatujZl(wartosc)}) przekracza Twój samodzielny potencjał `
      + `(${formatujZl(maksPotencjal)}) — rozważ konsorcjum, by spełnić warunek zdolności.`,
    );
  }
  if (pozaZakresem) {
    powody.push(
      `Zakres (CPV dział ${dzialyPozycji.join(', ')}) wykracza poza kompetencje z profilu `
      + '— potrzebny partner z tą specjalizacją.',
    );
  }

  return Object.freeze({
    potrzebnyPartner: przekraczaWartosc || pozaZakresem,
    powody: Object.freeze(powody),
  });
}

// ─────────────────────────── kamienie milowe ───────────────────────────────

const KAMIENIE_TYTULY = {
  partner: 'Zabezpiecz partnera do konsorcjum (list intencyjny)',
  dokumenty: 'Skompletuj dokumenty podmiotowe i referencje',
  moce: 'Zarezerwuj moce przerobowe i kadrę',
  finansowanie: 'Przygotuj wadium / zabezpieczenie finansowe',
  gotowosc: 'Finalny przegląd gotowości i śledzenie ogłoszenia',
};

/**
 * Buduje kamienie milowe cofnięte o `KAMIENIE_DNI_PRZED[klucz]` dni od terminu wszczęcia.
 * Gdy termin nieznany (`wszczecieMs === null`) — offsety zostają, daty są null.
 * Sortuje malejąco wg `dniPrzed` (= rosnąco wg daty: najpilniejsze na górze).
 */
function budujKamienie({ potrzebnyPartner, wadiumWymagane, wszczecieMs, dzisiajMs }) {
  const klucze = ['dokumenty', 'moce', 'gotowosc'];
  if (potrzebnyPartner) klucze.push('partner');
  if (wadiumWymagane) klucze.push('finansowanie');

  const kamienie = klucze.map((klucz) => {
    const dniPrzed = KAMIENIE_DNI_PRZED[klucz];
    const ms = wszczecieMs != null ? wszczecieMs - dniPrzed * DZIEN_MS : null;
    const data = ms != null ? formatIso(ms) : null;
    const dniOdDzis = (ms != null && dzisiajMs != null)
      ? Math.round((ms - dzisiajMs) / DZIEN_MS)
      : null;
    return Object.freeze({
      klucz,
      tytul: KAMIENIE_TYTULY[klucz],
      dniPrzed,
      data,
      dniOdDzis,
      minelo: dniOdDzis != null && dniOdDzis < 0,
    });
  });

  kamienie.sort((a, b) => b.dniPrzed - a.dniPrzed);
  return kamienie;
}

// ─────────────────────────── funkcja publiczna ─────────────────────────────

/**
 * Generuje plan przygotowań dla jednej wykrytej pozycji rocznego planu postępowań.
 *
 * @param {{pozycja?: object, profil?: {cpv?: string[], maksymalnaWartoscKontraktu?: number,
 *   posiadaneDokumenty?: string[]}, dzisiaj?: string}} wejscie — `dzisiaj` w formacie
 *   „YYYY-MM-DD" (wstrzykiwane, bez Date.now); jeśli brak, bierzemy `profil.dzisiaj`.
 * @returns {Readonly<{wszczecieData: string|null, miesiacyDoWszczecia: number|null,
 *   konsorcjum: Readonly<{potrzebnyPartner: boolean, powody: string[]}>,
 *   dokumenty: ReadonlyArray<Readonly<{klucz: string, nazwa: string, powod: string,
 *     posiadany: boolean}>>, doKompletowania: ReadonlyArray<object>,
 *   kamienieMilowe: ReadonlyArray<Readonly<{klucz: string, tytul: string, dniPrzed: number,
 *     data: string|null, dniOdDzis: number|null, minelo: boolean}>>,
 *   startRezerwacjiMocy: object, startPrzygotowanIso: string|null, dniDoStartu: number|null,
 *   komunikat: string}>} Zamrożony plan przygotowań.
 */
export function generujPlanPrzygotowan({ pozycja, profil, dzisiaj } = {}) {
  const poz = pozycja ?? {};
  const prof = profil ?? {};

  // ── wartość, zakres i zasoby z profilu ──
  const wartosc = wartoscZ(poz);
  const maksPotencjal = maksPotencjalZ(prof);
  const dzialyPozycji = cpvDivisions(cpvZ(poz));
  const dzialyProfilu = cpvDivisions(prof.cpv ?? []);
  const posiadaneSet = new Set(prof.posiadaneDokumenty ?? []);

  const konsorcjum = ocenKonsorcjum({ wartosc, maksPotencjal, dzialyPozycji, dzialyProfilu });
  const dokumenty = dobierzDokumenty({ dzialy: dzialyPozycji, wartosc, posiadaneSet });
  const wadiumWymagane = wartosc != null && wartosc >= PROG_WADIUM;

  // ── oś czasu: termin wszczęcia (reuse parsera radaru) i wstrzyknięte „dzisiaj" ──
  const termin = parsujTermin(poz.terminWszczecia ?? poz.przewidywanyTerminWszczecia);
  const dzis = parsujDzien(dzisiaj ?? prof.dzisiaj);
  const wszczecieMs = termin ? naMs(termin.rok, termin.miesiac, 1) : null;
  const dzisiajMs = dzis ? naMs(dzis.rok, dzis.miesiac, dzis.dzien) : null;
  const miesiacyDoWszczecia = (termin && dzis)
    ? (termin.rok - dzis.rok) * 12 + (termin.miesiac - dzis.miesiac)
    : null;

  const kamienieMilowe = budujKamienie({
    potrzebnyPartner: konsorcjum.potrzebnyPartner,
    wadiumWymagane,
    wszczecieMs,
    dzisiajMs,
  });

  const startRezerwacjiMocy = kamienieMilowe.find((k) => k.klucz === 'moce');
  const najwczesniejszy = kamienieMilowe[0];
  const startPrzygotowanIso = najwczesniejszy?.data ?? null;
  const dniDoStartu = najwczesniejszy?.dniOdDzis ?? null;

  // ── jednozdaniowy komunikat ──
  let komunikat;
  if (termin == null) {
    komunikat = 'Termin wszczęcia w planie jest nieokreślony — ustaw przypomnienie i monitoruj aktualizacje planu.';
  } else if (dniDoStartu != null && dniDoStartu <= 0) {
    komunikat = `Najwyższy czas na przygotowania — planowy start minął ${-dniDoStartu} dni temu; `
      + `do wszczęcia zostało ok. ${miesiacyDoWszczecia} mies.`;
  } else {
    komunikat = `Zacznij przygotowania za ok. ${dniDoStartu} dni; masz ${miesiacyDoWszczecia} mies. do wszczęcia.`;
  }

  return Object.freeze({
    wszczecieData: wszczecieMs != null ? formatIso(wszczecieMs) : null,
    miesiacyDoWszczecia,
    konsorcjum,
    dokumenty: Object.freeze(dokumenty),
    doKompletowania: Object.freeze(dokumenty.filter((d) => !d.posiadany)),
    kamienieMilowe: Object.freeze(kamienieMilowe),
    startRezerwacjiMocy,
    startPrzygotowanIso,
    dniDoStartu,
    komunikat,
  });
}
