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

const { pobierzBzpZWznowieniem, zatwierdzCheckpointBzp, runBzpOkno } = await import('../src/jobs/oknoBzp.js');
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
  const licznikPierwszego = pustyLicznik();
  await pobierzBzpZWznowieniem(licznikPierwszego, {});
  // Checkpoint zamyka się dopiero PO zapisie ogłoszeń (2026-09-25).
  await zatwierdzCheckpointBzp(licznikPierwszego);
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
  await zatwierdzCheckpointBzp(licznik);
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
  await zatwierdzCheckpointBzp(licznik);

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

/*
 * CHECKPOINT PO UTRWALENIU (naprawa 2026-09-25).
 *
 * Doba była zamykana jako kompletna PRZED zapisem ogłoszeń, a błąd zapisu kończył
 * się tylko `pominiete++` z `ok: true`. Ogłoszenie, którego nie zapisaliśmy, nie
 * wracało już nigdy — jego doba była „kompletna".
 */
test('bez zatwierdzenia (zapis się nie odbył) checkpoint NIE zamyka żadnej doby', async () => {
  await wyczyscCheckpoint();
  podstawFetch();
  await pobierzBzpZWznowieniem(pustyLicznik(), {});
  const stan = await oknoBzp.wczytaj();
  assert.equal(stan, null, 'pobranie bez zapisu nie może niczego zamknąć');
});

test('KRYTYCZNE: nieudany zapis jednego ogłoszenia zostawia jego dobę otwartą — kolejny przebieg pobiera ją ponownie', async () => {
  await wyczyscCheckpoint();
  podstawFetch();
  const wczoraj = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const pechowe = `${wczoraj}/BZP 1`;

  const oryginalnyUpsert = tenders.upsert;
  tenders.upsert = async (o) => {
    if (o.externalId === pechowe) throw new Error('Firestore: zapis padł');
    return oryginalnyUpsert.call(tenders, o);
  };
  let pierwszy;
  try {
    pierwszy = await runBzpOkno({});
  } finally {
    tenders.upsert = oryginalnyUpsert;
  }

  assert.equal(pierwszy.skipped, 1);
  assert.equal(pierwszy.ok, false, 'utracony zapis to nie jest czysty sukces');
  assert.match(pierwszy.error, /zapis/i);
  const stan = await oknoBzp.wczytaj();
  assert.equal(stan.dni[wczoraj].kompletny, false, 'doba z niezapisanym ogłoszeniem zostaje otwarta');
  assert.equal(stan.dni[wczoraj].niezapisane, 1);

  const zapisywane = [];
  tenders.upsert = async (o) => { zapisywane.push(o.externalId); return oryginalnyUpsert.call(tenders, o); };
  const drugie = podstawFetch();
  let drugi;
  try {
    drugi = await runBzpOkno({});
  } finally {
    tenders.upsert = oryginalnyUpsert;
  }

  assert.ok(drugie.includes(wczoraj), 'kolejny przebieg pyta ponownie o dobę z utraconym zapisem');
  assert.ok(zapisywane.includes(pechowe), 'i zapisuje brakujące ogłoszenie');
  assert.equal(drugi.ok, true);
  assert.equal((await oknoBzp.wczytaj()).dni[wczoraj].kompletny, true);
});
