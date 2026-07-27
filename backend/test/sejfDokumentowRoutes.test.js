import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Endpointy sejfu dokumentów (podzadanie 4/7 ulepszenia „Sejf podmiotowych środków
 * dowodowych z licznikiem świeżości"). Router `routes/sejfDokumentow.js` montowany
 * pod `/api/przetarg/sejf` — spójnie ze wzorcem Radaru podprogowego/SWZ (samodzielny
 * router na singletonie `db`, uwierzytelniony, skopowany do właściciela).
 *
 * Sedno tego podzadania testujemy end-to-endowo, przez PRAWDZIWĄ aplikację Express:
 *  1. LISTA — GET /dokumenty zwraca dokumenty właściciela WZBOGACONE o licznik dni
 *     (`dniDoWaznosci`), status ('gotowy'|'zamow_nowy'|'przeterminowany') oraz link
 *     „gdzie wyrobić online" z katalogu (`online`). Dokument bezterminowy = brak
 *     terminu (dniDoWaznosci = null w JSON), status „gotowy".
 *  2. UPLOAD — POST /dokumenty/:id/plik przyjmuje oryginał w base64, wykrywa format
 *     i podpis (podpisany XML → flaga true, bez ostrzeżenia; skan PDF → flaga false +
 *     ostrzeżenie; surowy obraz → 400), zapisuje bajty przez usługę z kroku 3.
 * Dodatkowo: dodawanie/edycja/usuwanie i izolacja właściciela (cudzy dokument = 404).
 */

// ── Fikstury plików (te same markery co test usługi z kroku 3) ───────────────

const XML_PODPISANY = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
   <Zaswiadczenie xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
     <Tresc>Nie figuruje w Kartotece Karnej.</Tresc>
     <ds:Signature><ds:SignedInfo/><ds:SignatureValue>QUJD</ds:SignatureValue></ds:Signature>
   </Zaswiadczenie>`,
  'utf8',
);

const PDF_SKAN = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
4 0 obj<</Type/XObject/Subtype/Image/Width 2480/Height 3508/Filter/DCTDecode
/BitsPerComponent 8/ColorSpace/DeviceRGB/Length 900000>>stream
......(zdjęcie kartki papieru).......
endstream endobj
%%EOF`,
  'latin1',
);

const JPEG_SUROWY = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

// ── Setup aplikacji (temp DB + temp katalog na oryginały) ────────────────────

const DB_FILE = path.join(os.tmpdir(), `przetargai-sejf-rt-${process.pid}.db`);
const STORAGE_DIR = path.join(os.tmpdir(), `przetargai-sejf-rt-store-${process.pid}`);
process.env.DATABASE_PATH = DB_FILE;
process.env.SEJF_STORAGE_DIR = STORAGE_DIR; // magazynNaDysku czyta to przy starcie routera
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

async function dodaj(token, body) {
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function lista(token) {
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty`, { headers: naglowki(token) });
  return { status: res.status, json: await res.json() };
}

async function wgraj(token, id, { nazwaPliku, bajty }) {
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${id}/plik`, {
    method: 'POST',
    headers: naglowki(token),
    body: JSON.stringify({ nazwa_pliku: nazwaPliku, plik_base64: bajty.toString('base64') }),
  });
  return { status: res.status, json: await res.json() };
}

// ── Auth / dodawanie ─────────────────────────────────────────────────────────

test('GET /dokumenty — bez tokenu => 401', async () => {
  const { status } = await lista(null);
  assert.equal(status, 401);
});

test('POST /dokumenty — dodaje dokument i zwraca 201 z licznikiem, statusem i linkiem online', async () => {
  const token = await zaloz(`dodaj-${process.pid}@t.pl`);
  const { status, json } = await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01', notatka: 'e-KRK' });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.dokument?.id, 'rekord dostaje id');
  assert.equal(json.dokument.typ_dokumentu, 'krk');
  assert.equal(json.dokument.okresWaznosciDni, 180, 'okres domyślny z katalogu');
  assert.equal(typeof json.dokument.status, 'string', 'wzbogacony o status świeżości');
  assert.equal(json.dokument.online.nazwa, 'e-KRK', 'link gdzie wyrobić online z katalogu');
  assert.equal(json.dokument.flaga_podpis_elektroniczny, false, 'bez pliku flaga podpisu false');
});

