import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * Idempotencja webhooków Stripe (audyt 2026-07-09, MEDIUM×2).
 * Stripe ponawia dostawę przy każdym nie-2xx i przy niepewności sieciowej.
 * Bez rejestru zdarzeń powtórka wystawiała DRUGĄ FAKTURĘ i słała drugi e-mail.
 */


const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { stripeEvents, faktury } = await import('../src/db/repos.js');

test('stripeEvents.claim — pierwsza obsługa true, równoległa dostawa false', async () => {
  const id = `evt_${process.pid}_a`;
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), true);
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), false, 'obsługa w toku — duplikat odrzucony');
  await stripeEvents.markDone(id);
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), false, 'zdarzenie zamknięte na trwałe');
});

test('AUDYT: rezerwacja porzucona przez padniętą instancję wygasa i da się ją przejąć', async () => {
  // Bez wygaśnięcia: instancja pada po claim(), Stripe ponawia, widzi „duplikat",
  // a opłacony klient NIGDY nie dostaje planu.
  const id = `evt_${process.pid}_stale`;
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), true);

  // Cofamy znacznik rezerwacji o 10 minut — tak, jakby instancja padła dawno temu.
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('stripe_events').doc(id)
    .set({ claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }, { merge: true });

  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), true,
    'przeterminowaną rezerwację musi dać się przejąć');
});

test('AUDYT: zdarzenie zamknięte (done) nigdy nie zostaje przejęte, choćby było stare', async () => {
  const id = `evt_${process.pid}_done`;
  await stripeEvents.claim(id, 'checkout.session.completed');
  await stripeEvents.markDone(id);

  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('stripe_events').doc(id)
    .set({ claimed_at: new Date(Date.now() - 60 * 60_000).toISOString() }, { merge: true });

  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), false,
    'obsłużone zdarzenie nie może zostać obsłużone drugi raz (druga faktura!)');
});

test('stripeEvents.claim — różne zdarzenia nie kolidują', async () => {
  assert.equal(await stripeEvents.claim(`evt_${process.pid}_b`, 'x'), true);
  assert.equal(await stripeEvents.claim(`evt_${process.pid}_c`, 'x'), true);
});

test('stripeEvents.release — po nieudanej obsłudze Stripe może ponowić', async () => {
  // Scenariusz: aktywacja padła w połowie (np. Firestore niedostępny). Zwalniamy
  // rezerwację i zwracamy 500 — ponowna dostawa MUSI móc dokończyć robotę.
  const id = `evt_${process.pid}_d`;
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), true);
  await stripeEvents.release(id);
  assert.equal(await stripeEvents.claim(id, 'checkout.session.completed'), true, 'po release ponowienie musi przejść');
});

// ---------------- idempotencja faktury ----------------

test('AUDYT: faktura wystawia się DOKŁADNIE RAZ na sesję płatności', async () => {
  /*
   * Rejestr zdarzeń nie wystarcza: gdy `markDone` padnie po udanej obsłudze,
   * rezerwacja wygasa po 5 min, a ponowna dostawa (Stripe: „co najmniej raz")
   * przetwarza zdarzenie od nowa. Fakturownia nie ma klucza idempotencji, więc
   * klient dostawał DRUGĄ fakturę VAT za tę samą płatność.
   */
  const sesja = `cs_${process.pid}_1`;
  assert.equal(await faktury.zarezerwuj(sesja), true, 'pierwsza faktura');
  assert.equal(await faktury.zarezerwuj(sesja), false, 'druga faktura za tę samą sesję — NIE');
  assert.equal(await faktury.zarezerwuj(sesja), false);
});

test('AUDYT: nieudane wystawienie zwalnia rezerwację, żeby ponowienie zadziałało', async () => {
  const sesja = `cs_${process.pid}_2`;
  assert.equal(await faktury.zarezerwuj(sesja), true);
  await faktury.zwolnij(sesja);
  assert.equal(await faktury.zarezerwuj(sesja), true, 'po zwolnieniu ponowienie musi wystawić fakturę');
});

test('faktury: brak identyfikatora sesji nie blokuje wystawienia', async () => {
  // Nie mamy jak deduplikować — lepiej wystawić fakturę niż jej nie wystawić.
  assert.equal(await faktury.zarezerwuj(null), true);
  assert.equal(await faktury.zarezerwuj(undefined), true);
});

// ---------------- reguły uprawnień do planu ----------------

/*
 * Reguła jest IMPORTOWANA z kodu produkcyjnego, nie przepisywana.
 *
 * Audyt 2026-07-10: ten test trzymał WŁASNĄ kopię tabeli decyzyjnej, więc świecił
 * na zielono także wtedy, gdy webhook decydował inaczej. Test sprawdzający swoją
 * własną kopię reguły nie sprawdza niczego.
 */
const { tierPrzetargAi: tier } = await import('../src/lib/subscriptionStatus.js');

test('AUDYT: klient, który przestał płacić, TRACI plan Standard', () => {
  // Dotąd `customer.subscription.updated` obsługiwano wyłącznie dla Fittera —
  // użytkownik PrzetargAI z wygasłą kartą zachowywał Standard w nieskończoność.
  assert.equal(tier('unpaid'), 'free', 'unpaid: Stripe poddał się z obciążeniem');
  assert.equal(tier('canceled'), 'free');
  assert.equal(tier('incomplete_expired'), 'free');
  assert.equal(tier('paused'), 'free');
});

test('AUDYT: past_due zachowuje dostęp — Stripe wciąż ponawia obciążenie', () => {
  // Odcięcie po pierwszej nieudanej próbie karty kosztuje więcej klientów,
  // niż oszczędza. Stripe sam przestawi na unpaid/canceled, gdy się podda.
  assert.equal(tier('past_due'), 'standard');
  assert.equal(tier('active'), 'standard');
  assert.equal(tier('trialing'), 'standard');
});
