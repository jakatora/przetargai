import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

/*
 * JEDNA SUBSKRYPCJA NA KLIENTA (P2, ścieżka pieniędzy — 2026-09-25).
 *
 * Scenariusz, który ten plik zamyka: bez zapisanego `stripe_customer_id` każda sesja
 * Checkout zakładała NOWEGO klienta Stripe, `/upgrade` patrzył tylko na lokalny
 * `premium_tier`, a webhook nadpisywał identyfikator subskrypcji. Dwie opłacone sesje
 * (albo zakup po zwrocie/chargebacku, gdy plan spadł do Free, a subskrypcja w Stripe
 * żyła) = pierwsza subskrypcja obciąża kartę co miesiąc, rezygnacja i usunięcie konta
 * anulują tylko drugą, a `deleted` starej zdejmuje plan mimo aktywnej nowej.
 *
 * Zdarzenia webhooka idą przez PRAWDZIWĄ trasę HTTP z PODPISEM Stripe (generowanym
 * przez SDK tym samym sekretem, którym trasa weryfikuje) — nie wprost do handleEvent.
 *
 * Stripe jest „skonfigurowany" kluczem-atrapą: każdą metodę SDK, której używa kod,
 * podmieniamy na instancji, więc nic nie wychodzi do sieci (a fałszywy klucz i tak
 * nie przeszedłby autoryzacji). Metody RUCHU PIENIĘDZY (zwrot, anulowanie, wypłata,
 * transfer) są pułapkami — test sprawdza, że kod NIGDY ich nie woła sam.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.STRIPE_SECRET_KEY = 'sk_test_atrapa_bez_sieci';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_atrapa_testowa';
process.env.STRIPE_PRICE_STANDARD = 'price_atrapa_standard';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, magicLinks } = await import('../src/db/repos.js');
const { stripe } = await import('../src/services/stripe.js');
const { createApp } = await import('../src/app.js');
const webhooksRouter = (await import('../src/routes/webhooks.js')).default;
const { getFirestore } = await import('firebase-admin/firestore');

assert.ok(stripe, 'Stripe musi być włączony atrapą klucza — inaczej test nic nie sprawdza');

// ---------------- atrapy Stripe ----------------

let wywolania;
let subskrypcjeKlienta; // to, co zwraca subscriptions.list (per klient)
let statusyPojedyncze; // subscriptions.retrieve: id → status (brak = resource_missing)
let otwarteSesje; // checkout.sessions.list(status=open)
let listaPada;
let seqKlient = 0;

function pulapka(nazwa) {
  return async (...args) => {
    wywolania.zakazane.push({ nazwa, args });
    throw new Error(`ZAKAZ: kod sam wywołał ${nazwa}`);
  };
}

beforeEach(() => {
  wywolania = {
    customersCreate: [], sessionsCreate: [], subsList: [], sessionsExpire: [], zakazane: [],
  };
  subskrypcjeKlienta = new Map();
  statusyPojedyncze = new Map();
  otwarteSesje = [];
  listaPada = false;

  // Idempotencja jak w Stripe: ten sam klucz → ten sam klient.
  const poKluczu = new Map();
  stripe.customers.create = async (params, opts) => {
    wywolania.customersCreate.push({ params, opts });
    const klucz = opts?.idempotencyKey;
    if (klucz && poKluczu.has(klucz)) return poKluczu.get(klucz);
    seqKlient++;
    const klient = { id: `cus_atrapa_${process.pid}_${seqKlient}`, email: params?.email };
    if (klucz) poKluczu.set(klucz, klient);
    return klient;
  };
  stripe.subscriptions.list = async (params) => {
    wywolania.subsList.push(params);
    if (listaPada) throw Object.assign(new Error('Stripe niedostępny (atrapa)'), { type: 'StripeConnectionError' });
    return { data: subskrypcjeKlienta.get(params?.customer) ?? [], has_more: false };
  };
  stripe.subscriptions.retrieve = async (id) => {
    if (!statusyPojedyncze.has(id)) {
      throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
    }
    return { id, status: statusyPojedyncze.get(id) };
  };
  stripe.checkout.sessions.list = async () => ({ data: otwarteSesje, has_more: false });
  stripe.checkout.sessions.expire = async (id) => {
    wywolania.sessionsExpire.push(id);
    return { id, status: 'expired' };
  };
  stripe.checkout.sessions.create = async (params) => {
    wywolania.sessionsCreate.push(params);
    return { id: `cs_atrapa_${wywolania.sessionsCreate.length}`, url: 'https://checkout.stripe.com/c/atrapa' };
  };

  stripe.refunds.create = pulapka('refunds.create');
  stripe.subscriptions.cancel = pulapka('subscriptions.cancel');
  stripe.subscriptions.update = pulapka('subscriptions.update');
  stripe.payouts.create = pulapka('payouts.create');
  stripe.transfers.create = pulapka('transfers.create');
});

// ---------------- serwery ----------------

// Aplikacja właściwa (trasy /upgrade).
const app = await createApp();
const serwerApi = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const API = `http://127.0.0.1:${serwerApi.address().port}`;

// Webhook: Cloud Functions podają `req.rawBody` natywnie — tu odtwarzamy to samo,
// żeby weryfikacja podpisu działała na surowych bajtach, jak na produkcji.
const hookApp = express();
hookApp.use((req, _res, next) => {
  const kawalki = [];
  req.on('data', (c) => kawalki.push(c));
  req.on('end', () => { req.rawBody = Buffer.concat(kawalki); next(); });
});
hookApp.use('/webhooks', webhooksRouter);
const serwerHook = await new Promise((r) => { const s = hookApp.listen(0, () => r(s)); });
const HOOK = `http://127.0.0.1:${serwerHook.address().port}`;

after(() => { serwerApi.close(); serwerHook.close(); });

// ---------------- pomocnicze ----------------

let seq = 0;
const ZNAK = `sj${process.pid}`;

async function dodajUsera(pola = {}) {
  seq++;
  const u = await users.create({ email: `${ZNAK}-${seq}@t.pl`, passwordHash: 'h', keywords: ['test'] });
  if (Object.keys(pola).length) {
    await getFirestore().collection('users').doc(u.id).update(pola);
  }
  return users.findById(u.id);
}

async function wyslijPodpisane(typ, obiekt) {
  seq++;
  const payload = JSON.stringify({ id: `evt_${ZNAK}_${seq}`, object: 'event', type: typ, data: { object: obiekt } });
  const podpis = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const odp = await fetch(`${HOOK}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': podpis },
    body: payload,
  });
  return { status: odp.status, body: await odp.json() };
}

/** Wpis audytu jest fire-and-forget — czekamy chwilę, aż dojedzie. */
async function wpisyAudytu(userId, action) {
  for (let i = 0; i < 40; i++) {
    const snap = await getFirestore().collection('audit_logs')
      .where('user_id', '==', userId).where('action', '==', action).get();
    if (!snap.empty) return snap.docs.map((d) => d.data());
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

async function upgrade(userId) {
  const { token } = await magicLinks.create({ userId, purpose: 'upgrade', ttlMinutes: 10 });
  const odp = await fetch(`${API}/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, token }),
  });
  return { status: odp.status, body: await odp.json().catch(() => null) };
}

// ---------------- podpis jest prawdziwy ----------------

test('webhook bez ważnego podpisu → 400 (podpisy w tym pliku są realnie weryfikowane)', async () => {
  const odp = await fetch(`${HOOK}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=zly' },
    body: JSON.stringify({ id: 'evt_zly', type: 'customer.subscription.deleted', data: { object: {} } }),
  });
  assert.equal(odp.status, 400);
});

