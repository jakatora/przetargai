import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Endpoint GET /matches/:id/streszczenie (D-052) — wyjaśnienie AI ogłoszenia.
 * Testujemy przez prawdziwy serwer HTTP, bo najgroźniejsze ryzyka są tu trasowe:
 *  • kolizja z GET /matches/:id (id="…/streszczenie"),
 *  • serwowanie wspólnego cache przetargu przy zachowaniu IDOR-odporności.
 * Klucz AI pusty (jak w innych testach) → ścieżka generacji degraduje łagodnie;
 * ścieżkę SUKCESU testujemy przez wcześniejsze zaszczepienie cache w repo.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, matches } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `str-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['test'] }),
  });
  return (await odp.json()).token;
}
const auth = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
const userId = async (token) => (await (await fetch(`${BAZA}/auth/me`, { headers: auth(token) })).json()).user.id;

async function dopasowanie(uid, tytul) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `str-${process.pid}-${seq}`, title: tytul, organization: 'Gmina',
    cpvMain: '45261000-4', deadline: '2099-01-01T00:00:00.000Z', source: 'bzp',
  });
  const { match } = await matches.create({ userId: uid, tenderId: tender.id, score: 88, reasoning: 'pasuje', scorer: 'ai', tender });
  return match.id; // = tenderId
}

test('cache HIT: zaszczepione wyjaśnienie zwracane jest bez wołania AI', async () => {
  const token = await konto();
  const id = await dopasowanie(await userId(token), 'Remont dachu szkoły podstawowej');

  await tenders.saveSummary(id, {
    czego_dotyczy: 'Gmina remontuje dach szkoły.',
    dokumenty: ['Formularz oferty', 'Wpis do CEIDG'],
    na_co_uwaga: 'Krótki termin.',
    ocena: 'Dobre dla małej firmy budowlanej.',
  });

  const odp = await fetch(`${BAZA}/matches/${id}/streszczenie`, { headers: auth(token) });
  assert.equal(odp.status, 200);
  const dane = await odp.json();
  assert.equal(dane.cached, true, 'z cache, bez kosztu AI');
  assert.match(dane.streszczenie.czego_dotyczy, /dach szkoły/);
  assert.equal(dane.streszczenie.dokumenty.length, 2);
});

test('cache MISS bez AI: łagodna degradacja (streszczenie null + powód)', async () => {
  const token = await konto();
  const id = await dopasowanie(await userId(token), 'Dostawa materiałów biurowych');

  const dane = await (await fetch(`${BAZA}/matches/${id}/streszczenie`, { headers: auth(token) })).json();
  assert.equal(dane.streszczenie, null);
  assert.equal(dane.powod, 'niedostepne', 'AI wyłączone → uczciwy komunikat, nie 500');
  assert.ok(dane.komunikat);
});

test('KRYTYCZNE: /streszczenie nie koliduje z GET /:id ani nie łamie IDOR', async () => {
  const a = await konto();
  const id = await dopasowanie(await userId(a), 'Roboty budowlane — remont mostu');
  await tenders.saveSummary(id, { czego_dotyczy: 'Remont mostu.', dokumenty: [], na_co_uwaga: '', ocena: '' });

  // Właściciel dostaje wyjaśnienie…
  const wlasciciel = await (await fetch(`${BAZA}/matches/${id}/streszczenie`, { headers: auth(a) })).json();
  assert.match(wlasciciel.streszczenie.czego_dotyczy, /mostu/);

  // …a obcy user NIE (dopasowanie w jego subkolekcji nie istnieje → 404).
  const b = await konto();
  const obcy = await fetch(`${BAZA}/matches/${id}/streszczenie`, { headers: auth(b) });
  assert.equal(obcy.status, 404, 'cudzego dopasowania nie da się zaadresować');
});