test('POST /dokumenty — nieznany typ dokumentu => 400', async () => {
  const token = await zaloz(`zlytyp-${process.pid}@t.pl`);
  const { status } = await dodaj(token, { typ: 'nieistniejacy', data_wystawienia: '2026-07-01' });
  assert.equal(status, 400);
});

test('POST /dokumenty — błędna data wystawienia => 400 (nie 500)', async () => {
  const token = await zaloz(`zladata-${process.pid}@t.pl`);
  assert.equal((await dodaj(token, { typ: 'krk', data_wystawienia: '2026-02-30' })).status, 400);
  assert.equal((await dodaj(token, { typ: 'krk', data_wystawienia: '01-07-2026' })).status, 400);
});

// ── Lista z licznikiem/statusem/linkiem + izolacja właściciela ───────────────

test('GET /dokumenty — zwraca listę właściciela wzbogaconą o licznik dni, status i link online', async () => {
  const token = await zaloz(`lista-${process.pid}@t.pl`);
  await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01' });
  await dodaj(token, { typ: 'wykaz_robot_uslugi' }); // bezterminowy

  const { status, json } = await lista(token);
  assert.equal(status, 200);
  assert.equal(json.dokumenty.length, 2, 'oba dokumenty użytkownika');

  const krk = json.dokumenty.find((d) => d.typ_dokumentu === 'krk');
  assert.equal(typeof krk.dniDoWaznosci, 'number', 'KRK ma licznik dni');
  assert.ok(['gotowy', 'zamow_nowy', 'przeterminowany'].includes(krk.status));
  assert.equal(krk.online.nazwa, 'e-KRK', 'link gdzie wyrobić online');

  const wykaz = json.dokumenty.find((d) => d.typ_dokumentu === 'wykaz_robot_uslugi');
  assert.equal(wykaz.dniDoWaznosci, null, 'bezterminowy: brak terminu (Infinity → null w JSON)');
  assert.equal(wykaz.status, 'gotowy', 'bezterminowy zawsze gotowy');
});

test('GET /dokumenty — nie pokazuje dokumentów innego użytkownika', async () => {
  const a = await zaloz(`ownerA-${process.pid}@t.pl`);
  const b = await zaloz(`ownerB-${process.pid}@t.pl`);
  await dodaj(a, { typ: 'krk', data_wystawienia: '2026-07-01' });
  await dodaj(b, { typ: 'zus', data_wystawienia: '2026-07-01' });

  const listaB = await lista(b);
  assert.ok(listaB.json.dokumenty.every((d) => d.typ_dokumentu !== 'krk'), 'B nie widzi dokumentu A');
  assert.ok(listaB.json.dokumenty.some((d) => d.typ_dokumentu === 'zus'), 'B widzi swój dokument');
});

// ── Upload oryginału ─────────────────────────────────────────────────────────

test('POST /dokumenty/:id/plik — podpisany XML: flaga true, bez ostrzeżenia, format xml', async () => {
  const token = await zaloz(`upload-xml-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01' });

  const wynik = await wgraj(token, json.dokument.id, { nazwaPliku: 'krk.xml', bajty: XML_PODPISANY });
  assert.equal(wynik.status, 200, JSON.stringify(wynik.json));
  assert.equal(wynik.json.dokument.plik_format, 'xml');
  assert.equal(wynik.json.dokument.flaga_podpis_elektroniczny, true);
  assert.equal(wynik.json.ostrzezenie, null, 'podpisany oryginał — bez ostrzeżenia');

  // Po uploadzie lista pokazuje dokument z zapaloną flagą podpisu.
  const po = await lista(token);
  const krk = po.json.dokumenty.find((d) => d.id === json.dokument.id);
  assert.equal(krk.flaga_podpis_elektroniczny, true);
});

test('POST /dokumenty/:id/plik — skan PDF: flaga false + ostrzeżenie o skanie', async () => {
  const token = await zaloz(`upload-skan-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'zus', data_wystawienia: '2026-07-01' });

  const wynik = await wgraj(token, json.dokument.id, { nazwaPliku: 'skan.pdf', bajty: PDF_SKAN });
  assert.equal(wynik.status, 200, JSON.stringify(wynik.json));
  assert.equal(wynik.json.dokument.plik_format, 'pdf');
  assert.equal(wynik.json.dokument.flaga_podpis_elektroniczny, false);
  assert.match(wynik.json.ostrzezenie, /skan|elektron/i);
});

