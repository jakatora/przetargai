import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * OKNO BAZY KONKURENCYJNOŚCI — czysta logika checkpointu (etap 3).
 *
 * Problem, który to rozwiązuje: wartość zamówienia i CPV są WYŁĄCZNIE w szczegółach
 * (`GET /announcements/{id}`), a aktywnych ogłoszeń jest 1 135. Bez pamięci między
 * przebiegami każdy cykl kosztowałby 1 135 zapytań po dane, które się nie ruszyły —
 * i nie zmieściłby się w żadnym budżecie czasu.
 *
 * Z checkpointem przebieg pobiera szczegóły TYLKO dla ogłoszeń nowych i zmienionych.
 * Zmianę widać już z LISTY (odcisk z terminu, tytułu i treści), więc wykrycie
 * przesuniętego terminu nie kosztuje ani jednego dodatkowego zapytania.
 *
 * Trzy decyzje, które łatwo zepsuć i które dlatego mają tu własne testy:
 *  • okno czasu USTAWIA KOLEJNOŚĆ, a nie odsiewa — ogłoszenie sprzed pół roku, wciąż
 *    otwarte, musi kiedyś wejść, tylko po świeższych;
 *  • zniknięcie z listy wolno interpretować WYŁĄCZNIE przy pełnym pokryciu —
 *    zmierzony przebieg pokrył 81 %, więc inaczej „anulowalibyśmy" 19 % rynku;
 *  • ogłoszenie po terminie znika z listy NATURALNIE i nie ma czego weryfikować.
 */

process.env.ANTHROPIC_API_KEY = '';

const { odciskOgloszenia, wybierzDoPobrania, wykryjZnikniecia, zaktualizujCheckpointBk, MAKS_WPISOW_CHECKPOINTU } =
  await import('../src/jobs/oknoBk.js');

const TERAZ = '2026-09-24T06:00:00.000Z';
const OKNO_OD = '2026-08-25'; // 30 dni wstecz

const pozycja = (id, over = {}) => [String(id), {
  id,
  title: `Ogłoszenie ${id}`,
  content: 'Opis zamówienia',
  publication_date: '2026-09-23',
  submission_deadline: '2026-10-15 23:59:59',
  ...over,
}];

const aktywneZ = (...pozycje) => new Map(pozycje);

/* ============================== odcisk ============================== */

test('odcisk zmienia się, gdy zamawiający PRZESUWA TERMIN (najczęstsza zmiana w BK)', () => {
  const [, a] = pozycja(1);
  const [, b] = pozycja(1, { submission_deadline: '2026-10-22 23:59:59' });
  assert.notEqual(odciskOgloszenia(a), odciskOgloszenia(b));
});

test('odcisk zmienia się, gdy do treści dopisano odpowiedzi na pytania', () => {
  const [, a] = pozycja(1);
  const [, b] = pozycja(1, { content: '=> 24.09.2026 Zamawiający udzielił odpowiedzi. Opis zamówienia' });
  assert.notEqual(odciskOgloszenia(a), odciskOgloszenia(b));
});

test('odcisk jest STABILNY dla niezmienionego ogłoszenia (inaczej ciągniemy szczegóły w kółko)', () => {
  const [, a] = pozycja(1);
  const [, b] = pozycja(1);
  assert.equal(odciskOgloszenia(a), odciskOgloszenia(b));
  assert.ok(odciskOgloszenia(a).length <= 40, 'checkpoint trzyma 1 135 wpisów — odcisk musi być krótki');
});

/* ========================== wybór do pobrania ========================== */

test('pierwszy przebieg: wszystko jest nowe', () => {
  const wynik = wybierzDoPobrania({
    aktywne: aktywneZ(pozycja(1), pozycja(2)), checkpoint: null, oknoOd: OKNO_OD, maks: 10,
  });
  assert.deepEqual(wynik.doPobrania, ['1', '2']);
  assert.equal(wynik.nowe, 2);
  assert.equal(wynik.zmienione, 0);
});

test('ogłoszenie o NIEZMIENIONYM odcisku nie kosztuje ani jednego zapytania', () => {
  const [id, poz] = pozycja(1);
  const checkpoint = { ogloszenia: { [id]: { odcisk: odciskOgloszenia(poz) } } };

  const wynik = wybierzDoPobrania({ aktywne: aktywneZ([id, poz]), checkpoint, oknoOd: OKNO_OD, maks: 10 });
  assert.deepEqual(wynik.doPobrania, []);
  assert.equal(wynik.bezZmian, 1);
});

