import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wyjaśnienie dopasowania (P1-4) — DLACZEGO ten przetarg trafił do feedu.
 *
 * Dotąd karta niosła jedno zdanie z `match_reasoning`: albo tekst z płatnego AI,
 * albo ogólnik „Trafione słowa kluczowe: …". Użytkownik nie miał jak sprawdzić,
 * który sygnał zadziałał i co zmienić w profilu, żeby feed wyglądał inaczej.
 *
 * Ten moduł liczy sygnały z DANYCH, KTÓRE JUŻ MAMY (profil + ogłoszenie) —
 * zero wywołań AI, zero zapytań do bazy. Ta sama funkcja obsługuje kartę,
 * szczegóły i podpowiedź przy pustym feedzie.
 */

const W = await import('../src/lib/wyjasnienieDopasowania.js');

const profil = (nad = {}) => ({
  keywords: ['droga', 'chodnik'],
  cpv_codes: ['45233000'],
  ...nad,
});

const ogloszenie = (nad = {}) => ({
  title: 'Przebudowa drogi gminnej wraz z chodnikiem',
  cpv_main: '45233222-1 (Roboty w zakresie układania chodników)',
  wojewodztwo: 'PL14',
  budget: 800000,
  wadium_kwota: null,
  ...nad,
});

const sygnal = (wynik, typ) => wynik.sygnaly.find((s) => s.typ === typ);

test('każdy sygnał ma etykietę i szczegół w obu językach', () => {
  const w = W.wyjasnijDopasowanie(profil(), ogloszenie());
  assert.deepEqual(w.sygnaly.map((s) => s.typ), ['cpv', 'slowa', 'region', 'wartosc']);
  for (const s of w.sygnaly) {
    assert.ok(s.etykieta.pl && s.etykieta.en, `${s.typ} bez etykiety PL/EN`);
    assert.ok(s.szczegol.pl && s.szczegol.en, `${s.typ} bez szczegółu PL/EN`);
  }
});

test('KRYTYCZNE: sygnał CPV nazywa KONKRETNE kody, nie „zgodność CPV"', () => {
  const s = sygnal(W.wyjasnijDopasowanie(profil(), ogloszenie()), 'cpv');
  assert.equal(s.sila, 'mocny');
  assert.deepEqual(s.wartosci, ['45233000', '45233222']);
  assert.match(s.szczegol.pl, /45233222/);
  assert.match(s.szczegol.en, /45233222/);
});

test('dokładnie ten sam kod CPV jest odróżniony od zgodności działu', () => {
  const dokladny = sygnal(W.wyjasnijDopasowanie(
    profil({ cpv_codes: ['45233222'] }), ogloszenie(),
  ), 'cpv');
  assert.equal(dokladny.sila, 'mocny');
  assert.match(dokladny.szczegol.pl, /dokładnie ten sam/i);

  const dzial = sygnal(W.wyjasnijDopasowanie(
    profil({ cpv_codes: ['45000000'] }), ogloszenie(),
  ), 'cpv');
  assert.equal(dzial.sila, 'czesciowy');
  assert.match(dzial.szczegol.pl, /dział/i);
});

test('profil bez CPV dostaje sygnał „brak" i konkretną podpowiedź', () => {
  const s = sygnal(W.wyjasnijDopasowanie(profil({ cpv_codes: [] }), ogloszenie()), 'cpv');
  assert.equal(s.sila, 'brak');
  assert.ok(s.podpowiedz.pl && s.podpowiedz.en);
  assert.match(s.podpowiedz.pl, /CPV/);
});

test('KRYTYCZNE: sygnał słów wymienia trafione słowa, a odmiana się liczy', () => {
  const s = sygnal(W.wyjasnijDopasowanie(profil(), ogloszenie()), 'slowa');
  assert.equal(s.sila, 'mocny');
  assert.deepEqual(s.wartosci.sort(), ['chodnik', 'droga']);
});

test('słowo z profilu, którego NIE ma w tytule, nie udaje trafienia', () => {
  const s = sygnal(W.wyjasnijDopasowanie(
    profil({ keywords: ['most'] }), ogloszenie(),
  ), 'slowa');
  assert.equal(s.sila, 'brak');
  assert.deepEqual(s.wartosci, []);
});

test('region: bez zapisanych województw to informacja z podpowiedzią, nie ocena', () => {
  const s = sygnal(W.wyjasnijDopasowanie(profil(), ogloszenie()), 'region');
  assert.equal(s.sila, 'informacja');
  assert.match(s.szczegol.pl, /Mazowieckie/);
  assert.match(s.podpowiedz.pl, /wojew/i);
});

