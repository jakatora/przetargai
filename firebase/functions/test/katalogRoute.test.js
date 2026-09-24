import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * GET /tenders — katalog „Wszystkie przetargi" (P1-1), przez realny serwer HTTP.
 *
 * Najważniejsza własność jest jedna: ta lista pokazuje RYNEK, a nie feed.
 * Użytkownik z pustym profilem i zerem dopasowań ma tu zobaczyć wszystko, co
 * jest w bazie. Gdyby katalog przeszedł przez pulę dopasowań albo przez dzienny
 * limit planu Free, byłby drugim feedem pod inną nazwą — i cały sens trybu
 * „Wszystkie" by zniknął.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto({ keywords = [], cpvCodes = [] } = {}) {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `kat-${process.pid}-${seq}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords,
      cpv_codes: cpvCodes,
    }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

/** Znacznik tej sesji testowej — baza emulatora jest wspólna dla wszystkich plików. */
const ZNAK = `katx${process.pid}x${Date.now()}`;

const zaJutro = (dni) => new Date(Date.now() + dni * 86_400_000).toISOString();

async function dodaj(nad = {}) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `${ZNAK}-${seq}`,
    title: `${ZNAK} ${nad.title ?? 'Przebudowa drogi gminnej'}`,
    organization: nad.organization ?? 'Gmina Zielonka',
    source: nad.source ?? 'bzp',
    cpvMain: nad.cpvMain ?? '45233222-1 (Roboty w zakresie układania chodników)',
    budget: nad.budget ?? null,
    deadline: nad.deadline ?? zaJutro(14),
    wojewodztwo: nad.wojewodztwo ?? 'PL14',
    url: nad.url ?? 'https://ezamowienia.gov.pl/x',
    publishedAt: nad.publishedAt ?? new Date().toISOString(),
  });
  return tender;
}

async function katalog(token, parametry = {}) {
  const qs = new URLSearchParams({ q: ZNAK, limit: '50', ...parametry });
  const odp = await fetch(`${BAZA}/tenders?${qs}`, { headers: auth(token) });
  return { status: odp.status, dane: await odp.json() };
}

test('bez tokenu katalog nie odpowiada', async () => {
  const odp = await fetch(`${BAZA}/tenders`);
  assert.equal(odp.status, 401);
});

test('KRYTYCZNE: konto BEZ profilu i BEZ dopasowań widzi pełny rynek', async () => {
  await dodaj({ title: 'Remont swietlicy' });
  await dodaj({ title: 'Dostawa kruszywa' });

  // Konto bez słów kluczowych i bez CPV nie ma prawa do ani jednego dopasowania.
  const token = await konto();
  const feed = await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(token) })).json();
  assert.equal(feed.count, 0, 'założenie testu: profil pusty => zero dopasowań');

  const { status, dane } = await katalog(token);
  assert.equal(status, 200);
  assert.ok(dane.count >= 2, `katalog ma pokazywać rynek, pokazał ${dane.count}`);
  assert.ok(dane.tenders.every((t) => t.title.startsWith(ZNAK)));
});

test('każdy wpis niesie źródło pierwotne, link do oryginału i czas synchronizacji', async () => {
  await dodaj({ source: 'ted', url: 'https://ted.europa.eu/udl?uri=1' });
  const token = await konto();
  const { dane } = await katalog(token, { zrodlo: 'ted' });

  const wpis = dane.tenders[0];
  assert.equal(wpis.zrodlo.kod, 'ted');
  assert.equal(wpis.zrodlo.etykieta.pl, 'TED');
  assert.ok(wpis.zrodlo.nazwa.en, 'nazwa źródła po angielsku');
  assert.equal(wpis.url, 'https://ted.europa.eu/udl?uri=1');
  assert.ok(Object.hasOwn(wpis.zrodlo, 'zsynchronizowano_o'), 'karta musi znać czas ostatniej synchronizacji');
  assert.ok(dane.zrodla.ted, 'odpowiedź niesie stan źródeł');
});

