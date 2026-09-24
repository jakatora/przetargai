import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Czysta logika katalogu „Wszystkie przetargi" (P1-1): normalizacja filtrów,
 * predykat dopasowania, plan zapytania Firestore i kursor.
 *
 * Tryb „Wszystkie" ma pokazywać RYNEK, nie feed użytkownika — więc żaden filtr
 * nie może zależeć od profilu ani od liczby dopasowań. Tu pilnujemy tego, co da
 * się sprawdzić bez bazy: czy filtr przepuszcza to, co powinien, i czy kursor
 * jest stabilny.
 */

const K = await import('../src/lib/katalogPrzetargow.js');

const TERAZ = '2026-09-24T10:00:00.000Z';

const przetarg = (nad = {}) => ({
  id: 't1',
  source: 'bzp',
  title: 'Przebudowa drogi gminnej w Zielonce',
  organization: 'Gmina Zielonka',
  cpv_main: '45233222-1 (Roboty w zakresie układania chodników)',
  budget: 500000,
  currency: 'PLN',
  deadline: '2026-10-10T09:00:00.000Z',
  published_at: '2026-09-20T00:00:00.000Z',
  fetched_at: '2026-09-21T00:00:00.000Z',
  wojewodztwo: 'PL14',
  ...nad,
});

// -- normalizacja -------------------------------------------------------------

test('limit jest przycinany do bezpiecznego zakresu', () => {
  assert.equal(K.normalizujFiltry({ limit: '500' }).limit, K.LIMIT_MAKS);
  assert.equal(K.normalizujFiltry({ limit: '0' }).limit, 1);
  assert.equal(K.normalizujFiltry({ limit: 'abc' }).limit, K.LIMIT_DOMYSLNY);
  assert.equal(K.normalizujFiltry({}).limit, K.LIMIT_DOMYSLNY);
});

test('nieznane źródło, region i sortowanie są odrzucane, nie przepuszczane', () => {
  const f = K.normalizujFiltry({ zrodlo: 'gazeta', region: 'Berlin', sort: 'losowo' });
  assert.equal(f.zrodlo, null);
  assert.equal(f.region, null);
  assert.equal(f.sort, 'najnowsze', 'domyślne sortowanie to najnowsze');
});

test('region przyjmuje i kod TERYT, i nazwę z Bazy Konkurencyjności', () => {
  assert.equal(K.normalizujFiltry({ region: 'PL14' }).region, '14');
  assert.equal(K.normalizujFiltry({ region: 'mazowieckie' }).region, '14');
});

test('daty skracane do doby rozszerzają się na pełne granice', () => {
  const f = K.normalizujFiltry({ opublikowano_od: '2026-09-01', opublikowano_do: '2026-09-30' });
  assert.equal(f.opublikowano_od, '2026-09-01T00:00:00.000Z');
  assert.equal(f.opublikowano_do, '2026-09-30T23:59:59.999Z');
});

test('bezsensowne liczby w widełkach wartości są ignorowane', () => {
  const f = K.normalizujFiltry({ wartosc_min: 'dużo', wartosc_max: '-5' });
  assert.equal(f.wartosc_min, null);
  assert.equal(f.wartosc_max, null);
});

test('tekst szukania jest przycinany — nie ufamy długości wejścia', () => {
  const f = K.normalizujFiltry({ q: 'x'.repeat(500) });
  assert.equal(f.q.length, K.MAKS_DLUGOSC_TEKSTU);
});

// -- predykat -----------------------------------------------------------------

test('bez filtrów przepuszcza każdy nieanulowany przetarg', () => {
  const f = K.normalizujFiltry({ termin: 'wszystkie' });
  assert.equal(K.pasujeDoFiltrow(przetarg(), f, TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg({ anulowany: true }), f, TERAZ), false);
});

