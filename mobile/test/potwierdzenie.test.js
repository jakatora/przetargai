import { test } from 'node:test';
import assert from 'node:assert/strict';
import { potwierdzAkcje } from '../src/lib/potwierdzenie.js';

/*
 * Okno potwierdzenia działające także w przeglądarce (audyt 2026-09-29).
 *
 * react-native-web ma `Alert.alert() {}` — pustą funkcję. „Wyloguj się" w wersji
 * webowej nie robiło więc nic: okno się nie pokazywało, a akcja nie ruszała.
 */

const opcje = { tytul: 'Wylogowanie', tresc: 'Czy na pewno?', etykietaTak: 'Wyloguj' };

test('web: pyta przez window.confirm i po zgodzie wykonuje akcję', () => {
  let wykonano = 0;
  let pytanie = null;
  potwierdzAkcje({ ...opcje, onTak: () => { wykonano += 1; } }, {
    platforma: 'web',
    confirm: (tekst) => { pytanie = tekst; return true; },
    alert: () => assert.fail('na webie Alert.alert jest pusty — nie wolno na nim polegać'),
  });
  assert.equal(wykonano, 1);
  assert.match(pytanie, /Wylogowanie/);
  assert.match(pytanie, /Czy na pewno\?/);
});

test('web: odmowa w window.confirm nie wykonuje akcji', () => {
  let wykonano = 0;
  potwierdzAkcje({ ...opcje, onTak: () => { wykonano += 1; } }, { platforma: 'web', confirm: () => false, alert: () => {} });
  assert.equal(wykonano, 0);
});

test('natywnie: Alert.alert z przyciskami Anuluj / akcja', () => {
  let wykonano = 0;
  let przyciski = null;
  potwierdzAkcje({ ...opcje, onTak: () => { wykonano += 1; } }, {
    platforma: 'ios',
    confirm: () => assert.fail('natywnie nie ma window.confirm'),
    alert: (tytul, tresc, lista) => { przyciski = lista; },
  });
  assert.deepEqual(przyciski.map((p) => p.text), ['Anuluj', 'Wyloguj']);
  przyciski[1].onPress();
  assert.equal(wykonano, 1);
});
