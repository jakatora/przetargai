import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * DEDUPLIKACJA MIĘDZY REJESTRAMI (etap 3).
 *
 * Do tej pory każde źródło deduplikowało się SAMO — po `externalId`. To wystarczało,
 * dopóki rejestry się nie nakładały. Baza Konkurencyjności nakłada się z BZP: ten sam
 * zamawiający potrafi ogłosić postępowanie współfinansowane z UE w OBU rejestrach,
 * a identyfikatory są wtedy zupełnie różne (`bzp:2026/BZP-00123` vs `bk:292028`).
 * Bez tego kroku użytkownik dostaje to samo zamówienie dwa razy — i dwa razy płaci
 * za nie uwagą, a konto Free także swoim dziennym limitem dopasowań.
 *
 * ZAŁOŻONA ASYMETRIA RYZYKA: zgubiony przetarg kosztuje kontrakt, zdublowany kosztuje
 * jedno przewinięcie listy. Dlatego klucz jest WĄSKI (tytuł + dzień terminu +
 * zamawiający) — wolimy pokazać duplikat niż scalić dwa różne zamówienia.
 */

process.env.ANTHROPIC_API_KEY = '';

const { kluczOgloszenia, scalMiedzyZrodlami, PRIORYTET_ZRODEL } =
  await import('../src/lib/dedupZrodel.js');

const ogloszenie = (over = {}) => ({
  externalId: 'x-1',
  title: 'Budowa drogi gminnej w Żabnie',
  organization: 'Gmina Żabno',
  deadline: '2026-10-15T09:59:59.000Z',
  source: 'bzp',
  url: 'https://ezamowienia.gov.pl/x',
  ...over,
});

/* ============================== klucz ============================== */

test('ten sam przetarg w dwóch rejestrach daje TEN SAM klucz mimo różnych identyfikatorów', () => {
  const zBzp = ogloszenie({ externalId: 'bzp:1', source: 'bzp' });
  const zBk = ogloszenie({ externalId: 'bk:292028', source: 'baza_konkurencyjnosci', url: 'https://bk/1' });
  assert.equal(kluczOgloszenia(zBzp), kluczOgloszenia(zBk));
});

test('klucz nie widzi wielkości liter, diakrytyków, interpunkcji ani podwójnych spacji', () => {
  const a = ogloszenie({ title: 'Budowa drogi gminnej w Żabnie' });
  const b = ogloszenie({ title: '  BUDOWA   DROGI, GMINNEJ w Zabnie!  ' });
  assert.equal(kluczOgloszenia(a), kluczOgloszenia(b));
});

test('forma prawna zamawiającego nie rozdziela tego samego podmiotu', () => {
  const a = ogloszenie({ organization: 'Zakład Usług Komunalnych Sp. z o.o.' });
  const b = ogloszenie({ organization: 'ZAKŁAD USŁUG KOMUNALNYCH SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ' });
  assert.equal(kluczOgloszenia(a), kluczOgloszenia(b));
});

test('RÓŻNI zamawiający z identycznym tytułem to NIE jest duplikat', () => {
  const a = ogloszenie({ title: 'Dostawa artykułów biurowych', organization: 'Gmina A' });
  const b = ogloszenie({ title: 'Dostawa artykułów biurowych', organization: 'Gmina B' });
  assert.notEqual(kluczOgloszenia(a), kluczOgloszenia(b),
    'generyczne tytuły powtarzają się w całej Polsce — scalenie ukryłoby prawdziwe zamówienie');
});

test('inny dzień składania ofert to inne postępowanie (np. powtórzone po unieważnieniu)', () => {
  const a = ogloszenie({ deadline: '2026-10-15T09:59:59.000Z' });
  const b = ogloszenie({ deadline: '2026-11-15T09:59:59.000Z' });
  assert.notEqual(kluczOgloszenia(a), kluczOgloszenia(b));
});

test('ta sama doba, inna godzina odcięcia => nadal ten sam przetarg', () => {
  const a = ogloszenie({ deadline: '2026-10-15T07:00:00.000Z' });
  const b = ogloszenie({ deadline: '2026-10-15T09:59:59.000Z' });
  assert.equal(kluczOgloszenia(a), kluczOgloszenia(b),
    'rejestry zapisują godzinę odcięcia różnie — doba wystarczy do identyfikacji');
});

test('brak danych do klucza => `null`, czyli ogłoszenie NIE jest z niczym scalane', () => {
  assert.equal(kluczOgloszenia({ title: 'X', organization: null, deadline: null }), null);
  assert.equal(kluczOgloszenia({ title: '', organization: 'Gmina', deadline: '2026-10-15T00:00:00Z' }), null);
  assert.equal(kluczOgloszenia(null), null);
});

/* ============================== scalanie ============================== */

test('duplikat zostaje w rejestrze URZĘDOWYM, a nie w tym, który przyszedł pierwszy', () => {
  const zBk = ogloszenie({ externalId: 'bk:292028', source: 'baza_konkurencyjnosci', url: 'https://bk/292028' });
  const zBzp = ogloszenie({ externalId: 'bzp:1', source: 'bzp', url: 'https://ezamowienia.gov.pl/1' });

  const wynik = scalMiedzyZrodlami([
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [zBk] },
    { zrodlo: 'bzp', ogloszenia: [zBzp] },
  ]);

  assert.equal(wynik.ogloszenia.length, 1);
  assert.equal(wynik.ogloszenia[0].externalId, 'bzp:1', 'BZP jest rejestrem pierwotnym dla postępowań wg Pzp');
  assert.equal(wynik.duplikaty, 1);
});

