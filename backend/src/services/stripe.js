import Stripe from 'stripe';
import { env, features } from '../config/env.js';
import { serviceUnavailable } from '../lib/errors.js';

const stripe = features.stripe ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export function isStripeEnabled() {
  return Boolean(stripe);
}

/**
 * Tworzy sesję Stripe Checkout dla subskrypcji „PrzetargAI Standard".
 * Płatność odbywa się na landingu — zgodnie ze strategią iOS (bez IAP).
 */
export async function createCheckoutSession({ user, successUrl, cancelUrl }) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  if (!env.STRIPE_PRICE_STANDARD) throw serviceUnavailable('Brak STRIPE_PRICE_STANDARD w konfiguracji');

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_STANDARD, quantity: 1 }],
    customer: user.stripe_customer_id || undefined,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { user_id: user.id, company_nip: user.company_nip },
    subscription_data: { metadata: { user_id: user.id } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });
}

/** Weryfikuje podpis webhooka Stripe i zwraca zdarzenie. */
export function constructWebhookEvent(rawBody, signature) {
  if (!stripe) throw serviceUnavailable('Stripe niedostępny');
  if (!env.STRIPE_WEBHOOK_SECRET) throw serviceUnavailable('Brak STRIPE_WEBHOOK_SECRET');
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Tworzy sesję Stripe Checkout dla Fitter Welder Pro (mobile-first, bez
 * auth — identyfikator urządzenia jako client_reference_id). Plan musi być
 * "monthly" lub "yearly". Backend wybiera odpowiednie price ID z env.
 *
 * Webhook (zob. routes/webhooks.js) wykryje subskrypcję po metadata.project=fitter
 * i zapisze do tabeli fitter_premium, więc klient mobilny ma niezależny flow
 * od PrzetargAI bez konfliktu w DB.
 */
export async function createFitterCheckoutSession({ plan, deviceId, customerEmail, successUrl, cancelUrl }) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  const priceId = plan === 'yearly'
    ? env.STRIPE_PRICE_FITTER_YEARLY
    : env.STRIPE_PRICE_FITTER_MONTHLY;
  if (!priceId) throw serviceUnavailable(`Brak STRIPE_PRICE_FITTER_${plan.toUpperCase()} w konfiguracji`);
  if (!deviceId) throw serviceUnavailable('deviceId wymagany dla Fitter checkout');

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: customerEmail || undefined,
    client_reference_id: deviceId,
    metadata: { project: 'fitter', plan, device_id: deviceId },
    subscription_data: { metadata: { project: 'fitter', plan, device_id: deviceId } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });
}

/**
 * One-time Stripe Checkout dla ogłoszenia w module Praca (Fitter Welder
 * Pro). 49 PLN za ogłoszenie, bez wyjątków (nawet Premium płaci).
 * Webhook (routes/webhooks.js) wykryje metadata.project='fitter_jobs' i
 * oznaczy listing jako paid + ustawi expires_at.
 */
export async function createFitterJobCheckoutSession({ listingId, deviceId, customerEmail, successUrl, cancelUrl }) {
  if (!stripe) throw serviceUnavailable('Płatności niedostępne — brak konfiguracji Stripe');
  const priceId = env.STRIPE_PRICE_FITTER_JOB_POST;
  if (!priceId) throw serviceUnavailable('Brak STRIPE_PRICE_FITTER_JOB_POST w konfiguracji');
  if (!listingId) throw serviceUnavailable('listingId wymagany dla job checkout');
  if (!deviceId) throw serviceUnavailable('deviceId wymagany dla job checkout');

  return stripe.checkout.sessions.create({
    mode: 'payment', // one-time, NOT subscription
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: customerEmail || undefined,
    client_reference_id: listingId,
    metadata: { project: 'fitter_jobs', listing_id: listingId, device_id: deviceId },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: false,
  });
}

export { stripe };