test('filtr terminu: aktywne vs po terminie vs wszystkie', () => {
  const minelo = przetarg({ deadline: '2026-09-01T00:00:00.000Z' });
  assert.equal(K.pasujeDoFiltrow(minelo, K.normalizujFiltry({}), TERAZ), false, 'domyślnie tylko aktywne');
  assert.equal(K.pasujeDoFiltrow(minelo, K.normalizujFiltry({ termin: 'poterminie' }), TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(minelo, K.normalizujFiltry({ termin: 'wszystkie' }), TERAZ), true);
});

test('przetarg BEZ terminu jest widoczny tylko w trybie „wszystkie terminy"', () => {
  const bez = przetarg({ deadline: null });
  assert.equal(K.pasujeDoFiltrow(bez, K.normalizujFiltry({}), TERAZ), false);
  assert.equal(K.pasujeDoFiltrow(bez, K.normalizujFiltry({ termin: 'poterminie' }), TERAZ), false);
  assert.equal(K.pasujeDoFiltrow(bez, K.normalizujFiltry({ termin: 'wszystkie' }), TERAZ), true);
});

test('CPV dopasowuje się po PREFIKSIE i po KAŻDYM kodzie ogłoszenia, nie tylko pierwszym', () => {
  const f = (cpv) => K.normalizujFiltry({ cpv, termin: 'wszystkie' });
  const t = przetarg({ cpv_main: '45000000-7 (Roboty budowlane),45233222-1 (Chodniki)' });
  assert.equal(K.pasujeDoFiltrow(t, f('45233222'), TERAZ), true, 'drugi kod też się liczy');
  assert.equal(K.pasujeDoFiltrow(t, f('45'), TERAZ), true, 'dział');
  assert.equal(K.pasujeDoFiltrow(t, f('45233222-1'), TERAZ), true, 'z cyfrą kontrolną');
  assert.equal(K.pasujeDoFiltrow(t, f('71'), TERAZ), false);
});

test('region łapie ogłoszenie BK zapisane NAZWĄ województwa', () => {
  const f = K.normalizujFiltry({ region: 'PL12', termin: 'wszystkie' });
  assert.equal(K.pasujeDoFiltrow(przetarg({ wojewodztwo: 'małopolskie' }), f, TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg({ wojewodztwo: 'PL14' }), f, TERAZ), false);
  assert.equal(K.pasujeDoFiltrow(przetarg({ wojewodztwo: null }), f, TERAZ), false);
});

test('tekst szuka po tytule i zamawiającym, bez diakrytyków i wielkości liter', () => {
  const f = (q) => K.normalizujFiltry({ q, termin: 'wszystkie' });
  assert.equal(K.pasujeDoFiltrow(przetarg(), f('ZIELONKA'), TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg(), f('przebudowa drogi'), TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg(), f('most'), TERAZ), false);
});

test('widełki wartości pomijają ogłoszenia BEZ podanej kwoty (i mówi o tym kontrakt)', () => {
  const f = K.normalizujFiltry({ wartosc_min: '100000', termin: 'wszystkie' });
  assert.equal(K.pasujeDoFiltrow(przetarg({ budget: 500000 }), f, TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg({ budget: 1000 }), f, TERAZ), false);
  assert.equal(K.pasujeDoFiltrow(przetarg({ budget: null }), f, TERAZ), false);
  assert.match(K.opisFiltrow(f).wartosc.uwaga.pl, /bez podanej/i);
});

test('zakres dat publikacji używa daty pobrania, gdy rejestr nie podał publikacji', () => {
  const f = K.normalizujFiltry({ opublikowano_od: '2026-09-21', termin: 'wszystkie' });
  assert.equal(K.pasujeDoFiltrow(przetarg({ published_at: null, fetched_at: '2026-09-21T08:00:00.000Z' }), f, TERAZ), true);
  assert.equal(K.pasujeDoFiltrow(przetarg({ published_at: null, fetched_at: '2026-09-10T08:00:00.000Z' }), f, TERAZ), false);
});

// -- plan zapytania -----------------------------------------------------------

test('plan zapytania spycha na Firestore TYLKO źródło i zakres pola sortowania', () => {
  const plan = K.planZapytania(K.normalizujFiltry({ zrodlo: 'ted', region: '14', sort: 'termin' }), TERAZ);
  assert.deepEqual(plan.rowne, [['source', 'ted']]);
  assert.equal(plan.sort.pole, 'deadline');
  assert.equal(plan.sort.kierunek, 'asc');
  assert.deepEqual(plan.zakres, [['deadline', '>=', TERAZ]]);
});

test('sort „najnowsze" nie zakłada zakresu — status terminu liczy się w pamięci', () => {
  const plan = K.planZapytania(K.normalizujFiltry({}), TERAZ);
  assert.equal(plan.sort.pole, 'fetched_at');
  assert.equal(plan.sort.kierunek, 'desc');
  assert.deepEqual(plan.zakres, []);
});

test('sort po terminie odsiewa ogłoszenia BEZ terminu już w zapytaniu', () => {
  const plan = K.planZapytania(K.normalizujFiltry({ sort: 'termin', termin: 'wszystkie' }), TERAZ);
  assert.deepEqual(plan.zakres, [['deadline', '>', '']]);
});

// -- kursor -------------------------------------------------------------------

test('kursor przechodzi tam i z powrotem bez utraty wartości', () => {
  const odcisk = K.odciskFiltrow(K.normalizujFiltry({ zrodlo: 'bzp' }));
  const kursor = K.kodujKursor({ wartosc: '2026-09-21T00:00:00.000Z', id: 'abc~01', odcisk });
  assert.deepEqual(K.dekodujKursor(kursor), { wartosc: '2026-09-21T00:00:00.000Z', id: 'abc~01', odcisk });
});

test('śmieci w kursorze dają null, a nie wyjątek', () => {
  assert.equal(K.dekodujKursor('nie-base64-%%%'), null);
  assert.equal(K.dekodujKursor(''), null);
  assert.equal(K.dekodujKursor(Buffer.from('{"co":1}').toString('base64url')), null);
  assert.equal(K.dekodujKursor('x'.repeat(5000)), null);
});

test('KRYTYCZNE: odcisk zmienia się razem z filtrami — stara strona nie wpada w nowy zestaw', () => {
  const a = K.odciskFiltrow(K.normalizujFiltry({ zrodlo: 'bzp' }));
  const b = K.odciskFiltrow(K.normalizujFiltry({ zrodlo: 'ted' }));
  assert.notEqual(a, b);
  // limit i kursor nie są częścią zestawu — zmiana rozmiaru strony nie unieważnia kursora
  assert.equal(a, K.odciskFiltrow(K.normalizujFiltry({ zrodlo: 'bzp', limit: 50, kursor: 'x' })));
});

// -- indeksy ------------------------------------------------------------------

test('każdy wariant zapytania ma zadeklarowany indeks złożony', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const plik = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../firestore.indexes.json');
  const konfiguracja = JSON.parse(fs.readFileSync(plik, 'utf8'));

  const podpis = (i) => `${i.collectionGroup}:${i.fields.map((f) => `${f.fieldPath}/${f.order}`).join(',')}`;
  const zadeklarowane = new Set((konfiguracja.indexes ?? []).map(podpis));

  const wymagane = K.indeksyWymagane();
  assert.ok(wymagane.length >= 2, 'katalog potrzebuje indeksów złożonych');
  for (const i of wymagane) {
    assert.ok(zadeklarowane.has(podpis(i)), `brak indeksu w firestore.indexes.json: ${podpis(i)}`);
  }
});

