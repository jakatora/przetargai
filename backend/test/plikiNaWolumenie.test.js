import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

/*
 * Pliki Sejfu i Czarnej skrzynki MUSZĄ leżeć na trwałym wolumenie (2026-09-25).
 *
 * Wcześniej domyślny katalog był liczony od `process.cwd()` => na Railway `/app/data/...`,
 * a `/app` znika przy każdym deployu. Oryginały zaświadczeń (KRK/ZUS/US) i dowody awarii
 * platformy (zrzuty, oryginał oferty) przepadały po cichu, choć rekordy w bazie (na `/data`)
 * dalej twierdziły, że plik jest. Domyślny katalog = obok pliku bazy (ten sam wolumen).
 *
 * Test NIE ustawia SEJF_STORAGE_DIR / CZARNA_SKRZYNKA_STORAGE_DIR — sprawdza właśnie
 * DOMYŚLNE katalogi: baza w <tmp>/data.db => pliki w <tmp>/sejf i <tmp>/czarna-skrzynka.
 * Dodatkowo: kasowanie plików (usunięcie dokumentu, nadpisanie, usunięcie konta), brak
 * ścieżki serwera w odpowiedziach i SHA-256 plików w logu oraz w pakiecie dowodowym.
 */

const KATALOG = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-wolumen-'));
const DB_FILE = path.join(KATALOG, 'data.db');
process.env.DATABASE_PATH = DB_FILE;
delete process.env.SEJF_STORAGE_DIR;
delete process.env.CZARNA_SKRZYNKA_STORAGE_DIR;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { magazynNaDysku: magazynSejfu } = await import('../src/services/sejfDokumentow.js');
const { magazynNaDysku: magazynSkrzynki } = await import('../src/services/czarnaSkrzynka.js');

