import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusSubskrypcjiFittera, tierPrzetargAi } from '../src/lib/subscriptionStatus.js';

/*
 * Audyt 2026-07-09 (HIGH ×2) — reguły biznesowe, kto ma opłacony dostęp.
 *
 * 1) Fitter: `cancel_at_period_end` mapowano NATYCHMIAST na 'canceled'. Klient,
 *    który w połowie opłaconego miesiąca kliknął „anuluj odnowienie", tracił
 *    Premium tego samego dnia — mimo że zapłacił do końca okresu. To zwrot
 *    pieniędzy albo skarga, w obu przypadkach nasza wina.
 *
 * 2) PrzetargAI: `customer.subscription.updated` obsługiwano wyłącznie dla
 *    Fittera, więc klient z wygasłą kartą zachowywał Standard w nieskończoność.
 */

test('Fitter: anulowanie na koniec okresu NIE odbiera Premium od razu', () => {
  const status = statusSubskrypcjiFittera({ status: 'active', cancel_at_period_end: true });
  assert.equal(status, 'active', 'klient zapłacił do końca okresu — dostęp zostaje');
});

test('Fitter: dostęp znika dopiero, gdy Stripe zamknie subskrypcję', () => {
  assert.equal(statusSubskrypcjiFittera({ status: 'canceled', cancel_at_period_end: true }), 'canceled');
  assert.equal(statusSubskrypcjiFittera({ status: 'unpaid', cancel_at_period_end: false }), 'unpaid');
});

test('Fitter: brak statusu ze Stripe traktujemy jako aktywny (fail-open dla płacącego)', () => {
  assert.equal(statusSubskrypcjiFittera({ cancel_at_period_end: false }), 'active');
});

test('Fitter: status spoza dozwolonego zbioru nie może wywalić zapisu do bazy', () => {
  // schema.sql ma CHECK (status IN ('active','canceled','past_due','unpaid')).
  // Stripe zna też 'trialing', 'incomplete', 'paused' — wpisanie ich rzuciłoby
  // wyjątkiem w środku webhooka i Stripe ponawiałby w nieskończoność.
  const dozwolone = new Set(['active', 'canceled', 'past_due', 'unpaid']);
  for (const s of ['trialing', 'incomplete', 'incomplete_expired', 'paused', 'active', 'unpaid']) {
    const wynik = statusSubskrypcjiFittera({ status: s, cancel_at_period_end: false });
    assert.ok(dozwolone.has(wynik), `status "${s}" zmapowany na niedozwolone "${wynik}"`);
  }
});

test('PrzetargAI: past_due zachowuje plan — Stripe wciąż ponawia obciążenie', () => {
  assert.equal(tierPrzetargAi('active'), 'standard');
  assert.equal(tierPrzetargAi('trialing'), 'standard');
  assert.equal(tierPrzetargAi('past_due'), 'standard');
});

test('PrzetargAI: klient, który przestał płacić, traci plan Standard', () => {
  assert.equal(tierPrzetargAi('unpaid'), 'free');
  assert.equal(tierPrzetargAi('canceled'), 'free');
  assert.equal(tierPrzetargAi('incomplete_expired'), 'free');
  assert.equal(tierPrzetargAi('paused'), 'free');
});
