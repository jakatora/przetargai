import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow';
process.env.AI_BUDGET_SOFT_USD = '1000000';
process.env.AI_BUDGET_HARD_USD = '2000000';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

/*
 * SDK Anthropica zapamiętuje `globalThis.fetch` przy imporcie — atrapa musi stanąć
 * wcześniej (wzór: matchingAi.test.js). Ruch bez ustawionej odpowiedzi idzie dalej.
 */
let odpowiedz = null;
let ostatnieZapytanie = null;
const oryginalnyFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!odpowiedz) return oryginalnyFetch(url, opts);
  ostatnieZapytanie = JSON.parse(opts.body);
  return odpowiedz();
};
afterEach(() => { odpowiedz = null; ostatnieZapytanie = null; });

const { ocenDlaKlienta, porownajWarunki } = await import('../src/services/ai.js');
const { getFirestore } = await import('firebase-admin/firestore');

function model(tekst, status = 200) {
  odpowiedz = () => new Response(JSON.stringify(status === 200 ? {
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: tekst }], stop_reason: 'end_turn', usage: { input_tokens: 700, output_tokens: 100 },
  } : { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }),
  { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u-ai-sel', keywords: ['dach'], karta: { formalne: { obrot_roczny: 8e5 } } };

test('ocenDlaKlienta: werdykt + koszt zapisany pod operacją pracownik_ocena', async () => {
  model('{"decyzja":"biore","przyczyna":null,"punkty":["Dachy"],"score":81}');
  const w = await ocenDlaKlienta(USER, { title: 'Remont dachu' }, { zapisane: [], odrzucone: [] }, { teraz: '2026-10-21T10:00:00.000Z' });
  assert.deepEqual(w, { decyzja: 'biore', przyczyna: null, punkty: ['Dachy'], score: 81 });
  assert.match(ostatnieZapytanie.system, /realnie może startować/);
  assert.match(ostatnieZapytanie.messages[0].content, /<przetarg>/);
  const wpisy = await getFirestore().collection('ai_usage').where('operation', '==', 'pracownik_ocena').get();
  assert.ok(wpisy.docs.some((d) => d.data().user_id === 'u-ai-sel'));
});

test('ocenDlaKlienta: nieczytelna odpowiedź i błąd API → null', async () => {
  model('nie wiem');
  assert.equal(await ocenDlaKlienta(USER, { title: 'X' }, undefined), null);
  model('', 400);
  assert.equal(await ocenDlaKlienta(USER, { title: 'X' }, undefined), null);
});

test('porownajWarunki: werdykt po normalizacji', async () => {
  model('{"werdykt":"nie_spelniasz","wymagania":[{"rodzaj":"obrot","wymog":"Obrót 2 mln","status":"brak","komentarz":"Masz 800 tys."}]}');
  const w = await porownajWarunki(USER, 'Obrót min. 2 mln zł');
  assert.equal(w.werdykt, 'nie_spelniasz');
  assert.match(ostatnieZapytanie.messages[0].content, /<warunki>/);
});