test('paginacja kursorowa oddaje komplet bez powtórek i bez dziur', async () => {
  const znakStrony = `${ZNAK}str`;
  for (let i = 0; i < 5; i++) {
    seq++;
    await tenders.upsert({
      externalId: `${znakStrony}-${i}`,
      title: `${znakStrony} pozycja ${i}`,
      source: 'bzp',
      deadline: zaJutro(20),
    });
  }
  const token = await konto();

  const widziane = [];
  let kursor = null;
  let stron = 0;
  do {
    const parametry = { q: znakStrony, limit: '2' };
    if (kursor) parametry.kursor = kursor;
    const { dane } = await katalog(token, parametry);
    widziane.push(...dane.tenders.map((t) => t.id));
    kursor = dane.next_kursor;
    stron++;
    assert.ok(stron < 10, 'paginacja się nie kończy');
  } while (kursor);

  assert.equal(widziane.length, 5, `oczekuję 5 pozycji, jest ${widziane.length}`);
  assert.equal(new Set(widziane).size, 5, 'ta sama pozycja nie może wrócić na kolejnej stronie');
});

test('kursor z INNEGO zestawu filtrów jest odrzucany, a nie po cichu użyty', async () => {
  await dodaj({ title: 'kursor strony' });
  const token = await konto();
  const { dane } = await katalog(token, { limit: '1' });
  assert.ok(dane.next_kursor, 'założenie testu: jest kolejna strona');

  const odp = await fetch(
    `${BAZA}/tenders?${new URLSearchParams({ q: ZNAK, limit: '1', zrodlo: 'ted', kursor: dane.next_kursor })}`,
    { headers: auth(token) },
  );
  assert.equal(odp.status, 400);
  const blad = await odp.json();
  assert.match(JSON.stringify(blad), /kursor/i);
});

test('uszkodzony kursor daje 400, nie cichy restart listy', async () => {
  const token = await konto();
  const odp = await fetch(`${BAZA}/tenders?kursor=$$$nie-kursor$$$`, { headers: auth(token) });
  assert.equal(odp.status, 400);
});

test('filtr źródła zawęża do jednego rejestru', async () => {
  const znak = `${ZNAK}zr`;
  await tenders.upsert({ externalId: `${znak}-a`, title: `${znak} bzp`, source: 'bzp', deadline: zaJutro(10) });
  await tenders.upsert({ externalId: `${znak}-b`, title: `${znak} bk`, source: 'baza_konkurencyjnosci', deadline: zaJutro(10) });
  const token = await konto();

  const wszystkie = await katalog(token, { q: znak });
  assert.equal(wszystkie.dane.count, 2);
  const tylkoBk = await katalog(token, { q: znak, zrodlo: 'baza_konkurencyjnosci' });
  assert.equal(tylkoBk.dane.count, 1);
  assert.equal(tylkoBk.dane.tenders[0].zrodlo.kod, 'baza_konkurencyjnosci');
});

test('KRYTYCZNE: filtr regionu widzi ogłoszenie BK zapisane NAZWĄ województwa', async () => {
  const znak = `${ZNAK}reg`;
  await tenders.upsert({
    externalId: `${znak}-bk`, title: `${znak} zapytanie ofertowe`,
    source: 'baza_konkurencyjnosci', wojewodztwo: 'małopolskie', deadline: zaJutro(10),
  });
  await tenders.upsert({
    externalId: `${znak}-bzp`, title: `${znak} roboty`,
    source: 'bzp', wojewodztwo: 'PL14', deadline: zaJutro(10),
  });
  const token = await konto();

  const malopolska = await katalog(token, { q: znak, region: 'PL12' });
  assert.equal(malopolska.dane.count, 1, 'nazwa województwa z BK musi się liczyć jak kod TERYT');
  assert.equal(malopolska.dane.tenders[0].zrodlo.kod, 'baza_konkurencyjnosci');
});

test('filtry CPV, kwoty i terminu zawężają zgodnie z opisem kontraktu', async () => {
  const znak = `${ZNAK}fil`;
  await tenders.upsert({ externalId: `${znak}-drogi`, title: `${znak} drogi`, source: 'bzp', cpvMain: '45233222-1', budget: 800000, deadline: zaJutro(10) });
  await tenders.upsert({ externalId: `${znak}-it`, title: `${znak} informatyka`, source: 'bzp', cpvMain: '72000000-5', budget: 50000, deadline: zaJutro(10) });
  await tenders.upsert({ externalId: `${znak}-stary`, title: `${znak} zamkniety`, source: 'bzp', cpvMain: '45233222-1', budget: 800000, deadline: zaJutro(-5) });
  const token = await konto();

  assert.equal((await katalog(token, { q: znak })).dane.count, 2, 'domyślnie bez przetargów po terminie');
  assert.equal((await katalog(token, { q: znak, termin: 'wszystkie' })).dane.count, 3);
  assert.equal((await katalog(token, { q: znak, termin: 'poterminie' })).dane.count, 1);
  assert.equal((await katalog(token, { q: znak, cpv: '45' })).dane.count, 1);
  assert.equal((await katalog(token, { q: znak, wartosc_min: '100000' })).dane.count, 1);
  assert.equal((await katalog(token, { q: znak, wartosc_max: '100000' })).dane.count, 1);
});

