import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PoprzetargowaKontrola,
  STATUSY_KONTROLI,
  STATUS_KONTROLI_DOMYSLNY,
  zapiszKontrole,
  wczytajKontrole,
} from '../src/lib/poprzetargowaKontrola.js';

/*
 * Model poprzetargowej kontroli oferty zwycięzcy (podzadanie 1/13). Tu tylko
 * definicja + zapis/odczyt — bez logiki wyliczania terminu KIO czy analizy.
 * Magazyn wstrzykujemy jako atrapa (Map), bo prawdziwy `storage.js` ciągnie
 * react-native i nie ładuje się w node:test.
 */

function atrapaMagazynu() {
  const m = new Map();
  return {
    m,
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, v); },
  };
}

test('konstruktor: pełne dane zachowane, status z listy', () => {
  const k = new PoprzetargowaKontrola({
    postepowanieId: 'BZP-123',
    daneZamawiajacego: 'Gmina Kowalewo, ul. Rynek 1',
    dataOtwarciaOfert: '2026-07-10T09:00:00Z',
    dataOgloszeniaWyniku: '2026-07-20T12:00:00Z',
    terminOdwolaniaKio: '2026-07-30T23:59:59Z',
    status: 'wniosek_wyslany',
  });
  assert.equal(k.postepowanieId, 'BZP-123');
  assert.equal(k.daneZamawiajacego, 'Gmina Kowalewo, ul. Rynek 1');
  assert.equal(k.dataOtwarciaOfert, '2026-07-10T09:00:00Z');
  assert.equal(k.dataOgloszeniaWyniku, '2026-07-20T12:00:00Z');
  assert.equal(k.terminOdwolaniaKio, '2026-07-30T23:59:59Z');
  assert.equal(k.status, 'wniosek_wyslany');
});

test('konstruktor: braki → null, status domyślny „nowa"', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X' });
  assert.equal(k.daneZamawiajacego, null);
  assert.equal(k.dataOtwarciaOfert, null);
  assert.equal(k.dataOgloszeniaWyniku, null);
  assert.equal(k.terminOdwolaniaKio, null);
  assert.equal(k.status, STATUS_KONTROLI_DOMYSLNY);
  assert.equal(k.status, 'nowa');
});

test('konstruktor: nieznany status → fallback na domyślny', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 'X', status: 'kosmiczny' });
  assert.equal(k.status, 'nowa');
});

test('konstruktor: numeryczne id postępowania sprowadzone do stringa', () => {
  const k = new PoprzetargowaKontrola({ postepowanieId: 42 });
  assert.equal(k.postepowanieId, '42');
});

test('enum ma dokładnie 4 etapy w ustalonej kolejności', () => {
  assert.deepEqual(
    STATUSY_KONTROLI.map((s) => s.wartosc),
    ['nowa', 'wniosek_wyslany', 'dokumenty_otrzymane', 'analiza_gotowa'],
  );
});

test('toJSON/fromJSON: pełny round-trip zachowuje pola', () => {
  const oryginal = new PoprzetargowaKontrola({
    postepowanieId: 'TED-9',
    daneZamawiajacego: 'Zamawiający Sp. z o.o.',
    dataOtwarciaOfert: '2026-06-01T08:00:00Z',
    dataOgloszeniaWyniku: '2026-06-15T08:00:00Z',
    terminOdwolaniaKio: '2026-06-25T08:00:00Z',
    status: 'analiza_gotowa',
  });
  const odtworzona = PoprzetargowaKontrola.fromJSON(JSON.parse(JSON.stringify(oryginal)));
  assert.ok(odtworzona instanceof PoprzetargowaKontrola);
  assert.deepEqual(odtworzona.toJSON(), oryginal.toJSON());
});

test('zapisz + wczytaj: model wraca z magazynu', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, {
    postepowanieId: 'BZP-777',
    daneZamawiajacego: 'Powiat Testowy',
    status: 'dokumenty_otrzymane',
  });
  const wczytana = await wczytajKontrole(magazyn, 'BZP-777');
  assert.ok(wczytana instanceof PoprzetargowaKontrola);
  assert.equal(wczytana.postepowanieId, 'BZP-777');
  assert.equal(wczytana.daneZamawiajacego, 'Powiat Testowy');
  assert.equal(wczytana.status, 'dokumenty_otrzymane');
});

test('zapisz: klucz w magazynie jest namespaceowany per postępowanie', async () => {
  const magazyn = atrapaMagazynu();
  await zapiszKontrole(magazyn, { postepowanieId: 'ABC' });
  assert.ok(magazyn.m.has('kontrola:ABC'));
});

test('zapisz akceptuje instancję i zwraca znormalizowany model', async () => {
  const magazyn = atrapaMagazynu();
  const zwrocona = await zapiszKontrole(magazyn, new PoprzetargowaKontrola({ postepowanieId: 'INST' }));
  assert.ok(zwrocona instanceof PoprzetargowaKontrola);
  assert.equal(zwrocona.status, 'nowa');
});

test('zapisz bez postepowanieId → rzuca (nie ma jak powiązać)', async () => {
  const magazyn = atrapaMagazynu();
  await assert.rejects(() => zapiszKontrole(magazyn, { daneZamawiajacego: 'X' }), /postepowanieId/);
});

test('wczytaj: brak wpisu → null', async () => {
  const magazyn = atrapaMagazynu();
  assert.equal(await wczytajKontrole(magazyn, 'NIE-MA'), null);
});

test('wczytaj: brak id → null (bez odpytywania magazynu)', async () => {
  const magazyn = atrapaMagazynu();
  assert.equal(await wczytajKontrole(magazyn, null), null);
});

test('wczytaj: uszkodzony JSON → null (traktujemy jak brak)', async () => {
  const magazyn = atrapaMagazynu();
  await magazyn.setItem('kontrola:BAD', '{nie-json');
  assert.equal(await wczytajKontrole(magazyn, 'BAD'), null);
});
