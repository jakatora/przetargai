import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Pytanie do SWZ z cytatem (2026-10-31): `POST /postepowania/:id/zapytaj`. Model odpowiada z treści
 * SWZ postępowania, a każdy jego cytat sprawdzamy w tekście — wymyślony cytat nie przejdzie jako
 * „potwierdzone”. Bez treści SWZ trasa nie woła płatnego AI.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-pytanie-swz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { ustawKlientaAnthropic } = await import('../src/services/analizaSwz.js');
const { zapamietajWklejonaSwz } = await import('../src/services/trescSwz.js');
const { fragmentyDlaPytania, zweryfikujCytaty, parsujOdpowiedz, MAKS_ZNAKOW_KONTEKSTU } = await import('../src/services/pytanieDoSwz.js');

const SWZ = [
  'Rozdział VII. Warunki udziału w postępowaniu.',
  'Wykonawca wykaże, że w okresie ostatnich 5 lat wykonał co najmniej 2 roboty budowlane polegające na budowie drogi o wartości nie mniejszej niż 500 000,00 zł brutto każda.',
  'Rozdział IX. Wadium.',
  'Zamawiający wymaga wniesienia wadium w wysokości 15 000,00 zł.',
].join('\n');

let odpowiedzAi;
const wywolania = [];
const ai = {
  messages: {
    create: async (zadanie) => {
      wywolania.push(zadanie);
      return { content: [{ type: 'text', text: JSON.stringify(odpowiedzAi) }], usage: { input_tokens: 900, output_tokens: 120 } };
    },
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
beforeEach(() => { wywolania.length = 0; });

function nowy(nazwa, { swz = SWZ } = {}) {
  const u = users.create({ companyNip: null, companyName: null, email: `pyt-${nazwa}-${process.pid}@t.pl`, passwordHash: 'h' });
  const post = postepowaniaSwz.create({ userId: u.id, nazwa: `Postępowanie ${nazwa}`, terminSkladaniaOfert: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  if (swz) zapamietajWklejonaSwz({ postepowanieId: post.id, swz });
  return { token: signToken(u.id), postId: post.id };
}

async function zapytaj(u, cialo, postId = u.postId) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania/${postId}/zapytaj`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('cytat obecny w SWZ (inne cudzysłowy i odstępy) → „potwierdzone”, koszt zaksięgowany', async () => {
  const u = nowy('ok');
  odpowiedzAi = { odpowiedz: 'Tak, wadium wynosi 15 000,00 zł.', cytaty: ['Zamawiający  wymaga wniesienia wadium\nw wysokości 15 000,00 zł'], brak_w_swz: false };
  const { status, json } = await zapytaj(u, { pytanie: 'Czy jest wadium i ile?' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.status, 'potwierdzone');
  assert.equal(json.zrodlo_tresci, 'wklejona');
  assert.deepEqual(json.cytaty.map((c) => c.potwierdzony), [true]);
  assert.match(wywolania[0].messages[0].content, /Czy jest wadium i ile\?/);
  const koszt = db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE operation = 'swz_pytanie'").get();
  assert.ok(koszt.n >= 1, 'wywołanie AI zaksięgowane w ai_usage');
});

test('cytat wymyślony przez model → „nieudowodnione”, nie „potwierdzone”', async () => {
  const u = nowy('zmyslony');
  odpowiedzAi = { odpowiedz: 'Wymagany jest certyfikat ISO 9001.', cytaty: ['Wykonawca przedstawi certyfikat ISO 9001'], brak_w_swz: false };
  const { status, json } = await zapytaj(u, { pytanie: 'Czy wymagają ISO 9001?' });
  assert.equal(status, 200);
  assert.equal(json.status, 'nieudowodnione');
  assert.deepEqual(json.cytaty.map((c) => c.potwierdzony), [false]);
});

test('model mówi, że SWZ tego nie rozstrzyga → „brak_w_swz”', async () => {
  const u = nowy('brak');
  odpowiedzAi = { odpowiedz: 'SWZ nie określa wymogu ubezpieczenia OC.', cytaty: [], brak_w_swz: true };
  const { json } = await zapytaj(u, { pytanie: 'Jaka polisa OC?' });
  assert.equal(json.status, 'brak_w_swz');
});

test('bez treści SWZ → 409 i ŻADNEGO wywołania AI; cudze postępowanie → 404; za krótkie pytanie → 400', async () => {
  const bez = nowy('pusty', { swz: null });
  const r409 = await zapytaj(bez, { pytanie: 'Czy jest wadium?' });
  assert.equal(r409.status, 409);
  const obcy = nowy('obcy');
  const r404 = await zapytaj(obcy, { pytanie: 'Czy jest wadium?' }, bez.postId);
  assert.equal(r404.status, 404);
  const r400 = await zapytaj(obcy, { pytanie: 'a' });
  assert.equal(r400.status, 400);
  assert.equal(wywolania.length, 0, 'płatne AI nie zostało wywołane');
});

test('długa SWZ: do modelu idą fragmenty z odpowiedzią, w limicie znaków', () => {
  const wypelniacz = 'Postanowienia ogólne dotyczące realizacji przedmiotu zamówienia i komunikacji. '.repeat(600);
  const tresc = `${wypelniacz}\nZamawiający wymaga wniesienia wadium w wysokości 15 000,00 zł.\n${wypelniacz}`;
  const f = fragmentyDlaPytania(tresc, 'Ile wynosi wadium?');
  assert.ok(tresc.length > MAKS_ZNAKOW_KONTEKSTU);
  assert.ok(f.length <= MAKS_ZNAKOW_KONTEKSTU + 200, `fragmenty mają ${f.length} znaków`);
  assert.match(f, /wadium w wysokości 15 000,00 zł/);
  assert.equal(fragmentyDlaPytania(SWZ, 'cokolwiek'), SWZ, 'krótka SWZ idzie w całości');
});

test('weryfikacja cytatów i odczyt odpowiedzi', () => {
  assert.deepEqual(zweryfikujCytaty(['„wniesienia wadium” w wysokości', 'krótki', 42, 'wadium w wysokości 20 000,00 zł'], 'Zamawiający wymaga wniesienia wadium w wysokości 15 000,00 zł.').map((c) => c.potwierdzony), [true, false]);
  assert.equal(parsujOdpowiedz('nie JSON'), null);
  assert.equal(parsujOdpowiedz('{"odpowiedz": ""}'), null);
  assert.deepEqual(parsujOdpowiedz('Oto: {"odpowiedz": "Tak.", "cytaty": ["x"], "brak_w_swz": false}'), { odpowiedz: 'Tak.', cytaty: ['x'], brak_w_swz: false });
});

test('POST /tresc-pdf: tekst SWZ z PDF zapisany BEZ wywołania AI, potem można pytać', async () => {
  const { budujPdf } = await import('./helpers/buildPdf.js');
  const u = nowy('pdf', { swz: null });
  const zapis = await fetch(`${base}/api/przetarg/swz/postepowania/${u.postId}/tresc-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ swz_pdf_base64: budujPdf('Zamawiajacy wymaga wniesienia wadium w wysokosci 7 000,00 zl.') }),
  });
  assert.equal(zapis.status, 200);
  const z = await zapis.json();
  assert.equal(z.tresc_swz.zrodlo, 'wklejona');
  assert.equal(wywolania.length, 0, 'zapis treści nie woła AI');
  odpowiedzAi = { odpowiedz: 'Wadium 7 000,00 zł.', cytaty: ['wniesienia wadium w wysokosci 7 000,00 zl'], brak_w_swz: false };
  const { json } = await zapytaj(u, { pytanie: 'Ile wadium?' });
  assert.equal(json.status, 'potwierdzone');
  const obcy = nowy('pdf-obcy');
  const cudze = await fetch(`${base}/api/przetarg/swz/postepowania/${u.postId}/tresc-pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${obcy.token}` }, body: JSON.stringify({ swz_pdf_base64: 'JVBERi0xLjQ=' }),
  });
  assert.equal(cudze.status, 404);
});