const KATALOG_SEJFU = path.join(KATALOG, 'sejf');
const KATALOG_SKRZYNKI = path.join(KATALOG, 'czarna-skrzynka');

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
  try { fs.rmSync(KATALOG, { recursive: true, force: true }); } catch { /* Windows: plik bazy bywa zablokowany */ }
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const XML_PODPISANY = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
   <Zaswiadczenie xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
     <Tresc>Nie figuruje w Kartotece Karnej.</Tresc>
     <ds:Signature><ds:SignatureValue>QUJD</ds:SignatureValue></ds:Signature>
   </Zaswiadczenie>`,
  'utf8',
);
const PDF_PODPISANY = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Sig/ByteRange[0 1 2 3]>>endobj\n%%EOF', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);

async function zaloz(email) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'haslo12345' }),
  });
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  return json.token;
}

async function zadanie(token, metoda, url, body) {
  const res = await fetch(`${base}${url}`, {
    method: metoda,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Pliki w katalogu (albo [] gdy katalog jeszcze nie powstał). */
function pliki(katalog) {
  try { return fs.readdirSync(katalog).sort(); } catch { return []; }
}

/** Czy wartość wygląda na ścieżkę serwera (absolutną / z katalogiem). */
function toSciezkaSerwera(v) {
  return typeof v === 'string' && (path.isAbsolute(v) || v.includes('/') || v.includes('\\'));
}

// ══════════════════════════ Domyślne katalogi ═════════════════════════════════

test('domyślny katalog Sejfu i Czarnej skrzynki leży pod katalogiem bazy (trwały wolumen)', () => {
  assert.equal(magazynSejfu().katalog, KATALOG_SEJFU);
  assert.equal(magazynSkrzynki().katalog, KATALOG_SKRZYNKI);
});

test('zmienne SEJF_STORAGE_DIR / CZARNA_SKRZYNKA_STORAGE_DIR nadal nadpisują katalog', () => {
  const inny = path.join(KATALOG, 'inny');
  process.env.SEJF_STORAGE_DIR = inny;
  process.env.CZARNA_SKRZYNKA_STORAGE_DIR = inny;
  try {
    assert.equal(magazynSejfu().katalog, inny);
    assert.equal(magazynSkrzynki().katalog, inny);
  } finally {
    delete process.env.SEJF_STORAGE_DIR;
    delete process.env.CZARNA_SKRZYNKA_STORAGE_DIR;
  }
});

test('magazyn.usun kasuje wyłącznie plik w SWOIM katalogu (nazwa, nie ścieżka — bez path traversal)', async () => {
  const mag = magazynSejfu(path.join(KATALOG, 'traversal'));
  const klucz = await mag.zapisz('abc', 'pdf', PDF_PODPISANY);
  assert.equal(klucz, 'abc.pdf', 'do bazy trafia nazwa pliku, nie ścieżka serwera');
  const ofiara = path.join(KATALOG, 'nie-ruszac.pdf');
  fs.writeFileSync(ofiara, 'x');
  await mag.usun('../nie-ruszac.pdf');
  assert.ok(fs.existsSync(ofiara), 'plik spoza katalogu magazynu nietknięty');
  await mag.usun(klucz);
  assert.deepEqual(pliki(path.join(KATALOG, 'traversal')), []);
  // Stary rekord z absolutną ścieżką (/app/data/sejf/<id>.pdf) — kasujemy po nazwie w katalogu.
  const klucz2 = await mag.zapisz('def', 'xml', XML_PODPISANY);
  await mag.usun(path.join('/app/data/sejf', klucz2));
  assert.deepEqual(pliki(path.join(KATALOG, 'traversal')), []);
  await mag.usun('nie-istnieje.pdf'); // brak pliku => bez wyjątku
});

// ══════════════════════════ Sejf dokumentów ═══════════════════════════════════

test('Sejf: upload zapisuje na wolumenie, odpowiedź bez ścieżki serwera, ma_plik=true', async () => {
  const token = await zaloz(`sejf-upload-${process.pid}@t.pl`);
  const { json: d } = await zadanie(token, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'krk' });
  const up = await zadanie(token, 'POST', `/api/przetarg/sejf/dokumenty/${d.dokument.id}/plik`, {
    nazwa_pliku: 'krk.xml', plik_base64: XML_PODPISANY.toString('base64'),
  });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.ok(pliki(KATALOG_SEJFU).includes(`${d.dokument.id}.xml`), 'oryginał leży w <katalog bazy>/sejf');
  assert.equal(up.json.dokument.ma_plik, true);
  assert.ok(up.json.dokument.plik_url, 'pole zostaje (mobile czyta je jako „jest plik")');
  assert.ok(!toSciezkaSerwera(up.json.dokument.plik_url), `bez ścieżki serwera: ${up.json.dokument.plik_url}`);

  const lista = await zadanie(token, 'GET', '/api/przetarg/sejf/dokumenty');
  const naLiscie = lista.json.dokumenty.find((x) => x.id === d.dokument.id);
  assert.equal(naLiscie.ma_plik, true);
  assert.ok(!toSciezkaSerwera(naLiscie.plik_url));

  const bezPliku = await zadanie(token, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'zus' });
  assert.equal(bezPliku.json.dokument.ma_plik, false);
  assert.equal(bezPliku.json.dokument.plik_url, null);
});

test('Sejf: nadpisanie pliku innym formatem kasuje stary oryginał z dysku', async () => {
  const token = await zaloz(`sejf-nadpis-${process.pid}@t.pl`);
  const { json: d } = await zadanie(token, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'us' });
  const id = d.dokument.id;
  await zadanie(token, 'POST', `/api/przetarg/sejf/dokumenty/${id}/plik`, { plik_base64: XML_PODPISANY.toString('base64') });
  assert.ok(pliki(KATALOG_SEJFU).includes(`${id}.xml`));

  const up = await zadanie(token, 'POST', `/api/przetarg/sejf/dokumenty/${id}/plik`, { plik_base64: PDF_PODPISANY.toString('base64') });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.ok(pliki(KATALOG_SEJFU).includes(`${id}.pdf`), 'nowy oryginał zapisany');
  assert.ok(!pliki(KATALOG_SEJFU).includes(`${id}.xml`), 'stary oryginał nie zostaje jako sierota');
});

test('Sejf: DELETE dokumentu usuwa jego plik z dysku', async () => {
  const token = await zaloz(`sejf-delete-${process.pid}@t.pl`);
  const { json: d } = await zadanie(token, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'krk' });
  const id = d.dokument.id;
  await zadanie(token, 'POST', `/api/przetarg/sejf/dokumenty/${id}/plik`, { plik_base64: XML_PODPISANY.toString('base64') });
  assert.ok(pliki(KATALOG_SEJFU).includes(`${id}.xml`));

  const del = await zadanie(token, 'DELETE', `/api/przetarg/sejf/dokumenty/${id}`);
  assert.equal(del.status, 200);
  assert.ok(!pliki(KATALOG_SEJFU).includes(`${id}.xml`), 'plik usunięty razem z rekordem');
});

// ══════════════════════════ Czarna skrzynka ═══════════════════════════════════

test('Czarna skrzynka: zrzut i oferta na wolumenie, SHA-256 w logu i w pakiecie, bez ścieżek serwera', async () => {
  const token = await zaloz(`cs-hash-${process.pid}@t.pl`);
  const { json: s } = await zadanie(token, 'POST', '/api/przetarg/czarna-skrzynka/sesje', {});
  const sid = s.sesja.id;

  const zrzut = await zadanie(token, 'POST', `/api/przetarg/czarna-skrzynka/sesje/${sid}/zrzut`, {
    plik_base64: `data:image/png;base64,${PNG.toString('base64')}`,
  });
  assert.equal(zrzut.status, 201, JSON.stringify(zrzut.json));
  assert.equal(zrzut.json.zdarzenie.plik_sha256, sha256(PNG), 'SHA-256 zrzutu utrwalony we wpisie');
  assert.ok(!toSciezkaSerwera(zrzut.json.zdarzenie.plik_url), `bez ścieżki serwera: ${zrzut.json.zdarzenie.plik_url}`);
  assert.equal(pliki(KATALOG_SKRZYNKI).length, 1, 'zrzut leży w <katalog bazy>/czarna-skrzynka');

  const oferta = Buffer.from('<Oferta><Cena>1</Cena></Oferta>', 'utf8');
  const wgranie = await zadanie(token, 'POST', `/api/przetarg/czarna-skrzynka/sesje/${sid}/oferta`, {
    plik_base64: oferta.toString('base64'), nazwa_pliku: 'oferta.xml',
  });
  assert.equal(wgranie.status, 200, JSON.stringify(wgranie.json));
  assert.equal(wgranie.json.hash, sha256(oferta));
  assert.ok(!toSciezkaSerwera(wgranie.json.plik_url), `bez ścieżki serwera: ${wgranie.json.plik_url}`);
  assert.ok(!toSciezkaSerwera(wgranie.json.sesja.plik_oferty_url));
  assert.equal(pliki(KATALOG_SKRZYNKI).length, 2);

  const podglad = await zadanie(token, 'GET', `/api/przetarg/czarna-skrzynka/sesje/${sid}`);
  const wpisOferty = podglad.json.zdarzenia.find((z) => z.typ === 'hash_oferty');
  assert.equal(wpisOferty.plik_sha256, sha256(oferta), 'SHA-256 oferty także we wpisie logu');
  for (const z of podglad.json.zdarzenia) assert.ok(!toSciezkaSerwera(z.plik_url));

  const { json: p } = await zadanie(token, 'GET', `/api/przetarg/czarna-skrzynka/sesje/${sid}/pakiet`);
  const pakiet = p.pakiet;
  assert.equal(pakiet.manifest.zrzuty[0].sha256, sha256(PNG), 'SHA-256 zrzutu w manifeście pakietu');
  assert.equal(pakiet.oferta.hash, sha256(oferta), 'SHA-256 oferty w pakiecie');
  const wPrzebiegu = pakiet.manifest.przebieg.find((e) => e.typ === 'zrzut');
  assert.equal(wPrzebiegu.plik_sha256, sha256(PNG), 'SHA-256 pliku także w pełnym przebiegu');
  assert.ok(!toSciezkaSerwera(pakiet.oferta.plikUrl));
});

// ══════════════════════════ Usunięcie konta ═══════════════════════════════════

test('DELETE /auth/me kasuje z dysku pliki Sejfu i Czarnej skrzynki użytkownika (cudze zostają)', async () => {
  const token = await zaloz(`konto-pliki-${process.pid}@t.pl`);
  const obcy = await zaloz(`konto-obcy-${process.pid}@t.pl`);

  const { json: d } = await zadanie(token, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'krk' });
  await zadanie(token, 'POST', `/api/przetarg/sejf/dokumenty/${d.dokument.id}/plik`, { plik_base64: XML_PODPISANY.toString('base64') });
  const { json: s } = await zadanie(token, 'POST', '/api/przetarg/czarna-skrzynka/sesje', {});
  await zadanie(token, 'POST', `/api/przetarg/czarna-skrzynka/sesje/${s.sesja.id}/zrzut`, { plik_base64: PNG.toString('base64') });
  await zadanie(token, 'POST', `/api/przetarg/czarna-skrzynka/sesje/${s.sesja.id}/oferta`, {
    plik_base64: Buffer.from('oferta').toString('base64'), nazwa_pliku: 'o.pdf',
  });

  const { json: dObcy } = await zadanie(obcy, 'POST', '/api/przetarg/sejf/dokumenty', { typ: 'krk' });
  await zadanie(obcy, 'POST', `/api/przetarg/sejf/dokumenty/${dObcy.dokument.id}/plik`, { plik_base64: XML_PODPISANY.toString('base64') });
  const { json: sObcy } = await zadanie(obcy, 'POST', '/api/przetarg/czarna-skrzynka/sesje', {});
  await zadanie(obcy, 'POST', `/api/przetarg/czarna-skrzynka/sesje/${sObcy.sesja.id}/zrzut`, { plik_base64: PNG.toString('base64') });

  const sejfPrzed = pliki(KATALOG_SEJFU);
  const skrzynkaPrzed = pliki(KATALOG_SKRZYNKI);

  const del = await zadanie(token, 'DELETE', '/auth/me', { password: 'haslo12345' });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const sejfPo = pliki(KATALOG_SEJFU);
  const skrzynkaPo = pliki(KATALOG_SKRZYNKI);
  assert.ok(!sejfPo.includes(`${d.dokument.id}.xml`), 'plik sejfu usuniętego konta skasowany');
  assert.ok(sejfPo.includes(`${dObcy.dokument.id}.xml`), 'plik sejfu innego użytkownika zostaje');
  assert.equal(sejfPrzed.length - sejfPo.length, 1);
  assert.equal(skrzynkaPrzed.length - skrzynkaPo.length, 2, 'zrzut + oferta usuniętego konta skasowane');
  assert.ok(skrzynkaPo.length >= 1, 'zrzut innego użytkownika zostaje');
});
