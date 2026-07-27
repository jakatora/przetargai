import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

/*
 * Endpointy „czarnej skrzynki" składania oferty (podzadanie 5/7 ulepszenia „Czarna
 * skrzynka składania oferty — dowody na awarię platformy"). Router
 * `routes/czarnaSkrzynka.js` montowany pod `/api/przetarg/czarna-skrzynka` —
 * spójnie ze wzorcem Sejfu/Radaru SWZ (samodzielny router na singletonie `db`,
 * uwierzytelniony, skopowany do właściciela sesji).
 *
 * Testujemy PEŁNĄ ŚCIEŻKĘ rejestratora lotu przez PRAWDZIWĄ aplikację Express:
 *   sesja → zdarzenia (krok/błąd wysyłki/brak EPO) + zrzut → hash pliku oferty
 *   → POST /awaria (detekcja→pakiet→pismo w jednym kroku) → pobranie pakietu i pisma.
 * Do tego twarde niezmienniki wartości dowodowej: log append-only w kolejności,
 * tamper-evident suma pakietu, izolacja po właścicielu (cudza sesja = 404) i 401
 * bez tokenu.
 */

// ── Setup aplikacji (temp DB + temp katalog na oryginały) ────────────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-cs-rt-${process.pid}.db`);
const STORAGE_DIR = path.join(os.tmpdir(), `przetargai-cs-rt-store-${process.pid}`);
process.env.DATABASE_PATH = DB_FILE;
process.env.CZARNA_SKRZYNKA_STORAGE_DIR = STORAGE_DIR; // magazynNaDysku czyta to przy starcie routera
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
});

const ROOT = `/api/przetarg/czarna-skrzynka`;

async function zaloz(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345', keywords: ['budownictwo'] }),
  });
  return (await res.json()).token;
}

