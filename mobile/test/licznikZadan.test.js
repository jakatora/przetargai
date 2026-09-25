import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utworzLicznikZadan } from '../src/lib/licznikZadan.js';

/*
 * Wyścig nieaktualnych odpowiedzi (2026-09-25, P1).
 *
 * Katalog „Wszystkie" i radar planów: szybka zmiana filtra/zakładki wysyła drugie
 * żądanie, zanim wróci pierwsze. Gdy pierwsze wróci PÓŹNIEJ, nadpisywało wyniki
 * nowszego — lista pokazywała wyniki filtra, którego już nie ma na ekranie.
 * Dociąganie kolejnej strony nie może też dokleić strony z poprzedniego filtra.
 */

const czekaj = (ms, wartosc) => new Promise((r) => setTimeout(() => r(wartosc), ms));

test('tylko najnowsze żądanie jest aktualne', () => {
  const l = utworzLicznikZadan();
  const a = l.nowe();
  assert.equal(l.czyAktualne(a), true);
  const b = l.nowe();
  assert.equal(l.czyAktualne(a), false);
  assert.equal(l.czyAktualne(b), true);
});

test('wolniejsza STARA odpowiedź nie nadpisuje nowszej (symulacja wyścigu)', async () => {
  const l = utworzLicznikZadan();
  let widok = null;
  const pobierz = async (filtr, opoznienie) => {
    const nr = l.nowe();
    const wynik = await czekaj(opoznienie, `wyniki:${filtr}`);
    if (l.czyAktualne(nr)) widok = wynik;
  };
  await Promise.all([pobierz('stary', 40), pobierz('nowy', 5)]);
  assert.equal(widok, 'wyniki:nowy');
});

test('dociąganie nie zakłada nowej generacji, ale traci ważność po zmianie filtra', () => {
  const l = utworzLicznikZadan();
  const lista = l.nowe(); // pierwsza strona filtra A
  const strona = l.biezace(); // dociąganie w obrębie tej samej listy
  assert.equal(strona, lista);
  assert.equal(l.czyAktualne(strona), true);
  l.nowe(); // użytkownik zmienia filtr w trakcie dociągania
  assert.equal(l.czyAktualne(strona), false, 'strona filtra A nie może trafić do listy filtra B');
});

test('liczniki są niezależne między ekranami', () => {
  const a = utworzLicznikZadan();
  const b = utworzLicznikZadan();
  const nrA = a.nowe();
  b.nowe();
  b.nowe();
  assert.equal(a.czyAktualne(nrA), true);
});