test('region: zapisane województwo trafione i nietrafione dają różne sygnały', () => {
  const trafione = sygnal(W.wyjasnijDopasowanie(
    profil({ regiony: ['14', '12'] }), ogloszenie(),
  ), 'region');
  assert.equal(trafione.sila, 'mocny');

  const obok = sygnal(W.wyjasnijDopasowanie(
    profil({ regiony: ['12'] }), ogloszenie(),
  ), 'region');
  assert.equal(obok.sila, 'brak');
  assert.match(obok.szczegol.pl, /poza/i);
});

test('region z Bazy Konkurencyjności (nazwa) liczy się tak samo jak kod TERYT', () => {
  const s = sygnal(W.wyjasnijDopasowanie(
    profil({ regiony: ['12'] }), ogloszenie({ wojewodztwo: 'małopolskie' }),
  ), 'region');
  assert.equal(s.sila, 'mocny');
});

test('wartość: brak kwoty w rejestrze jest powiedziany wprost, nie przemilczany', () => {
  const s = sygnal(W.wyjasnijDopasowanie(profil(), ogloszenie({ budget: null })), 'wartosc');
  assert.equal(s.sila, 'informacja');
  assert.match(s.szczegol.pl, /nie podaje/i);
});

test('wartość powyżej zadeklarowanej skali firmy jest sygnałem OSTRZEGAWCZYM', () => {
  const s = sygnal(W.wyjasnijDopasowanie(
    profil({ wartosc_max: 500000 }), ogloszenie({ budget: 800000 }),
  ), 'wartosc');
  assert.equal(s.sila, 'brak');
  assert.match(s.szczegol.pl, /powyżej/i);

  const w = sygnal(W.wyjasnijDopasowanie(
    profil({ wartosc_max: 1000000 }), ogloszenie({ budget: 800000 }),
  ), 'wartosc');
  assert.equal(w.sila, 'mocny');
});

test('podsumowanie streszcza TYLKO sygnały, które zadziałały', () => {
  const w = W.wyjasnijDopasowanie(profil(), ogloszenie());
  assert.match(w.podsumowanie.pl, /45233222/);
  assert.match(w.podsumowanie.pl, /droga|chodnik/);

  const bezNiczego = W.wyjasnijDopasowanie(
    profil({ keywords: ['most'], cpv_codes: [] }), ogloszenie(),
  );
  assert.match(bezNiczego.podsumowanie.pl, /brak/i);
  assert.match(bezNiczego.podsumowanie.en, /no /i);
});

test('KRYTYCZNE: wyjaśnienie nigdy nie pochodzi z płatnego AI', () => {
  const w = W.wyjasnijDopasowanie(profil(), ogloszenie());
  assert.equal(w.zrodlo, 'heurystyka');
});

test('puste i połamane wejście nie wywraca wyjaśnienia', () => {
  const w = W.wyjasnijDopasowanie(null, null);
  assert.equal(w.sygnaly.length, 4);
  assert.ok(w.podsumowanie.pl);
});

// -- następny krok przy pustym feedzie ----------------------------------------

test('KRYTYCZNE: pusty profil dostaje krok „uzupełnij profil", nie „czekaj"', () => {
  const krok = W.nastepnyKrokProfilu({ keywords: [], cpv_codes: [] }, { liczbaDopasowan: 0 });
  assert.equal(krok.kod, 'uzupelnij_profil');
  assert.ok(krok.tytul.pl && krok.tytul.en && krok.opis.pl && krok.opis.en);
  assert.equal(krok.pole, 'keywords');
});

test('profil na samych słowach → krok „dodaj kody CPV"', () => {
  const krok = W.nastepnyKrokProfilu({ keywords: ['droga', 'chodnik', 'most'], cpv_codes: [] }, { liczbaDopasowan: 0 });
  assert.equal(krok.kod, 'dodaj_cpv');
  assert.equal(krok.pole, 'cpv_codes');
});

test('jedno słowo kluczowe → krok „dopisz słowa", z liczbą w treści', () => {
  const krok = W.nastepnyKrokProfilu({ keywords: ['droga'], cpv_codes: ['45233000'] }, { liczbaDopasowan: 0 });
  assert.equal(krok.kod, 'dodaj_slowa');
  assert.match(krok.opis.pl, /1\b/);
});

test('komplet profilu, a feed pusty → krok kieruje do trybu „Wszystkie"', () => {
  const krok = W.nastepnyKrokProfilu(
    { keywords: ['droga', 'chodnik', 'most'], cpv_codes: ['45233000'], regiony: ['14'] },
    { liczbaDopasowan: 0 },
  );
  assert.equal(krok.kod, 'obejrzyj_wszystkie');
  assert.match(krok.opis.pl, /Wszystkie/);
});

test('feed z dopasowaniami nie dostaje natrętnej podpowiedzi', () => {
  assert.equal(
    W.nastepnyKrokProfilu({ keywords: ['droga', 'chodnik', 'most'], cpv_codes: ['45233000'], regiony: ['14'] }, { liczbaDopasowan: 12 }),
    null,
  );
});
