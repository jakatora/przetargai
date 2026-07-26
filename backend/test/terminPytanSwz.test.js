import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Kalkulator TERMINU PYTAŃ do SWZ `terminPytanSwz` — podzadanie 2/7 ulepszenia
 * „Radar pytań i odpowiedzi do SWZ". Czysta funkcja, bez sieci i bazy: z daty
 * ogłoszenia i terminu składania ofert liczy „koniec dnia, w którym upływa POŁOWA
 * terminu składania" (po nim zamawiający może zignorować pytania) oraz liczbę dni
 * pozostałych do tej daty.
 *
 * Testujemy szczęśliwą ścieżkę i ADWERSARYJNIE: okno o parzystej i nieparzystej
 * liczbie dni (połowa wypada w południe), termin z godziną zegarową, okno w obrębie
 * jednego dnia, granice liczenia dni pozostałych (dzień graniczny, dokładnie koniec
 * dnia, dzień po) oraz braki/niepoprawne dane i błędną kolejność dat.
 */

const { terminPytanSwz } = await import('../src/lib/terminPytanSwz.js');

// ── Wyznaczenie dnia połowy: parzyste / nieparzyste okno ─────────────────────

test('parzyste okno (10 dni) — połowa o północy dnia 5., termin pytań = koniec tego dnia', () => {
  const r = terminPytanSwz({
    dataOgloszenia: '2026-07-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-07-11T00:00:00.000Z',
    teraz: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(r.polowaTerminu, '2026-07-06T00:00:00.000Z', 'punkt połowy okna');
  assert.equal(r.terminPytan, '2026-07-06T23:59:59.999Z', 'koniec dnia połowy');
});

test('nieparzyste okno (11 dni) — połowa w południe, dzień połowy ten sam co przy parzystym', () => {
  const r = terminPytanSwz({
    dataOgloszenia: '2026-07-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-07-12T00:00:00.000Z',
    teraz: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(r.polowaTerminu, '2026-07-06T12:00:00.000Z', 'nieparzyste okno => połowa o 12:00');
  assert.equal(r.terminPytan, '2026-07-06T23:59:59.999Z', 'to wciąż koniec dnia 6 lipca');
});

test('nieparzyste okno (13 dni) — połowa wpada na kolejny dzień (7 lipca 12:00)', () => {
  const r = terminPytanSwz({
    dataOgloszenia: '2026-07-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-07-14T00:00:00.000Z',
    teraz: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(r.polowaTerminu, '2026-07-07T12:00:00.000Z');
  assert.equal(r.terminPytan, '2026-07-07T23:59:59.999Z');
});

test('termin składania z godziną zegarową (oferty do 10:00) — połowa liczona co do godziny', () => {
  const r = terminPytanSwz({
    dataOgloszenia: '2026-07-01T00:00:00.000Z',
    terminSkladaniaOfert: '2026-08-01T10:00:00.000Z',
    teraz: '2026-07-01T00:00:00.000Z',
  });
  // 31 dni 10 h => połowa 15 dni 17 h => 16 lipca 17:00
  assert.equal(r.polowaTerminu, '2026-07-16T17:00:00.000Z');
  assert.equal(r.terminPytan, '2026-07-16T23:59:59.999Z');
});

test('okno w obrębie jednego dnia — termin pytań to koniec tego samego dnia', () => {
  const r = terminPytanSwz({
    dataOgloszenia: '2026-07-01T08:00:00.000Z',
    terminSkladaniaOfert: '2026-07-01T18:00:00.000Z',
    teraz: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(r.polowaTerminu, '2026-07-01T13:00:00.000Z');
  assert.equal(r.terminPytan, '2026-07-01T23:59:59.999Z');
});

// ── Liczba dni pozostałych do terminu pytań (granice) ────────────────────────

const OKNO = { dataOgloszenia: '2026-07-01T00:00:00.000Z', terminSkladaniaOfert: '2026-07-11T00:00:00.000Z' };
// terminPytan dla OKNO = koniec 6 lipca.

test('dniPozostalo — 5 dni przed dniem granicznym', () => {
  const r = terminPytanSwz({ ...OKNO, teraz: '2026-07-01T09:00:00.000Z' });
  assert.equal(r.dniPozostalo, 5);
  assert.equal(r.minelo, false);
});

test('dniPozostalo — w dniu granicznym jest 0 i termin jeszcze NIE minął', () => {
  const r = terminPytanSwz({ ...OKNO, teraz: '2026-07-06T08:00:00.000Z' });
  assert.equal(r.dniPozostalo, 0, 'ostatni dzień => 0 dni');
  assert.equal(r.minelo, false, 'jest jeszcze czas do końca dnia');
});

test('dniPozostalo — dokładnie na końcu dnia granicznego termin jeszcze NIE minął', () => {
  const r = terminPytanSwz({ ...OKNO, teraz: '2026-07-06T23:59:59.999Z' });
  assert.equal(r.dniPozostalo, 0);
  assert.equal(r.minelo, false, 'granica jest inkluzywna (koniec dnia to ostatnia dopuszczalna chwila)');
});

test('dniPozostalo — dzień po granicy: termin minął, liczba ujemna', () => {
  const r = terminPytanSwz({ ...OKNO, teraz: '2026-07-07T00:00:00.000Z' });
  assert.equal(r.dniPozostalo, -1);
  assert.equal(r.minelo, true);
});

// ── Braki i niepoprawne dane (konserwatywnie: null, bez wyjątku) ─────────────

test('brak którejkolwiek z dat => null, bez wyliczeń, bez wyjątku', () => {
  for (const arg of [
    { terminSkladaniaOfert: '2026-07-11T00:00:00.000Z' },
    { dataOgloszenia: '2026-07-01T00:00:00.000Z' },
    { dataOgloszenia: null, terminSkladaniaOfert: null },
    {},
    undefined,
  ]) {
    const r = terminPytanSwz(arg);
    assert.equal(r.terminPytan, null, `brak danych (${JSON.stringify(arg)}) => terminPytan null`);
    assert.equal(r.dniPozostalo, null);
    assert.equal(r.minelo, false);
  }
});

test('niepoprawna data (śmieciowy string) => null', () => {
  const r = terminPytanSwz({ dataOgloszenia: 'nie-data', terminSkladaniaOfert: '2026-07-11T00:00:00.000Z' });
  assert.equal(r.terminPytan, null);
});

test('termin składania nie późniejszy niż ogłoszenie => null (nie ma sensownego okna)', () => {
  const rowne = terminPytanSwz({
    dataOgloszenia: '2026-07-11T00:00:00.000Z',
    terminSkladaniaOfert: '2026-07-11T00:00:00.000Z',
  });
  assert.equal(rowne.terminPytan, null, 'okno zerowe => brak połowy');

  const odwrocone = terminPytanSwz({
    dataOgloszenia: '2026-07-11T00:00:00.000Z',
    terminSkladaniaOfert: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(odwrocone.terminPytan, null, 'termin przed ogłoszeniem => brak połowy');
});

// ── Obiekty Date na wejściu (nie tylko stringi ISO) ──────────────────────────

test('akceptuje obiekty Date tak samo jak stringi ISO', () => {
  const r = terminPytanSwz({
    dataOgloszenia: new Date('2026-07-01T00:00:00.000Z'),
    terminSkladaniaOfert: new Date('2026-07-11T00:00:00.000Z'),
    teraz: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(r.terminPytan, '2026-07-06T23:59:59.999Z');
  assert.equal(r.dniPozostalo, 5);
});

// ── Opis „po ludzku" (do UI/alertów) ─────────────────────────────────────────

test('powod opisuje sytuację: przed terminem informuje o dniach, po terminie mówi że minął', () => {
  const przed = terminPytanSwz({ ...OKNO, teraz: '2026-07-01T00:00:00.000Z' });
  assert.match(przed.powod, /2026-07-06/);
  assert.match(przed.powod, /pozosta/i);

  const po = terminPytanSwz({ ...OKNO, teraz: '2026-07-09T00:00:00.000Z' });
  assert.match(po.powod, /min/i);

  const brak = terminPytanSwz({});
  assert.match(brak.powod, /Brak/i);
});
