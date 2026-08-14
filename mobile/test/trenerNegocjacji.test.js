import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wykryjTrybNegocjacji,
  wyjasnienieDlaUzytkownika,
  formatujTermin,
  ZELAZNA_ZASADA,
  KRYTERIA_DOMYSLNE,
  porownajOfertaDodatkowa,
} from '../src/lib/trenerNegocjacji.js';

/*
 * „Trener negocjacji i oferty dodatkowej" (tryb podstawowy wariant 2/3 — art. 275
 * pkt 2-3 Pzp) — czysta logika (testowalna node:test): rozpoznanie trybu z tekstu
 * ogłoszenia, wyjaśnienie dla usera, odmiana PL terminu odpowiedzi, treść żelaznej
 * zasady oraz porównanie oferty dodatkowej z pierwotną POLE PO POLU. Bez UI, bez
 * sieci — nigdy nie rzuca, zawsze pełny kształt.
 */

// ─────────────────────────── (a) wykrywanie trybu ────────────────────────────

test('art. 275 pkt 2 → tryb podstawowy wariant 2, negocjacje fakultatywne, oferta dodatkowa możliwa', () => {
  const w = wykryjTrybNegocjacji(
    'Postępowanie prowadzone w trybie podstawowym na podstawie art. 275 pkt 2 ustawy Pzp.',
  );
  assert.equal(w.trybPodstawowy, true);
  assert.equal(w.wariant, 2);
  assert.equal(w.negocjacje, 'fakultatywne');
  assert.equal(w.mozliwaOfertaDodatkowa, true);
});

test('art. 275 pkt 3 → wariant 3, negocjacje obowiązkowe, oferta dodatkowa możliwa', () => {
  const w = wykryjTrybNegocjacji(
    'Zamawiający prowadzi postępowanie w trybie podstawowym (art. 275 pkt 3 Pzp).',
  );
  assert.equal(w.wariant, 3);
  assert.equal(w.negocjacje, 'obowiazkowe');
  assert.equal(w.mozliwaOfertaDodatkowa, true);
});

test('art. 275 pkt 1 → wariant 1: BEZ negocjacji, oferta dodatkowa NIEMOŻLIWA (false dla w1)', () => {
  const w = wykryjTrybNegocjacji('Tryb podstawowy bez negocjacji — art. 275 pkt 1 ustawy Pzp.');
  assert.equal(w.trybPodstawowy, true);
  assert.equal(w.wariant, 1);
  assert.equal(w.negocjacje, 'brak');
  assert.equal(w.mozliwaOfertaDodatkowa, false);
});

test('„art. 275 ust. 1 pkt 2" (z numerem ustępu) też rozpoznane jako wariant 2', () => {
  const w = wykryjTrybNegocjacji('Postępowanie w trybie podstawowym, o którym mowa w art. 275 ust. 1 pkt 2 Pzp.');
  assert.equal(w.wariant, 2);
  assert.equal(w.mozliwaOfertaDodatkowa, true);
});

test('rozpoznanie po opisie: „z możliwością negocjacji" → wariant 2 (bez podania punktu)', () => {
  const w = wykryjTrybNegocjacji(
    'Zamawiający prowadzi postępowanie w trybie podstawowym z możliwością prowadzenia negocjacji.',
  );
  assert.equal(w.wariant, 2);
  assert.equal(w.negocjacje, 'fakultatywne');
  assert.equal(w.mozliwaOfertaDodatkowa, true);
});

test('rozpoznanie po opisie: „prowadzi negocjacje" bez „może" → wariant 3', () => {
  const w = wykryjTrybNegocjacji(
    'Postępowanie prowadzone w trybie podstawowym; zamawiający prowadzi negocjacje w celu ulepszenia treści ofert.',
  );
  assert.equal(w.wariant, 3);
  assert.equal(w.negocjacje, 'obowiazkowe');
});

test('inny tryb (przetarg nieograniczony) → NIE tryb podstawowy, oferta dodatkowa niemożliwa', () => {
  const w = wykryjTrybNegocjacji('Postępowanie prowadzone w trybie przetargu nieograniczonego (art. 132 Pzp).');
  assert.equal(w.trybPodstawowy, false);
  assert.equal(w.wariant, null);
  assert.equal(w.mozliwaOfertaDodatkowa, false);
});

