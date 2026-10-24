import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { budujPdf } from './helpers/buildPdf.js';

/*
 * SWZ jako PLIK PDF w `POST /postepowania/:id/analiza` (2026-10-24). Użytkownik
 * wybiera plik z telefonu zamiast kopiować tekst z PDF-a; backend wyciąga warstwę
 * tekstową tą samą biblioteką co dla umowy, zapamiętuje ją jak wklejoną SWZ
 * (checklista dokumentów działa bez AI) i dopiero potem woła model.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-radar-pdf-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, swzTrescWklejona } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { ustawKlientaAnthropic } = await import('../src/services/analizaSwz.js');

const ai = {
  messages: {
    create: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ pytania: [{ tresc: 'Czy dopuszczacie równoważne materiały?', fragment: 'pkt 3' }] }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  },
};

let server;
let base;
before(() => {
  migrate();
  ustawKlientaAnthropic(ai);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  ustawKlientaAnthropic(null);
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

function nowy(nazwa) {
  const u = users.create({ companyNip: null, companyName: null, email: `pdf-${nazwa}-${process.pid}@t.pl`, passwordHash: 'h' });
  const post = postepowaniaSwz.create({ userId: u.id, nazwa: `Postępowanie ${nazwa}`, terminSkladaniaOfert: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  return { token: signToken(u.id), postId: post.id };
}

async function analiza(u, cialo) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania/${u.postId}/analiza`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('SWZ z pliku PDF: tekst wyciągnięty, zapamiętany jak wklejona SWZ, pytania wygenerowane', async () => {
  const u = nowy('ok');
  const { status, json } = await analiza(u, { swz_pdf_base64: budujPdf('Wykonawca zlozy zaswiadczenie z ZUS o niezaleganiu.') });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.pytania.length, 1);
  const zapis = swzTrescWklejona.findByPostepowanie ? swzTrescWklejona.findByPostepowanie(u.postId) : db.prepare('SELECT tresc FROM swz_tresc_wklejona WHERE postepowanie_id = ?').get(u.postId);
  assert.ok(zapis && /zaswiadczenie z ZUS/i.test(zapis.tresc), 'treść z PDF trafia do swz_tresc_wklejona');
});

test('wklejony tekst ma pierwszeństwo przed plikiem', async () => {
  const u = nowy('tekst');
  const { status } = await analiza(u, { swz: 'Wykonawca zlozy polise OC.', swz_pdf_base64: budujPdf('Inna tresc z pliku') });
  assert.equal(status, 201);
  const zapis = db.prepare('SELECT tresc FROM swz_tresc_wklejona WHERE postepowanie_id = ?').get(u.postId);
  assert.match(zapis.tresc, /polise OC/);
  assert.doesNotMatch(zapis.tresc, /Inna tresc/);
});

test('PDF bez warstwy tekstowej (skan / śmieci) → 400 z komunikatem po polsku, nic nie zapisane', async () => {
  const u = nowy('skan');
  const { status, json } = await analiza(u, { swz_pdf_base64: Buffer.from('%PDF-1.4 to nie jest prawdziwy pdf').toString('base64') });
  assert.equal(status, 400);
  assert.match(json.error.message, /skan|tekstu/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM swz_tresc_wklejona WHERE postepowanie_id = ?').get(u.postId).n, 0);
});

test('brak jakiejkolwiek treści → 400 jak dotąd', async () => {
  const u = nowy('pusto');
  const { status } = await analiza(u, {});
  assert.equal(status, 400);
});