// ---------------- (c) zdarzenia NIE-bieżącej subskrypcji ----------------

test('deleted STAREJ subskrypcji NIE zdejmuje planu, gdy bieżąca jest inna', async () => {
  const cus = `cus_${ZNAK}_del_stara`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_nowa_1', premium_tier: 'standard',
  });

  const odp = await wyslijPodpisane('customer.subscription.deleted', { id: 'sub_stara_1', customer: cus, status: 'canceled' });
  assert.equal(odp.status, 200);

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'standard', 'usunięcie STAREJ subskrypcji nie może odebrać planu opłaconego NOWĄ');
  assert.equal(po.stripe_subscription_id, 'sub_nowa_1', 'bieżąca subskrypcja zostaje nietknięta');
  assert.ok((await wpisyAudytu(user.id, 'subscription_event_ignored')).length >= 1, 'zignorowane zdarzenie zostawia ślad w audycie');
  assert.equal(wywolania.zakazane.length, 0);
});

test('updated STAREJ subskrypcji (unpaid) NIE zmienia planu', async () => {
  const cus = `cus_${ZNAK}_upd_stara`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_nowa_2', premium_tier: 'standard',
  });

  const odp = await wyslijPodpisane('customer.subscription.updated', { id: 'sub_stara_2', customer: cus, status: 'unpaid' });
  assert.equal(odp.status, 200);
  assert.equal((await users.findById(user.id)).premium_tier, 'standard');
});

