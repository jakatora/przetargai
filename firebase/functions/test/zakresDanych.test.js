import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Ekran „Zakres danych" (P1-4) — czysta logika.
 *
 * Produkt, który zbiera ogłoszenia z trzech rejestrów, bardzo łatwo daje się
 * przeczytać jako „wszystkie przetargi w Polsce". To NIEPRAWDA: BIP-y zamawiających,
 * platformy zakupowe bez publicznego API i zamówienia prywatne nie mają feedu,
 * z którego dałoby się je legalnie pobrać. Wykonawca, który uwierzy w komplet,
 * przegapi postępowanie i obwini aplikację — słusznie.
 *
 * Ten moduł zamienia surowe ślady (`_health/cykl`, checkpointy okien) na uczciwy
 * opis: co obejmujemy, kiedy to ostatnio zadziałało i czego NIE widzimy.
 */

const { zbudujZakresDanych, PROG_OPOZNIENIA_H } = await import('../src/lib/zakresDanych.js');

const TERAZ = '2026-09-24T12:00:00.000Z';
const godzinTemu = (h) => new Date(Date.parse(TERAZ) - h * 3_600_000).toISOString();

const wejscie = (nad = {}) => ({
  teraz: TERAZ,
  wlaczone: { bzp: true, ted: true, baza_konkurencyjnosci: true },
  zrodlaCyklu: {
    bzp: { ostatni_sukces_o: godzinTemu(2), ostatni_blad_o: null, ostatni_blad: null },
    ted: { ostatni_sukces_o: godzinTemu(1), ostatni_blad_o: null, ostatni_blad: null },
    baza_konkurencyjnosci: { ostatni_sukces_o: godzinTemu(3), ostatni_blad_o: null, ostatni_blad: null },
  },
  ...nad,
});

test('opisuje wszystkie trzy obsługiwane rejestry, po polsku i po angielsku', () => {
  const z = zbudujZakresDanych(wejscie());
  assert.deepEqual(z.zrodla.map((s) => s.kod), ['bzp', 'ted', 'baza_konkurencyjnosci']);
  for (const s of z.zrodla) {
    assert.ok(s.nazwa.pl && s.nazwa.en, `${s.kod} bez nazwy PL/EN`);
    assert.ok(s.zakres.pl && s.zakres.en, `${s.kod} bez opisu zakresu PL/EN`);
    assert.ok(s.stan_opis.pl && s.stan_opis.en, `${s.kod} bez opisu stanu PL/EN`);
  }
});

test('świeży sukces daje stan „ok" i policzony wiek', () => {
  const bzp = zbudujZakresDanych(wejscie()).zrodla.find((s) => s.kod === 'bzp');
  assert.equal(bzp.stan, 'ok');
  assert.equal(bzp.godzin_od_sukcesu, 2);
  assert.equal(bzp.ostatni_blad, null);
});

test('stary sukces bez błędu to „opóźnione", nie „ok" — cisza źródła też jest awarią', () => {
  const dane = wejscie();
  dane.zrodlaCyklu.ted.ostatni_sukces_o = godzinTemu(PROG_OPOZNIENIA_H + 5);
  const ted = zbudujZakresDanych(dane).zrodla.find((s) => s.kod === 'ted');
  assert.equal(ted.stan, 'opoznione');
});

test('KRYTYCZNE: błąd NOWSZY niż ostatni sukces to awaria, i widać jego treść', () => {
  const dane = wejscie();
  dane.zrodlaCyklu.bzp = {
    ostatni_sukces_o: godzinTemu(10),
    ostatni_blad_o: godzinTemu(1),
    ostatni_blad: 'HTTP 429',
  };
  const bzp = zbudujZakresDanych(dane).zrodla.find((s) => s.kod === 'bzp');
  assert.equal(bzp.stan, 'awaria');
  assert.equal(bzp.ostatni_blad, 'HTTP 429');
  assert.match(bzp.stan_opis.pl, /HTTP 429/);
});

test('błąd STARSZY niż ostatni sukces nie zapala alarmu, ale zostaje widoczny', () => {
  const dane = wejscie();
  dane.zrodlaCyklu.bzp = {
    ostatni_sukces_o: godzinTemu(1),
    ostatni_blad_o: godzinTemu(200),
    ostatni_blad: 'timeout z lipca',
  };
  const bzp = zbudujZakresDanych(dane).zrodla.find((s) => s.kod === 'bzp');
  assert.equal(bzp.stan, 'ok');
  assert.equal(bzp.ostatni_blad_o, godzinTemu(200), 'historia błędu nie znika');
});

test('źródło wyłączone przełącznikiem mówi to wprost, zamiast udawać awarię', () => {
  const dane = wejscie({ wlaczone: { bzp: true, ted: false, baza_konkurencyjnosci: true } });
  const ted = zbudujZakresDanych(dane).zrodla.find((s) => s.kod === 'ted');
  assert.equal(ted.aktywne, false);
  assert.equal(ted.stan, 'wylaczone');
  assert.match(ted.stan_opis.pl, /wyłączon/i);
});

test('brak jakiegokolwiek śladu to „brak_danych", a nie cichy sukces', () => {
  const z = zbudujZakresDanych(wejscie({ zrodlaCyklu: {} }));
  for (const s of z.zrodla) {
    assert.equal(s.stan, 'brak_danych');
    assert.equal(s.ostatni_sukces_o, null);
    assert.equal(s.godzin_od_sukcesu, null);
  }
});

