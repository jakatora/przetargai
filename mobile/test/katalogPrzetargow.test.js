import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Tryb „Wszystkie" na głównej liście (P1-3) — czysta logika stanu.
 *
 * Ekran ma przełącznik „Dla mnie / Wszystkie", własny zestaw filtrów, stronicowanie
 * i cztery stany (ładowanie / pusto / błąd / lista). Wszystko, co da się policzyć
 * bez Reacta, liczy się tutaj — inaczej te reguły byłyby testowalne wyłącznie
 * przez klikanie w aplikacji.
 */

const K = await import('../src/lib/katalogPrzetargow.js');

test('tryby mają etykiety w obu językach, domyślny to „Dla mnie"', () => {
  assert.deepEqual(K.TRYBY.map((t) => t.wartosc), ['dlamnie', 'wszystkie']);
  for (const t of K.TRYBY) assert.ok(t.etykieta.pl && t.etykieta.en);
  assert.equal(K.TRYB_DOMYSLNY, 'dlamnie');
  assert.equal(K.normalizujTryb('kosmos'), 'dlamnie');
  assert.equal(K.normalizujTryb('wszystkie'), 'wszystkie');
});

test('domyślne filtry katalogu nie zawężają rynku poza terminem', () => {
  assert.deepEqual(K.FILTRY_DOMYSLNE, {
    zrodlo: null, region: null, cpv: '', q: '', sort: 'najnowsze', termin: 'aktywne',
    wartosc_min: '', wartosc_max: '',
  });
});

test('KRYTYCZNE: zapis z magazynu jest odtwarzany polem po polu, śmieci odrzucane', () => {
  const odtworzone = K.normalizujFiltry({ zrodlo: 'ted', sort: 'losowo', region: 'PL14', cpv: 'abc45xx', nieznane: 1 });
  assert.equal(odtworzone.zrodlo, 'ted');
  assert.equal(odtworzone.sort, 'najnowsze', 'nieznane sortowanie wraca do domyślnego');
  assert.equal(odtworzone.region, '14');
  assert.equal(odtworzone.cpv, '45', 'z CPV zostają same cyfry');
  assert.equal(odtworzone.nieznane, undefined, 'nieznane pole nie wchodzi do stanu');
});

test('normalizacja przeżywa null i uszkodzony JSON z magazynu', () => {
  assert.deepEqual(K.normalizujFiltry(null), K.FILTRY_DOMYSLNE);
  assert.deepEqual(K.normalizujFiltry('nie obiekt'), K.FILTRY_DOMYSLNE);
});

test('do zapytania idą TYLKO ustawione filtry — pusty filtr nie zawęża', () => {
  assert.deepEqual(K.parametryZapytania(K.FILTRY_DOMYSLNE), { sort: 'najnowsze', termin: 'aktywne' });

  const pelne = K.normalizujFiltry({
    zrodlo: 'bzp', region: '14', cpv: '45233', q: ' drogi ', sort: 'termin',
    termin: 'wszystkie', wartosc_min: '100000', wartosc_max: '2000000',
  });
  assert.deepEqual(K.parametryZapytania(pelne), {
    zrodlo: 'bzp', region: '14', cpv: '45233', q: 'drogi', sort: 'termin',
    termin: 'wszystkie', wartosc_min: '100000', wartosc_max: '2000000',
  });
});

test('licznik aktywnych filtrów pomija sortowanie i domyślny status terminu', () => {
  assert.equal(K.liczbaAktywnychFiltrow(K.FILTRY_DOMYSLNE), 0);
  assert.equal(K.liczbaAktywnychFiltrow(K.normalizujFiltry({ sort: 'termin' })), 0, 'sortowanie to nie filtr');
  assert.equal(K.liczbaAktywnychFiltrow(K.normalizujFiltry({ zrodlo: 'ted', region: '14' })), 2);
  assert.equal(K.liczbaAktywnychFiltrow(K.normalizujFiltry({ termin: 'wszystkie' })), 1, 'zmiana statusu terminu to wybór usera');
});

test('KRYTYCZNE: dołączanie strony nie duplikuje pozycji po odświeżeniu w tle', () => {
  const strona1 = [{ id: 'a' }, { id: 'b' }];
  const strona2 = [{ id: 'b' }, { id: 'c' }];
  assert.deepEqual(K.scalStrone(strona1, strona2).map((t) => t.id), ['a', 'b', 'c']);
});

test('scalStrone zachowuje kolejność serwera — sortowanie jest jego decyzją', () => {
  const wynik = K.scalStrone([{ id: 'z' }], [{ id: 'a' }, { id: 'm' }]);
  assert.deepEqual(wynik.map((t) => t.id), ['z', 'a', 'm']);
});

test('pustka z filtrem mówi, KTÓRY filtr zawęża i jak go zdjąć', () => {
  const zFiltrem = K.opisPustki(K.normalizujFiltry({ zrodlo: 'ted', q: 'most' }));
  assert.match(zFiltrem.pl, /filtr/i);
  assert.ok(zFiltrem.en);
  assert.ok(K.opisPustki(K.FILTRY_DOMYSLNE).pl.length > 20);
});

test('pustka BEZ filtrów nie sugeruje zmiany filtrów, bo nie ma czego zmieniać', () => {
  const bez = K.opisPustki(K.FILTRY_DOMYSLNE);
  assert.doesNotMatch(bez.pl, /wyczyść/i);
});

test('licznik wyników mówi wprost, gdy to nie jest cały wynik', () => {
  assert.match(K.etykietaLicznika({ ile: 20, wyczerpano: true }).pl, /^20 /);
  assert.match(K.etykietaLicznika({ ile: 20, wyczerpano: false }).pl, /co najmniej|\+/i);
  assert.equal(K.etykietaLicznika({ ile: 0, wyczerpano: true }), null);
});

test('odmiana liczby przetargów po polsku nie brzmi jak automat', () => {
  assert.match(K.etykietaLicznika({ ile: 1, wyczerpano: true }).pl, /1 przetarg$/);
  assert.match(K.etykietaLicznika({ ile: 3, wyczerpano: true }).pl, /3 przetargi$/);
  assert.match(K.etykietaLicznika({ ile: 12, wyczerpano: true }).pl, /12 przetargów$/);
  assert.match(K.etykietaLicznika({ ile: 22, wyczerpano: true }).pl, /22 przetargi$/);
});

test('zmiana filtru kasuje kursor — stara strona nie należy do nowego zestawu', () => {
  assert.equal(K.czyResetowacKursor(K.FILTRY_DOMYSLNE, K.normalizujFiltry({ zrodlo: 'ted' })), true);
  assert.equal(K.czyResetowacKursor(K.FILTRY_DOMYSLNE, K.normalizujFiltry({})), false);
});
