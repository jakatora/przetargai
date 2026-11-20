import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { budujPdfStrony } from './helpers/buildPdf.js';

const file = path.join(os.tmpdir(), `swz-history-${process.pid}.db`);
process.env.DATABASE_PATH = file;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { users, postepowaniaSwz, swzWersje, zmianySwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { createApp } = await import('../src/app.js');
const { ustawKlientaAnthropic } = await import('../src/services/roznicaSwz.js');
const { mapaStron, znajdzCytat, bezpiecznyUrl } = await import('../src/lib/zrodlaSwz.js');
const { porownajSwz } = await import('../src/services/roznicaSwz.js');
const { zbudujEksportSwz } = await import('../src/services/eksportSwz.js');
let server, base, owner, stranger, post, token;
let aiCalls = 0;
before(() => {
  migrate();
  owner = users.create({ companyNip: null, companyName: null, email: `history-${process.pid}@test.invalid`, passwordHash: 'x' });
  stranger = users.create({ companyNip: null, companyName: null, email: `other-${process.pid}@test.invalid`, passwordHash: 'x' });
  post = postepowaniaSwz.create({ userId: owner.id, nazwa: 'Historia SWZ — wydarzenie' });
  token = signToken(owner.id);
  ustawKlientaAnthropic({ messages: { create: async () => { aiCalls++; throw new Error('Paid call must not occur'); } } });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/przetarg/swz/postepowania/${post.id}`;
});
after(() => {
  ustawKlientaAnthropic(null);
  server.closeAllConnections(); server.close(); db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
});
async function request(suffix, body, auth = token) {
  const response = await fetch(base + suffix, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const initial = budujPdfStrony(['Dokumentacja wydarzenia.', 'Termin realizacji: 60 dni. Wymagane zaswiadczenie z ZUS.']);
const next = budujPdfStrony(['Dokumentacja wydarzenia.', 'Termin realizacji: 45 dni. Wymagane zaswiadczenie z ZUS.']);

test('pierwsza aktualizacja PDF porównuje z analizą, zachowuje strony i linki, bez AI', async () => {
  assert.equal((await request('/tresc', { swz_pdf_base64: initial, zrodlo_url: 'https://example.org/swz-1.pdf' })).status, 200);
  const result = await request('/odswiez', { swz_pdf_base64: next, zrodlo_url: 'https://example.org/swz-2.pdf', opis_ai: false });
  assert.equal(result.status, 200);
  assert.equal(result.data.zmiany, 1);
  const comparison = result.data.zmiany_wpisy[0].porownanie;
  assert.equal(comparison.poprzednia.rodzaj, 'pierwsza_analiza');
  assert.equal(comparison.poprzednia.id, null);
  assert.equal(comparison.nowa.numer, 1);
  assert.ok(comparison.cytaty.length >= 2);
  assert.ok(comparison.cytaty.every((q) => q.strona === 2 && q.potwierdzony));
  assert.equal(comparison.cytaty.find((q) => q.zmiana === 'usuniete').zrodlo.url, 'https://example.org/swz-1.pdf');
  assert.equal(comparison.cytaty.find((q) => q.zmiana === 'dodane').zrodlo.url, 'https://example.org/swz-2.pdf');
  assert.equal(aiCalls, 0);
});

test('powtórka PDF nie dubluje wersji, zmian ani wywołań AI', async () => {
  const repeated = await request('/odswiez', { swz_pdf_base64: next, opis_ai: false });
  assert.equal(repeated.data.nowe_wersje, 0);
  assert.equal(swzWersje.count(post.id), 1);
  assert.equal(zmianySwz.listForPostepowanie(post.id).length, 1);
  assert.equal(aiCalls, 0);
});

test('panel i eksport TXT/JSON zawierają obydwa źródła oraz pełną różnicę, bez nowego AI', async () => {
  const detail = await request('');
  assert.equal(detail.data.wersje.length, 2);
  assert.equal(detail.data.wersje[0].rodzaj, 'pierwsza_analiza');
  assert.equal(detail.data.wersje[1].liczba_stron, 2);
  const text = await request('/eksport');
  assert.match(text.data.nazwa, /^PrzetargAI-SWZ-.*\.txt$/);
  assert.match(text.data.tresc, /60 dni/); assert.match(text.data.tresc, /45 dni/);
  assert.match(text.data.tresc, /strona 2/); assert.match(text.data.tresc, /example.org\/swz-2.pdf/);
  const json = await request('/eksport?format=json');
  const data = JSON.parse(json.data.tresc);
  assert.equal(data.wersje.length, 2);
  assert.equal(data.zmiany[0].porownanie.cytaty[0].strona, 2);
  assert.equal(data.wymagania.find((r) => r.typ === 'zus').cytat.strona, 2);
  assert.equal(aiCalls, 0);
});

test('dowody wymagań w prawdziwym dopasowaniu wskazują stronę bieżącej wersji PDF', async () => {
  const response = await fetch(`${base.split('/swz/')[0]}/sejf/dopasowanie/${post.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
  const data = await response.json();
  assert.equal(response.status, 200);
  const proof = data.dowody_wymagan.find((r) => r.typ === 'zus').cytat;
  assert.equal(proof.strona, 2); assert.equal(proof.zrodlo.numer, 1); assert.ok(proof.potwierdzony);
});

test('eksport respektuje właściciela i odrzuca nieobsługiwany format', async () => {
  assert.equal((await request('/eksport', null, null)).status, 401);
  assert.equal((await request('/eksport', null, signToken(stranger.id))).status, 404);
  assert.equal((await request('/eksport?format=html')).status, 400);
});

test('niebezpieczny link źródła nie zapisuje nowej wersji', async () => {
  assert.equal((await request('/odswiez', { tresc: 'Inny dokument', zrodlo_url: 'javascript:alert(1)', opis_ai: false })).status, 400);
  assert.equal(swzWersje.count(post.id), 1);
  assert.equal(bezpiecznyUrl('https://secret@host.invalid/doc'), null);
});

test('cytat z powtarzanej linii ma dokładną stronę zmienionego wystąpienia, także CRLF', () => {
  const a = 'Powtorzenie\r\nTekst A\r\nPowtorzenie\r\nTekst B';
  const b = a.replace('Tekst B', 'Tekst C');
  const result = porownajSwz({ tresc: a, strony: [0, a.indexOf('Powtorzenie', 2)] }, { tresc: b, strony: [0, b.indexOf('Powtorzenie', 2)] });
  assert.ok(result.porownanie.cytaty.every((q) => q.strona === 2 && q.linia === null));
  assert.deepEqual(result.porownanie.cytaty.map((q) => q.tekst), ['Tekst B', 'Tekst C']);
});

test('brak mapy stron nie tworzy numerów; obcy cytat pozostaje niepotwierdzony', () => {
  assert.equal(mapaStron('[8,2]', 'Długi tekst'), null);
  const proof = znajdzCytat('Warunek nieistniejacy', { tresc: 'Dokument wymaga referencji.' });
  assert.equal(proof.potwierdzony, false); assert.equal(proof.strona, null);
  const actual = znajdzCytat('WYMAGA   REFERENCJI', { tresc: 'Dokument wymaga\nreferencji.' });
  assert.equal(actual.potwierdzony, true); assert.equal(actual.strona, null);
});

test('duży eksport kończy się jawnym błędem, zamiast cicho ucinać historię', () => {
  assert.throws(() => zbudujEksportSwz({ postepowanie: post, wersje: [], pytania: [], zmiany: [], wymagania: [] }, { maksBajtow: 10 }), /20 MB/);
});
