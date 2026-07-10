import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Runda 30: silnik dopasowań z WŁĄCZONYM AI nie miał ani jednego testu —
 * matching.test.js zeruje klucz (features.ai=false), a ai.test.js testuje
 * scoreTenderMatch w izolacji. Tu testujemy OKABLOWANIE obu warstw:
 * decyzję o śladzie (`ocenaOstateczna`), kwotę dobową i nadpisanie oceny.
 *
 * Budżet miesięczny AI jest WSPÓLNY dla całej bazy emulatora, a ai.test.js
 * (osobny proces tej samej sesji `npm test`) przepala go do >900 USD.
 * Zawyżamy limity w TYM procesie, żeby bramka budżetu nie fałszowała wyników.
 */
process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow';
process.env.AI_BUDGET_SOFT_USD = '1000000';
process.env.AI_BUDGET_HARD_USD = '2000000';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

/*
 * SDK Anthropica zapamiętuje `globalThis.fetch` przy imporcie — atrapa musi
 * stanąć wcześniej. Ruch bez ustawionej odpowiedzi leci do emulatora.
 */
let nastepnaOdpowiedz = null;
const oryginalnyFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (!nastepnaOdpowiedz) return oryginalnyFetch(...args);
  return nastepnaOdpowiedz();
};

const { users, tenders, matches, evaluations, aiQuota } = await import('../src/db/repos.js');
const { generateMatchesForUser } = await import('../src/services/matching.js');
const { getFirestore } = await import('firebase-admin/firestore');

afterEach(() => { nastepnaOdpowiedz = null; });

function modelOdpowiada(score, reasoning = 'Ocena testowa modelu.') {
  nastepnaOdpowiedz = () => new Response(JSON.stringify({
    id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify({ score, reasoning }) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 50 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

let seq = 0;
async function dodajPrzetarg(title, extra = {}) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `ma-${process.pid}-${seq}`,
    title,
    organization: 'Gmina Testowa',
    deadline: '2099-01-01T00:00:00.000Z',
    ...extra,
  });
  return tender;
}
async function dodajUsera(keywords) {
  seq++;
  const u = await users.create({ email: `ma${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords });
  return users.findById(u.id);
}

test('awaria AI NIE zostawia śladu — kandydat wróci do modelu jutro', async () => {
  /*
   * Serce naprawy z audytu: ślad w evaluations zamyka kandydatowi drogę powrotną.
   * Zapis śladu przy awarii AI oznaczałby, że jednodniowa usterka Anthropica
   * TRWALE degraduje jakość feedu. Kandydat musi być MIĘDZY prefiltrem (15)
   * a progiem dopasowania (60): sama zgodność działu CPV daje ~25 — AI jest
   * pytane, ale heurystyka nie tworzy dopasowania, więc bez odpowiedzi modelu
   * NIC nie wolno utrwalić.
   */
  seq++;
  const stworzony = await users.create({
    email: `ma${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: [], cpvCodes: ['45000000'],
  });
  const user = await users.findById(stworzony.id);
  const tender = await dodajPrzetarg(`Przebudowa mostu w ciągu drogi ${seq}`, {
    cpvMain: '45233222-1 (Roboty w zakresie chodników)',
  });

  nastepnaOdpowiedz = () => { throw new Error('ECONNRESET'); };
  const wynik = await generateMatchesForUser(user, [tender]);

  assert.equal(wynik.aiCalls, 1, 'próba wywołania AI była (heurystyka ~25 ≥ prefiltr 15)');
  assert.equal(wynik.created, 0, 'heurystyka ~25 < próg 60 — dopasowanie nie powstaje');
  const slady = await evaluations.idsAmong(user.id, [tender.id]);
  // Diagnostyka na wypadek porażki: surowy dokument śladu mówi, KTO go zapisał.
  const surowySlad = slady.has(tender.id)
    ? (await getFirestore().collection('users').doc(user.id)
        .collection('evaluations').doc(tender.id).get()).data()
    : null;
  assert.equal(slady.has(tender.id), false,
    'ślad po awarii AI = przetarg nigdy nie wróci do modelu (trwała degradacja feedu); '
    + `ślad=${JSON.stringify(surowySlad)} wynik=${JSON.stringify(wynik)}`);
  assert.equal(await aiQuota.used(user.id), 1,
    'nieudane wywołanie TEŻ kosztuje — kwota dobowa maleje przy próbie');
});

test('odpowiedź AI NADPISUJE heurystykę (score, scorer, uzasadnienie)', async () => {
  const user = await dodajUsera(['brukarstwo']);
  const tender = await dodajPrzetarg(`Brukarstwo — plac ${seq}`);

  modelOdpowiada(91, 'Profil idealnie pasuje do zamówienia.');
  const wynik = await generateMatchesForUser(user, [tender]);

  assert.equal(wynik.created, 1);
  const lista = await matches.listForUser(user.id, 10);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].scorer, 'ai');
  assert.equal(lista[0].confidence_score, 91);
  assert.match(lista[0].match_reasoning, /idealnie/);
});

test('AI poniżej progu: ślad OSTATECZNY ze scorer=ai, dopasowania brak', async () => {
  const user = await dodajUsera(['brukarstwo']);
  const tender = await dodajPrzetarg(`Brukarstwo — chodnik ${seq}`);

  modelOdpowiada(20, 'Pozornie pasuje, ale to inna branża.');
  const wynik = await generateMatchesForUser(user, [tender]);

  assert.equal(wynik.created, 0, 'AI zawetowało — dopasowanie nie powstaje');
  const slady = await evaluations.idsAmong(user.id, [tender.id]);
  assert.equal(slady.has(tender.id), true,
    'weto modelu JEST ostateczne — bez śladu płacilibyśmy za tę samą ocenę codziennie');
});

test('po wyczerpaniu kwoty dobowej ocena idzie heurystyką i ślad JEST zapisywany', async () => {
  const user = await dodajUsera(['brukarstwo']);
  // Free = 10 wywołań/dobę. Wyczerpujemy kwotę wprost przez repo.
  for (let i = 0; i < 10; i++) await aiQuota.reserve(user.id, 10);

  const tender = await dodajPrzetarg(`Brukarstwo — parking ${seq}`);
  nastepnaOdpowiedz = () => { throw new Error('AI nie może być wołane po wyczerpaniu kwoty'); };

  const wynik = await generateMatchesForUser(user, [tender]);

  assert.equal(wynik.aiCalls, 0, 'kwota wyczerpana = zero prób');
  const slady = await evaluations.idsAmong(user.id, [tender.id]);
  assert.equal(slady.has(tender.id), true,
    'bez AI w zasięgu ocena heurystyczna JEST ostateczna (wartoPytacAi=false) — ślad zapisany');
});

test('kandydat poniżej prefiltra AI (score < 15) nie zużywa kwoty ani sieci', async () => {
  const user = await dodajUsera(['brukarstwo']);
  const tender = await dodajPrzetarg(`Dostawa tonerów do drukarek ${seq}`); // zero trafień

  nastepnaOdpowiedz = () => { throw new Error('prefiltr powinien odciąć to wywołanie'); };
  const wynik = await generateMatchesForUser(user, [tender]);

  assert.equal(wynik.aiCalls, 0, 'słaby kandydat nie może kosztować pieniędzy');
  assert.equal(await aiQuota.used(user.id), 0);
});
