import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Incydent testowy 2026-09-29: lokalny emulator Functions zrobił trzy rzeczy na
 * PRODUKCJI, choć nikt tego nie chciał:
 *  • bez `.secret.local` firebase-tools pobrał wszystkie sekrety z Secret Managera
 *    (w tym klucze Resend, Stripe i Anthropic),
 *  • z tym kluczem Resend rejestracja w emulatorze wysłała 10 maili powitalnych
 *    na adresy testowe (wszystkie odbite),
 *  • most `/api/przetarg/*` miał domyślnie włączony adres produkcyjnego Railway,
 *    więc otwarcie Sejfu założyło tam konto pomostowe.
 *
 * Ten plik pilnuje, żeby żadna z tych dróg nie wróciła przez przeoczoną
 * konfigurację. Produkcja zachowuje dotychczasowe domyślne (sprawdzone niżej).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KATALOG_FUNKCJI = path.resolve(__dirname, '..');
const ADRES_PRODUKCYJNY = 'https://backend-production-a43e3.up.railway.app';

let licznikImportow = 0;

/** Świeża instancja config.js dla podanego środowiska (process.env przywracane). */
async function configDla(nadpisania) {
  const zapis = {};
  for (const [klucz, wartosc] of Object.entries(nadpisania)) {
    zapis[klucz] = process.env[klucz];
    if (wartosc === undefined) delete process.env[klucz];
    else process.env[klucz] = wartosc;
  }
  try {
    licznikImportow += 1;
    return await import(`../src/config.js?srodowisko=${licznikImportow}`);
  } finally {
    for (const [klucz, wartosc] of Object.entries(zapis)) {
      if (wartosc === undefined) delete process.env[klucz];
      else process.env[klucz] = wartosc;
    }
  }
}

const BEZ_MOSTU = { MOST_ENABLED: undefined, MOST_RAILWAY_URL: undefined };

test('tryb testowy: most domyślnie wyłączony i skierowany na localhost', async () => {
  const { env, features } = await configDla({ ...BEZ_MOSTU, NODE_ENV: 'test', FUNCTIONS_EMULATOR: undefined });
  assert.equal(features.most, false);
  assert.equal(new URL(env.MOST_RAILWAY_URL).hostname, '127.0.0.1');
});

test('emulator: most domyślnie wyłączony i skierowany na localhost', async () => {
  const { env, features } = await configDla({ ...BEZ_MOSTU, NODE_ENV: undefined, FUNCTIONS_EMULATOR: 'true' });
  assert.equal(features.most, false);
  assert.equal(new URL(env.MOST_RAILWAY_URL).hostname, '127.0.0.1');
});

test('tryb lokalny: jawnie włączony most na zewnętrzny host to błąd konfiguracji', async () => {
  await assert.rejects(
    configDla({ NODE_ENV: 'test', MOST_ENABLED: 'true', MOST_RAILWAY_URL: ADRES_PRODUKCYJNY }),
    /localhost/,
  );
  await assert.rejects(
    configDla({ NODE_ENV: undefined, FUNCTIONS_EMULATOR: 'true', MOST_ENABLED: 'true', MOST_RAILWAY_URL: ADRES_PRODUKCYJNY }),
    /localhost/,
  );
});

test('tryb lokalny: most jawnie skierowany na lokalny backend działa', async () => {
  const { env, features } = await configDla({
    NODE_ENV: 'test', MOST_ENABLED: 'true', MOST_RAILWAY_URL: 'http://127.0.0.1:3100',
  });
  assert.equal(features.most, true);
  assert.equal(env.MOST_RAILWAY_URL, 'http://127.0.0.1:3100');
});

test('emulator: AI, Stripe, e-mail, faktury i push wyłączone nawet przy ustawionych kluczach', async () => {
  const { features } = await configDla({
    NODE_ENV: undefined,
    FUNCTIONS_EMULATOR: 'true',
    ANTHROPIC_API_KEY: 'klucz-atrapa',
    STRIPE_SECRET_KEY: 'klucz-atrapa',
    RESEND_API_KEY: 'klucz-atrapa',
    FAKTUROWANIE_ENABLED: 'true',
    FAKTUROWNIA_API_KEY: 'klucz-atrapa',
    FAKTUROWNIA_DOMAIN: 'atrapa',
  });
  assert.deepEqual(
    { ai: features.ai, stripe: features.stripe, email: features.email, invoicing: features.invoicing, push: features.push },
    { ai: false, stripe: false, email: false, invoicing: false, push: false },
  );
});

