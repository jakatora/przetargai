import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zbudujSciezke, KROKI, FAZY, kluczSciezki, wczytajSciezke, zapiszSciezke,
} from '../src/lib/sciezkaDoOferty.js';

test('pusta ścieżka: 0% postępu, wszystkie kroki obecne, fazy w stałej kolejności', () => {
  const { fazy, postep } = zbudujSciezke(new Set());
  assert.equal(postep.zrobione, 0);
  assert.equal(postep.procent, 0);
  assert.equal(postep.wszystkieWymaganeGotowe, false);
  assert.deepEqual(fazy.map((f) => f.nazwa), FAZY, 'fazy niepuste w stałej kolejności');
  const wszystkieKroki = fazy.flatMap((f) => f.kroki);
  assert.equal(wszystkieKroki.length, KROKI.length);
  assert.ok(wszystkieKroki.every((k) => k.wykonany === false));
});

test('postęp liczy TYLKO kroki wymagane — odhaczenie opcjonalnego nie nabija procentu', () => {
  const wymagane = KROKI.filter((k) => !k.opcjonalny).length;
  const opcjonalny = KROKI.find((k) => k.opcjonalny);
  assert.ok(opcjonalny, 'w ścieżce są kroki opcjonalne');

  const { postep } = zbudujSciezke(new Set([opcjonalny.klucz]));
  assert.equal(postep.zrobione, 0, 'opcjonalny nie liczy się do postępu');
  assert.equal(postep.wymagane, wymagane);
  assert.equal(postep.procent, 0);
});

test('jeden wymagany krok = poprawny procent', () => {
  const pierwszyWymagany = KROKI.find((k) => !k.opcjonalny);
  const { postep } = zbudujSciezke([pierwszyWymagany.klucz]);
  assert.equal(postep.zrobione, 1);
  assert.equal(postep.procent, Math.round(100 / postep.wymagane));
});

test('wszystkie wymagane ukończone → 100% i flaga gotowości', () => {
  const wymaganeKlucze = KROKI.filter((k) => !k.opcjonalny).map((k) => k.klucz);
  const { postep } = zbudujSciezke(new Set(wymaganeKlucze));
  assert.equal(postep.procent, 100);
  assert.equal(postep.wszystkieWymaganeGotowe, true);
});

test('każdy krok z ekranem wskazuje istniejący ekran nawigatora (spójność skrótów)', () => {
  // Nazwy ekranów zarejestrowanych w RootNavigator (branża zalogowana).
  const EKRANY = new Set([
    'RadarSwz', 'BankReferencji', 'SymulatorPlynnosci', 'KalkulatorPunktow', 'KontrolerGwarancji',
    'Sejf', 'Konsorcjum', 'ObronaCeny', 'Tajemnica', 'WizjaLokalna', 'KalkulatorTerminow',
    'RejestratorOferty', 'TerminZwiazania', 'StraznikWezwania',
  ]);
  for (const k of KROKI) {
    if (k.ekran) assert.ok(EKRANY.has(k.ekran), `krok ${k.klucz} → nieznany ekran ${k.ekran}`);
  }
});

test('kluczSciezki czyści znaki niedozwolone w SecureStore (np. „:" w id TED)', () => {
  const klucz = kluczSciezki('ted:515302-2026');
  assert.doesNotMatch(klucz, /[^A-Za-z0-9._-]/, 'klucz może zawierać tylko [A-Za-z0-9._-]');
  assert.match(klucz, /^przetargai\.sciezka\./);
});

test('zapisz → wczytaj: round-trip zbioru ukończonych kroków (fałszywy storage)', async () => {
  const mapa = new Map();
  const storage = {
    getItem: async (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: async (k, v) => { mapa.set(k, v); },
  };
  await zapiszSciezke(storage, 'ted:1-2026', new Set(['swz', 'punkty']));
  const wczytane = await wczytajSciezke(storage, 'ted:1-2026');
  assert.deepEqual([...wczytane].sort(), ['punkty', 'swz']);

  // Brak wpisu → pusty zbiór; uszkodzony JSON → pusty zbiór (nie wywraca ekranu).
  assert.equal((await wczytajSciezke(storage, 'nie-ma')).size, 0);
  mapa.set(kluczSciezki('zly'), '{niepoprawny');
  assert.equal((await wczytajSciezke(storage, 'zly')).size, 0);
});