test('updated subskrypcji, której jeszcze nie przypisaliśmy (incomplete przed checkoutem), NIE daje planu', async () => {
  /*
   * Klient Stripe jest teraz zapisywany PRZED płatnością, więc zdarzenia nowej
   * subskrypcji potrafią znaleźć użytkownika, zanim checkout się rozliczy. Status
   * `incomplete` nie jest w BEZ_DOSTEPU — bez tej bramki plan wpadałby przed zapłatą.
   */
  const cus = `cus_${ZNAK}_upd_wczesne`;
  const user = await dodajUsera({ stripe_customer_id: cus });

  const odp = await wyslijPodpisane('customer.subscription.updated', { id: 'sub_wczesna', customer: cus, status: 'incomplete' });
  assert.equal(odp.status, 200);
  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'free', 'plan przyznaje wyłącznie opłacony checkout, nie wczesne zdarzenie subskrypcji');
  assert.equal(po.stripe_subscription_id, null);
});

test('updated BIEŻĄCEJ subskrypcji nadal działa (unpaid → Free, active → Standard)', async () => {
  const cus = `cus_${ZNAK}_upd_biez`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_biez_3', premium_tier: 'standard',
  });

  await wyslijPodpisane('customer.subscription.updated', { id: 'sub_biez_3', customer: cus, status: 'unpaid' });
  assert.equal((await users.findById(user.id)).premium_tier, 'free');
  await wyslijPodpisane('customer.subscription.updated', { id: 'sub_biez_3', customer: cus, status: 'active' });
  assert.equal((await users.findById(user.id)).premium_tier, 'standard');
});

test('deleted BIEŻĄCEJ, gdy klient ma inną ŻYWĄ subskrypcję → przepięcie na nią, plan zostaje (bez anulowania)', async () => {
  const cus = `cus_${ZNAK}_del_biez_inna`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_biez_4', premium_tier: 'standard',
  });
  subskrypcjeKlienta.set(cus, [{ id: 'sub_zywa_4', status: 'active', customer: cus, created: 1_700_000_000, metadata: {} }]);

  const odp = await wyslijPodpisane('customer.subscription.deleted', { id: 'sub_biez_4', customer: cus, status: 'canceled' });
  assert.equal(odp.status, 200);

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'standard', 'klient wciąż płaci za drugą subskrypcję — plan nie może spaść');
  assert.equal(po.stripe_subscription_id, 'sub_zywa_4', 'rezygnacja i usunięcie konta muszą trafiać w subskrypcję, która obciąża kartę');
  assert.ok((await wpisyAudytu(user.id, 'subscription_switched')).length >= 1);
  assert.equal(wywolania.zakazane.length, 0, 'żadnego automatycznego anulowania ani zwrotu');
});

test('deleted BIEŻĄCEJ bez innych żywych → Free i czyszczenie identyfikatora', async () => {
  const cus = `cus_${ZNAK}_del_biez_sama`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_biez_5', premium_tier: 'standard',
  });

  await wyslijPodpisane('customer.subscription.deleted', { id: 'sub_biez_5', customer: cus, status: 'canceled' });
  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'free');
  assert.equal(po.stripe_subscription_id, null);
});

// ---------------- (c) checkout z NOWĄ subskrypcją przy żywej starej ----------------