test('produkcja: dotychczasowe domyślne bez zmian (most włączony, adres Railway)', async () => {
  const { env, features } = await configDla({ ...BEZ_MOSTU, NODE_ENV: 'production', FUNCTIONS_EMULATOR: undefined });
  assert.equal(features.most, true);
  assert.equal(env.MOST_RAILWAY_URL, ADRES_PRODUKCYJNY);
  assert.equal(features.push, true);
});

test('.secret.local pokrywa KAŻDY sekret funkcji niepustą atrapą (emulator nie sięga do Secret Managera)', () => {
  // firebase-tools pomija w .secret.local wartości PUSTE i dla nich pobiera sekret
  // z Secret Managera — dlatego pusty wpis jest tak samo groźny jak brak wpisu.
  const index = fs.readFileSync(path.join(KATALOG_FUNKCJI, 'index.js'), 'utf8');
  const sekrety = [...index.matchAll(/defineSecret\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(sekrety.length >= 9, 'nie znaleziono deklaracji defineSecret w index.js');

  const plik = fs.readFileSync(path.join(KATALOG_FUNKCJI, '.secret.local'), 'utf8');
  const wartosci = Object.fromEntries(plik.split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

  for (const nazwa of sekrety) {
    assert.ok(wartosci[nazwa], `${nazwa}: brak niepustej atrapy w .secret.local`);
    assert.doesNotMatch(wartosci[nazwa], /^(sk_live_|sk_test_|rk_live_|whsec_|re_|sk-ant-)/,
      `${nazwa}: wartość wygląda na prawdziwy klucz — .secret.local trzyma tylko atrapy`);
  }
  // smoke.sh sprawdza /admin tym kluczem — rozjazd dawał fałszywe FAIL.
  const smoke = fs.readFileSync(path.join(KATALOG_FUNKCJI, '..', 'test-e2e', 'smoke.sh'), 'utf8');
  assert.match(smoke, new RegExp(`X-Admin-Key: ${wartosci.ADMIN_API_KEY}`));
});

test('skrypty emulatora działają na projekcie demo- (bez dostępu do zasobów produkcji)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(KATALOG_FUNKCJI, 'package.json'), 'utf8'));
  for (const skrypt of ['test', 'emulators', 'test:e2e']) {
    assert.match(pkg.scripts[skrypt], /--project demo-przetargai\b/, `skrypt ${skrypt}`);
  }
  const smoke = fs.readFileSync(path.join(KATALOG_FUNKCJI, '..', 'test-e2e', 'smoke.sh'), 'utf8');
  assert.match(smoke, /127\.0\.0\.1:5002\/demo-przetargai\//);
});

// ── Trasa mostu w domyślnej konfiguracji testów: zero ruchu poza maszynę ──────

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

test('domyślna konfiguracja testów: /api/przetarg/* odpowiada 503 i nie wychodzi do sieci', async () => {
  const zewnetrzne = [];
  globalThis.fetch = async (url, opcje) => {
    const host = new URL(String(url)).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      zewnetrzne.push(String(url));
      throw new Error('test: ruch poza maszynę zablokowany');
    }
    return oryginalnyFetch(url, opcje);
  };

  const user = await users.create({ email: `lokalny-${process.pid}@test.invalid`, passwordHash: 'x' });
  const token = signToken(user.id, 0);
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const odp = await fetch(`http://127.0.0.1:${port}/api/przetarg/sejf/katalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cialo = await odp.json();
    assert.equal(odp.status, 503);
    assert.equal(cialo.error.code, 'MOST_WYLACZONY');
    assert.deepEqual(zewnetrzne, [], 'żadne żądanie nie może opuścić maszyny');
  } finally {
    serwer.close();
  }
});
