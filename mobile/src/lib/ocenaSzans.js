/**
 * Ocena szans i rekomendacja — podzadanie 11/13 ulepszenia „Prześwietlenie oferty
 * zwycięzcy i szansa na odwołanie".
 *
 * Warstwa decyzji: bierze zarzuty wykryte przez silnik reguł odrzucenia
 * ({@link ./silnikRegulOdrzucenia analizuj_oferte_zwyciezcy}) oraz wgrane dokumenty
 * i wydaje użytkownikowi KONKRETNĄ decyzję — listę potencjalnych zarzutów, ocenę
 * szans (niska/średnia/wysoka) i JEDNOZNACZNĄ rekomendację „jest podstawa, walcz"
 * albo „odpuść". Zapis wyniku do rekordu kontroli (status „analiza_gotowa") robi
 * {@link ./poprzetargowaKontrola zapiszAnalize}.
 *
 * DLACZEGO DETERMINISTYCZNIE, A NIE PŁATNYM MODELEM: w specyfikacji to „warstwa AI",
 * ale realnie jest to przeliczenie sił zarzutów, które reguły już wyznaczyły wg
 * konkretnych przepisów Pzp. Trzymamy to jako czystą, testowalną funkcję (bez
 * płatnego API, bez Date.now()) z dwóch powodów:
 *  1. Powtarzalność — te same przesłanki zawsze dają tę samą decyzję; użytkownik nie
 *     dostaje raz „walcz", raz „odpuść" dla identycznych danych.
 *  2. Ścieżka pieniędzy — rekomendacja „walcz" popycha do wpisu do KIO (koszt rzędu
 *     kilku–kilkunastu tys. zł), więc próg musi być jawny i obronny, a nie ukryty w
 *     niedeterministycznej odpowiedzi modelu. Zawyżamy poprzeczkę dla „walcz":
 *     rekomendujemy walkę dopiero, gdy jest realna (co najmniej jedna umiarkowana
 *     przesłanka), a nie przy samych słabych formalnościach.
 *
 * Defensywna jak reszta lib: nigdy nie rzuca, przy braku danych zwraca pełny kształt.
 */

import { SILA_ZARZUTU } from './regulaRazacoNiskaCena.js';

/**
 * Skala oceny szans w odwołaniu — od najniższej do najwyższej (kolejność znacząca,
 * jak {@link SILA_ZARZUTU}). Prezentacyjny odpowiednik zagregowanej siły zarzutów.
 */
export const OCENA_SZANS = ['niska', 'srednia', 'wysoka'];

/** Jednoznaczne rekomendacje ze specyfikacji — kontrakt dla UI i zapisu do rekordu. */
export const REKOMENDACJA_WALCZ = Object.freeze({ wartosc: 'walcz', etykieta: 'jest podstawa, walcz' });
export const REKOMENDACJA_ODPUSC = Object.freeze({ wartosc: 'odpusc', etykieta: 'odpuść' });

/**
 * Wagi sił zarzutu, ustawione równolegle do {@link SILA_ZARZUTU} (slaba, umiarkowana,
 * mocna). Dobrane tak, by:
 *  - słabe formalności same z siebie nie robiły podstawy (1 + 1 = 2 < próg „walcz"),
 *  - jedna przesłanka umiarkowana była już podstawą (3 ≥ próg „walcz"),
 *  - dwie umiarkowane albo jedna mocna dawały wysokie szanse (6 ≥ próg „wysoka").
 * Trzymane w tablicy równoległej do skali (nie w mapie po nazwie), żeby test mógł
 * pilnować, że każda siła ze skali ma wagę — a nowa siła nie przejdzie po cichu.
 */
export const WAGI_SILY = [1, 3, 6];

/** Progi zagregowanych punktów: < PROG_SREDNIA → niska; < PROG_WYSOKA → średnia; wyżej → wysoka. */
const PROG_SREDNIA = 3;
const PROG_WYSOKA = 6;

/** Kategorie dokumentów, których komplet daje pełną (nie wstępną) analizę. */
const KATEGORIE_WYMAGANE = ['ofertaZwyciezcy', 'protokol'];

/** Waga danej siły wg skali; nieznana/brak/nieokreślona waga → 0 (nie wywraca oceny, nigdy NaN). */
function wagaSily(sila) {
  const i = SILA_ZARZUTU.indexOf(sila);
  return i >= 0 ? (WAGI_SILY[i] ?? 0) : 0;
}

/**
 * Sprowadza wejście `zarzuty` do tablicy zarzutów. Przyjmuje zarówno agregat z silnika
 * (`{ zarzuty: [...], liczba, najwyzszaSila }`), jak i gołą tablicę — UI może podać
 * jedno albo drugie. Wszystko inne → pusta tablica (nie zgadujemy).
 */
