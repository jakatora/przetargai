import { test } from 'node:test';
import assert from 'node:assert/strict';
import { potwierdzAkcje, wybierzOpcje, pokazKomunikat } from '../src/lib/potwierdzenie.js';

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

// Wybór jednej z kilku opcji (Rejestrator: „co zawiodło?"). window.confirm umie tylko
// tak/nie, więc na webie ekran pokazuje opcje jako przyciski w treści.
const opcjeAwarii = (wybrane) => [
  { etykieta: 'Platforma nie działa', onWybor: () => wybrane.push('platforma') },
  { etykieta: 'Podpis nie działa', onWybor: () => wybrane.push('podpis') },
];

test('wybierzOpcje web: opcje trafiają do ekranu, Alert nieużywany', () => {
  const wybrane = [];
  let pokazane = null;
  wybierzOpcje({ tytul: 'Zgłoś awarię', tresc: 'Co zawiodło?', opcje: opcjeAwarii(wybrane) }, {
    platforma: 'web',
    alert: () => assert.fail('na webie Alert.alert jest pusty'),
    pokazWLinii: (opcje) => { pokazane = opcje; },
  });
  assert.deepEqual(pokazane.map((o) => o.etykieta), ['Platforma nie działa', 'Podpis nie działa']);
  pokazane[1].onWybor();
  assert.deepEqual(wybrane, ['podpis']);
});

test('wybierzOpcje natywnie: Alert z Anuluj + opcjami, wybór wykonuje akcję', () => {
  const wybrane = [];
  let przyciski = null;
  wybierzOpcje({ tytul: 'Zgłoś awarię', tresc: 'Co zawiodło?', opcje: opcjeAwarii(wybrane) }, {
    platforma: 'android',
    alert: (_t, _m, lista) => { przyciski = lista; },
    pokazWLinii: () => assert.fail('natywnie zostaje Alert'),
  });
  assert.deepEqual(przyciski.map((p) => p.text), ['Anuluj', 'Platforma nie działa', 'Podpis nie działa']);
  przyciski[1].onPress();
  assert.deepEqual(wybrane, ['platforma']);
});

// Komunikaty jednoprzyciskowe (błędy w Sejfie, Rejestratorze, przy usuwaniu konta):
// na webie Alert.alert ich nie pokazywał — użytkownik nie wiedział, że akcja padła.
test('pokazKomunikat web: window.alert z tytułem i treścią', () => {
  let pokazane = null;
  pokazKomunikat({ tytul: 'Nie udało się utrwalić dowodu', tresc: 'Brak połączenia' }, {
    platforma: 'web', alert: () => assert.fail('pusty na webie'), webAlert: (t) => { pokazane = t; },
  });
  assert.match(pokazane, /Nie udało się utrwalić dowodu/);
  assert.match(pokazane, /Brak połączenia/);
});

test('pokazKomunikat natywnie: Alert.alert(tytuł, treść)', () => {
  let args = null;
  pokazKomunikat({ tytul: 'Zapisano', tresc: 'OK' }, {
    platforma: 'ios', alert: (...a) => { args = a; }, webAlert: () => assert.fail('natywnie bez window.alert'),
  });
  assert.deepEqual(args, ['Zapisano', 'OK']);
});
