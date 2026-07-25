import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wyodrebnij_pola_z_oferty,
  RODZAJE_PODPISU,
  KATALOG_OSWIADCZEN,
  KATALOG_ZASWIADCZEN,
} from '../src/lib/wyodrebnijPolaOferty.js';

/*
 * Parser dokumentów oferty zwycięzcy (podzadanie 8/13) — WYŁĄCZNIE ekstrakcja pól
 * z tekstu (warstwa tekstowa PDF / wynik OCR): cena, format podpisu, lista
 * oświadczeń, zaświadczenia + daty. Bez UI, bez oceny przesłanek odrzucenia
 * (analiza to kolejne podzadania). Zwraca dict — nigdy nie rzuca.
 *
 * „Przykładowy PDF" reprezentujemy jako tekst, jaki dałaby warstwa tekstowa /
 * OCR takiego pliku (parsowanie bajtów PDF i OCR to osobny krok integracyjny,
 * poza tą czystą funkcją).
 */

const NBSP = String.fromCharCode(0x00a0); // twarda spacja
const WASKA_NBSP = String.fromCharCode(0x202f); // wąska twarda spacja

// Przykładowa oferta zwycięzcy — tekst jak z warstwy tekstowej PDF / OCR.
const PRZYKLADOWA_OFERTA = `FORMULARZ OFERTOWY
Postępowanie nr ZP/12/2026 na dostawę sprzętu komputerowego.

Wykonawca: ACME Sp. z o.o., ul. Przykładowa 1, 00-001 Warszawa, NIP 5250000000.

W odpowiedzi na ogłoszenie oferujemy wykonanie przedmiotu zamówienia.
Cena oferty brutto: 1 234 567,89 zł
(słownie: jeden milion dwieście trzydzieści cztery tysiące ...).
Cena netto: 1 003 713,00 zł

Ofertę podpisano kwalifikowanym podpisem elektronicznym.

Do oferty załączamy:
- Oświadczenie o niepodleganiu wykluczeniu z postępowania (art. 125 ust. 1 ustawy Pzp),
- Oświadczenie o spełnianiu warunków udziału w postępowaniu,
- Jednolity Europejski Dokument Zamówienia (JEDZ),
- Oświadczenie o przynależności do grupy kapitałowej.

Zaświadczenie z ZUS z dnia 12 maja 2026 r. o niezaleganiu ze składkami.
Zaświadczenie z urzędu skarbowego z dnia 05.05.2026 o niezaleganiu w podatkach.
Informacja z KRK (o niekaralności) z dnia 2026-04-20.
Odpis z KRS z dnia 10 stycznia 2026 r.
`;

// --- Katalogi (kontrakt dla podzadań analizy przesłanek) ---

test('RODZAJE_PODPISU: trzy prawne formy podpisu elektronicznego', () => {
  assert.deepEqual(RODZAJE_PODPISU, ['kwalifikowany', 'zaufany', 'osobisty']);
});

test('KATALOG_OSWIADCZEN i KATALOG_ZASWIADCZEN mają stabilny porządek rodzajów', () => {
  assert.deepEqual(
    KATALOG_OSWIADCZEN.map((o) => o.rodzaj),
    ['niepodleganie_wykluczeniu', 'spelnianie_warunkow', 'jedz', 'grupa_kapitalowa', 'aktualnosc'],
  );
  assert.deepEqual(
    KATALOG_ZASWIADCZEN.map((z) => z.rodzaj),
    ['ZUS', 'US', 'KRK', 'KRS', 'CEIDG'],
  );
});

// --- Pełny przykład (przykładowy PDF) ---

test('pełna oferta: cena brutto (nie netto) jako liczba + waluta PLN', () => {
  const wynik = wyodrebnij_pola_z_oferty(PRZYKLADOWA_OFERTA);
  assert.equal(wynik.cena.kwota, 1234567.89);
  assert.equal(wynik.cena.waluta, 'PLN');
  assert.equal(wynik.cena.surowa, '1 234 567,89 zł');
});

test('pełna oferta: format podpisu = kwalifikowany', () => {
  const wynik = wyodrebnij_pola_z_oferty(PRZYKLADOWA_OFERTA);
  assert.equal(wynik.formatPodpisu, 'kwalifikowany');
});

test('pełna oferta: wykryte cztery oświadczenia w porządku katalogu', () => {
  const wynik = wyodrebnij_pola_z_oferty(PRZYKLADOWA_OFERTA);
  assert.deepEqual(
    wynik.oswiadczenia.map((o) => o.rodzaj),
    ['niepodleganie_wykluczeniu', 'spelnianie_warunkow', 'jedz', 'grupa_kapitalowa'],
  );
  // każda pozycja niesie etykietę do pokazania na liście
  assert.ok(wynik.oswiadczenia.every((o) => typeof o.etykieta === 'string' && o.etykieta.length > 0));
});

test('pełna oferta: zaświadczenia z datami (ISO, kropki, słowny miesiąc)', () => {
  const wynik = wyodrebnij_pola_z_oferty(PRZYKLADOWA_OFERTA);
  assert.deepEqual(
    wynik.zaswiadczenia.map((z) => [z.rodzaj, z.data]),
    [
      ['ZUS', '2026-05-12'],
      ['US', '2026-05-05'],
      ['KRK', '2026-04-20'],
      ['KRS', '2026-01-10'],
    ],
  );
});

