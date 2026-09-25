import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Płatne AI modułów przetargowych: twardy sufit wejścia i dobowy limit na użytkownika
 * (P1, 2026-09-25).
 *
 * Analiza SWZ wysyłała do modelu CAŁĄ dokumentację (do ~200 tys. tokenów na wywołanie),
 * a jedyną granicą była miesięczna bramka budżetu wspólna dla WSZYSTKICH aplikacji —
 * jeden użytkownik (albo skrypt z jego tokenem) mógł ją wyczerpać i zgasić AI reszcie.
 *
 * Sprawdzamy:
 *  - prompt analizy SWZ jest przycięty do limitu znaków, z adnotacją dla modelu,
 *  - po wyczerpaniu dobowego limitu kolejne wywołanie dostaje 429 z komunikatem PL
 *    i NIE woła klienta Anthropic (atrapa liczy wywołania),
 *  - limit jest per użytkownik i łączny dla operacji przetargowych (analiza + opis
 *    różnic + streszczenie regulaminu dzielą jedną pulę),
 *  - wywołania spoza żądania użytkownika (cron) nie są limitowane per użytkownik.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-limit-ai-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // brak realnego klienta — wstrzykujemy atrapy
process.env.RESEND_API_KEY = '';
process.env.PRZETARG_AI_DAILY_LIMIT_PER_USER = '2';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const analiza = await import('../src/services/analizaSwz.js');
const roznica = await import('../src/services/roznicaSwz.js');
const regulamin = await import('../src/services/regulaminZakupowy.js');
const { uruchomJakoUzytkownik } = await import('../src/lib/kontekstZadania.js');

