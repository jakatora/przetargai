import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * BŁĄD PRODUKCYJNY (2026-07-10, wykryty na ŻYWEJ produkcji przy D-043):
 * backfill po rejestracji i po PATCH /me był „fire-and-forget", a Cloud
 * Functions ZAMRAŻAJĄ instancję po wysłaniu odpowiedzi — obietnica w tle
 * nigdy nie kończyła pracy. Użytkownik rejestrował się z dobrymi słowami
 * kluczowymi przy pełnej bazie i dostawał PUSTY feed (do najbliższego crona).
 * Emulator maskował problem, bo jego proces żyje dalej.
 *
 * Kontrakt: odpowiedź rejestracji/PATCH wraca DOPIERO PO zakończeniu
 * dopasowywania — natychmiastowy odczyt feedu musi widzieć dopasowania.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function zasiejPrzetarg(title) {
  seq++;
  await tenders.upsert({
    externalId: `onb-${process.pid}-${seq}`,
    title,
    organization: 'Gmina Onboardingowa',
    deadline: '2099-01-01T00:00:00.000Z',
  });
}

test('rejestracja: feed jest pełny NATYCHMIAST po odpowiedzi (bez czekania na cron)', async () => {
  await zasiejPrzetarg(`Dostawa mebli biurowych dla urzędu ${seq}`);
  tenders.odswiezPule();

  const rej = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `onb-${process.pid}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords: ['meble biurowe'],
    }),
  });
  assert.equal(rej.status, 201);
  const { token } = await rej.json();

  // ZERO sleep — to jest sedno testu: odpowiedź przyszła = dopasowania SĄ.
  const feed = await fetch(`${BAZA}/matches?limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dane = await feed.json();
  assert.ok(dane.count >= 1,
    'feed pusty tuż po rejestracji = fire-and-forget wrócił (Functions zamrażają tło)');
});

test('PATCH /me: zmiana słów kluczowych dowozi dopasowania przed odpowiedzią', async () => {
  await zasiejPrzetarg(`Remont dachu szkoły podstawowej ${seq}`);
  tenders.odswiezPule();

  const rej = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `onb-p-${process.pid}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords: ['fotowoltaika przemysłowa'], // nic nie trafia
    }),
  });
  const { token } = await rej.json();

  const patch = await fetch(`${BAZA}/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ keywords: ['remont dachu'] }),
  });
  assert.equal(patch.status, 200);

  const feed = await fetch(`${BAZA}/matches?limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.ok((await feed.json()).count >= 1,
    'zmiana kryteriów musi przeliczyć feed PRZED odpowiedzią (prod zamraża tło)');
});
