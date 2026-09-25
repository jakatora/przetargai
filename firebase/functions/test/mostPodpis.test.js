import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/*
 * Podpis kont pomostowych (P1, 2026-09-25).
 *
 * `POST /auth/register` na Railway jest publiczne, a konta pomostowe mają adres
 * na domenie technicznej `MOST_EMAIL_DOMENA`. Kto zna schemat adresu
 * (most.<uid>@…), mógł przed mostem założyć konto na cudzy uid i przejąć jego
 * dane w modułach. Railway zacznie wymagać dla tej domeny nagłówka
 * `X-Most-Podpis` = HMAC-SHA256(JWT_SECRET, email) w hex — umie go wyliczyć
 * wyłącznie ktoś, kto zna sekret, czyli Functions.
 *
 * Test bez emulatora: most woła tylko sieć (atrapa fetch), bazy nie dotyka.
 */

const { env } = await import('../src/config.js');
const { zalozKontoPomostowe, podpisMostu, emailMostu } = await import('../src/services/mostRailway.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

function podstawRailway({ statusRejestracji = 201 } = {}) {
  const zadania = [];
  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    zadania.push({ adres, naglowki: opcje.headers ?? {}, cialo: JSON.parse(String(opcje.body ?? '{}')) });
    if (adres.endsWith('/auth/register')) {
      return new Response(JSON.stringify({ user: { id: 'rail-podpis' } }), { status: statusRejestracji });
    }
    return new Response(JSON.stringify({ user: { id: 'rail-z-logowania' } }), { status: 200 });
  };
  return zadania;
}

test('podpisMostu = HMAC-SHA256(JWT_SECRET, email) w hex (małe litery)', () => {
  const email = 'most.abc@most.przetarg-ai.pl';
  const oczekiwany = crypto.createHmac('sha256', env.JWT_SECRET).update(email).digest('hex');
  assert.equal(podpisMostu(email), oczekiwany);
  assert.match(podpisMostu(email), /^[0-9a-f]{64}$/);
  assert.notEqual(podpisMostu(email), podpisMostu('most.inny@most.przetarg-ai.pl'),
    'podpis wiąże KONKRETNY adres — nie da się go przenieść na cudzy uid');
});

test('rejestracja konta pomostowego niesie nagłówek X-Most-Podpis dla SWOJEGO adresu', async () => {
  const zadania = podstawRailway();

  await zalozKontoPomostowe('uid-podpis-1');

  const rejestracja = zadania.find((z) => z.adres.endsWith('/auth/register'));
  assert.equal(rejestracja.cialo.email, emailMostu('uid-podpis-1'));
  assert.equal(rejestracja.naglowki['X-Most-Podpis'], podpisMostu(emailMostu('uid-podpis-1')));
});

test('logowanie po 409 też niesie podpis (Railway może go wymagać i tam)', async () => {
  const zadania = podstawRailway({ statusRejestracji: 409 });

  const id = await zalozKontoPomostowe('uid-podpis-2');

  assert.equal(id, 'rail-z-logowania');
  const logowanie = zadania.find((z) => z.adres.endsWith('/auth/login'));
  assert.equal(logowanie.naglowki['X-Most-Podpis'], podpisMostu(emailMostu('uid-podpis-2')));
});