test('numer strony PDF przy potwierdzonym cytacie (tresc-pdf → zapytaj); wklejony tekst bez numeru', async () => {
  const { budujPdfStrony } = await import('./helpers/buildPdf.js');
  const u = nowy('strony', { swz: null });
  const zapis = await fetch(`${base}/api/przetarg/swz/postepowania/${u.postId}/tresc-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ swz_pdf_base64: budujPdfStrony([
      'Rozdzial I. Informacje ogolne o zamawiajacym.',
      'Rozdzial IX. Wadium wynosi 9 000,00 zl.',
      'Rozdzial XII. Realizacja trwa 6 miesiecy.',
    ]) }),
  });
  assert.equal(zapis.status, 200);
  odpowiedzAi = { odpowiedz: 'Wadium 9 000 zł, realizacja 6 miesięcy.', cytaty: ['Wadium wynosi 9 000,00 zl', 'Realizacja trwa 6 miesiecy', 'zmyślony cytat spoza dokumentu'], brak_w_swz: false };
  const { json } = await zapytaj(u, { pytanie: 'Ile wadium i jaki termin?' });
  assert.equal(json.status, 'potwierdzone');
  assert.deepEqual(json.cytaty.map((c) => [c.potwierdzony, c.strona ?? null]), [[true, 2], [true, 3], [false, null]]);

  const wklejona = nowy('strony-tekst');
  odpowiedzAi = { odpowiedz: 'Wadium 15 000 zł.', cytaty: ['wniesienia wadium w wysokości 15 000,00 zł'], brak_w_swz: false };
  const bez = await zapytaj(wklejona, { pytanie: 'Ile wadium?' });
  assert.equal(bez.json.cytaty[0].potwierdzony, true);
  assert.equal('strona' in bez.json.cytaty[0], false, 'wklejony tekst nie ma stron');
});

test('strona cytatu: przejście przez granicę stron → strona początku; zapis z niespójnymi stronami pominięty', async () => {
  const { tekstZeStronami } = await import('../src/lib/umowaEkstrakcja.js');
  const { poczatkiStron } = await import('../src/services/trescSwz.js');
  const { tekst, poczatki } = tekstZeStronami(['Strona  pierwsza\nkonczy sie zdaniem o', '', 'wadium 5 000 zl. Dalej druga.']);
  assert.equal(tekst, 'Strona pierwsza konczy sie zdaniem o wadium 5 000 zl. Dalej druga.');
  assert.deepEqual(poczatki, [0, 36, 37]);
  const c = zweryfikujCytaty(['zdaniem o wadium 5 000 zl', 'Dalej druga'], tekst, poczatki);
  assert.deepEqual(c.map((x) => x.strona), [1, 3]);
  assert.equal(poczatkiStron('[0, 50, 20]', tekst), null, 'malejące offsety odrzucone');
  assert.equal(poczatkiStron('[0, 999]', tekst), null, 'offset poza treścią odrzucony');
  assert.equal(poczatkiStron('nie JSON', tekst), null);
  assert.deepEqual(poczatkiStron('[0, 36, 37]', tekst), [0, 36, 37]);
});
