import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * WZNAWIANIE OKNA BZP od końca do końca (P0-2) — z prawdziwym checkpointem
 * w Firestore. Testy czystej logiki wyboru dób są w oknoBzpCheckpoint.test.js;
 * tutaj sprawdzamy, że stan naprawdę przeżywa przebieg i że ponowne pobranie
 * tej samej doby niczego nie duplikuje w bazie.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { pobierzBzpZWznowieniem } = await import('../src/jobs/oknoBzp.js');
const { oknoBzp, tenders, tenderDocId } = await import('../src/db/repos.js');
const { pustyLicznik } = await import('../src/lib/licznikZrodla.js');
const { getFirestore } = await import('firebase-admin/firestore');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (dane) => ({
  ok: true, status: 200, statusText: '200',
  json: async () => dane, text: async () => JSON.stringify(dane),
});

/** Ogłoszenia z identyfikatorem zależnym od doby — jak w prawdziwym BZP. */
function ogloszeniaDoby(dzien, n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    bzpNumber: `${dzien}/BZP ${i}`,
    orderObject: `Robota ${dzien}-${i}`,
    cpvCode: '45000000-7',
  }));
}

/** Podstawia fetch i zbiera doby, o które zapytał adapter. */
function podstawFetch() {
  const pytaneDoby = [];
  globalThis.fetch = async (u) => {
    const dzien = new URL(String(u)).searchParams.get('PublicationDateFrom').slice(0, 10);
    pytaneDoby.push(dzien);
    return odpowiedz(ogloszeniaDoby(dzien));
  };
  return pytaneDoby;
}

async function wyczyscCheckpoint() {
  await getFirestore().collection('_health').doc('bzp_okno').delete();
}

test('KLUCZOWE: drugi przebieg NIE pyta ponownie o doby domknięte w pierwszym', async () => {
  await wyczyscCheckpoint();

  const pierwsze = podstawFetch();
  await pobierzBzpZWznowieniem(pustyLicznik(), {});
  assert.ok(pierwsze.length >= 2, 'pierwszy przebieg pobiera całe okno');

  const drugie = podstawFetch();
  await pobierzBzpZWznowieniem(pustyLicznik(), {});

  const dzisiaj = new Date().toISOString().slice(0, 10);
  assert.deepEqual([...new Set(drugie)], [dzisiaj],
    'domknięte doby przeszłe nie kosztują już ani jednego zapytania');
});

test('doba pominięta przez BUDŻET wraca w kolejnym przebiegu', async () => {
  await wyczyscCheckpoint();
  podstawFetch();

  // Budżet 0 ms: pierwszy przebieg nie zdąży przetworzyć żadnej doby.
  const licznik = pustyLicznik();
  await pobierzBzpZWznowieniem(licznik, { budzetMs: 0 });
  assert.equal(licznik.dni.length, 0);
  assert.ok(licznik.pominieteDni.length > 0);

  const stan = await oknoBzp.wczytaj();
  assert.ok(Object.values(stan.dni).every((d) => !d.kompletny),
    'nic nie wolno zamknąć jako kompletne, skoro nic nie pobrano');

  const drugie = podstawFetch();
  await pobierzBzpZWznowieniem(pustyLicznik(), {});
  assert.ok(drugie.length > 0, 'kolejny przebieg podnosi to, co zostało');
});

test('licznik niesie stan okna: ile dób i ile zostało do domknięcia', async () => {
  await wyczyscCheckpoint();
  podstawFetch();

  const licznik = pustyLicznik();
  await pobierzBzpZWznowieniem(licznik, {});

  assert.ok(licznik.dobyOkna >= 7, 'okno domyślne to BZP_LOOKBACK_DAYS + dzisiaj');
  assert.equal(licznik.dobyNiedomkniete, 0,
    'po udanym pełnym przebiegu żadna doba przeszła nie zostaje otwarta');
});

test('IDEMPOTENCJA: ponowne pobranie tej samej doby nie duplikuje przetargów', async () => {
  await wyczyscCheckpoint();
  podstawFetch();

  const ogloszenia = await pobierzBzpZWznowieniem(pustyLicznik(), {});
  const probka = ogloszenia[0];

  const pierwszy = await tenders.upsert(probka);
  assert.equal(pierwszy.created, true);

  const drugi = await tenders.upsert(probka);
  assert.equal(drugi.created, false, 'docId = identyfikator zewnętrzny → wznawianie jest bezpieczne');

  const zapisany = await tenders.findById(tenderDocId(probka.externalId));
  assert.equal(zapisany.bzp_external_id, probka.externalId);
});
