import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Runda 30 (krytyk kompletności): ścieżki PIENIĘDZY w webhookach nie miały testów —
 * testowana była czysta tabela tierPrzetargAi i wystawFakture, ale nie OKABLOWANIE:
 * aktywacja planu po checkoutcie, faktura za odnowienie, degradacja planu
 * i inwarianty kolejności claim → handleEvent → markDone.
 */

process.env.ANTHROPIC_API_KEY = '';
// Fakturownia „skonfigurowana" — testy sterują jej odpowiedziami atrapą fetch.
process.env.FAKTUROWANIE_ENABLED = 'true';
process.env.FAKTUROWNIA_API_KEY = 'test-key';
process.env.FAKTUROWNIA_DOMAIN = 'test-domena';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, faktury, stripeEvents, tenders, matches } = await import('../src/db/repos.js');
const { handleEvent, przetworzZdarzenie } = await import('../src/routes/webhooks.js');

let seq = 0;
async function dodajUsera(extra = {}) {
  seq++;
  const u = await users.create({
    email: `wp${process.pid}-${seq}@t.pl`,
    passwordHash: 'h',
    keywords: ['test'],
    ...extra,
  });
  return users.findById(u.id);
}

const oryginalnyFetch = globalThis.fetch;
let wywolaniaFakturowni = 0;
afterEach(() => { globalThis.fetch = oryginalnyFetch; wywolaniaFakturowni = 0; });

function fakturowniaDziala() {
  globalThis.fetch = async (url, opts) => {
    wywolaniaFakturowni++;
    return { ok: true, json: async () => ({ id: seq, number: `FV/${seq}` }), _opts: opts };
  };
}

// ---------------- checkout.session.completed ----------------

test('checkout NIEOPŁACONY (przelew w drodze) nie aktywuje planu ani faktury', async () => {
  const user = await dodajUsera();
  const sesja = `cs_unpaid_${process.pid}`;
  fakturowniaDziala();

  await handleEvent({
    type: 'checkout.session.completed',
    data: { object: { id: sesja, payment_status: 'unpaid', client_reference_id: user.id } },
  });

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'free', 'aktywacja przed zapłatą = subskrypcja za darmo');
  assert.equal(wywolaniaFakturowni, 0, 'faktura bez pieniędzy to błąd księgowy');
  assert.equal(await faktury.zarezerwuj(sesja), true, 'rezerwacja faktury nie może być spalona');
});

test('checkout no_payment_required (kupon 100% / trial) AKTYWUJE Standard', async () => {
  // Regresja 2026-07-29: warunek `!== paid` traktował `no_payment_required` jak brak
  // płatności i NIE aktywował — klient z pełnym rabatem/trialem zostawał na Free na zawsze,
  // mimo poprawnej subskrypcji w Stripe. `no_payment_required` = płatna sesja bez kwoty.
  const user = await dodajUsera();
  fakturowniaDziala();

  await handleEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_npr_${process.pid}`,
        payment_status: 'no_payment_required',
        client_reference_id: user.id,
        customer: 'cus_npr',
        subscription: 'sub_npr',
        amount_total: 0,
      },
    },
  });

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'standard',
    'no_payment_required MUSI aktywować Standard — to prawidłowa płatna sesja, nie brak zapłaty');
  // Decyzja właściciela 2026-07-29: przy 0 zł NIE wystawiamy faktury (brak zapłaty).
  assert.equal(wywolaniaFakturowni, 0, 'kwota 0 zł → żadnego wywołania Fakturowni');
});

test('checkout OPŁACONY aktywuje Standard, zapisuje Stripe ID i wystawia fakturę raz', async () => {
  const user = await dodajUsera();
  const sesja = `cs_paid_${process.pid}`;
  fakturowniaDziala();

  /*
   * INCYDENT PRODUKCYJNY 2026-07-10: klient kupił Standard i feed dalej pokazywał
   * 5 dopasowań — aktywacja NIE przeliczała dopasowań, różnica pojawiłaby się
   * dopiero przy kolejnym cronie. Aktywacja MUSI dowieźć feed od razu.
   */
  for (let i = 0; i < 7; i++) {
    await tenders.upsert({
      externalId: `wp-akt-${process.pid}-${i}`,
      title: `Przetarg testowy pakietu numer ${i}`,
      organization: 'Gmina',
      deadline: '2099-01-01T00:00:00.000Z',
    });
  }
  tenders.odswiezPule();

  await handleEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sesja,
        payment_status: 'paid',
        client_reference_id: user.id,
        customer: 'cus_wp1',
        subscription: 'sub_wp1',
        amount_total: 24477,
      },
    },
  });

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'standard');
  assert.equal(po.stripe_customer_id, 'cus_wp1');
  assert.equal(po.stripe_subscription_id, 'sub_wp1');
  assert.equal(wywolaniaFakturowni, 1);
  assert.equal(await faktury.zarezerwuj(sesja), false, 'druga faktura za tę sesję niemożliwa');

  const feed = await matches.listForUser(user.id, 20);
  assert.ok(feed.length >= 7,
    `po zakupie Standard feed ma być pełny OD RAZU (jest ${feed.length}, oczekiwano ≥7) — klient zapłacił i patrzy`);
});

test('checkout z nieistniejącym userem NIE rzuca (trwały błąd danych — ponowienia nic nie dadzą)', async () => {
  fakturowniaDziala();
  await handleEvent({
    type: 'checkout.session.completed',
    data: { object: { id: `cs_ghost_${process.pid}`, payment_status: 'paid', client_reference_id: 'nie-ma-takiego' } },
  });
  assert.equal(wywolaniaFakturowni, 0);
});

test('checkout Fittera jest ignorowany (obsługuje go backend Railway)', async () => {
  const user = await dodajUsera();
  fakturowniaDziala();
  await handleEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_fit_${process.pid}`,
        payment_status: 'paid',
        client_reference_id: user.id,
        metadata: { project: 'fitter-welder' },
      },
    },
  });
  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'free', 'zdarzenie Fittera nie może zmieniać usera PrzetargAI');
  assert.equal(wywolaniaFakturowni, 0);
});

