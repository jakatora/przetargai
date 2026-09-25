import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { budujPdf } from './helpers/buildPdf.js';

/*
 * /api/przetarg/umowa/analiza — uwierzytelnienie i limity PDF (P2, 2026-09-25).
 *
 * Trasa była publiczna i parsowała PDF (pdfjs) w wątku głównym bez limitu stron: każdy
 * anonim mógł wrzucać wielomegabajtowe, tysiącstronicowe pliki i blokować proces, na
 * którym wiszą wszystkie aplikacje. Most z Firebase i tak dokłada token do każdego
 * żądania /api/przetarg/*, więc wymaganie logowania nie psuje aplikacji.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-umowa-limity-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { ekstrahujZPdf, MAKS_STRON_PDF } = await import('../src/lib/umowaEkstrakcja.js');

/** Minimalny poprawny PDF z `strony` stronami (wspólny strumień treści). */
function pdfStron(tekst, strony) {
  const kidsy = Array.from({ length: strony }, (_, i) => `${4 + i} 0 R`).join(' ');
  const content = `BT /F1 18 Tf 72 700 Td (${tekst}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kidsy}] /Count ${strony} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  for (let i = 0; i < strony; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R /Resources << /Font << /F1 ${4 + strony} 0 R >> >> >>`);
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

let server;
let base;
let token;

before(() => {
  migrate();
  token = signToken(users.create({ companyNip: null, companyName: null, email: `umowa-lim-${process.pid}@t.pl`, passwordHash: 'h' }).id);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function analiza(body, { zTokenem = true } = {}) {
  const res = await fetch(`${base}/api/przetarg/umowa/analiza`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(zTokenem ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST /analiza — bez tokenu => 401 (trasa nie jest już publiczna)', async () => {
  const { status, json } = await analiza({ tekst: 'Umowa' }, { zTokenem: false });
  assert.equal(status, 401, JSON.stringify(json));
});

test('POST /analiza — z tokenem działa jak dotąd (PDF z tekstem)', async () => {
  const { status, json } = await analiza({ pdf_base64: budujPdf('Wynagrodzenie podlega waloryzacji') });
  assert.equal(status, 200, JSON.stringify(json));
  assert.match(json.tekst, /waloryzacji/);
});

test('POST /analiza — PDF ponad 5 MB => 413 ZA_DUZY_PLIK (bez parsowania)', async () => {
  const b64 = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41).toString('base64');
  const { status, json } = await analiza({ pdf_base64: b64 });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DUZY_PLIK');
  assert.match(json.error.message, /5 MB/);
});

test(`POST /analiza — PDF ponad limit stron => 413 ZA_DUZO_STRON`, async () => {
  const { status, json } = await analiza({ pdf_base64: pdfStron('Strona', MAKS_STRON_PDF + 1) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DUZO_STRON');
  assert.match(json.error.message, new RegExp(String(MAKS_STRON_PDF)));
});

test('ekstrahujZPdf — limit stron: dokładnie limit przechodzi, limit+1 rzuca 413', async () => {
  assert.equal(MAKS_STRON_PDF, 200);
  const ok = await ekstrahujZPdf(pdfStron('Tresc', MAKS_STRON_PDF));
  assert.match(ok, /Tresc/);
  await assert.rejects(
    () => ekstrahujZPdf(pdfStron('Tresc', MAKS_STRON_PDF + 1)),
    (err) => err.status === 413 && err.code === 'ZA_DUZO_STRON',
  );
});

test('POST /analiza — tekst ponad limit treści => 413 ZA_DLUGA_TRESC', async () => {
  const { status, json } = await analiza({ tekst: 'x\n'.repeat(50_001) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DLUGA_TRESC');
});
