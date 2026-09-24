import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wyslijZLimitem, parametryDlaMetody } from '../src/lib/zapytanieSieciowe.js';

/** fetch, który odpowiada dopiero, gdy go nikt nie przerwie — jak zawieszone łącze. */
function wiszacyFetch() {
  return (_url, { signal }) => new Promise((_ok, blad) => {
    signal.addEventListener('abort', () => blad(new Error('AbortError')));
  });
}

const bezCzekania = () => Promise.resolve();

test('zawieszone żądanie kończy się błędem po limicie, zamiast wisieć bez końca', async () => {
  const start = Date.now();
  await assert.rejects(
    wyslijZLimitem('u', {}, { fetchFn: wiszacyFetch(), limitMs: 30, ponowienia: 0 }),
  );
  assert.ok(Date.now() - start < 2000);
});

test('odczyt (GET) po błędzie sieci ponawia raz i zwraca odpowiedź', async () => {
  let proby = 0;
  const fetchFn = async () => {
    proby += 1;
    if (proby === 1) throw new Error('sieć');
    return { ok: true, status: 200 };
  };
  const res = await wyslijZLimitem('u', {}, { fetchFn, limitMs: 1000, ponowienia: 1, czekaj: bezCzekania });
  assert.equal(res.status, 200);
  assert.equal(proby, 2);
});

test('odpowiedź HTTP z błędem (np. 500) NIE jest ponawiana — to nie awaria sieci', async () => {
  let proby = 0;
  const fetchFn = async () => { proby += 1; return { ok: false, status: 500 }; };
  const res = await wyslijZLimitem('u', {}, { fetchFn, limitMs: 1000, ponowienia: 1, czekaj: bezCzekania });
  assert.equal(res.status, 500);
  assert.equal(proby, 1);
});

test('po wyczerpaniu ponowień błąd sieci wychodzi na zewnątrz', async () => {
  let proby = 0;
  const fetchFn = async () => { proby += 1; throw new Error('sieć'); };
  await assert.rejects(wyslijZLimitem('u', {}, { fetchFn, limitMs: 1000, ponowienia: 1, czekaj: bezCzekania }));
  assert.equal(proby, 2);
});

test('parametryDlaMetody: tylko GET jest ponawiany; zapisy mają dłuższy limit (pliki Sejfu) i zero ponowień', () => {
  assert.deepEqual(parametryDlaMetody('GET'), { limitMs: 20_000, ponowienia: 1 });
  assert.deepEqual(parametryDlaMetody('POST'), { limitMs: 60_000, ponowienia: 0 });
  assert.deepEqual(parametryDlaMetody('DELETE'), { limitMs: 60_000, ponowienia: 0 });
});
