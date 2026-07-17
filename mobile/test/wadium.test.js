import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opisWadium } from '../src/lib/wadium.js';

/*
 * Prezentacja wadium na karcie przetargu (D-056). Wadium to twardy próg —
 * brak przed terminem = odrzucenie oferty. `null` (nieznane) NIE pokazujemy,
 * żeby nie sugerować, że wadium nie ma. Nie zmyślamy kwot.
 */

test('nieznane (null) → nie pokazujemy wiersza', () => {
  assert.equal(opisWadium({ wadium_wymagane: null }), null);
  assert.equal(opisWadium({}), null);
});

test('nie wymagane → jasny komunikat, bez ostrzeżenia', () => {
  const w = opisWadium({ wadium_wymagane: false });
  assert.match(w.wartosc, /Nie wymagane/i);
  assert.equal(w.ostrzezenie, false);
});

test('wymagane z kwotą → kwota + ostrzeżenie o terminie', () => {
  const w = opisWadium({ wadium_wymagane: true, wadium_kwota: 7800 });
  assert.match(w.wartosc, /7\s?800/);
  assert.match(w.wartosc, /zł/);
  assert.equal(w.ostrzezenie, true, 'wadium wymagane = podświetlamy jako ważne');
});

test('wymagane, wiele części → dopisek o częściach', () => {
  const w = opisWadium({ wadium_wymagane: true, wadium_kwota: 8000, wadium_wiele_czesci: true });
  assert.match(w.wartosc, /8\s?000/);
  assert.match(w.podpis ?? '', /część|części/i);
});

test('wymagane bez kwoty → mówimy „sprawdź w ogłoszeniu", nie zmyślamy', () => {
  const w = opisWadium({ wadium_wymagane: true, wadium_kwota: null });
  assert.match(w.wartosc, /wymagane/i);
  assert.match(w.podpis ?? w.wartosc, /ogłoszeni/i);
  assert.equal(w.ostrzezenie, true);
});