test('ZMIENIONY odcisk wraca do pobrania i jest raportowany osobno od nowego', () => {
  const [id, poz] = pozycja(1, { submission_deadline: '2026-11-01 23:59:59' });
  const checkpoint = { ogloszenia: { [id]: { odcisk: 'stary-odcisk' } } };

  const wynik = wybierzDoPobrania({ aktywne: aktywneZ([id, poz]), checkpoint, oknoOd: OKNO_OD, maks: 10 });
  assert.deepEqual(wynik.doPobrania, ['1']);
  assert.equal(wynik.zmienione, 1);
  assert.equal(wynik.nowe, 0);
});

test('okno czasu USTAWIA KOLEJNOŚĆ: świeże idą pierwsze, zaległe zostają w kolejce', () => {
  const wynik = wybierzDoPobrania({
    aktywne: aktywneZ(
      pozycja(1, { publication_date: '2026-03-31' }),
      pozycja(2, { publication_date: '2026-09-23' }),
      pozycja(3, { publication_date: '2026-09-20' }),
    ),
    checkpoint: null, oknoOd: OKNO_OD, maks: 10,
  });

  assert.deepEqual(wynik.doPobrania, ['2', '3', '1'], 'najświeższe z okna, potem starsze z okna, na końcu zaległe');
  assert.equal(wynik.pozaOknem, 1);
});

test('KRYTYCZNE: ogłoszenie spoza okna, wciąż OTWARTE, nie jest porzucane', () => {
  const wynik = wybierzDoPobrania({
    aktywne: aktywneZ(pozycja(1, { publication_date: '2026-01-21' })),
    checkpoint: null, oknoOd: OKNO_OD, maks: 10,
  });
  assert.deepEqual(wynik.doPobrania, ['1'],
    'twarde odsianie po dacie publikacji ukryłoby wieloletnie kontrakty — te najbardziej wartościowe');
});

test('limit szczegółów tnie kolejkę i JAWNIE mówi, ile zostało na następny przebieg', () => {
  const wynik = wybierzDoPobrania({
    aktywne: aktywneZ(pozycja(1), pozycja(2), pozycja(3)),
    checkpoint: null, oknoOd: OKNO_OD, maks: 2,
  });
  assert.equal(wynik.doPobrania.length, 2);
  assert.equal(wynik.zaleglosc, 1, 'bez tej liczby nie wiadomo, czy okno się kiedykolwiek domknie');
});

test('maks = 0 nie pobiera nic, ale nadal liczy zaległość', () => {
  const wynik = wybierzDoPobrania({
    aktywne: aktywneZ(pozycja(1)), checkpoint: null, oknoOd: OKNO_OD, maks: 0,
  });
  assert.deepEqual(wynik.doPobrania, []);
  assert.equal(wynik.zaleglosc, 1);
});

/* ============================ zniknięcia ============================ */

test('KRYTYCZNE: przy NIEPEŁNYM pokryciu zniknięcia są ignorowane', () => {
  const checkpoint = { ogloszenia: { 1: { termin: '2099-01-01T00:00:00.000Z' } } };
  const wynik = wykryjZnikniecia({
    aktywne: aktywneZ(), checkpoint, pokrycieKompletne: false, teraz: TERAZ, maks: 10,
  });
  assert.deepEqual(wynik, [],
    'zmierzony przebieg pokrył 81 % listy — bez tej blokady „anulowalibyśmy" co piąte ogłoszenie');
});

test('przy pełnym pokryciu zniknięcie ogłoszenia PRZED terminem idzie do weryfikacji', () => {
  const checkpoint = { ogloszenia: { 1: { termin: '2099-01-01T00:00:00.000Z' } } };
  const wynik = wykryjZnikniecia({
    aktywne: aktywneZ(), checkpoint, pokrycieKompletne: true, teraz: TERAZ, maks: 10,
  });
  assert.deepEqual(wynik, ['1']);
});

test('ogłoszenie PO TERMINIE znika z listy naturalnie — nie marnujemy na nie zapytania', () => {
  const checkpoint = { ogloszenia: { 1: { termin: '2026-09-01T00:00:00.000Z' } } };
  const wynik = wykryjZnikniecia({
    aktywne: aktywneZ(), checkpoint, pokrycieKompletne: true, teraz: TERAZ, maks: 10,
  });
  assert.deepEqual(wynik, [], 'większość zniknięć to wygaśnięcia, nie anulowania');
});

test('ogłoszenie wciąż na liście nigdy nie jest weryfikowane', () => {
  const [id, poz] = pozycja(1);
  const checkpoint = { ogloszenia: { [id]: { termin: '2099-01-01T00:00:00.000Z' } } };
  assert.deepEqual(
    wykryjZnikniecia({ aktywne: aktywneZ([id, poz]), checkpoint, pokrycieKompletne: true, teraz: TERAZ, maks: 10 }),
    [],
  );
});

