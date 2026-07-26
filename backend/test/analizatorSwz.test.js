import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Analizator SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ", podzadanie 3/7).
 *
 * Wejście: treść SWZ + wzoru umowy + przedmiaru → wywołanie Claude → lista
 * gotowych pytań (niejasność / sprzeczność / brak parametru), każde z odniesieniem
 * do fragmentu. Trasa zapisuje je jako SZKICE w `pytania_swz`.
 *
 * Płatnego API nie wołamy w testach (zakaz + brak klucza): pokrywamy
 *   • czyste funkcje (budowanie promptu, parsowanie odpowiedzi) — bez klienta,
 *   • serwis z ATRAPĄ klienta (ścieżka sukcesu, brak klienta, błąd, bramka budżetu),
 *   • endpoint end-to-end (auth, własność, walidacja, zapis szkiców) — też przez atrapę.
 * Kształt wywołania (`model`/`system`/`messages`/`usage`) jest identyczny jak w
 * sprawdzonych produkcyjnie services/ai.js i fitterScan.js.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-analizator-swz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // brak realnego klienta — wstrzykujemy atrapę
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, pytaniaSwz, aiUsage } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const {
  budujPromptSwz, parsujPytania, analizujSwz, ustawKlientaAnthropic,
} = await import('../src/services/analizaSwz.js');

/** Atrapa klienta Anthropic: oddaje zadaną listę pytań i zapamiętuje wywołania. */
function fakeKlient(pytania) {
  const wywolania = [];
  return {
    wywolania,
    messages: {
      create: async (arg) => {
        wywolania.push(arg);
        return {
          content: [{ type: 'text', text: JSON.stringify({ pytania }) }],
          usage: { input_tokens: 12, output_tokens: 8 },
        };
      },
    },
  };
}

let userId;
let token;
let postId;
let server;
let base;