/** Atrapa klienta Anthropic: oddaje zadany JSON i liczy wywołania. */
function atrapa(odpowiedz) {
  const wywolania = [];
  return {
    wywolania,
    messages: {
      create: async (arg) => {
        wywolania.push(arg);
        return { content: [{ type: 'text', text: JSON.stringify(odpowiedz) }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    },
  };
}

const klientAnalizy = atrapa({ pytania: [{ tresc: 'Czy termin jest wiążący?', fragment: 'Rozdz. V', kategoria: 'niejasnosc' }] });
const klientRoznicy = atrapa({ opis: 'termin 60→45 dni — przelicz harmonogram' });
const klientRegulaminu = atrapa({ streszczenie: 'Oferta mailem w 7 dni, bez wadium.' });

let server;
let base;

function nowyUzytkownik(nazwa) {
  const u = users.create({ companyNip: null, companyName: null, email: `${nazwa}-${process.pid}@t.pl`, passwordHash: 'h' });
  return { id: u.id, token: signToken(u.id), postId: postepowaniaSwz.create({ userId: u.id, nazwa: `SWZ ${nazwa}` }).id };
}

before(() => {
  migrate();
  analiza.ustawKlientaAnthropic(klientAnalizy);
  roznica.ustawKlientaAnthropic(klientRoznicy);
  regulamin.ustawKlientaAnthropic(klientRegulaminu);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  analiza.ustawKlientaAnthropic(null);
  roznica.ustawKlientaAnthropic(null);
  regulamin.ustawKlientaAnthropic(null);
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

async function post(u, sciezka, cialo) {
  const res = await fetch(`${base}${sciezka}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json() };
}

// ── Twardy sufit wejścia do AI ───────────────────────────────────────────────

test('budujPromptSwz — dokumentacja ponad limit przycięta, z adnotacją dla modelu', () => {
  const swz = 'S'.repeat(300_000);
  const umowa = 'U'.repeat(10_000);
  const przedmiar = 'P'.repeat(5_000);
  const p = analiza.budujPromptSwz({ swz, umowa, przedmiar });

  assert.ok(p.length <= analiza.MAKS_ZNAKOW_DO_AI + 2_000, `prompt ma ${p.length} znaków`);
  assert.ok(p.includes('U'.repeat(10_000)), 'krótka umowa przekazana w całości');
  assert.ok(p.includes('P'.repeat(5_000)), 'krótki przedmiar przekazany w całości');
  assert.match(p, /przycięt/i, 'model wie, że dostał fragment');
  assert.match(p, /<swz>[\s\S]*<\/swz>[\s\S]*<umowa>[\s\S]*<\/umowa>[\s\S]*<przedmiar>[\s\S]*<\/przedmiar>/);
});

test('budujPromptSwz — dokumentacja w limicie bez zmian (bez adnotacji)', () => {
  const p = analiza.budujPromptSwz({ swz: 'Termin: 60 dni', umowa: '', przedmiar: '' });
  assert.match(p, /<swz>\nTermin: 60 dni\n<\/swz>/);
  assert.doesNotMatch(p, /przycięt/i);
});

test('analizujSwz — do modelu idzie przycięty prompt (atrapa widzi <= limitu)', async () => {
  const przed = klientAnalizy.wywolania.length;
  await analiza.analizujSwz({ swz: 'X'.repeat(500_000) });
  const arg = klientAnalizy.wywolania[przed];
  assert.ok(arg.messages[0].content.length <= analiza.MAKS_ZNAKOW_DO_AI + 2_000);
});

// ── Dobowy limit na użytkownika ──────────────────────────────────────────────

test('analiza SWZ ponad dobowy limit => 429 z komunikatem PL i BEZ wywołania Anthropic', async () => {
  const u = nowyUzytkownik('limit-a');
  const przed = klientAnalizy.wywolania.length;

  for (let i = 0; i < 2; i++) {
    const { status, json } = await post(u, `/api/przetarg/swz/postepowania/${u.postId}/analiza`, { swz: `SWZ ${i}` });
    assert.equal(status, 201, JSON.stringify(json));
  }
  const { status, json } = await post(u, `/api/przetarg/swz/postepowania/${u.postId}/analiza`, { swz: 'SWZ 3' });

  assert.equal(status, 429, JSON.stringify(json));
  assert.equal(json.error.code, 'LIMIT_AI_DZIENNY');
  assert.match(json.error.message, /limit/i);
  assert.match(json.error.message, /2/, 'komunikat podaje wysokość limitu');
  assert.equal(klientAnalizy.wywolania.length - przed, 2, 'trzecie żądanie NIE dotarło do Anthropic');
});

test('limit jest per użytkownik — inny użytkownik ma własną pulę', async () => {
  const u = nowyUzytkownik('limit-b');
  const { status } = await post(u, `/api/przetarg/swz/postepowania/${u.postId}/analiza`, { swz: 'SWZ b' });
  assert.equal(status, 201);
});

test('pula jest łączna: opis różnic SWZ zjada ten sam limit co analiza', async () => {
  const u = nowyUzytkownik('limit-c');
  const przedRoznica = klientRoznicy.wywolania.length;

  // Pierwsza wersja to baza (bez AI); druga tworzy zmianę => 1 wywołanie opisu skutku.
  assert.equal((await post(u, `/api/przetarg/swz/postepowania/${u.postId}/odswiez`, { tresc: 'Termin: 60 dni' })).status, 200);
  assert.equal((await post(u, `/api/przetarg/swz/postepowania/${u.postId}/odswiez`, { tresc: 'Termin: 45 dni' })).status, 200);
  assert.equal(klientRoznicy.wywolania.length - przedRoznica, 1);

  assert.equal((await post(u, `/api/przetarg/swz/postepowania/${u.postId}/analiza`, { swz: 'SWZ c' })).status, 201);
  const trzecie = await post(u, `/api/przetarg/swz/postepowania/${u.postId}/analiza`, { swz: 'SWZ c2' });
  assert.equal(trzecie.status, 429, 'opis różnic + analiza = 2 = limit');

  // Opis skutku jest best-effort: po limicie zmiana zapisuje się z samym diffem, bez AI.
  const odswiez = await post(u, `/api/przetarg/swz/postepowania/${u.postId}/odswiez`, { tresc: 'Termin: 30 dni' });
  assert.equal(odswiez.status, 200);
  assert.equal(klientRoznicy.wywolania.length - przedRoznica, 1, 'po limicie opis skutku NIE woła Anthropic');
  assert.equal(odswiez.json.zmiany_wpisy.at(-1).opis_skutku, null);
  assert.match(odswiez.json.zmiany_wpisy.at(-1).diff, /\+ Termin: 30 dni/);
});

test('streszczenie regulaminu (radar podprogowy) liczy się do tej samej puli — 429 bez wywołania', async () => {
  const u = nowyUzytkownik('limit-d');
  const przed = klientRegulaminu.wywolania.length;
  await uruchomJakoUzytkownik(u.id, async () => {
    assert.ok(await regulamin.streszMiniProcedure({ tresc: 'Regulamin 1' }));
    assert.ok(await regulamin.streszMiniProcedure({ tresc: 'Regulamin 2' }));
    await assert.rejects(
      () => regulamin.streszMiniProcedure({ tresc: 'Regulamin 3' }),
      (err) => err.status === 429 && err.code === 'LIMIT_AI_DZIENNY',
    );
  });
  assert.equal(klientRegulaminu.wywolania.length - przed, 2, 'trzecie streszczenie NIE dotarło do Anthropic');
});

test('wywołania spoza żądania użytkownika (cron) nie są limitowane per użytkownik', async () => {
  const przed = klientAnalizy.wywolania.length;
  for (let i = 0; i < 4; i++) await analiza.analizujSwz({ swz: `cron ${i}` });
  assert.equal(klientAnalizy.wywolania.length - przed, 4);
});
