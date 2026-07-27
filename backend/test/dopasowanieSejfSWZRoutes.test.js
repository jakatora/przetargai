import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpoint dopasowania sejf ↔ SWZ (podzadanie 5/7 ulepszenia „Sejf podmiotowych
 * środków dowodowych z licznikiem świeżości"). Trasa `POST /api/przetarg/sejf/
 * dopasowanie/:postepowanieId` w routerze sejfu (routes/sejfDokumentow.js), testowana
 * end-to-endowo przez PRAWDZIWĄ aplikację Express (jak endpointy z kroku 4/7).
 *
 * Sedno: przewidywany dzień złożenia decyduje o koszykach. Testujemy w szczególności
 * SCENARIUSZ PRZESUNIĘCIA TERMINU — ten sam KRK jest „świeży" dla terminu z
 * postępowania, a „przeterminuje się przed złożeniem" dla późniejszego dnia podanego
 * jako override (`dzien_zlozenia`). Dodatkowo: brakujący typ z linkiem online oraz
 * izolacja właściciela (cudze/nieistniejące postępowanie => 404).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-dopasowanie-rt-${process.pid}.db`);
const STORAGE_DIR = path.join(os.tmpdir(), `przetargai-dopasowanie-rt-store-${process.pid}`);
process.env.DATABASE_PATH = DB_FILE;
process.env.SEJF_STORAGE_DIR = STORAGE_DIR;
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

async function dodajDokument(token, body) {
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body),
  });
  return (await res.json()).dokument;
}

async function zalozPostepowanie(token, body) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body),
  });
  return (await res.json()).postepowanie;
}

async function dopasuj(token, postepowanieId, body = {}) {
  const res = await fetch(`${base}/api/przetarg/sejf/dopasowanie/${postepowanieId}`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// SWZ wymagający KRK oraz zaświadczenia ZUS.
const SWZ_KRK_ZUS = `
  VIII. Podmiotowe środki dowodowe, jakie złoży wykonawca:
  1) informacja z Krajowego Rejestru Karnego w zakresie niekaralności,
  2) zaświadczenie z ZUS o niezaleganiu w opłacaniu składek na ubezpieczenia społeczne.
`;

test('POST /dopasowanie/:id — bez tokenu => 401', async () => {
  const { status } = await dopasuj(null, 'jakies-id');
  assert.equal(status, 401);
});

test('POST /dopasowanie/:id — nieistniejące/cudze postępowanie => 404', async () => {
  const a = await zaloz(`dop-a-${process.pid}@t.pl`);
  const b = await zaloz(`dop-b-${process.pid}@t.pl`);
  const post = await zalozPostepowanie(a, { nazwa: 'Budowa drogi', termin_skladania_ofert: '2026-09-01' });

  assert.equal((await dopasuj(a, 'nie-istnieje')).status, 404, 'nieistniejące => 404');
  assert.equal((await dopasuj(b, post.id)).status, 404, 'B nie widzi postępowania A');
});

test('POST /dopasowanie/:id — KRK świeży dla terminu z postępowania, ZUS brakuje z linkiem', async () => {
  const token = await zaloz(`dop-swieze-${process.pid}@t.pl`);
  // Termin składania z postępowania: 2026-09-01. KRK ważny do 2026-10-28.
  const post = await zalozPostepowanie(token, { nazwa: 'Remont', termin_skladania_ofert: '2026-09-01' });
  await dodajDokument(token, { typ: 'krk', data_wystawienia: '2026-05-01' });

  const { status, json } = await dopasuj(token, post.id, { swz: SWZ_KRK_ZUS });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.postepowanie_id, post.id);
  assert.equal(json.dzien_zlozenia, '2026-09-01', 'dzień złożenia z terminu postępowania');
  assert.ok(json.wymagane_typy.includes('krk') && json.wymagane_typy.includes('zus'), 'wykryto KRK i ZUS z SWZ');

  assert.deepEqual(json.swieze.map((d) => d.typ), ['krk'], 'KRK świeży na 2026-09-01');
  assert.equal(json.przeterminuja_sie.length, 0, 'nic nie przeterminowane dla tego terminu');
  assert.deepEqual(json.brakuje.map((d) => d.typ), ['zus'], 'ZUS brakuje w sejfie');
  assert.equal(json.brakuje[0].online.nazwa, 'PUE ZUS', 'link, gdzie wyrobić ZUS online');
});

test('SCENARIUSZ przesunięcia terminu — override dzien_zlozenia przenosi KRK do „przeterminuje się"', async () => {
  const token = await zaloz(`dop-shift-${process.pid}@t.pl`);
  const post = await zalozPostepowanie(token, { nazwa: 'Przebudowa', termin_skladania_ofert: '2026-09-01' });
  await dodajDokument(token, { typ: 'krk', data_wystawienia: '2026-05-01' }); // ważny do 2026-10-28

  // Pierwotny termin (2026-09-01): KRK świeży.
  const przed = await dopasuj(token, post.id, { swz: SWZ_KRK_ZUS });
  assert.deepEqual(przed.json.swieze.map((d) => d.typ), ['krk'], 'przed przesunięciem KRK świeży');

  // Przesunięty dzień złożenia (2026-11-15, po utracie ważności): KRK przeterminuje się.
  const po = await dopasuj(token, post.id, { swz: SWZ_KRK_ZUS, dzien_zlozenia: '2026-11-15' });
  assert.equal(po.status, 200, JSON.stringify(po.json));
  assert.equal(po.json.dzien_zlozenia, '2026-11-15', 'użyto przewidywanego dnia złożenia z override');
  assert.equal(po.json.swieze.length, 0, 'po przesunięciu KRK nie jest już świeży');
  assert.deepEqual(po.json.przeterminuja_sie.map((d) => d.typ), ['krk'],
    'po przesunięciu terminu KRK przeterminuje się przed złożeniem');
  assert.ok(po.json.przeterminuja_sie[0].dniDoWaznosci < 0, 'ujemny licznik dni na dzień złożenia');
});

test('POST /dopasowanie/:id — błędny dzien_zlozenia => 400 (nie 500)', async () => {
  const token = await zaloz(`dop-zladata-${process.pid}@t.pl`);
  const post = await zalozPostepowanie(token, { nazwa: 'Test', termin_skladania_ofert: '2026-09-01' });
  const { status } = await dopasuj(token, post.id, { swz: SWZ_KRK_ZUS, dzien_zlozenia: '2026-02-30' });
  assert.equal(status, 400);
});
