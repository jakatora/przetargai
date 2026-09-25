import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * CHECKPOINT OKNA BZP (P0-2) — czysta logika wyboru dni.
 *
 * Bez checkpointu każdy przebieg zaczynał od najstarszej doby okna i — gdy
 * zabrakło czasu — ginął zawsze na tych samych ostatnich dniach. Z checkpointem
 * przebieg pyta wyłącznie o to, czego jeszcze nie ma, więc okno domyka się
 * w kilku przebiegach zamiast nigdy.
 *
 * Reguły, których pilnują te testy:
 *  • DZISIAJ jest zawsze pobierane od nowa — ogłoszenia spływają przez cały dzień,
 *    więc „dzisiaj" nigdy nie jest kompletne,
 *  • doba zamknięta bez błędu i bez brakujących województw nie jest pytana ponownie,
 *  • doba z błędem albo z brakującym województwem WRACA do kolejki,
 *  • kolejka idzie od najświeższych — gdy zabraknie budżetu, tracimy najstarsze,
 *  • checkpoint nie puchnie: doby poza oknem są usuwane.
 */

process.env.ANTHROPIC_API_KEY = '';

const { wybierzDni, zaktualizujCheckpoint } = await import('../src/jobs/oknoBzp.js');

const OKNO = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'];
const DZISIAJ = '2026-09-22';

test('pusty checkpoint = pobieramy całe okno, od najświeższej doby', () => {
  assert.deepEqual(
    wybierzDni({ dni: OKNO, checkpoint: null, dzisiaj: DZISIAJ }),
    ['2026-09-22', '2026-09-21', '2026-09-20', '2026-09-19', '2026-09-18'],
  );
});

test('doba zamknięta jako kompletna NIE jest pytana ponownie', () => {
  const checkpoint = {
    dni: {
      '2026-09-20': { kompletny: true },
      '2026-09-21': { kompletny: true },
    },
  };
  assert.deepEqual(
    wybierzDni({ dni: OKNO, checkpoint, dzisiaj: DZISIAJ }),
    ['2026-09-22', '2026-09-19', '2026-09-18'],
  );
});

test('KRYTYCZNE: DZISIAJ jest pobierane zawsze, nawet gdy checkpoint mówi „kompletne"', () => {
  const checkpoint = { dni: { '2026-09-22': { kompletny: true } } };
  const wybrane = wybierzDni({ dni: OKNO, checkpoint, dzisiaj: DZISIAJ });
  assert.equal(wybrane[0], '2026-09-22',
    'ogłoszenia spływają przez cały dzień — zamknięcie dzisiaj zamroziłoby feed');
});

test('doba z błędem albo z brakującym województwem wraca do kolejki', () => {
  const checkpoint = {
    dni: {
      '2026-09-20': { kompletny: false, blad: 'BZP API odpowiedziało 403' },
      '2026-09-21': { kompletny: false, wojewodztwaBezDanych: 2 },
      '2026-09-19': { kompletny: true },
    },
  };
  assert.deepEqual(
    wybierzDni({ dni: OKNO, checkpoint, dzisiaj: DZISIAJ }),
    ['2026-09-22', '2026-09-21', '2026-09-20', '2026-09-18'],
  );
});

test('zaktualizujCheckpoint: doba bez błędu i bez braków zamyka się jako kompletna', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: null,
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-21', pobrano: 893, ucietySufit: true, zapytania: 17, wojewodztwaBezDanych: 0 }],
  });

  assert.equal(stan.dni['2026-09-21'].kompletny, true);
  assert.equal(stan.dni['2026-09-21'].pobrano, 893);
  assert.equal(stan.dni['2026-09-21'].zaktualizowano_o, '2026-09-22T10:00:00.000Z');
});

test('zaktualizujCheckpoint: DZISIAJ nigdy nie zamyka się jako kompletne', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: null,
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-22', pobrano: 513, ucietySufit: true, zapytania: 17, wojewodztwaBezDanych: 0 }],
  });
  assert.equal(stan.dni['2026-09-22'].kompletny, false);
});

test('zaktualizujCheckpoint: brakujące województwo NIE pozwala zamknąć doby', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: null,
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-20', pobrano: 400, ucietySufit: true, zapytania: 17, wojewodztwaBezDanych: 1 }],
  });
  assert.equal(stan.dni['2026-09-20'].kompletny, false,
    'doba, której kawałka nie pobraliśmy, jest niekompletna — choćby liczby wyglądały ładnie');
});

test('zaktualizujCheckpoint: doba z błędem zapisuje błąd i zostaje otwarta', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: { dni: { '2026-09-19': { kompletny: true, pobrano: 11 } } },
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-18', pobrano: 0, zapytania: 1, wojewodztwaBezDanych: 0, blad: 'BZP API odpowiedziało 403' }],
  });

  assert.equal(stan.dni['2026-09-18'].kompletny, false);
  assert.match(stan.dni['2026-09-18'].blad, /403/);
  assert.equal(stan.dni['2026-09-19'].kompletny, true, 'stan pozostałych dób przeżywa');
});

test('zaktualizujCheckpoint: doby poza oknem znikają (checkpoint nie puchnie)', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: { dni: { '2026-08-01': { kompletny: true }, '2026-09-19': { kompletny: true } } },
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [],
  });

  assert.equal(stan.dni['2026-08-01'], undefined);
  assert.equal(stan.dni['2026-09-19'].kompletny, true);
});

test('dni pominięte przez budżet zostają otwarte i wrócą w następnym przebiegu', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: null,
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-22', pobrano: 500, zapytania: 17, wojewodztwaBezDanych: 0 }],
    pominieteDni: ['2026-09-21', '2026-09-20'],
  });

  assert.deepEqual(
    wybierzDni({ dni: OKNO, checkpoint: stan, dzisiaj: DZISIAJ }),
    ['2026-09-22', '2026-09-21', '2026-09-20', '2026-09-19', '2026-09-18'],
  );
});

test('zaktualizujCheckpoint: doba z NIEZAPISANYM ogłoszeniem nie zamyka się (2026-09-25)', () => {
  const stan = zaktualizujCheckpoint({
    checkpoint: null,
    dni: OKNO,
    dzisiaj: DZISIAJ,
    teraz: '2026-09-22T10:00:00.000Z',
    raport: [{ dzien: '2026-09-20', pobrano: 400, zapytania: 1, wojewodztwaBezDanych: 0, niezapisane: 1 }],
  });
  assert.equal(stan.dni['2026-09-20'].kompletny, false);
  assert.equal(stan.dni['2026-09-20'].niezapisane, 1);
});