before(() => {
  migrate();
  const u = users.create({ companyNip: null, companyName: null, email: `analiza-${process.pid}@t.pl`, passwordHash: 'h' });
  userId = u.id;
  token = signToken(userId);
  postId = postepowaniaSwz.create({ userId, nazwa: 'Budowa hali sportowej' }).id;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Część 1: czyste funkcje (bez klienta AI) ─────────────────────────────────

test('budujPromptSwz — pakuje trzy dokumenty w rozłączne znaczniki (ochrona przed prompt injection)', () => {
  const p = budujPromptSwz({ swz: 'Rozdział III: materiał X', umowa: 'termin 45 dni', przedmiar: 'poz. 12 rura' });
  assert.match(p, /<swz>[\s\S]*Rozdział III: materiał X[\s\S]*<\/swz>/);
  assert.match(p, /<umowa>[\s\S]*termin 45 dni[\s\S]*<\/umowa>/);
  assert.match(p, /<przedmiar>[\s\S]*poz\. 12 rura[\s\S]*<\/przedmiar>/);
});

test('budujPromptSwz — pustą sekcję oznacza „(brak)", nie zmyśla treści', () => {
  const p = budujPromptSwz({ swz: 'tylko SWZ' });
  assert.match(p, /<umowa>\s*\(brak\)\s*<\/umowa>/);
  assert.match(p, /<przedmiar>\s*\(brak\)\s*<\/przedmiar>/);
});

test('parsujPytania — czyta {pytania:[...]} i normalizuje pola', () => {
  const wynik = parsujPytania(JSON.stringify({
    pytania: [
      { tresc: 'Czy dopuszczają Państwo materiał równoważny?', fragment: 'Rozdz. III pkt 2.4', kategoria: 'niejasnosc' },
      { tresc: 'SWZ mówi 60 dni, umowa 45 — który termin obowiązuje?', fragment: '§4 umowy', kategoria: 'sprzecznosc' },
    ],
  }));
  assert.equal(wynik.length, 2);
  assert.deepEqual(wynik[0], { tresc: 'Czy dopuszczają Państwo materiał równoważny?', fragment: 'Rozdz. III pkt 2.4', kategoria: 'niejasnosc' });
  assert.equal(wynik[1].kategoria, 'sprzecznosc');
});

test('parsujPytania — radzi sobie z ogrodzeniem ```json i prozą wokół', () => {
  const text = 'Oto wynik:\n```json\n{"pytania":[{"tresc":"Brak wymiaru w poz. 12 — proszę o uzupełnienie.","kategoria":"brak_parametru"}]}\n```\nGotowe.';
  const wynik = parsujPytania(text);
  assert.equal(wynik.length, 1);
  assert.equal(wynik[0].kategoria, 'brak_parametru');
  assert.equal(wynik[0].fragment, null, 'brak fragmentu => null');
});

test('parsujPytania — odrzuca puste treści i sprowadza nieznaną kategorię do „niejasnosc"', () => {
  const wynik = parsujPytania(JSON.stringify({
    pytania: [
      { tresc: '   ', fragment: 'x' },
      { tresc: 'Prawidłowe pytanie', kategoria: 'byle-co' },
      { fragment: 'brak treści' },
    ],
  }));
  assert.equal(wynik.length, 1, 'wpisy bez treści wypadają');
  assert.equal(wynik[0].kategoria, 'niejasnosc', 'nieznana kategoria => domyślna');
});

test('parsujPytania — śmieci / brak JSON => pusta lista (nie rzuca)', () => {
  assert.deepEqual(parsujPytania('nie ma tu żadnego json'), []);
  assert.deepEqual(parsujPytania(''), []);
  assert.deepEqual(parsujPytania('{zepsuty json'), []);
  assert.deepEqual(parsujPytania(JSON.stringify({ cos_innego: 1 })), [], 'brak pola pytania => []');
});

// ── Część 2: analizujSwz z atrapą klienta ────────────────────────────────────

test('analizujSwz — atrapa: zwraca pytania, woła priced model i księguje koszt', async () => {
  const klient = fakeKlient([
    { tresc: 'Czy dopuszczają Państwo materiał równoważny do wskazanego producenta?', fragment: 'Rozdz. III pkt 2.4', kategoria: 'niejasnosc' },
  ]);
  ustawKlientaAnthropic(klient);
  const przed = aiUsage.monthCallCount();

  const wynik = await analizujSwz({ swz: 'wymóg producenta X', umowa: 'termin 45 dni', przedmiar: 'poz. 12' });

  assert.equal(wynik.length, 1);
  assert.equal(wynik[0].fragment, 'Rozdz. III pkt 2.4');
  assert.equal(klient.wywolania.length, 1, 'dokładnie jedno wywołanie modelu');
  assert.equal(klient.wywolania[0].model, env.AI_MATCH_MODEL, 'używa zweryfikowanego cenowo modelu PrzetargAI');
  assert.equal(typeof klient.wywolania[0].system, 'string');
  assert.match(klient.wywolania[0].messages[0].content, /<swz>[\s\S]*wymóg producenta X/);
  assert.equal(aiUsage.monthCallCount(), przed + 1, 'koszt zaksięgowany do wspólnej puli ai_usage');
});

test('analizujSwz — brak klienta (AI wyłączone) => 503', async () => {
  ustawKlientaAnthropic(null);
  await assert.rejects(
    () => analizujSwz({ swz: 'cokolwiek' }),
    (err) => err.status === 503 && /AI|Anthropic/i.test(err.message),
  );
});

test('analizujSwz — błąd wywołania modelu => 503 (czytelny komunikat, nie surowe 500)', async () => {
  ustawKlientaAnthropic({ messages: { create: async () => { throw new Error('network down'); } } });
  await assert.rejects(
    () => analizujSwz({ swz: 'cokolwiek' }),
    (err) => err.status === 503,
  );
});

// ── Część 3: endpoint POST /api/przetarg/swz/postepowania/:id/analiza ─────────

async function postAnaliza(tok, id, body) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania/${id}/analiza`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST analiza — bez tokenu => 401', async () => {
  const { status } = await postAnaliza(null, postId, { swz: 'x' });
  assert.equal(status, 401);
});

test('POST analiza — cudze/nieistniejące postępowanie => 404', async () => {
  const nieistnieje = await postAnaliza(token, 'nie-ma-takiego', { swz: 'x' });
  assert.equal(nieistnieje.status, 404, JSON.stringify(nieistnieje.json));

  // Postępowanie innego użytkownika nie może być widoczne (skopowanie po user_id).
  const obcy = users.create({ companyNip: null, companyName: null, email: `obcy-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const cudzePost = postepowaniaSwz.create({ userId: obcy, nazwa: 'Cudze' }).id;
  const cudze = await postAnaliza(token, cudzePost, { swz: 'x' });
  assert.equal(cudze.status, 404, 'cudze postępowanie => 404, nie 200');
});