test('rejestr źródeł opisuje każdy kod po polsku i po angielsku', () => {
  assert.deepEqual(K.ZRODLA.map((z) => z.kod).sort(), ['baza_konkurencyjnosci', 'bzp', 'ted']);
  for (const z of K.ZRODLA) {
    assert.ok(z.nazwa.pl && z.nazwa.en, `${z.kod} bez nazwy PL/EN`);
    assert.ok(z.etykieta.pl && z.etykieta.en, `${z.kod} bez etykiety PL/EN`);
  }
});

// -- rozmiar pobrania ---------------------------------------------------------

/*
 * Pomiar na produkcji (2026-09-24): żądanie o 3 pozycje przeczytało 300
 * dokumentów, bo pętla skanu brała zawsze pełną stronę. Koszt odczytów musi
 * zależeć od tego, ILE wyników zamówiono, a nie od stałej w kodzie.
 */

test('pierwsze pobranie jest proporcjonalne do zamówionej strony, nie stałe', () => {
  const male = K.rozmiarPobrania({ potrzeba: 3, przeskanowano: 0, znalezione: 0 });
  assert.ok(male < K.SKAN_STRONA, `pierwsze pobranie ${male} nie może być pełną stroną`);
  assert.ok(male >= 3, 'musi wystarczyć na zamówioną liczbę wyników');

  const duze = K.rozmiarPobrania({ potrzeba: 50, przeskanowano: 0, znalezione: 0 });
  assert.ok(duze > male, 'większa strona wyników => większe pobranie');
});

test('rozmiar pobrania nigdy nie przekracza sufitu strony', () => {
  assert.equal(K.rozmiarPobrania({ potrzeba: 50, przeskanowano: 0, znalezione: 0, maks: 40 }), 40);
});

test('kiepska trafność filtra rozszerza kolejne pobranie', () => {
  // 2 trafienia na 100 dokumentów: żeby zebrać 20, trzeba sięgnąć znacznie dalej.
  const szerokie = K.rozmiarPobrania({ potrzeba: 18, przeskanowano: 100, znalezione: 2 });
  assert.equal(szerokie, K.SKAN_STRONA);
});

test('ZERO trafień do tej pory => pobieramy maksymalną stronę, zamiast dreptać', () => {
  assert.equal(K.rozmiarPobrania({ potrzeba: 20, przeskanowano: 300, znalezione: 0 }), K.SKAN_STRONA);
});

test('dobra trafność utrzymuje pobrania małe', () => {
  const ile = K.rozmiarPobrania({ potrzeba: 10, przeskanowano: 20, znalezione: 18 });
  assert.ok(ile <= 30, `przy trafności 90% wystarczy ~13 dokumentów, jest ${ile}`);
});
