import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Audyt 2026-07-10 (HIGH): CAŁA płatna gałąź silnika — `services/ai.js` i ścieżka
 * `scorer === 'ai'` w matching.js — nie miała ŻADNEGO testu. Każdy test wyłączał AI
 * (`ANTHROPIC_API_KEY = ''`), więc pokrycie kończyło się na heurystyce.
 *
 * Tu włączamy klucz-atrapę i podmieniamy warstwę sieci, żeby przejść ścieżkę
 * płatną BEZ dotykania prawdziwego API.
 */
process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow';
process.env.AI_BUDGET_SOFT_USD = '200';
process.env.AI_BUDGET_HARD_USD = '500';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

/*
 * SDK Anthropica zapamiętuje `globalThis.fetch` w momencie ładowania modułu, więc
 * podmiana po imporcie nie zadziała. Instalujemy stałą atrapę PRZED importem i
 * sterujemy jej zachowaniem zmienną `nastepnaOdpowiedz`.
 */
let nastepnaOdpowiedz = null;
const oryginalnyFetch = globalThis.fetch;

globalThis.fetch = async (...args) => {
  if (!nastepnaOdpowiedz) return oryginalnyFetch(...args); // ruch do emulatora Firestore
  const reakcja = nastepnaOdpowiedz;
  return reakcja();
};

const { parseScore, scoreTenderMatch, budgetStatus } = await import('../src/services/ai.js');
const { aiUsage } = await import('../src/db/repos.js');

afterEach(() => { nastepnaOdpowiedz = null; });

/** Atrapa odpowiedzi Anthropica w kształcie, jakiego oczekuje SDK. */
function odpowiedzModelu(tekst, { inputTokens = 1000, outputTokens = 50 } = {}) {
  nastepnaOdpowiedz = () => new Response(JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: tekst }],
    stop_reason: 'end_turn',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const FIRMA = { id: 'u-test', company_name: 'Brukarz', keywords: ['kostka'], cpv_codes: [] };
const PRZETARG = { title: 'Ułożenie kostki brukowej', organization: 'Gmina', cpv_main: '45233222' };

// ---------------- parseScore: tekst od modelu bywa nieprzewidywalny ----------------

test('parseScore — czysty JSON', () => {
  const r = parseScore('{"score": 87, "reasoning": "Trafienie w kostkę brukową."}');
  assert.equal(r.score, 87);
  assert.match(r.reasoning, /kostk/i);
});

test('parseScore — JSON otoczony prozą (model lubi tłumaczyć)', () => {
  const r = parseScore('Oto moja ocena:\n{"score": 42, "reasoning": "Słabe dopasowanie."}\nMam nadzieję, że pomogłem.');
  assert.equal(r.score, 42);
});

test('parseScore — wynik poza zakresem jest PRZYCINANY, nie odrzucany', () => {
  assert.equal(parseScore('{"score": 150, "reasoning": "x"}').score, 100);
  assert.equal(parseScore('{"score": -20, "reasoning": "x"}').score, 0);
});

test('parseScore — wynik ułamkowy jest zaokrąglany', () => {
  assert.equal(parseScore('{"score": 66.7, "reasoning": "x"}').score, 67);
});

test('parseScore — brak JSON-a, zły JSON i brak liczby dają null (degradacja do heurystyki)', () => {
  assert.equal(parseScore('Nie potrafię ocenić tego przetargu.'), null);
  assert.equal(parseScore('{"score": to nie liczba}'), null);
  assert.equal(parseScore('{"reasoning": "bez oceny"}'), null);
  assert.equal(parseScore(''), null);
});

test('parseScore — bardzo długie uzasadnienie jest ucinane (limit dokumentu)', () => {
  const r = parseScore(`{"score": 50, "reasoning": "${'x'.repeat(2000)}"}`);
  assert.ok(r.reasoning.length <= 800);
});

// ---------------- scoreTenderMatch: ścieżka płatna ----------------