test('POST analiza — brak treści (puste body) => 400', async () => {
  const { status, json } = await postAnaliza(token, postId, {});
  assert.equal(status, 400, JSON.stringify(json));
  assert.equal(json.error.code, 'BAD_REQUEST');
});

test('POST analiza — zapisuje wykryte pytania jako SZKICE powiązane z postępowaniem', async () => {
  ustawKlientaAnthropic(fakeKlient([
    { tresc: 'SWZ wskazuje 60 dni, wzór umowy 45 — który termin realizacji obowiązuje?', fragment: '§4 wzoru umowy vs Rozdz. V SWZ', kategoria: 'sprzecznosc' },
    { tresc: 'Proszę o podanie klasy betonu dla pozycji 12 przedmiaru.', kategoria: 'brak_parametru' }, // bez fragmentu => null
  ]));

  const { status, json } = await postAnaliza(token, postId, {
    swz: 'Termin realizacji: 60 dni', umowa: 'Termin realizacji: 45 dni', przedmiar: 'poz. 12: beton',
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.equal(json.postepowanie_id, postId);
  assert.equal(json.liczba, 2);
  assert.equal(json.pytania.length, 2);
  assert.ok(json.pytania.every((p) => p.status === 'szkic'), 'każde zapisane pytanie jest szkicem');
  assert.equal(json.pytania[0].fragment_swz, '§4 wzoru umowy vs Rozdz. V SWZ');
  assert.equal(json.pytania[1].fragment_swz, null, 'brak fragmentu zapisany jako null');

  // Faktycznie trafiło do tabeli (nie tylko echo z handlera).
  const wTabeli = pytaniaSwz.listForPostepowanie(postId);
  assert.equal(wTabeli.length, 2);
  assert.ok(wTabeli.every((p) => p.status === 'szkic' && p.postepowanie_id === postId));
});

test('POST analiza — gdy AI niedostępne => 503 (a nie zapis pustych pytań)', async () => {
  ustawKlientaAnthropic(null);
  const { status, json } = await postAnaliza(token, postId, { swz: 'coś do analizy' });
  assert.equal(status, 503, JSON.stringify(json));
  assert.equal(json.error.code, 'SERVICE_UNAVAILABLE');
});

// ── Część 4 (ostatnia — poisonuje budżet): bramka budżetu ────────────────────

test('analizujSwz — po przekroczeniu twardego budżetu AI => 503 BEZ wywołania modelu', async () => {
  // Wyczerpujemy wspólny budżet AI (twardy limit domyślnie 500 USD).
  aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: 500 });

  let wywolano = false;
  ustawKlientaAnthropic({ messages: { create: async () => { wywolano = true; return { content: [], usage: {} }; } } });

  await assert.rejects(
    () => analizujSwz({ swz: 'cokolwiek' }),
    (err) => err.status === 503 && /budżet|limit/i.test(err.message),
  );
  assert.equal(wywolano, false, 'bramka budżetu odcina PRZED płatnym wywołaniem');
});