test('pokrycie okna BK i BZP dochodzi do właściwego źródła', () => {
  const z = zbudujZakresDanych(wejscie({
    oknoBzp: { zakonczony_o: godzinTemu(1), doby_okna: 8, doby_niedomkniete: 0 },
    oknoBk: { zakonczony_o: godzinTemu(2), aktywne_w_zrodle: 1135, aktywne_pobrane: 1135, pokrycie_kompletne: true, zaleglosc: 0 },
  }));
  const bk = z.zrodla.find((s) => s.kod === 'baza_konkurencyjnosci');
  assert.equal(bk.pokrycie.aktywne_w_zrodle, 1135);
  assert.equal(bk.pokrycie.kompletne, true);
  const bzp = z.zrodla.find((s) => s.kod === 'bzp');
  assert.equal(bzp.pokrycie.doby_niedomkniete, 0);
  assert.equal(z.zrodla.find((s) => s.kod === 'ted').pokrycie, null);
});

test('niedomknięte okno BK mówi wprost, że część rynku mogła nie wejść', () => {
  const z = zbudujZakresDanych(wejscie({
    oknoBk: { zakonczony_o: godzinTemu(2), aktywne_w_zrodle: 1135, aktywne_pobrane: 900, pokrycie_kompletne: false, zaleglosc: 235 },
  }));
  const bk = z.zrodla.find((s) => s.kod === 'baza_konkurencyjnosci');
  assert.equal(bk.pokrycie.kompletne, false);
  assert.match(bk.pokrycie.opis.pl, /900/);
  assert.match(bk.pokrycie.opis.en, /900/);
});

test('KRYTYCZNE: lista rzeczy NIEOBJĘTYCH wymienia BIP, platformy bez feedu i zamówienia prywatne', () => {
  const z = zbudujZakresDanych(wejscie());
  const kody = z.nieobjete.map((n) => n.kod);
  assert.ok(kody.includes('bip'), 'BIP zamawiającego');
  assert.ok(kody.includes('platformy_bez_api'), 'platformy zakupowe bez publicznego API');
  assert.ok(kody.includes('prywatne'), 'zamówienia prywatne/komercyjne');
  for (const n of z.nieobjete) {
    assert.ok(n.tytul.pl && n.tytul.en && n.opis.pl && n.opis.en, `${n.kod} bez opisu PL/EN`);
  }
});

test('KRYTYCZNE: zastrzeżenie NIE obiecuje wszystkich przetargów w Polsce', () => {
  const z = zbudujZakresDanych(wejscie());
  assert.ok(z.zastrzezenie.pl.length > 40);
  assert.ok(z.zastrzezenie.en.length > 40);
  assert.doesNotMatch(z.zastrzezenie.pl, /wszystkie przetargi w Polsce/i);
  assert.match(z.zastrzezenie.pl, /nie\s|bez /i);
  assert.match(z.zastrzezenie.en, /not|no /i);
});

/*
 * Pomiar na produkcji (2026-09-24): karta ogłoszenia pokazywała „brak śladu
 * pobrania" dla WSZYSTKICH źródeł, choć okna BZP i BK domknęły się tej samej
 * nocy. Ślad dobowego cyklu pochodził sprzed naprawy lepkiego merge'a i nie
 * miał historii per źródło — a checkpointy okien, świeższe i pewniejsze, leżały
 * obok nieużyte. Okno 3-godzinne jest bliżej prawdy niż cykl dobowy.
 */

test('KRYTYCZNE: checkpoint okna zastępuje brakujący ślad cyklu', () => {
  const z = zbudujZakresDanych(wejscie({
    zrodlaCyklu: {},
    oknoBzp: { zakonczony_o: godzinTemu(1), doby_okna: 8, doby_niedomkniete: 0, error: null },
    oknoBk: { zakonczony_o: godzinTemu(2), aktywne_w_zrodle: 10, aktywne_pobrane: 10, pokrycie_kompletne: true, error: null },
  }));
  const bzp = z.zrodla.find((s) => s.kod === 'bzp');
  assert.equal(bzp.stan, 'ok');
  assert.equal(bzp.ostatni_sukces_o, godzinTemu(1));

  const bk = z.zrodla.find((s) => s.kod === 'baza_konkurencyjnosci');
  assert.equal(bk.stan, 'ok');
  assert.equal(bk.ostatni_sukces_o, godzinTemu(2));

  // TED nie ma własnego okna — dla niego brak śladu cyklu nadal znaczy brak danych.
  assert.equal(z.zrodla.find((s) => s.kod === 'ted').stan, 'brak_danych');
});

test('błąd w oknie liczy się jak awaria źródła', () => {
  const z = zbudujZakresDanych(wejscie({
    zrodlaCyklu: {},
    oknoBk: { zakonczony_o: godzinTemu(1), error: 'HTTP 503 z listy BK' },
  }));
  const bk = z.zrodla.find((s) => s.kod === 'baza_konkurencyjnosci');
  assert.equal(bk.stan, 'awaria');
  assert.match(bk.stan_opis.pl, /503/);
});

test('nowszy sukces wygrywa — bierzemy świeższy z dwóch śladów', () => {
  const z = zbudujZakresDanych(wejscie({
    oknoBzp: { zakonczony_o: godzinTemu(20), doby_niedomkniete: 0, error: null },
  }));
  // W `wejscie()` cykl BZP ma sukces 2 h temu — świeższy niż okno sprzed 20 h.
  assert.equal(z.zrodla.find((s) => s.kod === 'bzp').godzin_od_sukcesu, 2);
});
