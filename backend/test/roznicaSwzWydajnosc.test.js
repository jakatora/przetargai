import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Diff SWZ bez wywracania procesu (P0, 2026-09-25).
 *
 * `diffSwz` liczył LCS z tablicą (n+1)×(m+1) w wątku głównym. `POST /swz/postepowania/
 * :id/odswiez` przyjmował `tresc` bez limitu, więc dwie wersje po 8 tys. zmienionych
 * linii to 3,9 s i 366 MB, a ~20 tys. — OOM i przestój WSZYSTKICH aplikacji na tym
 * procesie (PrzetargAI, Fitter, SmartSpiżarka, ATLAS). Do tego cały diff szedł do
 * płatnego AI bez przycięcia.
 *
 * Sprawdzamy:
 *  - diff 2×50 tys. różnych linii kończy się szybko (tani algorytm powyżej progu),
 *  - duży dokument z rozrzuconymi zmianami dalej daje POPRAWNY diff (-/+ w miejscu zmiany),
 *  - prompt opisu skutku przycina diff i mówi, ile zmian pominięto,
 *  - trasy odrzucają treść ponad limit znaków/linii czytelnym komunikatem PL (413).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-roznica-wyd-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { diffSwz, budujPromptOpisu } = await import('../src/services/roznicaSwz.js');

let token;
let postId;
let server;
let base;

