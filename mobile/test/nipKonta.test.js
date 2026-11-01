import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synchronizujNipKonta } from '../src/lib/nipKonta.js';
import { KLUCZ_DANYCH_WYKONAWCY } from '../src/lib/dokumentyOferty.js';

const magazyn = (dane) => ({ getItem: async (k) => (k === KLUCZ_DANYCH_WYKONAWCY && dane ? JSON.stringify(dane) : null) });

test('NIP z telefonu idzie do konta raz, gdy konto go nie ma; zły NIP, brak danych i błąd serwera — nic', async () => {
  const wyslane = [];
  const api = { ustawNipFirmy: async (nip) => { wyslane.push(nip); return { user: { id: 'u1', company_nip: nip } }; } };
  assert.deepEqual(await synchronizujNipKonta({ id: 'u1', company_nip: null }, { storage: magazyn({ nip: '526-104-08-28' }), api }), { id: 'u1', company_nip: '5261040828' });
  assert.deepEqual(wyslane, ['5261040828']);
  assert.equal(await synchronizujNipKonta({ id: 'u1', company_nip: '7941844550' }, { storage: magazyn({ nip: '5261040828' }), api }), null, 'NIP z serwera zostaje');
  assert.equal(await synchronizujNipKonta({ id: 'u1', company_nip: null }, { storage: magazyn({ nip: '5261040827' }), api }), null, 'zła suma kontrolna');
  assert.equal(await synchronizujNipKonta({ id: 'u1', company_nip: null }, { storage: magazyn(null), api }), null);
  assert.equal(wyslane.length, 1);
  const zajety = { ustawNipFirmy: async () => { throw Object.assign(new Error('Ten NIP ma już inne konto'), { status: 409 }); } };
  assert.equal(await synchronizujNipKonta({ id: 'u1', company_nip: null }, { storage: magazyn({ nip: '5261040828' }), api: zajety }), null, 'błąd nie wywraca startu');
  assert.equal(await synchronizujNipKonta(null, { storage: magazyn({ nip: '5261040828' }), api }), null);
});