test('checkout z nową subskrypcją przy ŻYWEJ starej → alarm + audyt duplikatu, BEZ anulowania i zwrotu', async () => {
  const cus = `cus_${ZNAK}_dubel`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_stara_6', premium_tier: 'free',
  });
  statusyPojedyncze.set('sub_stara_6', 'active');

  const odp = await wyslijPodpisane('checkout.session.completed', {
    id: `cs_${ZNAK}_dubel`,
    payment_status: 'paid',
    client_reference_id: user.id,
    customer: cus,
    subscription: 'sub_nowa_6',
    amount_total: 4900,
  });
  assert.equal(odp.status, 200, 'opłacony checkout musi się rozliczyć — klient zapłacił');

  const po = await users.findById(user.id);
  assert.equal(po.premium_tier, 'standard');
  assert.equal(po.stripe_subscription_id, 'sub_nowa_6', 'bieżąca = ostatnio opłacona');
  assert.deepEqual(po.stripe_subscription_duplikaty, ['sub_stara_6'],
    'stara żywa subskrypcja musi zostać zapisana przy koncie — inaczej nikt jej nie znajdzie');

  const wpisy = await wpisyAudytu(user.id, 'subscription_duplicate');
  assert.equal(wpisy.length, 1, 'duplikat subskrypcji MUSI trafić do audytu (decyzja właściciela)');
  assert.match(wpisy[0].detail, /sub_stara_6/);
  assert.match(wpisy[0].detail, /sub_nowa_6/);
  assert.equal(wywolania.zakazane.length, 0, 'decyzja o zwrocie/anulowaniu należy do właściciela, nie do kodu');
});

test('checkout z nową subskrypcją, gdy stara już nie żyje → podmiana bez alarmu duplikatu', async () => {
  const cus = `cus_${ZNAK}_zastap`;
  const user = await dodajUsera({
    stripe_customer_id: cus, stripe_subscription_id: 'sub_martwa_7', premium_tier: 'free',
  });
  statusyPojedyncze.set('sub_martwa_7', 'canceled');

  await wyslijPodpisane('checkout.session.completed', {
    id: `cs_${ZNAK}_zastap`, payment_status: 'paid', client_reference_id: user.id,
    customer: cus, subscription: 'sub_nowa_7', amount_total: 4900,
  });

  const po = await users.findById(user.id);
  assert.equal(po.stripe_subscription_id, 'sub_nowa_7');
  assert.equal(po.stripe_subscription_duplikaty ?? null, null);
  assert.equal((await wpisyAudytu(user.id, 'subscription_duplicate')).length, 0);
});

test('powtórna dostawa checkoutu tej samej subskrypcji nie jest duplikatem', async () => {
  const cus = `cus_${ZNAK}_powtorka`;
  const user = await dodajUsera({ stripe_customer_id: cus });
  const sesja = {
    id: `cs_${ZNAK}_powtorka`, payment_status: 'paid', client_reference_id: user.id,
    customer: cus, subscription: 'sub_jedna_8', amount_total: 4900,
  };
  await wyslijPodpisane('checkout.session.completed', sesja);
  await wyslijPodpisane('checkout.session.completed', sesja);

  const po = await users.findById(user.id);
  assert.equal(po.stripe_subscription_id, 'sub_jedna_8');
  assert.equal(po.stripe_subscription_duplikaty ?? null, null);
});

// ---------------- (a)+(b) /upgrade ----------------

test('(b) druga sesja przy ŻYWEJ subskrypcji w Stripe → 409 i BRAK nowej sesji', async () => {
  // Plan spadł do Free po zwrocie/chargebacku, ale subskrypcja w Stripe żyje.
  const cus = `cus_${ZNAK}_409`;
  const user = await dodajUsera({ stripe_customer_id: cus, stripe_subscription_id: 'sub_zyje_9', premium_tier: 'free' });
  subskrypcjeKlienta.set(cus, [{ id: 'sub_zyje_9', status: 'past_due', customer: cus, metadata: {} }]);

  const odp = await upgrade(user.id);
  assert.equal(odp.status, 409);
  assert.equal(odp.body?.error?.code, 'CONFLICT');
  assert.match(String(odp.body?.error?.message), /subskrypcj/i, 'komunikat po polsku o istniejącej subskrypcji');
  assert.equal(wywolania.sessionsCreate.length, 0, 'NIE WOLNO otworzyć drugiej płatnej sesji');
  assert.equal(wywolania.customersCreate.length, 0, 'klient już jest — nie zakładamy drugiego');
  assert.equal(wywolania.subsList[0]?.customer, cus);
});

