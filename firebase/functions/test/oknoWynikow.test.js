import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const {
  runOknoWynikow, wybierzDniWynikow, zaktualizujCheckpointWynikow, dobyNiedomknieteWynikow,
} = await import('../src/jobs/oknoWynikow.js');
const { rozstrzygniecia, oknoWynikow } = await import('../src/db/repos.js');

const KATALOG = dirname(fileURLToPath(import.meta.url));
const fixture = (nazwa) =>
  JSON.parse(readFileSync(join(KATALOG, 'fixtures', `${nazwa}.json`), 'utf8'));

const DZIS = Date.UTC(2026, 8, 24); // 2026-09-24

describe('okno rozstrzygnięć — wybór dób i checkpoint', () => {
  const dni = ['2026-09-22', '2026-09-23', '2026-09-24'];

  test('bez checkpointu bierze wszystkie doby, od najświeższej', () => {
    assert.deepEqual(
      wybierzDniWynikow({ dni, checkpoint: null, dzisiaj: '2026-09-24' }),
      ['2026-09-24', '2026-09-23', '2026-09-22'],
    );
  });

  test('doba domknięta nie jest pobierana ponownie', () => {
    const checkpoint = { dni: { '2026-09-22': { kompletny: true } } };
    assert.deepEqual(
      wybierzDniWynikow({ dni, checkpoint, dzisiaj: '2026-09-24' }),
      ['2026-09-24', '2026-09-23'],
    );
  });

  test('DZISIAJ nigdy nie jest domknięte — wyniki dochodzą przez cały dzień', () => {
    const checkpoint = { dni: { '2026-09-24': { kompletny: true } } };
    assert.ok(wybierzDniWynikow({ dni, checkpoint, dzisiaj: '2026-09-24' }).includes('2026-09-24'));
  });

  test('doba z błędem zostaje otwarta', () => {
    const stan = zaktualizujCheckpointWynikow({
      checkpoint: null,
      raport: [{ dzien: '2026-09-22', ogloszen: 0, blad: 'HTTP 503' }],
      dni, dzisiaj: '2026-09-24', teraz: 'T',
    });
    assert.equal(stan.dni['2026-09-22'].kompletny, false);
    assert.equal(stan.dni['2026-09-22'].blad, 'HTTP 503');
  });

  test('doba poza oknem wypada z checkpointu (dokument nie rośnie bez końca)', () => {
    const stan = zaktualizujCheckpointWynikow({
      checkpoint: { dni: { '2026-08-01': { kompletny: true } } },
      raport: [], dni, dzisiaj: '2026-09-24', teraz: 'T',
    });
    assert.equal(stan.dni['2026-08-01'], undefined);
  });

  test('doba pominięta z braku budżetu NIE dostaje nieprawdziwego „kompletny"', () => {
    const stan = zaktualizujCheckpointWynikow({
      checkpoint: null, raport: [], pominieteDni: ['2026-09-22'],
      dni, dzisiaj: '2026-09-24', teraz: 'T',
    });
    assert.equal(stan.dni['2026-09-22'].kompletny, false);
    // Liczymy wyłącznie doby PRZESZŁE — „dzisiaj" jest otwarte z definicji.
    assert.equal(dobyNiedomknieteWynikow({ dni, checkpoint: stan, dzisiaj: '2026-09-24' }), 2);
  });
});