test('puste / nieczytelne wejście → nic nie wykryto, nigdy nie rzuca', () => {
  for (const wejscie of [null, undefined, '', '   ', 42, {}, { tekst: 'x' }]) {
    const w = wykryjTrybNegocjacji(wejscie);
    assert.equal(w.trybPodstawowy, false);
    assert.equal(w.wariant, null);
    assert.equal(w.negocjacje, null);
    assert.equal(w.mozliwaOfertaDodatkowa, false);
  }
});

// ─────────────────────────── (b) wyjaśnienie dla usera ────────────────────────

test('wyjaśnienie wariantu 3: zaproszenie do negocjacji + prawo do oferty dodatkowej + obowiązkowość', () => {
  const wykrycie = wykryjTrybNegocjacji('art. 275 pkt 3 Pzp, tryb podstawowy');
  const wy = wyjasnienieDlaUzytkownika(wykrycie);
  assert.equal(wy.dotyczy, true);
  assert.match(wy.tresc, /zaproszenie do negocjacji/i);
  assert.match(wy.tresc, /ofert[ęe] dodatkow/i);
  assert.match(wy.tresc, /obowi[ąa]zkow/i);
  assert.ok(typeof wy.tytul === 'string' && wy.tytul.length > 0);
});

test('wyjaśnienie wariantu 2: zaznacza, że zamawiający MOŻE, ale nie musi negocjować', () => {
  const wykrycie = wykryjTrybNegocjacji('art. 275 pkt 2 Pzp, tryb podstawowy');
  const wy = wyjasnienieDlaUzytkownika(wykrycie);
  assert.equal(wy.dotyczy, true);
  assert.match(wy.tresc, /nie musi/i);
  assert.match(wy.tresc, /ofert[ęe] dodatkow/i);
});

test('wyjaśnienie wariantu 1: trener nie ma zastosowania (brak negocjacji i oferty dodatkowej)', () => {
  const wykrycie = wykryjTrybNegocjacji('art. 275 pkt 1 Pzp — bez negocjacji');
  const wy = wyjasnienieDlaUzytkownika(wykrycie);
  assert.equal(wy.dotyczy, false);
  assert.match(wy.tresc, /bez negocjacji|nie ma zastosowania|nie przewiduje/i);
});

// ─────────────────────────── (c) odmiana terminu PL ───────────────────────────

test('formatujTermin: godziny (1 / 2 / 5 / 12 / 22)', () => {
  assert.equal(formatujTermin(1, 'godzina'), '1 godzina');
  assert.equal(formatujTermin(2, 'godzina'), '2 godziny');
  assert.equal(formatujTermin(5, 'godzina'), '5 godzin');
  assert.equal(formatujTermin(12, 'godzina'), '12 godzin');
  assert.equal(formatujTermin(22, 'godzina'), '22 godziny');
});

test('formatujTermin: dni (1 → „dzień", reszta → „dni")', () => {
  assert.equal(formatujTermin(1, 'dzien'), '1 dzień');
  assert.equal(formatujTermin(3, 'dzien'), '3 dni');
  assert.equal(formatujTermin(5, 'dzien'), '5 dni');
  assert.equal(formatujTermin(21, 'dzien'), '21 dni');
});

test('formatujTermin: tygodnie (1 / 2 / 5 / 11)', () => {
  assert.equal(formatujTermin(1, 'tydzien'), '1 tydzień');
  assert.equal(formatujTermin(2, 'tydzien'), '2 tygodnie');
  assert.equal(formatujTermin(5, 'tydzien'), '5 tygodni');
  assert.equal(formatujTermin(11, 'tydzien'), '11 tygodni');
});

test('formatujTermin: aliasy jednostek i 0 / wartość niepoprawna', () => {
  assert.equal(formatujTermin(2, 'dni'), '2 dni'); // alias liczby mnogiej
  assert.equal(formatujTermin(3, 'tygodnie'), '3 tygodnie');
  assert.equal(formatujTermin(0, 'godzina'), '0 godzin');
  assert.equal(formatujTermin(null, 'dzien'), '0 dni');
  assert.equal(formatujTermin('x', 'tydzien'), '0 tygodni');
});

// ─────────────────────────── (d) żelazna zasada ───────────────────────────────