// ---------------- invoice.paid (odnowienia) ----------------

test('invoice.paid z billing_reason=subscription_create NIE wystawia faktury (obsłużył ją checkout)', async () => {
  /*
   * Przy PIERWSZEJ płatności Stripe dostarcza OBA zdarzenia: checkout.session.completed
   * i invoice.paid(subscription_create). Klucze idempotencji są RÓŻNE (cs_… vs in_…),
   * więc rejestr faktur ich nie zdeduplikuje — chroni wyłącznie ta gałąź.
   */
  await dodajUsera(); // szum w bazie
  const faktura = `in_create_${process.pid}`;
  fakturowniaDziala();

  await handleEvent({
    type: 'invoice.paid',
    data: { object: { id: faktura, billing_reason: 'subscription_create', customer: 'cus_wp1', amount_paid: 24477 } },
  });

  assert.equal(wywolaniaFakturowni, 0, 'PODWÓJNA FAKTURA: create obsługuje checkout, nie invoice.paid');
  assert.equal(await faktury.zarezerwuj(faktura), true, 'rezerwacja nietknięta');
});

test('invoice.paid z billing_reason=subscription_cycle wystawia fakturę odnowienia dokładnie raz', async () => {
  const user = await dodajUsera();
  await users.setStripeCustomer(user.id, `cus_cycle_${process.pid}`);
  const faktura = `in_cycle_${process.pid}`;
  fakturowniaDziala();

  const zdarzenie = {
    type: 'invoice.paid',
    data: { object: { id: faktura, billing_reason: 'subscription_cycle', customer: `cus_cycle_${process.pid}`, amount_paid: 24477 } },
  };
  await handleEvent(zdarzenie);
  assert.equal(wywolaniaFakturowni, 1, 'faktura za odnowienie MUSI powstać');

  // Powtórna dostawa tego samego zdarzenia (Stripe = „co najmniej raz").
  await handleEvent(zdarzenie);
  assert.equal(wywolaniaFakturowni, 1, 'powtórka nie może wystawić drugiej faktury');
});

test('invoice.paid dla nieznanego klienta NIE rzuca (log zamiast pętli ponowień)', async () => {
  fakturowniaDziala();
  await handleEvent({
    type: 'invoice.paid',
    data: { object: { id: `in_ghost_${process.pid}`, billing_reason: 'subscription_cycle', customer: 'cus_ghost', amount_paid: 1 } },
  });
  assert.equal(wywolaniaFakturowni, 0);
});

// ---------------- degradacja i przywrócenie planu ----------------