function naListeZarzutow(zarzuty) {
  if (Array.isArray(zarzuty)) return zarzuty;
  if (zarzuty && typeof zarzuty === 'object' && Array.isArray(zarzuty.zarzuty)) {
    return zarzuty.zarzuty;
  }
  return [];
}

/** Czy w danej kategorii jest co najmniej jeden wgrany plik. */
function maPliki(dokumenty, kategoria) {
  return !!dokumenty && Array.isArray(dokumenty[kategoria]) && dokumenty[kategoria].length > 0;
}

/**
 * Ocena szans i rekomendacja odwołania do KIO.
 *
 * Nazwa snake_case celowo zgodna ze specyfikacją — to kontrakt wołany przez ekran
 * analizy (podzadania UI) po zebraniu zarzutów silnikiem reguł.
 *
 * @param {Array<{rodzaj?: string, tytul?: string, opis_zarzutu?: string, sila?: string}>
 *   | {zarzuty?: Array}} zarzuty lista zarzutów albo cały agregat z
 *   {@link ./silnikRegulOdrzucenia analizuj_oferte_zwyciezcy}.
 * @param {{ofertaZwyciezcy?: Array, protokol?: Array}} [dokumenty] wgrane referencje
 *   dokumentów z rekordu kontroli — służą tylko do oznaczenia, czy analiza jest pełna
 *   czy WSTĘPNA (brak kompletu nie zmienia oceny wykrytych przesłanek, ale uczciwie o
 *   tym mówi w uzasadnieniu).
 * @returns {{
 *   zarzuty: Array,
 *   liczbaZarzutow: number,
 *   punkty: number,
 *   ocenaSzans: 'niska'|'srednia'|'wysoka',
 *   rekomendacja: {wartosc: 'walcz'|'odpusc', etykieta: string},
 *   kompletDokumentow: boolean,
 *   uzasadnienie: string,
 * }}
 */
export function ocen_szanse_i_rekomendacja(zarzuty, dokumenty) {
  const lista = naListeZarzutow(zarzuty).filter((z) => z && typeof z === 'object');

  const punkty = lista.reduce((suma, z) => suma + wagaSily(z.sila), 0);

  let ocenaSzans;
  if (punkty >= PROG_WYSOKA) ocenaSzans = 'wysoka';
  else if (punkty >= PROG_SREDNIA) ocenaSzans = 'srednia';
  else ocenaSzans = 'niska';

  // Jednoznacznie: walczymy, gdy jest realna podstawa (≥ próg średnich szans),
  // odpuszczamy przy samych słabych formalnościach albo braku przesłanek.
  const rekomendacja = ocenaSzans === 'niska' ? REKOMENDACJA_ODPUSC : REKOMENDACJA_WALCZ;

  const kompletDokumentow = KATEGORIE_WYMAGANE.every((kat) => maPliki(dokumenty, kat));

  return {
    zarzuty: lista,
    liczbaZarzutow: lista.length,
    punkty,
    ocenaSzans,
    rekomendacja,
    kompletDokumentow,
    uzasadnienie: zbudujUzasadnienie(lista.length, ocenaSzans, rekomendacja, kompletDokumentow),
  };
}

/** Zwięzłe, czytelne uzasadnienie decyzji po polsku (baza pod nagłówek na ekranie analizy). */
function zbudujUzasadnienie(liczba, ocenaSzans, rekomendacja, kompletDokumentow) {
  const etykietaSzans = { niska: 'niskie', srednia: 'średnie', wysoka: 'wysokie' }[ocenaSzans];

  let zdanie;
  if (liczba === 0) {
    zdanie =
      'Nie wykryto przesłanek odrzucenia oferty zwycięzcy dających realną podstawę do ' +
      'odwołania. Szanse w KIO są niskie — rekomendacja: odpuść.';
  } else {
    const rzeczownik = liczba === 1 ? 'przesłankę' : 'przesłanki';
    const decyzja =
      rekomendacja.wartosc === 'walcz'
        ? 'jest podstawa do odwołania — walcz (pamiętaj o terminie na wniesienie odwołania do KIO).'
        : 'to jednak za słabe podstawy, by opłacał się wpis do KIO — odpuść.';
    zdanie =
      `Wykryto ${liczba} potencjalną/e ${rzeczownik} odrzucenia oferty zwycięzcy; ` +
      `szanse powodzenia oceniamy jako ${etykietaSzans}. Rekomendacja: ${decyzja}`;
  }

  if (!kompletDokumentow) {
    zdanie +=
      ' Uwaga: to analiza WSTĘPNA — nie wgrano jeszcze kompletu dokumentów (oferta ' +
      'zwycięzcy i protokół z załącznikami), więc część przesłanek mogła nie zostać ' +
      'zbadana i ocena może się jeszcze zmienić.';
  }

  return zdanie;
}
