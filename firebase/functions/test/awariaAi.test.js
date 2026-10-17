import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * CICHA AWARIA AI — okablowanie: ai.js → licznik przebiegu → ślad cyklu → /health → mail.
 *
 * Od 2026-10-12 każde wywołanie AI w `dailyTenderFetch` dostawało 400 „credit balance
 * is too low". Kod łapał błąd, zwracał null, matching jechał na heurystyce, a `/health`
 * przez 6 dni mówił `status: ok`. Ten plik sprawdza, że taka awaria jest teraz
 * policzona, zapisana w śladzie, widoczna w `/health` (503) i zgłoszona mailem
 * najwyżej raz na dobę. Czysta logika liczników: stanAi.test.js.
 *
 * Budżet miesięczny AI jest wspólny dla całej bazy emulatora (ai.test.js przepala go
 * do >900 USD) — zawyżamy limity w TYM procesie, jak matchingAi.test.js.
 */
process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow';
process.env.AI_BUDGET_SOFT_USD = '1000000';
process.env.AI_BUDGET_HARD_USD = '2000000';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

/*
 * SDK Anthropica zapamiętuje `globalThis.fetch` przy imporcie — atrapa musi stanąć
 * wcześniej. Przechwytujemy WYŁĄCZNIE ruch do Anthropica: ten plik odpytuje też
 * lokalny serwer `/health` przez fetch.
 */
let odpowiedzAi = null;
const oryginalnyFetch = globalThis.fetch;
globalThis.fetch = async (url, ...reszta) => {
  if (odpowiedzAi && String(url?.url ?? url).includes('anthropic.com')) return odpowiedzAi();
  return oryginalnyFetch(url, ...reszta);
};

const { scoreTenderMatch } = await import('../src/services/ai.js');
const { pustyLicznikAi, zbierajStatystykiAi } = await import('../src/lib/stanAi.js');
const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');
const { alarmujAwarieAi } = await import('../src/jobs/alarmAi.js');
const { cykl, users, alarmAi } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { getFirestore } = await import('firebase-admin/firestore');

afterEach(() => { odpowiedzAi = null; });

after(async () => {
  // Ślad z awarią AI zapaliłby /health na czerwono w kolejnych plikach testów.
  await getFirestore().collection('_health').doc('daily_cycle').delete();
  await getFirestore().collection('_health').doc('alarm_ai').delete();
});

const BRAK_KREDYTOW = 'Your credit balance is too low to access the Anthropic API. '
  + 'Please go to Plans & Billing to upgrade or purchase credits.';