test('subscription.updated: niepłacący traci Standard, płacący go odzyskuje', async () => {
  const user = await dodajUsera();
  const cus = `cus_deg_${process.pid}`;
  await users.setStripeCustomer(user.id, cus);
  await users.setTier(user.id, 'standard');

  await handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_d', customer: cus, status: 'unpaid' } } });
  assert.equal((await users.findById(user.id)).premium_tier, 'free',
    'klient, który przestał płacić, NIE może zachować planu w nieskończoność');

  await handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_d', customer: cus, status: 'active' } } });
  assert.equal((await users.findById(user.id)).premium_tier, 'standard', 'opłacona subskrypcja wraca');
});

test('subscription.updated Fittera nie dotyka usera PrzetargAI', async () => {
  const user = await dodajUsera();
  const cus = `cus_fit2_${process.pid}`;
  await users.setStripeCustomer(user.id, cus);
  await users.setTier(user.id, 'standard');

  await handleEvent({
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_f', customer: cus, status: 'unpaid', metadata: { project: 'fitter-welder' } } },
  });
  assert.equal((await users.findById(user.id)).premium_tier, 'standard');
});

test('subscription.deleted: powrót do Free i czyszczenie identyfikatora subskrypcji', async () => {
  const user = await dodajUsera();
  const cus = `cus_del_${process.pid}`;
  await users.setStripeCustomer(user.id, cus);
  await users.setStripeSubscription(user.id, 'sub_del');
  await users.setTier(user.id, 'standard');

  await handleEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_del', customer: cus } } });

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'free');
  assert.equal(po.stripe_subscription_id, null, 'martwy identyfikator subskrypcji musi zniknąć');
});

// ---------------- orkiestracja: claim → handleEvent → markDone ----------------

test('ORKIESTRACJA: błąd obsługi zwalnia rezerwację zdarzenia i zwraca 500 (Stripe ponowi)', async () => {
  const user = await dodajUsera();
  const zdarzenie = {
    id: `evt_fail_${process.pid}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_evtfail_${process.pid}`,
        payment_status: 'paid',
        client_reference_id: user.id,
        amount_total: 24477,
      },
    },
  };
  // Fakturownia w awarii → wystawFakture rzuca → handleEvent rzuca.
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'awaria' });

  const wynik = await przetworzZdarzenie(zdarzenie);
  assert.equal(wynik.status, 500, '500 = prośba do Stripe o ponowienie');
  assert.equal(await stripeEvents.claim(zdarzenie.id, zdarzenie.type), true,
    'rezerwacja MUSI być zwolniona — inaczej ponowienie zobaczy duplikat i faktura przepadnie');
});

test('ORKIESTRACJA: sukces domyka zdarzenie na stałe — duplikat dostaje ciche 200', async () => {
  const user = await dodajUsera();
  const zdarzenie = {
    id: `evt_ok_${process.pid}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_evtok_${process.pid}`,
        payment_status: 'paid',
        client_reference_id: user.id,
        amount_total: 24477,
      },
    },
  };
  fakturowniaDziala();

  const pierwszy = await przetworzZdarzenie(zdarzenie);
  assert.equal(pierwszy.status, 200);

  const drugi = await przetworzZdarzenie(zdarzenie);
  assert.equal(drugi.status, 200);
  assert.equal(drugi.body.duplicate, true, 'powtórna dostawa = duplikat');
  assert.equal(wywolaniaFakturowni, 1, 'duplikat nie może wystawić drugiej faktury');
});

test('ORKIESTRACJA: błąd markDone NIE zwalnia rezerwacji (mniejsze zło niż gwarantowany dubel)', async () => {
  const user = await dodajUsera();
  const zdarzenie = {
    id: `evt_markfail_${process.pid}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_markfail_${process.pid}`,
        payment_status: 'paid',
        client_reference_id: user.id,
        amount_total: 24477,
      },
    },
  };
  fakturowniaDziala();

  const oryginalnyMarkDone = stripeEvents.markDone;
  stripeEvents.markDone = async () => { throw new Error('Firestore niedostępny'); };
  try {
    const wynik = await przetworzZdarzenie(zdarzenie);
    assert.equal(wynik.status, 200, 'obsługa się udała — klient jest aktywowany');
    assert.equal(await stripeEvents.claim(zdarzenie.id, zdarzenie.type), false,
      'rezerwacja MUSI zostać: release po błędzie markDone = pewna druga faktura');
  } finally {
    stripeEvents.markDone = oryginalnyMarkDone;
  }
});
