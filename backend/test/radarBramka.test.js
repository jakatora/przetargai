import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Bramka przedwysyłkowa + mapowanie zmian na sekcje oferty — trwałość i endpointy
 * (ulepszenie „Radar pytań i odpowiedzi do SWZ", podzadanie 6/7).
 *
 * Część A: warstwa repos — kolumna `uwzglednione` w `zmiany_swz` (domyślnie false),
 *          `oznaczUwzglednione`, `findByIdForPostepowanie` (skopowanie po postępowaniu).
 * Część B: endpointy radaru SWZ —
 *          • GET  /postepowania/:id/checklista        (stan checklisty + bramki),
 *          • POST /postepowania/:id/zmiany/:zmianaId/uwzglednij (odznacz pozycję),
 *          • POST /postepowania/:id/wyslij            (bramka: 409 blokada / 200 ok/ostrzeżenie).
 * Część C: silnik różnic MAPUJE zmianę na sekcje oferty (`elementy_oferty` zapisane
 *          przez `zarejestrujRoznice`) — sprawdzane end-to-end przez /odswiez.
 *
 * Płatnego AI nie wołamy realnie — wstrzykujemy atrapę klienta do roznicaSwz.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-radar-bramka-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, swzWersje, zmianySwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { ustawKlientaAnthropic } = await import('../src/services/roznicaSwz.js');

/** Atrapa klienta Anthropic: opis skutku zmiany jako JSON {"opis":...}. */
function fakeKlient(opis) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ opis }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };
}

let userId;
let token;
let server;
let base;