function naglowki(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function post(token, sciezka, body) {
  const res = await fetch(`${base}${ROOT}${sciezka}`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
}

async function get(token, sciezka) {
  const res = await fetch(`${base}${ROOT}${sciezka}`, { headers: naglowki(token) });
  return { status: res.status, json: await res.json() };
}

// Pełny, poprawny komplet meta pisma (wszystkie pola wymagane) — pismo „kompletne".
const META_PELNE = {
  zamawiajacy: 'Gmina Testowa, ul. Ratuszowa 1, 00-001 Testów',
  numer_postepowania: 'ZP/2026/07',
  przedmiot_zamowienia: 'Budowa hali sportowej',
  wykonawca: 'Firma Budowlana Sp. z o.o., NIP 1234567890',
  termin_skladania: '2026-08-01 10:00',
  miejscowosc: 'Testów',
  data_pisma: '2026-07-27',
};

// ══════════════════════════ Auth ══════════════════════════════════════════════

test('POST /sesje — bez tokenu => 401', async () => {
  const { status } = await post(null, '/sesje', { postepowanie_id: 'p1' });
  assert.equal(status, 401);
});

// ══════════════════════════ Pełna ścieżka rejestratora ════════════════════════

test('pełna ścieżka: sesja → zdarzenia + zrzut → hash oferty → awaria → pakiet + pismo', async () => {
  const token = await zaloz(`pelna-${process.pid}@t.pl`);

  // 1) START SESJI
  const start = await post(token, '/sesje', { postepowanie_id: 'p-hala' });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  const sesjaId = start.json.sesja?.id;
  assert.ok(sesjaId, 'sesja dostaje id');
  assert.equal(start.json.sesja.postepowanie_id, 'p-hala');
  assert.ok(start.json.sesja.strefa_czasowa, 'utrwalona strefa zegara serwera');

  // 2) DOPISANIE ZDARZEŃ (append-only) — krok, potem dwie awarie
  assert.equal((await post(token, `/sesje/${sesjaId}/zdarzenia`, { typ: 'krok', opis: 'Otwarto platformę' })).status, 201);
  assert.equal((await post(token, `/sesje/${sesjaId}/zdarzenia`, { typ: 'blad_wysylki', opis: 'HTTP 500 przy wysyłce' })).status, 201);
  const zEpo = await post(token, `/sesje/${sesjaId}/zdarzenia`, { typ: 'brak_epo', opis: 'Brak EPO po 3 próbach' });
  assert.equal(zEpo.status, 201);
  assert.equal(zEpo.json.zdarzenie.typ, 'brak_epo');
  assert.ok(zEpo.json.zdarzenie.czas_serwera, 'wpis ma czas z zegara serwera');

  // 3) ZRZUT EKRANU (base64) — utrwalony jako osobne zdarzenie na taśmie
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const zrzut = await post(token, `/sesje/${sesjaId}/zrzut`, {
    plik_base64: `data:image/png;base64,${png.toString('base64')}`,
    opis: 'Ekran błędu 11:59',
  });
  assert.equal(zrzut.status, 201, JSON.stringify(zrzut.json));
  assert.equal(zrzut.json.zdarzenie.typ, 'zrzut');
  assert.ok(zrzut.json.zdarzenie.plik_url, 'oryginał zrzutu zapisany');

  // 4) HASH PLIKU OFERTY (upload base64) — suma kontrolna utrwalona na sesji
  const oferta = Buffer.from('<Oferta><Cena>123456.78</Cena></Oferta>', 'utf8');
  const wgranie = await post(token, `/sesje/${sesjaId}/oferta`, {
    plik_base64: oferta.toString('base64'),
    nazwa_pliku: 'oferta.xml',
  });
  assert.equal(wgranie.status, 200, JSON.stringify(wgranie.json));
  const oczekiwanyHash = crypto.createHash('sha256').update(oferta).digest('hex');
  assert.equal(wgranie.json.hash, oczekiwanyHash, 'zwrócony hash = SHA-256 oferty');
  assert.equal(wgranie.json.sesja.hash_oferty, oczekiwanyHash, 'hash utrwalony na sesji');

  // Taśma sesji: zdarzenia w kolejności dopisywania (append-only).
  const podglad = await get(token, `/sesje/${sesjaId}`);
  assert.equal(podglad.status, 200);
  const typy = podglad.json.zdarzenia.map((z) => z.typ);
  assert.deepEqual(
    typy,
    ['krok', 'blad_wysylki', 'brak_epo', 'zrzut', 'hash_oferty'],
    'kolejność taśmy = kolejność dopisywania',
  );

  // 5) POST /awaria — detekcja → pakiet → pismo w jednym kroku
  const awaria = await post(token, `/sesje/${sesjaId}/awaria`, { meta: META_PELNE });
  assert.equal(awaria.status, 200, JSON.stringify(awaria.json));

  assert.equal(awaria.json.awaria.awaria, true, 'wykryto awarię');
  assert.deepEqual([...awaria.json.awaria.typy].sort(), ['blad_wysylki', 'brak_epo'], 'oba typy awarii');

  const pakiet = awaria.json.pakiet;
  assert.ok(pakiet.sumaKontrolna, 'pakiet ma tamper-evident sumę kontrolną');
  assert.equal(pakiet.oferta.hash, oczekiwanyHash, 'pakiet niesie hash oferty');
  assert.equal(pakiet.manifest.liczby.zrzuty, 1, 'manifest liczy 1 zrzut');
  assert.equal(pakiet.manifest.liczby.zdarzenia, 5, 'manifest liczy pełny przebieg');

  const pismo = awaria.json.pismo;
  assert.equal(pismo.kompletne, true, 'komplet meta => pismo kompletne');
  assert.deepEqual(pismo.braki, [], 'brak pól do uzupełnienia');
  assert.match(pismo.tresc, /PRZED upływem terminu/i, 'żądanie przedłużenia przed upływem terminu');
  assert.match(pismo.tresc, /Krajowej Izby Odwoławczej|KIO/, 'powołanie na linię orzeczniczą KIO');
  assert.match(pismo.tresc, /Gmina Testowa/, 'podstawione dane zamawiającego');
  assert.match(pismo.nazwaPliku, /^pismo-o-przedluzenie-.*\.txt$/, 'nazwa pliku pisma');

  // 6) POBRANIE PAKIETU osobno — te same DOWODY (suma całości niesie też czas budowy
  // pakietu, więc bywa różna między buildami; niezmienne są utrwalone dowody i sam fakt
  // posiadania tamper-evident sumy).
  const pakietGet = await get(token, `/sesje/${sesjaId}/pakiet`);
  assert.equal(pakietGet.status, 200, JSON.stringify(pakietGet.json));
  assert.ok(pakietGet.json.pakiet.sumaKontrolna, 'osobny pakiet też ma sumę kontrolną');
  assert.equal(pakietGet.json.pakiet.oferta.hash, oczekiwanyHash, 'ten sam hash oferty');
  assert.deepEqual(pakietGet.json.pakiet.awaria.typy, pakiet.awaria.typy, 'te same typy awarii');
  assert.deepEqual(pakietGet.json.pakiet.manifest.liczby, pakiet.manifest.liczby, 'ten sam manifest');

  // 7) POBRANIE PISMA osobno (z meta) — spójne z pismem z /awaria co do stałej treści
  // (suma CAŁOŚCI pakietu w wykazie załączników niesie czas budowy, więc jedna linia
  // bywa różna między buildami; kompletność i podstawione dane są niezmienne).
  const pismoPost = await post(token, `/sesje/${sesjaId}/pismo`, { meta: META_PELNE });
  assert.equal(pismoPost.status, 200, JSON.stringify(pismoPost.json));
  assert.equal(pismoPost.json.pismo.kompletne, true, 'osobne pismo też kompletne');
  assert.equal(pismoPost.json.pismo.nazwaPliku, pismo.nazwaPliku, 'ta sama nazwa pliku pisma');
  assert.match(pismoPost.json.pismo.tresc, /Gmina Testowa/, 'te same dane zamawiającego');
  assert.match(pismoPost.json.pismo.tresc, new RegExp(oczekiwanyHash), 'ten sam hash oferty w wykazie załączników');
});

// ══════════════════════════ Braki meta w piśmie ═══════════════════════════════

test('POST /pismo — brak wymaganych pól meta => kompletne=false z wykazem braków (nie 500)', async () => {
  const token = await zaloz(`braki-${process.pid}@t.pl`);
  const { json: s } = await post(token, '/sesje', { postepowanie_id: 'p2' });
  await post(token, `/sesje/${s.sesja.id}/zdarzenia`, { typ: 'niedostepnosc', opis: 'Strona nie odpowiada' });

  const { status, json } = await post(token, `/sesje/${s.sesja.id}/pismo`, { meta: { zamawiajacy: 'Tylko zamawiający' } });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.pismo.kompletne, false);
  assert.ok(json.pismo.braki.some((b) => b.pole === 'wykonawca'), 'brak wykonawcy oznaczony');
  assert.match(json.pismo.tresc, /\[UZUPEŁNIJ/, 'braki widoczne w treści, nie giną po cichu');
});

// ══════════════════════════ Walidacja wejścia ═════════════════════════════════

test('POST /zdarzenia — pusty/nieokreślony typ => 400 (nie 500)', async () => {
  const token = await zaloz(`ztyp-${process.pid}@t.pl`);
  const { json: s } = await post(token, '/sesje', {});
  assert.equal((await post(token, `/sesje/${s.sesja.id}/zdarzenia`, { opis: 'bez typu' })).status, 400);
  assert.equal((await post(token, `/sesje/${s.sesja.id}/zdarzenia`, { typ: '   ' })).status, 400);
});

test('POST /oferta — pusty/brak base64 => 400', async () => {
  const token = await zaloz(`oferta-pusta-${process.pid}@t.pl`);
  const { json: s } = await post(token, '/sesje', {});
  assert.equal((await post(token, `/sesje/${s.sesja.id}/oferta`, {})).status, 400);
  assert.equal((await post(token, `/sesje/${s.sesja.id}/oferta`, { plik_base64: '' })).status, 400);
});

// ══════════════════════════ Izolacja po właścicielu ═══════════════════════════

test('cudza/nieistniejąca sesja => 404 (izolacja właściciela)', async () => {
  const a = await zaloz(`ownerA-${process.pid}@t.pl`);
  const b = await zaloz(`ownerB-${process.pid}@t.pl`);
  const { json: s } = await post(a, '/sesje', { postepowanie_id: 'pa' });
  await post(a, `/sesje/${s.sesja.id}/zdarzenia`, { typ: 'krok', opis: 'wpis A' });

  // Odczyt cudzej sesji / pakietu.
  assert.equal((await get(b, `/sesje/${s.sesja.id}`)).status, 404, 'B nie odczyta sesji A');
  assert.equal((await get(b, `/sesje/${s.sesja.id}/pakiet`)).status, 404, 'B nie zbuduje pakietu z sesji A');

  // Zapis do cudzej sesji.
  assert.equal((await post(b, `/sesje/${s.sesja.id}/zdarzenia`, { typ: 'krok', opis: 'wchodzę' })).status, 404);
  assert.equal((await post(b, `/sesje/${s.sesja.id}/awaria`, { meta: META_PELNE })).status, 404);

  // Nieistniejąca sesja.
  assert.equal((await get(a, `/sesje/nie-istnieje`)).status, 404);

  // Log właściciela nietknięty przez próby B.
  const po = await get(a, `/sesje/${s.sesja.id}`);
  assert.equal(po.json.zdarzenia.length, 1, 'taśma A bez obcych wpisów');
});