test('POST /dokumenty/:id/plik — surowy obraz (JPEG) => 400', async () => {
  const token = await zaloz(`upload-jpg-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01' });
  const wynik = await wgraj(token, json.dokument.id, { nazwaPliku: 'foto.jpg', bajty: JPEG_SUROWY });
  assert.equal(wynik.status, 400, JSON.stringify(wynik.json));
});

test('POST /dokumenty/:id/plik — bez treści base64 => 400', async () => {
  const token = await zaloz(`upload-pusty-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01' });
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${json.dokument.id}/plik`, {
    method: 'POST', headers: naglowki(token), body: JSON.stringify({ nazwa_pliku: 'x.xml' }),
  });
  assert.equal(res.status, 400);
});

test('POST /dokumenty/:id/plik — cudzy/nieistniejący dokument => 404', async () => {
  const a = await zaloz(`upload-ownerA-${process.pid}@t.pl`);
  const b = await zaloz(`upload-ownerB-${process.pid}@t.pl`);
  const { json } = await dodaj(a, { typ: 'krk', data_wystawienia: '2026-07-01' });

  const cudzy = await wgraj(b, json.dokument.id, { nazwaPliku: 'krk.xml', bajty: XML_PODPISANY });
  assert.equal(cudzy.status, 404, 'B nie wgra pliku do dokumentu A');
  const widmo = await wgraj(a, 'nie-istnieje', { nazwaPliku: 'krk.xml', bajty: XML_PODPISANY });
  assert.equal(widmo.status, 404);
});

// ── Edycja / usunięcie ───────────────────────────────────────────────────────

test('PATCH /dokumenty/:id — edytuje notatkę i okres ważności', async () => {
  const token = await zaloz(`edytuj-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'polisa_oc', data_wystawienia: '2026-01-01' });
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${json.dokument.id}`, {
    method: 'PATCH', headers: naglowki(token),
    body: JSON.stringify({ notatka: 'polisa roczna', okres_waznosci_dni: 180 }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.dokument.notatka, 'polisa roczna');
  assert.equal(body.dokument.okres_waznosci_dni, 180);
});

test('PATCH /dokumenty/:id — cudzy dokument => 404', async () => {
  const a = await zaloz(`edytuj-ownerA-${process.pid}@t.pl`);
  const b = await zaloz(`edytuj-ownerB-${process.pid}@t.pl`);
  const { json } = await dodaj(a, { typ: 'krk', data_wystawienia: '2026-07-01' });
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${json.dokument.id}`, {
    method: 'PATCH', headers: naglowki(b), body: JSON.stringify({ notatka: 'hej' }),
  });
  assert.equal(res.status, 404);
});

test('DELETE /dokumenty/:id — usuwa dokument właściciela', async () => {
  const token = await zaloz(`usun-${process.pid}@t.pl`);
  const { json } = await dodaj(token, { typ: 'krk', data_wystawienia: '2026-07-01' });
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${json.dokument.id}`, {
    method: 'DELETE', headers: naglowki(token),
  });
  assert.equal(res.status, 200);

  const po = await lista(token);
  assert.ok(po.json.dokumenty.every((d) => d.id !== json.dokument.id), 'po usunięciu brak na liście');
});

test('DELETE /dokumenty/:id — cudzy dokument => 404', async () => {
  const a = await zaloz(`usun-ownerA-${process.pid}@t.pl`);
  const b = await zaloz(`usun-ownerB-${process.pid}@t.pl`);
  const { json } = await dodaj(a, { typ: 'krk', data_wystawienia: '2026-07-01' });
  const res = await fetch(`${base}/api/przetarg/sejf/dokumenty/${json.dokument.id}`, {
    method: 'DELETE', headers: naglowki(b),
  });
  assert.equal(res.status, 404);
});

// ── Katalog typów (źródło dla formularza dodawania na mobile) ────────────────

test('GET /katalog — zwraca typy dokumentów z linkami online', async () => {
  const token = await zaloz(`katalog-${process.pid}@t.pl`);
  const res = await fetch(`${base}/api/przetarg/sejf/katalog`, { headers: naglowki(token) });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.typy), 'lista typów');
  const krk = json.typy.find((t) => t.id === 'krk');
  assert.ok(krk, 'katalog zawiera KRK');
  assert.equal(krk.online.nazwa, 'e-KRK');
  assert.equal(krk.okresWaznosciDniDomyslny, 180);
});