test('scalony wpis NIESIE link do drugiego rejestru (zamawiający prowadzi sprawę tam)', () => {
  const zBzp = ogloszenie({ externalId: 'bzp:1', source: 'bzp', url: 'https://ezamowienia.gov.pl/1' });
  const zBk = ogloszenie({ externalId: 'bk:292028', source: 'baza_konkurencyjnosci', url: 'https://bk/292028' });

  const [scalone] = scalMiedzyZrodlami([
    { zrodlo: 'bzp', ogloszenia: [zBzp] },
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [zBk] },
  ]).ogloszenia;

  assert.deepEqual(scalone.zrodla_alternatywne, [
    { source: 'baza_konkurencyjnosci', externalId: 'bk:292028', url: 'https://bk/292028' },
  ]);
  assert.equal(scalone.url, 'https://ezamowienia.gov.pl/1', 'link główny prowadzi do źródła pierwotnego');
});

test('scalenie UZUPEŁNIA braki: budżet z BK trafia na wpis z BZP, który go nie miał', () => {
  const zBzp = ogloszenie({ externalId: 'bzp:1', source: 'bzp', budget: null, cpvMain: null });
  const zBk = ogloszenie({ externalId: 'bk:2', source: 'baza_konkurencyjnosci', budget: 84_000, cpvMain: '45000000-7' });

  const [scalone] = scalMiedzyZrodlami([
    { zrodlo: 'bzp', ogloszenia: [zBzp] },
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [zBk] },
  ]).ogloszenia;

  assert.equal(scalone.budget, 84_000, 'pusta wartość w rejestrze wiodącym nie może wygrać z realną liczbą');
  assert.equal(scalone.cpvMain, '45000000-7');
});

test('scalenie NIE nadpisuje danych rejestru wiodącego tymi z rejestru pobocznego', () => {
  const zBzp = ogloszenie({ externalId: 'bzp:1', source: 'bzp', budget: 100 });
  const zBk = ogloszenie({ externalId: 'bk:2', source: 'baza_konkurencyjnosci', budget: 999 });

  const [scalone] = scalMiedzyZrodlami([
    { zrodlo: 'bzp', ogloszenia: [zBzp] },
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [zBk] },
  ]).ogloszenia;

  assert.equal(scalone.budget, 100);
  assert.equal(scalone.source, 'bzp');
});

test('ogłoszenie bez klucza przechodzi NIETKNIĘTE (lepiej duplikat niż zgubiony przetarg)', () => {
  const bezTerminu = ogloszenie({ externalId: 'bk:3', source: 'baza_konkurencyjnosci', deadline: null });
  const wynik = scalMiedzyZrodlami([
    { zrodlo: 'bzp', ogloszenia: [ogloszenie({ externalId: 'bzp:1' })] },
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [bezTerminu] },
  ]);
  assert.equal(wynik.ogloszenia.length, 2);
  assert.equal(wynik.duplikaty, 0);
});

test('duplikaty WEWNĄTRZ jednego źródła też się scalają (rejestr bywa niespójny)', () => {
  const wynik = scalMiedzyZrodlami([{
    zrodlo: 'bzp',
    ogloszenia: [ogloszenie({ externalId: 'bzp:1' }), ogloszenie({ externalId: 'bzp:2' })],
  }]);
  assert.equal(wynik.ogloszenia.length, 1);
  assert.equal(wynik.ogloszenia[0].externalId, 'bzp:1', 'wygrywa pierwszy napotkany');
  assert.equal(wynik.duplikaty, 1);
});

test('liczniki per źródło mówią, ILE scalono z KTÓREGO rejestru (bez tego audyt zgaduje)', () => {
  const wynik = scalMiedzyZrodlami([
    { zrodlo: 'bzp', ogloszenia: [ogloszenie({ externalId: 'bzp:1' })] },
    { zrodlo: 'ted', ogloszenia: [ogloszenie({ externalId: 'ted:1', source: 'ted' })] },
    { zrodlo: 'baza_konkurencyjnosci', ogloszenia: [ogloszenie({ externalId: 'bk:1', source: 'baza_konkurencyjnosci' })] },
  ]);

  assert.equal(wynik.ogloszenia.length, 1);
  assert.equal(wynik.duplikaty, 2);
  assert.deepEqual(wynik.wgZrodla, { bzp: 0, ted: 1, baza_konkurencyjnosci: 1 });
});

test('pusta i pominięta lista nie wywracają scalania', () => {
  assert.deepEqual(scalMiedzyZrodlami([]).ogloszenia, []);
  assert.deepEqual(scalMiedzyZrodlami([{ zrodlo: 'bzp', ogloszenia: null }]).ogloszenia, []);
});

test('PRIORYTET_ZRODEL zaczyna się od BZP — rejestru urzędowego dla Pzp', () => {
  assert.equal(PRIORYTET_ZRODEL[0], 'bzp');
  assert.ok(PRIORYTET_ZRODEL.includes('baza_konkurencyjnosci'));
  assert.ok(
    PRIORYTET_ZRODEL.indexOf('baza_konkurencyjnosci') > PRIORYTET_ZRODEL.indexOf('ted'),
    'BK jest rejestrem beneficjenta, nie zamawiającego publicznego — ustępuje obu urzędowym',
  );
});