test('(b) subskrypcja canceled/incomplete_expired nie blokuje zakupu', async () => {
  const cus = `cus_${ZNAK}_martwe`;
  const user = await dodajUsera({ stripe_customer_id: cus });
  subskrypcjeKlienta.set(cus, [
    { id: 'sub_m1', status: 'canceled', customer: cus, metadata: {} },
    { id: 'sub_m2', status: 'incomplete_expired', customer: cus, metadata: {} },
  ]);
  const odp = await upgrade(user.id);
  assert.equal(odp.status, 200);
  assert.equal(wywolania.sessionsCreate.length, 1);
});

test('(b) Stripe nie odpowiada przy sprawdzaniu subskrypcji → 503, bez sesji (fail-closed)', async () => {
  const user = await dodajUsera({ stripe_customer_id: `cus_${ZNAK}_503` });
  listaPada = true;
  const odp = await upgrade(user.id);
  assert.equal(odp.status, 503);
  assert.equal(wywolania.sessionsCreate.length, 0, 'bez pewności, że nie ma żywej subskrypcji, nie otwieramy płatności');
});

test('(a) ponowny checkout używa TEGO SAMEGO klienta Stripe (tworzony raz i zapisany)', async () => {
  const user = await dodajUsera();
  assert.equal(user.stripe_customer_id, null);

  const pierwsza = await upgrade(user.id);
  assert.equal(pierwsza.status, 200);
  assert.equal(wywolania.customersCreate.length, 1, 'klient zakładany przy pierwszym checkoucie');
  assert.match(String(wywolania.customersCreate[0].opts?.idempotencyKey), new RegExp(user.id),
    'klucz idempotencji per użytkownik — równoległe żądania nie założą dwóch klientów');
  assert.equal(wywolania.customersCreate[0].params.metadata?.user_id, user.id);

  const zapisany = (await users.findById(user.id)).stripe_customer_id;
  assert.ok(zapisany, 'identyfikator klienta zapisany przy koncie PRZED płatnością');
  assert.equal(wywolania.sessionsCreate[0].customer, zapisany);
  assert.equal(wywolania.sessionsCreate[0].customer_email, undefined, 'customer_email zakładałby nowego klienta');

  const druga = await upgrade(user.id);
  assert.equal(druga.status, 200);
  assert.equal(wywolania.customersCreate.length, 1, 'drugi checkout NIE zakłada kolejnego klienta');
  assert.equal(wywolania.sessionsCreate[1].customer, zapisany, 'ten sam klient w obu sesjach');
});

test('(a) otwarte, nieopłacone sesje klienta wygasają przed nową (dwie karty = dwie subskrypcje)', async () => {
  const cus = `cus_${ZNAK}_otwarte`;
  const user = await dodajUsera({ stripe_customer_id: cus });
  otwarteSesje = [{ id: 'cs_otwarta_1', status: 'open' }];

  const odp = await upgrade(user.id);
  assert.equal(odp.status, 200);
  assert.deepEqual(wywolania.sessionsExpire, ['cs_otwarta_1']);
});

test('(a) równoległy zapis klienta: pierwszy wygrywa, drugi dostaje ten sam identyfikator', async () => {
  const user = await dodajUsera();
  const [a, b] = await Promise.all([
    users.ustawStripeCustomerJesliBrak(user.id, 'cus_rownolegly_A'),
    users.ustawStripeCustomerJesliBrak(user.id, 'cus_rownolegly_B'),
  ]);
  assert.equal(a, b, 'obaj wołający muszą dostać tego samego klienta');
  assert.equal((await users.findById(user.id)).stripe_customer_id, a);
  assert.equal(await users.ustawStripeCustomerJesliBrak(user.id, 'cus_trzeci'), a, 'zapisany klient się nie zmienia');
});