before(() => {
  migrate();
  userId = users.create({ companyNip: null, companyName: null, email: `bramka-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  token = signToken(userId);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Część A: repos — kolumna `uwzglednione` ──────────────────────────────────

test('zmianySwz — nowa zmiana jest domyślnie NIEuwzględniona (wymaga aktualizacji)', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'A' });
  const z = zmianySwz.create({ postepowanieId: p.id, opisSkutku: 'nowa cena', elementyOferty: ['cena'] });
  assert.equal(z.uwzglednione, false, 'świeża zmiana czeka na uwzględnienie');
});

test('zmianySwz — oznaczUwzglednione przełącza stan w obie strony', () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'B' });
  const z = zmianySwz.create({ postepowanieId: p.id, opisSkutku: 'nowy termin', elementyOferty: ['harmonogram'] });

  const po = zmianySwz.oznaczUwzglednione(z.id, true);
  assert.equal(po.uwzglednione, true);
  assert.equal(zmianySwz.findById(z.id).uwzglednione, true, 'utrwalone w bazie');

  const cofniete = zmianySwz.oznaczUwzglednione(z.id, false);
  assert.equal(cofniete.uwzglednione, false, 'da się cofnąć odznaczenie');
});

test('zmianySwz — findByIdForPostepowanie skopowane do postępowania', () => {
  const p1 = postepowaniaSwz.create({ userId, nazwa: 'C1' });
  const p2 = postepowaniaSwz.create({ userId, nazwa: 'C2' });
  const z = zmianySwz.create({ postepowanieId: p1.id, opisSkutku: 'x' });
  assert.equal(zmianySwz.findByIdForPostepowanie(z.id, p1.id)?.id, z.id);
  assert.equal(zmianySwz.findByIdForPostepowanie(z.id, p2.id), null, 'zmiana z innego postępowania niewidoczna');
  assert.equal(zmianySwz.findByIdForPostepowanie('widmo', p1.id), null);
});

// ── Część B/C: endpointy end-to-end ──────────────────────────────────────────

async function req(method, sciezka, { tok, body } = {}) {
  const res = await fetch(`${base}${sciezka}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('GET checklista — bez tokenu => 401', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'D' });
  const { status } = await req('GET', `/api/przetarg/swz/postepowania/${p.id}/checklista`, {});
  assert.equal(status, 401);
});

test('GET checklista — cudze/nieistniejące postępowanie => 404', async () => {
  const obcy = users.create({ companyNip: null, companyName: null, email: `bramka-obcy-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const cudze = postepowaniaSwz.create({ userId: obcy, nazwa: 'Cudze' }).id;
  const r1 = await req('GET', `/api/przetarg/swz/postepowania/${cudze}/checklista`, { tok: token });
  assert.equal(r1.status, 404);
  const r2 = await req('GET', '/api/przetarg/swz/postepowania/nie-ma/checklista', { tok: token });
  assert.equal(r2.status, 404);
});

test('GET checklista — brak zmian => bramka gotowa', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Pusta' });
  const { status, json } = await req('GET', `/api/przetarg/swz/postepowania/${p.id}/checklista`, { tok: token });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.checklista.gotowa_do_wyslania, true);
  assert.equal(json.checklista.do_odznaczenia, 0);
  assert.equal(json.bramka.dopuszczona, true);
});

test('end-to-end — /odswiez mapuje zmianę na sekcje, bramka blokuje, odznaczenie zwalnia', async () => {
  // Deterministyczny opis skutku (atrapa) => mapowanie na harmonogram + cena.
  ustawKlientaAnthropic(fakeKlient('termin realizacji 60→45 dni — przelicz harmonogram i cenę'));

  const p = postepowaniaSwz.create({ userId, nazwa: 'Budowa drogi' });

  // Wersja bazowa (pierwsza — bez zmiany), potem nowa wersja różniąca się terminem.
  const v1 = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/odswiez`, {
    tok: token, body: { tresc: 'Termin realizacji: 60 dni\nParagraf 1' },
  });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  assert.equal(v1.json.zmiany, 0, 'pierwsza wersja to baza — brak wpisu zmiany');

  const v2 = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/odswiez`, {
    tok: token, body: { tresc: 'Termin realizacji: 45 dni\nParagraf 1' },
  });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  assert.equal(v2.json.zmiany, 1, 'zmiana treści => wpis zmiany');
  const zmianaId = v2.json.zmiany_wpisy[0].id;
  assert.deepEqual(v2.json.zmiany_wpisy[0].elementy_oferty, ['harmonogram', 'cena'],
    'silnik różnic zmapował zmianę na sekcje oferty i zapisał je');

  // Checklista: zmiana czeka, sekcje świecą, bramka blokuje.
  const ch1 = await req('GET', `/api/przetarg/swz/postepowania/${p.id}/checklista`, { tok: token });
  assert.equal(ch1.json.checklista.do_odznaczenia, 1);
  assert.equal(ch1.json.checklista.gotowa_do_wyslania, false);
  const flaga = Object.fromEntries(ch1.json.checklista.sekcje.map((s) => [s.sekcja, s.wymaga_aktualizacji]));
  assert.equal(flaga.harmonogram, true);
  assert.equal(flaga.cena, true);
  assert.equal(flaga.parametry, false);

  // Bramka bez wymuszenia => 409 blokada.
  const blok = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/wyslij`, { tok: token });
  assert.equal(blok.status, 409, JSON.stringify(blok.json));
  assert.equal(blok.json.error.code, 'CONFLICT');
  assert.equal(blok.json.error.details.bramka.poziom, 'blokada');

  // Bramka z wymuszeniem => 200 ostrzeżenie (dopuszczona mimo nieodznaczonej pozycji).
  const wymus = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/wyslij`, { tok: token, body: { wymus: true } });
  assert.equal(wymus.status, 200, JSON.stringify(wymus.json));
  assert.equal(wymus.json.bramka.poziom, 'ostrzezenie');
  assert.equal(wymus.json.bramka.dopuszczona, true);

  // Odznaczenie pozycji.
  const odzn = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/zmiany/${zmianaId}/uwzglednij`, { tok: token });
  assert.equal(odzn.status, 200, JSON.stringify(odzn.json));
  assert.equal(odzn.json.checklista.do_odznaczenia, 0);
  assert.equal(odzn.json.checklista.gotowa_do_wyslania, true);

  // Teraz bramka przepuszcza bez wymuszenia.
  const ok = await req('POST', `/api/przetarg/swz/postepowania/${p.id}/wyslij`, { tok: token });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.bramka.poziom, 'ok');
  assert.equal(ok.json.bramka.dopuszczona, true);
});

test('POST uwzglednij — zmiana z innego postępowania => 404', async () => {
  const p1 = postepowaniaSwz.create({ userId, nazwa: 'E1' });
  const p2 = postepowaniaSwz.create({ userId, nazwa: 'E2' });
  const z = zmianySwz.create({ postepowanieId: p2.id, opisSkutku: 'x' });
  const r = await req('POST', `/api/przetarg/swz/postepowania/${p1.id}/zmiany/${z.id}/uwzglednij`, { tok: token });
  assert.equal(r.status, 404, JSON.stringify(r.json));
});