test('limit weryfikacji chroni budżet przebiegu', () => {
  const ogloszenia = {};
  for (let i = 0; i < 10; i++) ogloszenia[i] = { termin: '2099-01-01T00:00:00.000Z' };
  const wynik = wykryjZnikniecia({
    aktywne: aktywneZ(), checkpoint: { ogloszenia }, pokrycieKompletne: true, teraz: TERAZ, maks: 3,
  });
  assert.equal(wynik.length, 3);
});

/* =========================== aktualizacja stanu =========================== */

test('checkpoint zapamiętuje odcisk i termin pobranych ogłoszeń', () => {
  const [id, poz] = pozycja(1);
  const stan = zaktualizujCheckpointBk({
    checkpoint: null,
    aktywne: aktywneZ([id, poz]),
    przetworzone: [{ id, termin: '2026-10-15T21:59:59.000Z' }],
    pokrycieKompletne: true,
    teraz: TERAZ,
  });

  assert.equal(stan.ogloszenia[id].odcisk, odciskOgloszenia(poz));
  assert.equal(stan.ogloszenia[id].termin, '2026-10-15T21:59:59.000Z');
  assert.equal(stan.ogloszenia[id].pobrane_o, TERAZ);
});

test('ogłoszenie NIEPOBRANE w tym przebiegu zostaje bez odcisku — wróci następnym razem', () => {
  const [id, poz] = pozycja(1);
  const stan = zaktualizujCheckpointBk({
    checkpoint: null, aktywne: aktywneZ([id, poz]), przetworzone: [], pokrycieKompletne: true, teraz: TERAZ,
  });
  assert.equal(stan.ogloszenia[id], undefined,
    'wpisanie odcisku bez pobrania szczegółu udawałoby, że mamy dane, których nie mamy');
});

test('przy PEŁNYM pokryciu wpisy spoza listy znikają (dokument ma limit 1 MiB)', () => {
  const [id, poz] = pozycja(1);
  const checkpoint = { ogloszenia: { [id]: { odcisk: 'x' }, 999: { odcisk: 'stare' } } };

  const stan = zaktualizujCheckpointBk({
    checkpoint, aktywne: aktywneZ([id, poz]), przetworzone: [], pokrycieKompletne: true, teraz: TERAZ,
  });
  assert.deepEqual(Object.keys(stan.ogloszenia), [id]);
});

test('przy NIEPEŁNYM pokryciu nic nie przycinamy (brak na liście ≠ koniec ogłoszenia)', () => {
  const [id, poz] = pozycja(1);
  const checkpoint = { ogloszenia: { [id]: { odcisk: 'x' }, 999: { odcisk: 'stare' } } };

  const stan = zaktualizujCheckpointBk({
    checkpoint, aktywne: aktywneZ([id, poz]), przetworzone: [], pokrycieKompletne: false, teraz: TERAZ,
  });
  assert.deepEqual(Object.keys(stan.ogloszenia).sort(), ['1', '999'],
    'przycięcie na niepełnym pokryciu kazałoby pobrać te szczegóły jeszcze raz');
});

test('anulowane wypada z checkpointu — nie weryfikujemy go co przebieg od nowa', () => {
  const checkpoint = { ogloszenia: { 1: { odcisk: 'x', termin: '2099-01-01T00:00:00.000Z' } } };
  const stan = zaktualizujCheckpointBk({
    checkpoint, aktywne: new Map(), przetworzone: [], anulowane: ['1'], pokrycieKompletne: false, teraz: TERAZ,
  });
  assert.equal(stan.ogloszenia['1'], undefined);
});

test('checkpoint ma twardy sufit wpisów — przy przepełnieniu zostają NAJŚWIEŻSZE', () => {
  const ogloszenia = {};
  const aktywne = new Map();
  const dodaj = (id, dataPublikacji) => {
    const [klucz, poz] = pozycja(id, { publication_date: dataPublikacji });
    aktywne.set(klucz, poz);
    ogloszenia[klucz] = { odcisk: 'x', publication_date: dataPublikacji };
  };

  for (let i = 0; i < MAKS_WPISOW_CHECKPOINTU; i++) dodaj(`nowe-${i}`, '2026-09-20');
  for (let i = 0; i < 50; i++) dodaj(`stare-${i}`, '2020-01-01');

  const stan = zaktualizujCheckpointBk({
    checkpoint: { ogloszenia }, aktywne, przetworzone: [], pokrycieKompletne: false, teraz: TERAZ,
  });

  const klucze = Object.keys(stan.ogloszenia);
  assert.equal(klucze.length, MAKS_WPISOW_CHECKPOINTU);
  assert.ok(
    klucze.every((k) => !k.startsWith('stare-')),
    'przy przepełnieniu tracimy najstarsze publikacje, a nie losowe wpisy',
  );
});
