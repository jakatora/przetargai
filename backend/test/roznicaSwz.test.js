import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Silnik różnic wersji SWZ (ulepszenie „Radar pytań i odpowiedzi do SWZ",
 * podzadanie 4/7).
 *
 * Porównuje nową wersję SWZ z poprzednią → czytelny diff (czysta funkcja) + krótki
 * opis skutku przez Claude (np. „termin realizacji 60→45 dni — przelicz harmonogram
 * i cenę") → zapis do `zmiany_swz`.
 *
 * Płatnego API nie wołamy w testach (zakaz + brak klucza): pokrywamy
 *   • czyste funkcje diffu i parsowania opisu — bez klienta,
 *   • opiszSkutekZmiany z ATRAPĄ klienta (sukces, brak klienta, błąd, bramka budżetu),
 *   • zarejestrujRoznice end-to-end na temp DB (zapis do zmiany_swz; graceful gdy AI down).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-roznica-swz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // brak realnego klienta — wstrzykujemy atrapę
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/config/env.js');
const { users, postepowaniaSwz, swzWersje, zmianySwz, aiUsage } = await import('../src/db/repos.js');
const {
  diffSwz, parsujOpis, budujPromptOpisu, opiszSkutekZmiany, zarejestrujRoznice, ustawKlientaAnthropic,
} = await import('../src/services/roznicaSwz.js');

/** Atrapa klienta Anthropic: oddaje zadany opis i zapamiętuje wywołania. */
function fakeKlient(opis) {
  const wywolania = [];
  return {
    wywolania,
    messages: {
      create: async (arg) => {
        wywolania.push(arg);
        return {
          content: [{ type: 'text', text: JSON.stringify({ opis }) }],
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      },
    },
  };
}

let userId;
let postId;

before(() => {
  migrate();
  userId = users.create({ companyNip: null, companyName: null, email: `roznica-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  postId = postepowaniaSwz.create({ userId, nazwa: 'Budowa hali sportowej' }).id;
});
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Część 1: czysty diff (bez AI) ────────────────────────────────────────────

test('diffSwz — przykładowa zmiana treści: termin realizacji 60→45 dni', () => {
  const stary = 'Rozdział V. Termin realizacji zamówienia\nTermin realizacji: 60 dni\nGwarancja: 24 miesiące';
  const nowy = 'Rozdział V. Termin realizacji zamówienia\nTermin realizacji: 45 dni\nGwarancja: 24 miesiące';
  const diff = diffSwz(stary, nowy);

  assert.match(diff, /^- Termin realizacji: 60 dni$/m, 'stara linia oznaczona „-"');
  assert.match(diff, /^\+ Termin realizacji: 45 dni$/m, 'nowa linia oznaczona „+"');
  assert.match(diff, /^ {2}Gwarancja: 24 miesiące$/m, 'niezmieniona linia to kontekst (prefiks spacja)');
  assert.doesNotMatch(diff, /^[-+] Gwarancja/m, 'niezmieniona linia nie jest dodana/usunięta');
});

test('diffSwz — identyczne wersje => pusty diff (nic do zapisania)', () => {
  assert.equal(diffSwz('Ten sam tekst\nlinia 2', 'Ten sam tekst\nlinia 2'), '');
  assert.equal(diffSwz('', ''), '');
});

test('diffSwz — dodanie i usunięcie linii', () => {
  const dodane = diffSwz('a\nb', 'a\nb\nc');
  assert.match(dodane, /^\+ c$/m, 'dopisana linia oznaczona „+"');
  assert.doesNotMatch(dodane, /^- /m, 'nic nie usunięto');

  const usuniete = diffSwz('a\nb\nc', 'a\nc');
  assert.match(usuniete, /^- b$/m, 'usunięta linia oznaczona „-"');
  assert.doesNotMatch(usuniete, /^\+ /m, 'nic nie dodano');
});

test('diffSwz — dalekie od zmian fragmenty zwija do „…", pokazuje kontekst wokół zmiany', () => {
  const stary = Array.from({ length: 20 }, (_, i) => `linia ${i}`).join('\n');
  const nowy = stary.replace('linia 10', 'linia 10 ZMIENIONA');
  const diff = diffSwz(stary, nowy, { kontekst: 2 });

  assert.match(diff, /^- linia 10$/m);
  assert.match(diff, /^\+ linia 10 ZMIENIONA$/m);
  assert.match(diff, /…/, 'odległe niezmienione linie zwinięte');
  assert.doesNotMatch(diff, /^ {2}linia 0$/m, 'odległy początek nie jest pokazywany dosłownie');
  assert.match(diff, /^ {2}linia 9$/m, 'najbliższy kontekst przed zmianą widoczny');
});

// ── Część 2: parsowanie opisu (bez AI) ───────────────────────────────────────

test('parsujOpis — czyta {"opis":...} i przycina', () => {
  assert.equal(
    parsujOpis(JSON.stringify({ opis: '  termin realizacji 60→45 dni — przelicz harmonogram i cenę  ' })),
    'termin realizacji 60→45 dni — przelicz harmonogram i cenę',
  );
});

test('parsujOpis — radzi sobie z ogrodzeniem ```json i prozą wokół', () => {
  const text = 'Oto skutek:\n```json\n{"opis":"zmieniono zakres — sprawdź przedmiar"}\n```\nGotowe.';
  assert.equal(parsujOpis(text), 'zmieniono zakres — sprawdź przedmiar');
});

test('parsujOpis — śmieci / brak opisu => null (nie rzuca)', () => {
  assert.equal(parsujOpis('nie ma tu żadnego json'), null);
  assert.equal(parsujOpis(''), null);
  assert.equal(parsujOpis('{zepsuty'), null);
  assert.equal(parsujOpis(JSON.stringify({ opis: '   ' })), null, 'pusty opis => null');
});

test('budujPromptOpisu — pakuje diff w rozłączny znacznik <diff> (ochrona przed injection)', () => {
  const p = budujPromptOpisu({ diff: '- 60 dni\n+ 45 dni' });
  assert.match(p, /<diff>[\s\S]*- 60 dni[\s\S]*\+ 45 dni[\s\S]*<\/diff>/);
  assert.match(budujPromptOpisu({}), /<diff>\s*\(brak zmian\)\s*<\/diff>/, 'pusty diff => „(brak zmian)"');
});

// ── Część 3: opiszSkutekZmiany z atrapą klienta ──────────────────────────────

test('opiszSkutekZmiany — atrapa: zwraca opis, woła priced model i księguje koszt', async () => {
  const klient = fakeKlient('termin realizacji 60→45 dni — przelicz harmonogram i cenę');
  ustawKlientaAnthropic(klient);
  const przed = aiUsage.monthCallCount();

  const opis = await opiszSkutekZmiany({ diff: '- Termin realizacji: 60 dni\n+ Termin realizacji: 45 dni' });

  assert.equal(opis, 'termin realizacji 60→45 dni — przelicz harmonogram i cenę');
  assert.equal(klient.wywolania.length, 1, 'dokładnie jedno wywołanie modelu');
  assert.equal(klient.wywolania[0].model, env.AI_MATCH_MODEL, 'używa zweryfikowanego cenowo modelu PrzetargAI');
  assert.match(klient.wywolania[0].messages[0].content, /<diff>[\s\S]*45 dni/);
  assert.equal(aiUsage.monthCallCount(), przed + 1, 'koszt zaksięgowany do wspólnej puli ai_usage');
});

test('opiszSkutekZmiany — brak klienta (AI wyłączone) => 503', async () => {
  ustawKlientaAnthropic(null);
  await assert.rejects(
    () => opiszSkutekZmiany({ diff: '- a\n+ b' }),
    (err) => err.status === 503 && /AI|Anthropic/i.test(err.message),
  );
});

test('opiszSkutekZmiany — błąd wywołania modelu => 503 (czytelny komunikat)', async () => {
  ustawKlientaAnthropic({ messages: { create: async () => { throw new Error('network down'); } } });
  await assert.rejects(
    () => opiszSkutekZmiany({ diff: '- a\n+ b' }),
    (err) => err.status === 503,
  );
});

// ── Część 4: orkiestrator zarejestrujRoznice → zapis do zmiany_swz ────────────

test('zarejestrujRoznice — zapisuje diff + opis do zmiany_swz i wiąże wersję', async () => {
  ustawKlientaAnthropic(fakeKlient('termin realizacji 60→45 dni — przelicz harmonogram i cenę'));

  const w1 = swzWersje.add({ postepowanieId: postId, hash: 'v1', tresc: 'Termin realizacji: 60 dni' });
  const w2 = swzWersje.add({ postepowanieId: postId, hash: 'v2', tresc: 'Termin realizacji: 45 dni', dataPublikacji: '2026-07-20T00:00:00.000Z' });

  const zmiana = await zarejestrujRoznice({
    postepowanieId: postId,
    poprzednia: w1.wersja,
    nowa: w2.wersja,
  });

  assert.ok(zmiana && zmiana.id, 'powstał wpis zmiany');
  assert.equal(zmiana.opis_skutku, 'termin realizacji 60→45 dni — przelicz harmonogram i cenę');
  assert.match(zmiana.diff, /^- Termin realizacji: 60 dni$/m);
  assert.match(zmiana.diff, /^\+ Termin realizacji: 45 dni$/m);
  assert.equal(zmiana.wersja_swz_id, w2.wersja.id, 'zmiana wskazuje nową wersję SWZ');
  assert.equal(zmiana.data_publikacji, '2026-07-20T00:00:00.000Z');

  // Faktycznie trafiło do tabeli (nie tylko echo).
  const wTabeli = zmianySwz.findById(zmiana.id);
  assert.equal(wTabeli.opis_skutku, zmiana.opis_skutku);
});

test('zarejestrujRoznice — identyczne wersje => null, żadnego wpisu', async () => {
  ustawKlientaAnthropic(fakeKlient('nie powinno się wywołać'));
  const p = postepowaniaSwz.create({ userId, nazwa: 'Bez zmian' }).id;

  const wynik = await zarejestrujRoznice({
    postepowanieId: p,
    poprzednia: { tresc: 'Ta sama treść' },
    nowa: { tresc: 'Ta sama treść' },
  });

  assert.equal(wynik, null, 'brak zmiany treści => brak wpisu');
  assert.equal(zmianySwz.listForPostepowanie(p).length, 0, 'tabela pusta dla tego postępowania');
});

test('zarejestrujRoznice — AI niedostępne => zapis zmiany z samym diffem (opis null)', async () => {
  ustawKlientaAnthropic(null); // symulacja braku AI — opis best-effort
  const p = postepowaniaSwz.create({ userId, nazwa: 'AI down' }).id;

  const zmiana = await zarejestrujRoznice({
    postepowanieId: p,
    poprzednia: { tresc: 'Wartość zabezpieczenia: 5%' },
    nowa: { tresc: 'Wartość zabezpieczenia: 3%' },
  });

  assert.ok(zmiana && zmiana.id, 'zmiana zapisana mimo niedostępnego AI');
  assert.equal(zmiana.opis_skutku, null, 'brak opisu, bo AI niedostępne');
  assert.match(zmiana.diff, /^- Wartość zabezpieczenia: 5%$/m, 'diff zachowany');
  assert.match(zmiana.diff, /^\+ Wartość zabezpieczenia: 3%$/m);
});

// ── Część 5 (ostatnia — poisonuje budżet): bramka budżetu ─────────────────────

test('opiszSkutekZmiany — po przekroczeniu twardego budżetu AI => 503 BEZ wywołania modelu', async () => {
  aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: 500 });

  let wywolano = false;
  ustawKlientaAnthropic({ messages: { create: async () => { wywolano = true; return { content: [], usage: {} }; } } });

  await assert.rejects(
    () => opiszSkutekZmiany({ diff: '- a\n+ b' }),
    (err) => err.status === 503 && /budżet|limit/i.test(err.message),
  );
  assert.equal(wywolano, false, 'bramka budżetu odcina PRZED płatnym wywołaniem');
});