describe('okno rozstrzygnięć — przebieg', () => {
  const wynikBzp = fixture('wynik-czesci-mieszane');
  const wynikiTed = fixture('ted-wyniki');

  test('zapisuje rozstrzygnięcia z OBU rejestrów i liczy części', async () => {
    const wynik = await runOknoWynikow({
      dniBzp: 2, dniTed: 2, teraz: DZIS,
      pobierzDzienBzp: async (dzien) => (dzien === '2026-09-23' ? [wynikBzp] : []),
      pobierzTed: async () => {
        const { mapujWynikTed } = await import('../src/services/tedWyniki.js');
        return wynikiTed.map(mapujWynikTed);
      },
    });

    assert.equal(wynik.ok, true);
    assert.equal(wynik.bzp_ogloszen, 1);
    assert.equal(wynik.bzp_czesci, 15);
    assert.equal(wynik.ted_ogloszen, 3);
    assert.ok(wynik.ted_czesci >= 14);
  });

  test('zapisane rozstrzygnięcie da się znaleźć po identyfikatorze POSTĘPOWANIA', async () => {
    await runOknoWynikow({
      dniBzp: 1, dniTed: 1, teraz: DZIS,
      pobierzDzienBzp: async () => [wynikBzp],
      pobierzTed: async () => [],
    });
    const znalezione = await rozstrzygniecia.poPostepowaniu(wynikBzp.tenderId);
    assert.ok(znalezione, 'rozstrzygnięcia nie da się znaleźć po postępowaniu');
    assert.equal(znalezione.zrodlo, 'bzp');
    assert.equal(znalezione.czesci.length, 15);
  });

  test('ponowne pobranie tej samej doby nie duplikuje dokumentów', async () => {
    const opcje = {
      dniBzp: 1, dniTed: 1, teraz: DZIS,
      pobierzDzienBzp: async () => [wynikBzp],
      pobierzTed: async () => [],
    };
    await runOknoWynikow(opcje);
    await runOknoWynikow(opcje);
    const { pozycje } = await rozstrzygniecia.strona({ limit: 500 });
    const tenSam = pozycje.filter((p) => p.externalId === wynikBzp.bzpNumber);
    assert.equal(tenSam.length, 1);
  });

  test('awaria TED NIE kasuje tego, co zapisał BZP', async () => {
    const wynik = await runOknoWynikow({
      dniBzp: 1, dniTed: 1, teraz: DZIS,
      pobierzDzienBzp: async () => [wynikBzp],
      pobierzTed: async () => { throw new Error('TED result odpowiedziało 429'); },
    });
    assert.equal(wynik.bzp_ogloszen, 1);
    assert.match(wynik.error, /429/);
    assert.equal(wynik.ted_ogloszen, 0);
  });

  test('awaria doby BZP nie zatrzymuje pozostałych dób', async () => {
    const wynik = await runOknoWynikow({
      dniBzp: 3, dniTed: 1, teraz: DZIS,
      pobierzDzienBzp: async (dzien) => {
        if (dzien === '2026-09-23') throw new Error('BZP 503');
        return [];
      },
      pobierzTed: async () => [],
    });
    assert.equal(wynik.doby_bledne, 1);
    assert.equal(wynik.doby_pobrane, 3);
  });

  test('ślad przebiegu ląduje w /health razem z zaległością okna', async () => {
    await runOknoWynikow({
      dniBzp: 3, dniTed: 1, teraz: DZIS,
      pobierzDzienBzp: async () => [], pobierzTed: async () => [],
    });
    const stan = await oknoWynikow.wczytaj();
    assert.ok(stan.ostatni_przebieg.zakonczony_o);
    assert.equal(typeof stan.ostatni_przebieg.doby_niedomkniete, 'number');
  });

  test('budżet czasu zostawia doby OTWARTE zamiast udawać komplet', async () => {
    // Inne okno niż pozostałe testy: checkpoint z wcześniejszych przebiegów
    // domknąłby część dób i test mierzyłby cudzy stan zamiast budżetu.
    const wynik = await runOknoWynikow({
      dniBzp: 5, dniTed: 1, teraz: Date.UTC(2026, 6, 24), budzetMs: -1,
      pobierzDzienBzp: async () => [], pobierzTed: async () => [],
    });
    assert.equal(wynik.doby_pobrane, 0);
    assert.equal(wynik.doby_pominiete, 5);
    assert.ok(wynik.doby_niedomkniete >= 4);
  });
});