// --- Wejście: różne kształty `plik` ---

test('akceptuje string, { tekst }, { text }, { nazwa, tresc } — i przenosi nazwę pliku', () => {
  const zeStringa = wyodrebnij_pola_z_oferty('Cena oferty brutto: 100,00 zł');
  assert.equal(zeStringa.cena.kwota, 100);
  assert.equal(zeStringa.nazwaPliku, null);

  assert.equal(wyodrebnij_pola_z_oferty({ tekst: 'Cena: 100,00 zł' }).cena.kwota, 100);
  assert.equal(wyodrebnij_pola_z_oferty({ text: 'Cena: 100,00 zł' }).cena.kwota, 100);

  const zNazwa = wyodrebnij_pola_z_oferty({ nazwa: 'oferta.pdf', tresc: 'Cena: 100,00 zł' });
  assert.equal(zNazwa.cena.kwota, 100);
  assert.equal(zNazwa.nazwaPliku, 'oferta.pdf');
});

test('brak/nieczytelne wejście → pusta struktura, nigdy nie rzuca', () => {
  for (const wejscie of [null, undefined, '', '   ', 42, {}, { tekst: '' }, { uri: 'file://x' }]) {
    const wynik = wyodrebnij_pola_z_oferty(wejscie);
    assert.equal(wynik.cena.kwota, null);
    assert.equal(wynik.cena.waluta, null);
    assert.equal(wynik.cena.surowa, null);
    assert.equal(wynik.formatPodpisu, 'nieokreslony');
    assert.deepEqual(wynik.oswiadczenia, []);
    assert.deepEqual(wynik.zaswiadczenia, []);
  }
});

// --- Cena: warianty formatu ---

test('cena z separatorem dziesiętnym kropką i bez waluty', () => {
  assert.equal(wyodrebnij_pola_z_oferty('Cena oferty: 123456.78').cena.kwota, 123456.78);
  assert.equal(wyodrebnij_pola_z_oferty('Cena oferty: 123456.78').cena.waluta, null);
});

test('cena z NBSP / wąską spacją jako separatorem tysięcy (typowe z PDF/OCR)', () => {
  // Wiele generatorów PDF wstawia twardą (U+00A0) lub wąską (U+202F) spację
  // między grupy tysięcy — parser musi je traktować jak zwykły separator.
  const zNbsp = wyodrebnij_pola_z_oferty(`Cena oferty brutto: 1${NBSP}234${NBSP}567,89 zł`).cena;
  assert.equal(zNbsp.kwota, 1234567.89);
  const zWaska = wyodrebnij_pola_z_oferty(`Cena brutto: 1${WASKA_NBSP}000${WASKA_NBSP}000,00 zł`).cena;
  assert.equal(zWaska.kwota, 1000000);
});

test('cena bez separatorów tysięcy: 246000,00 PLN', () => {
  const c = wyodrebnij_pola_z_oferty('Wartość oferty brutto: 246000,00 PLN').cena;
  assert.equal(c.kwota, 246000);
  assert.equal(c.waluta, 'PLN');
});

test('cena: gdy jest brutto i netto, wybieramy brutto', () => {
  const tekst = 'Cena netto: 100 000,00 zł\nCena brutto: 123 000,00 zł';
  assert.equal(wyodrebnij_pola_z_oferty(tekst).cena.kwota, 123000);
});

test('cena: kwota bez kontekstu „cena" nie jest brana (NIP, adres) → null', () => {
  const tekst = 'NIP 525-000-00-00, konto 12 3456 7890.\nBrak wartości oferty.';
  assert.equal(wyodrebnij_pola_z_oferty(tekst).cena.kwota, null);
});

// --- Format podpisu ---

test('podpis zaufany (profil zaufany / ePUAP)', () => {
  assert.equal(
    wyodrebnij_pola_z_oferty('Dokument podpisano profilem zaufanym ePUAP.').formatPodpisu,
    'zaufany',
  );
});

test('podpis osobisty (e-dowód)', () => {
  assert.equal(
    wyodrebnij_pola_z_oferty('Ofertę opatrzono podpisem osobistym.').formatPodpisu,
    'osobisty',
  );
});

test('format podpisu: decyduje najwcześniejsza wzmianka w tekście', () => {
  const tekst = 'Dopuszczalny podpis osobisty. Ofertę podpisano kwalifikowanym podpisem.';
  assert.equal(wyodrebnij_pola_z_oferty(tekst).formatPodpisu, 'osobisty');
});

// --- Zaświadczenia: brak daty, brak fałszywych trafień ---

test('zaświadczenie bez daty → rodzaj obecny, data null', () => {
  const wynik = wyodrebnij_pola_z_oferty('Załączamy zaświadczenie z ZUS o niezaleganiu.');
  assert.deepEqual(wynik.zaswiadczenia.map((z) => [z.rodzaj, z.data]), [['ZUS', null]]);
});

test('brak wzmianek → brak fałszywych oświadczeń/zaświadczeń', () => {
  const wynik = wyodrebnij_pola_z_oferty('Zwykły tekst bez żadnych dokumentów formalnych.');
  assert.deepEqual(wynik.oswiadczenia, []);
  assert.deepEqual(wynik.zaswiadczenia, []);
});
