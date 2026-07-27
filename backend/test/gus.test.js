import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Klient GUS BDL (services/gus.js) — podzadanie 11/12. Testujemy CZYSTE części
 * bez sieci: normalizację odpowiedzi BDL (`normalizujWskaznikGus`) i dobór
 * zmiennej po branży (`idZmiennejDlaBranzy`). Faktyczny `fetch` (pobierzAktualnyWskaznik)
 * jest wstrzykiwany w teście joba — tu go nie ruszamy.
 */

const { normalizujWskaznikGus, idZmiennejDlaBranzy } = await import('../src/services/gus.js');

// ── normalizujWskaznikGus ────────────────────────────────────────────────────

test('normalizuje realny kształt BDL i bierze najświeższy rok', () => {
  const payload = {
    totalRecords: 2,
    variableId: 217702,
    results: [
      { id: '000000000000', name: 'POLSKA', values: [
        { year: '2020', val: 100, attrId: 1 },
        { year: '2022', val: 112.4, attrId: 1 },
      ] },
    ],
  };
  assert.deepEqual(normalizujWskaznikGus(payload), { wartosc: 112.4, okres: '2022' });
});

test('przy remisie roku bierze późniejszą pozycję na liście (BDL jest chronologiczny)', () => {
  const payload = { results: [{ values: [
    { year: '2026', val: 120 },
    { year: '2026', val: 125 }, // np. kolejny kwartał tego samego roku
  ] }] };
  assert.equal(normalizujWskaznikGus(payload).wartosc, 125);
});

test('pomija pozycje bez liczbowego val', () => {
  const payload = { results: [{ values: [
    { year: '2025', val: 130 },
    { year: '2026', val: null },
    { year: '2026', val: 'brak' },
  ] }] };
  assert.deepEqual(normalizujWskaznikGus(payload), { wartosc: 130, okres: '2025' });
});

test('pusty/nietypowy payload => null (nie wybucha)', () => {
  assert.equal(normalizujWskaznikGus(null), null);
  assert.equal(normalizujWskaznikGus({}), null);
  assert.equal(normalizujWskaznikGus({ results: [] }), null);
  assert.equal(normalizujWskaznikGus({ results: [{ values: [] }] }), null);
  assert.equal(normalizujWskaznikGus('cokolwiek'), null);
});

// ── idZmiennejDlaBranzy ──────────────────────────────────────────────────────

// Klucze to RDZENIE (tak buduje się mapę w produkcji): jeden klucz „budowl" łapie
// i „budownictwo", i „roboty budowlane". Dopasowanie: klucz ⊂ znormalizowana branża.
const MAPA = { budowl: 217702, transport: 196562 };

test('dobiera zmienną po branży, odpornie na odmianę/diakrytyki/wielkość liter', () => {
  assert.equal(idZmiennejDlaBranzy('budownictwo', MAPA), 217702);
  assert.equal(idZmiennejDlaBranzy('Roboty BUDOWlane', MAPA), 217702, 'rdzeń klucza jako podłańcuch branży');
  assert.equal(idZmiennejDlaBranzy('transport drogowy', MAPA), 196562);
});

test('nieznana branża => null (job ją pomija, nie zmyśla wskaźnika)', () => {
  assert.equal(idZmiennejDlaBranzy('sprzątanie', MAPA), null);
  assert.equal(idZmiennejDlaBranzy('', MAPA), null);
  assert.equal(idZmiennejDlaBranzy('budownictwo', {}), null);
});

test('id niebędące liczbą jest ignorowane', () => {
  assert.equal(idZmiennejDlaBranzy('budownictwo', { budownictwo: 'abc' }), null);
});