test('scoreTenderMatch — udane wywołanie zwraca ocenę i KSIĘGUJE koszt z user_id', async () => {
  const przed = await aiUsage.monthCostUsd();
  odpowiedzModelu('{"score": 91, "reasoning": "Idealne dopasowanie."}', { inputTokens: 2000, outputTokens: 100 });

  const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
  assert.equal(wynik.score, 91);

  const po = await aiUsage.monthCostUsd();
  assert.ok(po > przed, 'koszt musi zostać zaksięgowany');

  // 2000 tokenów wejścia ($1/MTok) + 100 wyjścia ($5/MTok) = 0.0025 USD
  assert.ok(Math.abs((po - przed) - 0.0025) < 1e-6, `zaksięgowano ${(po - przed).toFixed(6)} USD`);
});

test('scoreTenderMatch — bełkot modelu degraduje do null, ale koszt i tak księgujemy', async () => {
  const przed = await aiUsage.monthCostUsd();
  odpowiedzModelu('Przepraszam, nie mogę tego ocenić.');

  const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
  assert.equal(wynik, null, 'nieparsowalna odpowiedź = degradacja do heurystyki');

  const po = await aiUsage.monthCostUsd();
  assert.ok(po > przed, 'Anthropic policzył sobie za tę odpowiedź — my też musimy');
});

test('scoreTenderMatch — awaria sieci zwraca null zamiast wywracać cykl', async () => {
  nastepnaOdpowiedz = () => { throw new Error('ECONNRESET'); };
  const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
  assert.equal(wynik, null);
});

/*
 * Runda 30: gałąź MIĘKKIEGO limitu nie miała testu. Pomylenie soft/hard przy
 * refaktoryzacji (return w gałęzi soft) po cichu wyłącza AI już przy 200 USD
 * zamiast 500 — płacący użytkownicy dostają dopasowania samą heurystyką.
 * Kolejność testów w tym pliku MA znaczenie: budżet miesiąca jest wspólny,
 * więc soft (300 USD) musi biec przed twardym (600 USD).
 */
test('miękki limit ALARMUJE, ale NIE blokuje wywołań AI', async () => {
  await aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', costUsd: 300, userId: null });

  const status = await budgetStatus({ swiezy: true }); // odśwież wspólny cache modułu
  assert.equal(status.softExceeded, true, 'warunek wstępny: 300 USD > miękki 200');
  assert.equal(status.hardExceeded, false, 'warunek wstępny: 300 USD < twardy 500');

  const alarmy = [];
  const oryginalnyError = console.error;
  console.error = (tekst) => alarmy.push(String(tekst));
  try {
    odpowiedzModelu('{"score": 55, "reasoning": "Ocena mimo miękkiego limitu."}');
    const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
    assert.equal(wynik?.score, 55, 'miękki limit NIE może wyłączać ocen AI');
  } finally {
    console.error = oryginalnyError;
  }
  assert.ok(alarmy.some((a) => a.includes('miękki')), 'alarm o miękkim limicie musi wyjść do Error Reporting');
});

test('alarm TWARDY nie jest zagłuszany godzinnym dławieniem alarmu miękkiego', async () => {
  // Chwilę temu poszedł alarm miękki. Wspólny licznik dławienia wyciszyłby
  // teraz alarm twardy — ten jedyny, który znaczy „AI właśnie przestało działać".
  await aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', costUsd: 600, userId: null });
  const status = await budgetStatus({ swiezy: true });
  assert.equal(status.hardExceeded, true);

  const alarmy = [];
  const oryginalnyError = console.error;
  console.error = (tekst) => alarmy.push(String(tekst));
  try {
    const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
    assert.equal(wynik, null);
  } finally {
    console.error = oryginalnyError;
  }
  assert.ok(alarmy.some((a) => a.includes('twardy')),
    'dławienie alarmów musi być OSOBNE per rodzaj — wspólne wycisza najważniejszy sygnał');
});

test('KRYTYCZNE: po przekroczeniu twardego limitu budżetu AI nie jest wołane wcale', async () => {
  // Przepalamy budżet ponad twardy limit ($500).
  await aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', costUsd: 600, userId: null });

  let wywolano = false;
  nastepnaOdpowiedz = () => { wywolano = true; throw new Error('nie powinno dojść do wywołania'); };

  const status = await budgetStatus({ swiezy: true });
  assert.equal(status.hardExceeded, true);

  const wynik = await scoreTenderMatch(FIRMA, PRZETARG);
  assert.equal(wynik, null);
  assert.equal(wywolano, false, 'bramka budżetu musi zadziałać PRZED wywołaniem sieciowym');
});