test('ZELAZNA_ZASADA: mówi wprost, że oferta dodatkowa nie może być gorsza w ŻADNYM kryterium, inaczej odrzucenie', () => {
  assert.ok(typeof ZELAZNA_ZASADA.tytul === 'string' && ZELAZNA_ZASADA.tytul.length > 0);
  assert.match(ZELAZNA_ZASADA.tresc, /nie mo[żz]e/i);
  assert.match(ZELAZNA_ZASADA.tresc, /[żz]adnym/i);
  assert.match(ZELAZNA_ZASADA.tresc + ZELAZNA_ZASADA.konsekwencja, /odrzuc/i);
});

// ─────────────────────────── (e) porównanie pole po polu ──────────────────────

const PIERWOTNA = { cena: 1000000, termin: 30, gwarancja: 60 };

test('KRYTERIA_DOMYSLNE obejmują cenę, termin i gwarancję z kierunkiem korzystności', () => {
  assert.deepEqual(
    KRYTERIA_DOMYSLNE.map((k) => [k.klucz, k.kierunek]),
    [
      ['cena', 'nizej_lepiej'],
      ['termin', 'nizej_lepiej'],
      ['gwarancja', 'wyzej_lepiej'],
    ],
  );
});

test('cena WYŻSZA w ofercie dodatkowej → pozycja mniej korzystna + BLOKADA wysyłki', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: PIERWOTNA,
    dodatkowa: { cena: 1050000, termin: 30, gwarancja: 60 },
  });
  assert.equal(wynik.blokujWyslanie, true);
  assert.deepEqual(wynik.mniejKorzystne.map((p) => p.klucz), ['cena']);
  assert.equal(wynik.ton, 'danger');
});

test('termin DŁUŻSZY → mniej korzystny + blokada', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: PIERWOTNA,
    dodatkowa: { cena: 1000000, termin: 45, gwarancja: 60 },
  });
  assert.equal(wynik.blokujWyslanie, true);
  assert.deepEqual(wynik.mniejKorzystne.map((p) => p.klucz), ['termin']);
});

test('gwarancja KRÓTSZA → mniej korzystna + blokada', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: PIERWOTNA,
    dodatkowa: { cena: 1000000, termin: 30, gwarancja: 48 },
  });
  assert.equal(wynik.blokujWyslanie, true);
  assert.deepEqual(wynik.mniejKorzystne.map((p) => p.klucz), ['gwarancja']);
});

test('REMIS na wszystkich polach → dozwolone (brak blokady)', () => {
  const wynik = porownajOfertaDodatkowa({ pierwotna: PIERWOTNA, dodatkowa: { ...PIERWOTNA } });
  assert.equal(wynik.blokujWyslanie, false);
  assert.deepEqual(wynik.mniejKorzystne, []);
  assert.ok(wynik.pozycje.every((p) => p.ocena === 'remis'));
  assert.equal(wynik.ton, 'sukces');
});

test('realna poprawa (niższa cena, reszta remis) → brak blokady, cena oceniona jako lepsza', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: PIERWOTNA,
    dodatkowa: { cena: 950000, termin: 30, gwarancja: 60 },
  });
  assert.equal(wynik.blokujWyslanie, false);
  const cena = wynik.pozycje.find((p) => p.klucz === 'cena');
  assert.equal(cena.ocena, 'lepsza');
});

test('wiele pogorszeń naraz → wszystkie trafiają na listę mniej korzystnych', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: PIERWOTNA,
    dodatkowa: { cena: 1050000, termin: 45, gwarancja: 48 },
  });
  assert.equal(wynik.blokujWyslanie, true);
  assert.deepEqual(wynik.mniejKorzystne.map((p) => p.klucz).sort(), ['cena', 'gwarancja', 'termin']);
  // każda pozycja niesie czytelny powód do pokazania userowi
  assert.ok(wynik.mniejKorzystne.every((p) => typeof p.powod === 'string' && p.powod.length > 0));
});

test('pola nieporównywalne (brak wartości) są pomijane — nie blokują na ślepo', () => {
  const wynik = porownajOfertaDodatkowa({
    pierwotna: { cena: 1000000 },
    dodatkowa: { gwarancja: 60 },
  });
  assert.deepEqual(wynik.pozycje, []);
  assert.equal(wynik.blokujWyslanie, false);
});

test('porównanie nie rzuca na pustym wejściu', () => {
  const wynik = porownajOfertaDodatkowa();
  assert.deepEqual(wynik.pozycje, []);
  assert.equal(wynik.blokujWyslanie, false);
});