before(() => {
  migrate();
  const u = users.create({ companyNip: null, companyName: null, email: `roznica-wyd-${process.pid}@t.pl`, passwordHash: 'h' });
  token = signToken(u.id);
  postId = postepowaniaSwz.create({ userId: u.id, nazwa: 'Duże SWZ' }).id;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Algorytm ─────────────────────────────────────────────────────────────────

test('diffSwz — 2×50 tys. całkowicie różnych linii kończy się szybko (bez tablicy n·m)', () => {
  const N = 50_000;
  const stary = Array.from({ length: N }, (_, i) => `stara linia ${i}`).join('\n');
  const nowy = Array.from({ length: N }, (_, i) => `nowa linia ${i}`).join('\n');

  const start = process.hrtime.bigint();
  const diff = diffSwz(stary, nowy);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;

  assert.ok(ms < 3000, `diff 2×50 tys. linii trwał ${ms.toFixed(0)} ms (limit 3000 ms)`);
  assert.match(diff, /^- stara linia 0$/m, 'stare linie oznaczone „-"');
  assert.match(diff, /^\+ nowa linia 49999$/m, 'nowe linie oznaczone „+"');
  assert.doesNotMatch(diff, /^ {2}stara/m, 'żadna stara linia nie udaje kontekstu');
});

test('diffSwz — duży dokument z rozrzuconymi zmianami: poprawny diff i szybko', () => {
  const N = 40_000;
  const linie = Array.from({ length: N }, (_, i) => `§ ${i}. Postanowienie numer ${i} dotyczące realizacji zamówienia.`);
  const nowe = linie.slice();
  // Co 97. linia zmieniona, co 1000. usunięta, a co 1500. przed nią wstawiona nowa —
  // żeby środek (po ścięciu prefiksu/sufiksu) był ogromny i nie zmieścił się w LCS.
  const zmienione = [];
  for (let i = 5; i < N - 5; i += 97) { nowe[i] = `${linie[i]} ZMIANA`; zmienione.push(i); }
  const wynik = [];
  nowe.forEach((l, i) => {
    if (i % 1500 === 7) wynik.push(`Nowy zapis przed ${i}`);
    if (i % 1000 === 3) return; // usunięta
    wynik.push(l);
  });

  const start = process.hrtime.bigint();
  const diff = diffSwz(linie.join('\n'), wynik.join('\n'));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 3000, `diff trwał ${ms.toFixed(0)} ms (limit 3000 ms)`);

  for (const i of zmienione.slice(0, 50)) {
    if (i % 1000 === 3) continue;
    assert.ok(diff.includes(`\n- ${linie[i]}\n`) || diff.startsWith(`- ${linie[i]}\n`), `linia ${i}: stara treść jako „-"`);
    assert.ok(diff.includes(`+ ${linie[i]} ZMIANA`), `linia ${i}: nowa treść jako „+"`);
  }
  assert.match(diff, /^- § 1003\. Postanowienie numer 1003 /m, 'usunięta linia oznaczona „-"');
  assert.match(diff, /^\+ Nowy zapis przed 1507$/m, 'wstawiona linia oznaczona „+"');
  assert.doesNotMatch(diff, /^[-+] § 2000\. Postanowienie numer 2000 dotyczące realizacji zamówienia\.$/m,
    'niezmieniona linia nie jest ani dodana, ani usunięta');
});

test('diffSwz — małe wejście liczone dokładnie jak dotąd (LCS)', () => {
  assert.equal(diffSwz('a\nb\nc', 'a\nx\nc'), '  a\n- b\n+ x\n  c');
  assert.equal(diffSwz('a\nb', 'a\nb'), '');
});

// ── Przycięcie diffu do AI ───────────────────────────────────────────────────

test('budujPromptOpisu — ogromny diff przycięty, z informacją ile zmian pominięto', () => {
  const linie = [];
  for (let i = 0; i < 20_000; i++) linie.push(`- stara pozycja ${i}`, `+ nowa pozycja ${i}`);
  const diff = linie.join('\n');

  const p = budujPromptOpisu({ diff });
  assert.ok(p.length < 40_000, `prompt ma ${p.length} znaków — diff nie został przycięty`);
  const m = p.match(/… i (\d+) dalszych zmian/);
  assert.ok(m, 'prompt mówi, ile zmian pominięto');
  const widoczne = (p.match(/^[-+] /gm) ?? []).length;
  assert.equal(widoczne + Number(m[1]), 40_000, 'pokazane + pominięte = wszystkie zmiany');
  assert.match(p, /<diff>[\s\S]*<\/diff>/, 'diff dalej w rozłącznym znaczniku');
});

test('budujPromptOpisu — mały diff bez zmian (bez adnotacji o przycięciu)', () => {
  const p = budujPromptOpisu({ diff: '- 60 dni\n+ 45 dni' });
  assert.match(p, /<diff>\n- 60 dni\n\+ 45 dni\n<\/diff>/);
  assert.doesNotMatch(p, /dalszych zmian/);
});

// ── Limity treści na trasach ─────────────────────────────────────────────────

async function post(sciezka, cialo) {
  const res = await fetch(`${base}${sciezka}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json() };
}

test('POST odswiez — treść ponad 2 mln znaków => 413 z komunikatem PL', async () => {
  const { status, json } = await post(`/api/przetarg/swz/postepowania/${postId}/odswiez`, { tresc: 'A'.repeat(2_000_001) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DLUGA_TRESC');
  assert.match(json.error.message, /tresc/);
  assert.match(json.error.message, /znaków/);
});

test('POST odswiez — treść ponad 50 tys. linii => 413 z komunikatem PL', async () => {
  const { status, json } = await post(`/api/przetarg/swz/postepowania/${postId}/odswiez`, { tresc: 'x\n'.repeat(50_001) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DLUGA_TRESC');
  assert.match(json.error.message, /linii/);
});

test('POST odswiez — treść w limicie dalej działa (200)', async () => {
  const { status, json } = await post(`/api/przetarg/swz/postepowania/${postId}/odswiez`, { tresc: 'Termin realizacji: 60 dni' });
  assert.equal(status, 200, JSON.stringify(json));
});

test('POST analiza — SWZ ponad limit => 413 (zanim dojdzie do płatnego AI)', async () => {
  const { status, json } = await post(`/api/przetarg/swz/postepowania/${postId}/analiza`, { swz: 'A'.repeat(2_000_001) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DLUGA_TRESC');
  assert.match(json.error.message, /swz/);
});

test('POST symulator-plynnosci/analiza — SWZ ponad limit => 413', async () => {
  const { status, json } = await post('/api/przetarg/symulator-plynnosci/analiza', { swz: 'x\n'.repeat(50_001) });
  assert.equal(status, 413, JSON.stringify(json));
  assert.equal(json.error.code, 'ZA_DLUGA_TRESC');
});