/** Odpowiedź błędu Anthropica w kształcie z produkcji (status + ciało `{type:'error', error:{…}}`). */
function bladAnthropica(status, typ, komunikat) {
  odpowiedzAi = () => new Response(JSON.stringify({
    type: 'error', error: { type: typ, message: komunikat }, request_id: 'req_test',
  }), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
}

function modelOdpowiada(tekst) {
  odpowiedzAi = () => new Response(JSON.stringify({
    id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: tekst }], stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 50 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function zapytajHealth() {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await oryginalnyFetch(`http://127.0.0.1:${port}/health`);
    return { status: res.status, cialo: await res.json() };
  } finally {
    serwer.close();
  }
}

const FIRMA = { id: 'u-awaria-ai', company_name: 'Brukarz', keywords: ['kostka'], cpv_codes: [] };
const PRZETARG = { title: 'Ułożenie kostki brukowej', organization: 'Gmina', cpv_main: '45233222' };

// ---------------- ai.js zgłasza wynik każdej próby ----------------

test('KRYTYCZNE: 400 „credit balance is too low" z API trafia do licznika jako brak kredytów', async () => {
  const licznik = pustyLicznikAi();
  bladAnthropica(400, 'invalid_request_error', BRAK_KREDYTOW);

  const ocena = await zbierajStatystykiAi(licznik, () => scoreTenderMatch(FIRMA, PRZETARG));

  assert.equal(ocena, null, 'zachowanie dla matchingu bez zmian: null → heurystyka');
  assert.equal(licznik.nieudane, 1);
  assert.equal(licznik.udane, 0);
  assert.deepEqual(licznik.bledy_wg_typu, { kredyty: 1 });
  assert.equal(licznik.ostatni_blad.typ, 'kredyty');
  assert.equal(licznik.ostatni_blad.status, 400);
  assert.match(licznik.ostatni_blad.komunikat, /credit balance is too low/);
});

test('401 z API to autoryzacja', async () => {
  const licznik = pustyLicznikAi();
  bladAnthropica(401, 'authentication_error', 'invalid x-api-key');
  await zbierajStatystykiAi(licznik, () => scoreTenderMatch(FIRMA, PRZETARG));
  assert.deepEqual(licznik.bledy_wg_typu, { autoryzacja: 1 });
});

test('udana ocena liczy się jako sukces, nieczytelna odpowiedź jako porażka', async () => {
  const licznik = pustyLicznikAi();
  await zbierajStatystykiAi(licznik, async () => {
    modelOdpowiada('{"score": 80, "reasoning": "Pasuje."}');
    assert.equal((await scoreTenderMatch(FIRMA, PRZETARG))?.score, 80);
    modelOdpowiada('Nie potrafię tego ocenić.');
    assert.equal(await scoreTenderMatch(FIRMA, PRZETARG), null);
  });
  assert.equal(licznik.udane, 1);
  assert.equal(licznik.nieudane, 1);
  assert.deepEqual(licznik.bledy_wg_typu, { nieczytelna_odpowiedz: 1 });
  assert.ok(licznik.ostatni_sukces_o);
});

// ---------------- cron → ślad → /health ----------------

let seq = 0;
/** Użytkownik i ogłoszenie, dla których heurystyka (~25) przechodzi prefiltr AI (15). */
async function przebiegZKandydatemAi(opcje) {
  seq++;
  await users.create({
    email: `awaria-ai-${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: [], cpvCodes: ['45000000'],
  });
  const ogloszenie = {
    externalId: `awaria-ai-${process.pid}-${seq}`,
    title: `Przebudowa mostu w ciągu drogi ${process.pid}-${seq}`,
    organization: 'Gmina Testowa',
    deadline: '2099-01-01T00:00:00.000Z',
    cpvMain: '45233222-1 (Roboty w zakresie chodników)',
  };
  return runTenderFetch({ zrodla: [{ nazwa: 'bzp', pobierz: async () => [ogloszenie] }], ...opcje });
}

test('KRYTYCZNE: cykl przy zerowych kredytach — ślad, /health 503 z sekcją ai i alarm', async () => {
  await getFirestore().collection('_health').doc('daily_cycle').delete();
  const alarmy = [];
  bladAnthropica(400, 'invalid_request_error', BRAK_KREDYTOW);

  const wynik = await przebiegZKandydatemAi({ alarmujAi: async (ai) => { alarmy.push(ai); } });

  assert.equal(wynik.ok, true, 'awaria AI nie wywraca cyklu — pobieranie i dopasowania działają');
  assert.equal(wynik.ai.wlaczone, true);
  assert.ok(wynik.ai.nieudane >= 1, `oczekiwano porażek AI, jest ${JSON.stringify(wynik.ai)}`);
  assert.equal(wynik.ai.udane, 0);
  assert.equal(wynik.ai.ostatni_blad.typ, 'kredyty');

  const slad = await cykl.ostatniPrzebieg();
  assert.equal(slad.wynik.ai.ostatni_blad.typ, 'kredyty', 'licznik zapisany tam, gdzie cron.ostatni_wynik');
  assert.equal(slad.ai.ostatni_blad.typ, 'kredyty', 'i w trwałej historii');

  assert.equal(alarmy.length, 1, 'cykl musi przekazać statystyki AI do alarmu');
  assert.equal(alarmy[0].bledy_wg_typu.kredyty, wynik.ai.nieudane);

  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 503, 'monitoring patrzy na kod odpowiedzi — awaria AI MUSI go zmienić');
  assert.equal(cialo.status, 'degraded');
  assert.equal(cialo.cron.ok, true, 'cron biegł — problemem jest wyłącznie AI');
  assert.equal(cialo.ai.ok, false);
  assert.equal(cialo.ai.udane, 0);
  assert.equal(cialo.ai.nieudane, wynik.ai.nieudane);
  assert.equal(cialo.ai.ostatni_blad.typ, 'kredyty');
  assert.match(cialo.ai.ostatni_blad.komunikat, /credit balance/);
  assert.equal(cialo.ai.ostatni_sukces_o, null, 'AI nie zadziałało ani razu od czystego śladu');
});

test('po doładowaniu: AI działa → 200, a historia pamięta ostatni błąd', async () => {
  modelOdpowiada('{"score": 30, "reasoning": "Słabe dopasowanie."}');

  const wynik = await przebiegZKandydatemAi({ alarmujAi: async () => {} });
  assert.ok(wynik.ai.udane >= 1);
  assert.equal(wynik.ai.nieudane, 0);

  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200, JSON.stringify(cialo.ai));
  assert.equal(cialo.ai.ok, true);
  assert.ok(cialo.ai.ostatni_sukces_o);
  assert.equal(cialo.ai.ostatni_blad?.typ, 'kredyty', 'wczorajszy błąd zostaje w historii — z datą');
});

test('awaria samego alarmu nie wywraca cyklu', async () => {
  bladAnthropica(400, 'invalid_request_error', BRAK_KREDYTOW);
  const wynik = await przebiegZKandydatemAi({ alarmujAi: async () => { throw new Error('Resend leży'); } });
  assert.equal(wynik.ok, true);
});

test('ślad sprzed tej zmiany (bez pola ai) nie zapala alarmu', async () => {
  await getFirestore().collection('_health').doc('daily_cycle').set({
    zakonczony_o: new Date().toISOString(), wynik: { ok: true, matchesCreated: 1 },
  });
  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200);
  assert.equal(cialo.ai.ok, null);
  assert.equal(cialo.ai.udane, null);
});

// ---------------- mail alarmowy: najwyżej raz na dobę ----------------

const AI_BEZ_KREDYTOW = {
  udane: 0, nieudane: 97, bledy_wg_typu: { kredyty: 97 },
  ostatni_blad: { typ: 'kredyty', status: 400, komunikat: BRAK_KREDYTOW, o: '2026-10-17T10:05:00.000Z' },
};

async function wyczyscZnacznik() {
  await getFirestore().collection('_health').doc('alarm_ai').delete();
}

function atrapaWysylki({ udana = true } = {}) {
  const wyslane = [];
  const wyslij = async (mail) => { wyslane.push(mail); return udana ? { sent: true, id: 'em_1' } : { sent: false, error: 'boom' }; };
  return { wyslane, wyslij };
}

test('KRYTYCZNE alarm: brak kredytów → mail do właściciela z treścią błędu i co zrobić', async () => {
  await wyczyscZnacznik();
  const { wyslane, wyslij } = atrapaWysylki();

  const wynik = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz: new Date('2026-10-17T10:10:00Z') });

  assert.equal(wynik.wyslano, true);
  assert.equal(wyslane.length, 1);
  assert.equal(wyslane[0].to, 'jakatora68@gmail.com');
  assert.match(wyslane[0].subject, /kredyty/i);
  assert.match(wyslane[0].text, /credit balance is too low/);
  assert.match(wyslane[0].text, /Plans & Billing/);
  assert.match(wyslane[0].text, /\/health/);
  assert.match(wyslane[0].html, /97/);
  assert.doesNotMatch(wyslane[0].html, /Plans & Billing/, 'HTML musi mieć encje (&amp;)');

  const znacznik = await alarmAi.wczytaj();
  assert.equal(znacznik.stan, 'wyslany');
  assert.equal(znacznik.dzien, '2026-10-17');
});

test('KRYTYCZNE alarm: ten sam dzień (ponowienie crona) — drugi mail NIE idzie, następny dzień — idzie', async () => {
  await wyczyscZnacznik();
  const { wyslane, wyslij } = atrapaWysylki();

  await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz: new Date('2026-10-17T10:10:00Z') });
  const drugi = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz: new Date('2026-10-17T21:30:00Z') });
  assert.equal(drugi.wyslano, false);
  assert.equal(drugi.powod, 'juz_wyslany_dzis');
  assert.equal(wyslane.length, 1);

  // Doba liczona w czasie polskim: 22:30 UTC 17.10 to już 18.10 w Warszawie.
  const nazajutrz = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz: new Date('2026-10-17T22:30:00Z') });
  assert.equal(nazajutrz.wyslano, true);
  assert.equal(wyslane.length, 2);
});

test('alarm: nieudana wysyłka zwalnia znacznik — ponowienie dosyła', async () => {
  await wyczyscZnacznik();
  const teraz = new Date('2026-10-17T10:10:00Z');

  const pierwsza = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij: atrapaWysylki({ udana: false }).wyslij, teraz });
  assert.equal(pierwsza.wyslano, false);
  assert.equal(pierwsza.powod, 'wysylka_nieudana');

  const { wyslane, wyslij } = atrapaWysylki();
  const ponowienie = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz });
  assert.equal(ponowienie.wyslano, true);
  assert.equal(wyslane.length, 1);
});

test('alarm: wyjątek wysyłki też zwalnia znacznik', async () => {
  await wyczyscZnacznik();
  const teraz = new Date('2026-10-17T10:10:00Z');
  const wynik = await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij: async () => { throw new Error('ETIMEDOUT'); }, teraz });
  assert.equal(wynik.wyslano, false);
  const { wyslane, wyslij } = atrapaWysylki();
  await alarmujAwarieAi(AI_BEZ_KREDYTOW, { wyslij, teraz });
  assert.equal(wyslane.length, 1);
});

test('alarm: autoryzacja też wysyła, limit i przeciążenie — nie (mijają same)', async () => {
  await wyczyscZnacznik();
  const { wyslane, wyslij } = atrapaWysylki();
  const teraz = new Date('2026-10-17T10:10:00Z');

  const limit = await alarmujAwarieAi({ udane: 0, nieudane: 40, bledy_wg_typu: { limit: 30, przeciazenie: 10 } }, { wyslij, teraz });
  assert.equal(limit.wyslano, false);
  assert.equal(limit.powod, 'brak_bledu_krytycznego');
  assert.equal(await alarmAi.wczytaj(), null, 'bez błędu krytycznego znacznik nie powstaje');

  const klucz = await alarmujAwarieAi({
    udane: 0, nieudane: 5, bledy_wg_typu: { autoryzacja: 5 },
    ostatni_blad: { typ: 'autoryzacja', status: 401, komunikat: 'invalid x-api-key' },
  }, { wyslij, teraz });
  assert.equal(klucz.wyslano, true);
  assert.match(wyslane[0].text, /ANTHROPIC_API_KEY/);
});

test('alarm: brak statystyk AI (ślad bez dopasowań) nie wysyła niczego', async () => {
  const { wyslane, wyslij } = atrapaWysylki();
  assert.equal((await alarmujAwarieAi(undefined, { wyslij })).wyslano, false);
  assert.equal(wyslane.length, 0);
});