test('anulowane postępowanie wypada z katalogu', async () => {
  const znak = `${ZNAK}anul`;
  const { tender } = await tenders.upsert({ externalId: `${znak}-1`, title: `${znak} do anulowania`, source: 'bzp', deadline: zaJutro(10) });
  const token = await konto();
  assert.equal((await katalog(token, { q: znak })).dane.count, 1);

  await tenders.oznaczAnulowany(`${znak}-1`, { powod: 'test' });
  assert.equal((await katalog(token, { q: znak })).dane.count, 0, `anulowany ${tender.id} nie ma prawa wrócić`);
});

test('sortowanie po terminie oddaje najbliższe terminy pierwsze', async () => {
  const znak = `${ZNAK}sort`;
  await tenders.upsert({ externalId: `${znak}-pozno`, title: `${znak} pozno`, source: 'bzp', deadline: zaJutro(40) });
  await tenders.upsert({ externalId: `${znak}-wczesnie`, title: `${znak} wczesnie`, source: 'bzp', deadline: zaJutro(2) });
  const token = await konto();

  const { dane } = await katalog(token, { q: znak, sort: 'termin' });
  assert.equal(dane.tenders.length, 2);
  assert.match(dane.tenders[0].title, /wczesnie/);
  assert.ok(dane.filtry.uwaga_sortowania.pl, 'sortowanie po terminie musi ujawnić, że pomija ogłoszenia bez terminu');
});

test('limit jest przycinany po stronie serwera — klient nie ustala kosztu odczytu', async () => {
  const token = await konto();
  const { dane } = await katalog(token, { limit: '5000' });
  assert.equal(dane.limit, 50);
});

test('GET /tenders/zakres-danych mówi, co obejmujemy i czego NIE', async () => {
  const token = await konto();
  const odp = await fetch(`${BAZA}/tenders/zakres-danych`, { headers: auth(token) });
  assert.equal(odp.status, 200);
  const dane = await odp.json();

  assert.deepEqual(dane.zrodla.map((z) => z.kod), ['bzp', 'ted', 'baza_konkurencyjnosci']);
  assert.ok(dane.nieobjete.some((n) => n.kod === 'bip'));
  assert.ok(dane.zastrzezenie.pl && dane.zastrzezenie.en);
  assert.doesNotMatch(dane.zastrzezenie.pl, /wszystkie przetargi w Polsce/i);
});

test('KRYTYCZNE: sufit odczytów nie gubi ogłoszeń — kursor prowadzi dalej', async () => {
  const znak = `${ZNAK}sufit`;
  for (let i = 0; i < 6; i++) {
    await tenders.upsert({
      externalId: `${znak}-${i}`, title: `${znak} pozycja ${i}`, source: 'bzp', deadline: zaJutro(30),
    });
  }
  const { normalizujFiltry } = await import('../src/lib/katalogPrzetargow.js');
  const filtry = normalizujFiltry({ q: znak, limit: 50 });

  // Sufit 2 dokumentów na przebieg: żeby zebrać całą szóstkę, kursor MUSI działać
  // mimo że każdy przebieg kończy się na budżecie odczytów, a nie na końcu danych.
  const widziane = new Set();
  let kursor = null;
  let przebiegow = 0;
  do {
    const wynik = await tenders.katalog({ filtry, kursor, rozmiarStrony: 2, skanMaks: 2 });
    for (const w of wynik.wiersze) widziane.add(w.id);
    kursor = wynik.ostatni;
    przebiegow++;
    assert.ok(przebiegow < 400, 'skan nie zbiega się do końca');
  } while (kursor && widziane.size < 6);

  assert.equal(widziane.size, 6, 'każde ogłoszenie musi być osiągalne mimo sufitu skanu');
});

test('GET /tenders/filtry podaje słowniki filtrów w PL i EN', async () => {
  const token = await konto();
  const dane = await (await fetch(`${BAZA}/tenders/filtry`, { headers: auth(token) })).json();

  assert.ok(dane.zrodla.length === 3);
  assert.equal(dane.regiony.length, 16);
  assert.ok(dane.sortowania.every((s) => s.etykieta.pl && s.etykieta.en));
  assert.ok(dane.terminy.every((s) => s.etykieta.pl && s.etykieta.en));
});
