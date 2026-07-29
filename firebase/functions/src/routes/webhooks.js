import { Router } from 'express';
import { constructWebhookEvent } from '../services/stripe.js';
import { users, stripeEvents, faktury } from '../db/repos.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { sendEmail, subscriptionActiveEmail } from '../services/email.js';
import { createStandardInvoice } from '../services/invoice.js';
import { tierPrzetargAi } from '../lib/subscriptionStatus.js';
import { backfillUser } from '../services/matching.js';

/**
 * INCYDENT 2026-07-10 (D-046): klient kupił Standard, a feed dalej pokazywał
 * 5 dopasowań — nowy plan „działał" dopiero od następnego crona. Po aktywacji
 * przeliczamy dopasowania OD RAZU (i czekamy — Functions zamrażają tło, D-044).
 * BEZ `wymus`: cooldown backfillu (10 min) chroni przed burzą przy ponowieniach
 * Stripe. Błąd przeliczenia nie może wywrócić aktywacji — plan już przyznany.
 */
async function dowiezFeedPoAktywacji(user) {
  try {
    const wynik = await backfillUser(user);
    logger.info({ userId: user.id, ...wynik }, 'Feed przeliczony po aktywacji planu');
  } catch (err) {
    logger.error({ err: err.message, userId: user.id },
      'Przeliczenie feedu po aktywacji nie powiodło się — dogoni przy cronie');
  }
}

const router = Router();


/**
 * Webhook Stripe.
 *
 * Cloud Functions udostępniają `req.rawBody` natywnie, więc — inaczej niż na
 * Railway — nie trzeba montować `express.raw()` przed globalnym `express.json()`.
 *
 * Naprawy z audytu 2026-07-09:
 *  • idempotencja (rejestr `stripe_events`) — powtórna dostawa nie wystawia
 *    drugiej faktury ani nie wysyła drugiego e-maila,
 *  • błąd obsługi zwraca 500, nie 200 — inaczej opłacony klient nie zostawał
 *    aktywowany, a Stripe nigdy nie ponawiał,
 *  • `customer.subscription.updated` działa dla PrzetargAI (dotąd tylko dla Fittera),
 *    więc klient, który przestał płacić, traci plan Standard,
 *  • `payment_status` sprawdzany przed aktywacją — asynchroniczne metody płatności
 *    (przelew, BLIK odroczony) potrafią zakończyć sesję PRZED wpływem pieniędzy.
 *
 * Zdarzenia Fittera (`metadata.project === 'fitter'*`) są tu IGNOROWANE — Fitter
 * Welder Pro został na Railway i ma własny endpoint webhooka (D-024).
 */
router.post('/stripe', async (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.rawBody, req.headers['stripe-signature']);
  } catch (err) {
    logger.warn({ err: err.message }, 'Webhook Stripe — odrzucony (błąd weryfikacji podpisu)');
    return res.status(400).json({ error: 'Nieprawidłowy podpis webhooka' });
  }

  const wynik = await przetworzZdarzenie(event);
  res.status(wynik.status).json(wynik.body);
});

/**
 * Orkiestracja zdarzenia PO weryfikacji podpisu: claim → obsługa → markDone.
 * Wydzielona z trasy (runda 30), żeby dało się testować inwarianty kolejności,
 * których złamanie oznacza podwójną fakturę VAT.
 *
 * @returns {Promise<{status: number, body: object}>}
 */
export async function przetworzZdarzenie(event) {
  // Rezerwacja zdarzenia PRZED obsługą. Duplikat kończy się cichym 200.
  const pierwszaObsluga = await stripeEvents.claim(event.id, event.type);
  if (!pierwszaObsluga) {
    logger.info({ eventId: event.id, type: event.type }, 'Webhook Stripe — duplikat, pomijam');
    return { status: 200, body: { received: true, duplicate: true } };
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Obsługa padła: zwalniamy rezerwację i prosimy Stripe o ponowienie. Bez tego
    // opłacony klient zostawałby bez subskrypcji, a my bez śladu poza logiem.
    await stripeEvents.release(event.id).catch((e) =>
      logger.error({ err: e.message, eventId: event.id }, 'Nie udało się zwolnić rezerwacji zdarzenia'));
    logger.error({ err: err.message, eventId: event.id, type: event.type }, 'Błąd obsługi webhooka Stripe');
    return { status: 500, body: { error: 'Obsługa zdarzenia nie powiodła się' } };
  }

  /*
   * Obsługa SIĘ POWIODŁA. Domykamy zdarzenie w osobnym bloku, bo błąd zamknięcia
   * NIE może uruchomić `release()` — to skasowałoby rezerwację i Stripe przetworzyłby
   * wszystko drugi raz: druga faktura, drugi e-mail (audyt 2026-07-10).
   * Gdy `markDone` zawiedzie, rezerwacja zostaje jako „w trakcie" i wygaśnie po
   * 5 minutach; ponowienie Stripe wykona obsługę raz jeszcze — ale to znacznie
   * mniejsze zło niż gwarantowany dubel. Powtórna obsługa jest bezpieczna:
   * aktywacja planu jest idempotentna, a faktura ma własną rezerwację per sesja
   * (kolekcja `invoices`), więc dubla nie wystawi. Powtórzy się jedynie e-mail
   * aktywacyjny — informacyjny, nieszkodliwy.
   */
  try {
    await stripeEvents.markDone(event.id);
  } catch (err) {
    logger.error({ err: err.message, eventId: event.id },
      'Zdarzenie obsłużone, ale nie udało się go domknąć — możliwa powtórna obsługa po wygaśnięciu rezerwacji');
  }
  return { status: 200, body: { received: true } };
}

/** Rozdzielnia zdarzeń. Eksport wyłącznie dla testów ścieżek pieniędzy (runda 30). */
export async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
    // Metody asynchroniczne (przelew, odroczony BLIK) kończą sesję ZANIM pieniądze
    // wpłyną. Stripe dosyła wtedy osobne zdarzenie z potwierdzeniem — bez jego
    // obsługi klient płacił i zostawał na planie Free (audyt 2026-07-10).
    case 'checkout.session.async_payment_succeeded':
      return obsluzCheckout(event.data.object);
    case 'checkout.session.async_payment_failed':
      logger.warn({ sessionId: event.data.object.id }, 'Płatność asynchroniczna nie powiodła się');
      return;
    // Comiesięczne odnowienie subskrypcji. Bez tego klient dostawał fakturę VAT
    // wyłącznie za PIERWSZY miesiąc, a płacił co miesiąc (audyt 2026-07-10).
    case 'invoice.paid':
      return obsluzOplaconaFakture(event.data.object);
    case 'customer.subscription.updated':
      return obsluzZmianeSubskrypcji(event.data.object);
    case 'customer.subscription.deleted':
      return obsluzUsuniecieSubskrypcji(event.data.object);
    default:
      logger.debug({ type: event.type }, 'Webhook Stripe — zdarzenie pominięte');
  }
}

/** Czy zdarzenie należy do Fittera (obsługiwanego przez backend na Railway). */
function nalezyDoFittera(obiekt) {
  return String(obiekt.metadata?.project ?? '').startsWith('fitter');
}

async function obsluzCheckout(session) {
  if (nalezyDoFittera(session)) {
    logger.debug({ sessionId: session.id }, 'Checkout Fittera — obsługiwany przez backend Railway');
    return;
  }

  // Sesja bywa „complete", gdy pieniądze jeszcze nie wpłynęły (przelew, odroczone
  // metody). Aktywacja przed zapłatą to rozdawanie subskrypcji za darmo.
  // ALE `no_payment_required` to prawidłowy stan płatnej sesji, w której NIE MA nic
  // do pobrania (kupon 100% / trial ustawiony na Cenie w Stripe). Bez tego klient z
  // pełnym rabatem miał poprawną subskrypcję w Stripe, a u nas zostawał na Free na
  // zawsze — żadne kolejne zdarzenie by tego nie naprawiło (audyt 2026-07-29).
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    logger.info({ sessionId: session.id, status: session.payment_status },
      'Checkout zakończony, ale płatność niepotwierdzona — aktywacja wstrzymana');
    return;
  }

  const userId = session.client_reference_id || session.metadata?.user_id;
  const user = userId ? await users.findById(userId) : null;
  if (!user) {
    // Trwały błąd danych: ponawianie nic nie da. Nie rzucamy — zdarzenie zostaje
    // odnotowane jako obsłużone, a alarm zostawiamy w logu.
    logger.error({ sessionId: session.id, userId }, 'Webhook: nie znaleziono użytkownika dla sesji');
    return;
  }

  if (session.customer) await users.setStripeCustomer(user.id, session.customer);
  if (session.subscription) await users.setStripeSubscription(user.id, session.subscription);
  await users.setTier(user.id, 'standard');
  audit({ userId: user.id, action: 'subscription_activated' });
  logger.info({ userId: user.id }, 'Subskrypcja Standard aktywowana');

  // Klient zapłacił i PATRZY na feed — nowy limit ma być widoczny od razu (D-046).
  await dowiezFeedPoAktywacji(await users.findById(user.id));

  // E-mail nie może wywrócić webhooka — aktywacja już się udała.
  await sendEmail({ to: user.email, ...subscriptionActiveEmail(user.company_name) })
    .catch((err) => logger.error({ err: err.message, userId: user.id }, 'Email aktywacji nie wysłany'));

  await wystawFakture(session, user);
}

/**
 * Wystawia fakturę DOKŁADNIE RAZ na sesję płatności.
 *
 * Sam rejestr zdarzeń nie wystarcza: gdy `markDone` padnie już po udanej obsłudze,
 * rezerwacja wygasa po pięciu minutach, a ponowna dostawa (Stripe gwarantuje dostawę
 * „co najmniej raz") przetwarza zdarzenie od nowa. Fakturownia nie ma klucza
 * idempotencji, więc klient dostawał DRUGĄ FAKTURĘ VAT za tę samą płatność
 * (audyt 2026-07-10). Rezerwacja per `session.id` to zamyka.
 *
 * @throws gdy Fakturownia jest skonfigurowana, ale faktury nie wystawiła — wtedy
 *   chcemy 500 i ponowienia od Stripe. Kosztem jest powtórny e-mail aktywacyjny
 *   (informacyjny, nieszkodliwy); zyskiem — faktura VAT, której brak jest problemem
 *   podatkowym klienta.
 * @returns {Promise<void>}
 */
export async function wystawFakture(session, user, { opis } = {}) {
  // Decyzja właściciela (2026-07-29): przy realnie pobranym 0 zł (kupon 100%,
  // trial, odnowienie pokryte kredytem) NIE wystawiamy faktury — brak zapłaty,
  // brak dokumentu. Zwieramy PRZED rezerwacją i Fakturownią, żeby nie spalić
  // identyfikatora sesji i nie wołać API na darmo.
  // `<= 0` tylko dla LICZBY: null/undefined = „Stripe nie podał kwoty" (nie zero) →
  // wtedy NIE pomijamy, działa dotychczasowy fallback ceny katalogowej.
  if (Number.isFinite(session.amount_total) && session.amount_total <= 0) {
    logger.info({ sessionId: session.id, userId: user.id },
      'Faktura pominięta — kwota 0 zł (kupon 100% / trial): brak zapłaty do zafakturowania');
    return;
  }

  if (!await faktury.zarezerwuj(session.id)) {
    logger.info({ sessionId: session.id, userId: user.id }, 'Faktura dla tej sesji już istnieje — pomijam');
    return;
  }

  /*
   * `createStandardInvoice` NIE RZUCA — łapie każdy błąd Fakturowni i zwraca
   * `{ created: false }`. Sprawdzamy więc WYNIK, nie wyjątek. Wcześniejsza wersja
   * miała blok `catch`, który nigdy się nie wykonywał: przy awarii Fakturowni
   * rezerwacja zostawała na zawsze, ponowienie widziało „faktura już istnieje",
   * a opłacony klient B2B **nigdy nie dostawał faktury VAT** i nie było ścieżki
   * naprawy poza ręcznym wystawieniem (audyt 2026-07-10 — regresja wprowadzona
   * razem z samą idempotencją).
   */
  let wynik;
  try {
    // NIP i nazwa firmy są opcjonalne (D-023) — faktura dla osoby bez NIP-u to
    // zwykła faktura imienna (Fakturownia: puste buyer_tax_no).
    wynik = await createStandardInvoice({
      buyerName: user.company_name ?? user.email,
      buyerNip: user.company_nip ?? '',
      buyerEmail: user.email,
      // Kwota FAKTYCZNIE pobrana przez Stripe — kod rabatowy zmienia ją w dół.
      amountTotal: session.amount_total,
      opis,
    });
  } catch (err) {
    wynik = { created: false, error: err.message };
  }

  if (wynik?.created) return;

  // Faktury nie ma. Zwalniamy rezerwację, żeby kolejna próba (ponowienie Stripe
  // albo ręczne wywołanie) mogła ją wystawić naprawdę. Dotyczy to także trybu
  // degradacji: gdy Fakturownia nie jest jeszcze skonfigurowana, nie wolno „spalić"
  // identyfikatora sesji, bo po jej włączeniu faktura już by nie powstała.
  await faktury.zwolnij(session.id).catch((err) =>
    logger.error({ err: err.message, sessionId: session.id }, 'Nie udało się zwolnić rezerwacji faktury'));

  const kontekst = { userId: user.id, sessionId: session.id, powod: wynik?.error };

  /*
   * Brak konfiguracji Fakturowni to stan ZNANY i celowy (tryb degradacji), nie awaria.
   * Podnoszenie go do błędu zalewałoby Error Reporting alarmem przy każdej płatności
   * i utopiłoby w szumie prawdziwe awarie. Kończymy cicho — 200 dla Stripe.
   */
  if (wynik?.degraded) {
    logger.warn(kontekst, 'Faktura pominięta — Fakturownia nieskonfigurowana (tryb degradacji)');
    return;
  }

  /*
   * Fakturownia JEST skonfigurowana, a mimo to faktury nie ma — czyli awaria.
   *
   * Rzucamy, żeby webhook zwrócił 500 i Stripe ponowił CAŁE zdarzenie. Bez tego
   * kończyliśmy 200, Stripe uznawał dostarczenie za udane i **nigdy nie ponawiał**:
   * jedna chwilowa usterka Fakturowni bezpowrotnie gubiła fakturę VAT opłaconego
   * klienta B2B, a jedynym śladem był wpis w logu (audyt 2026-07-10; komentarz
   * o „ponowieniu Stripe" opisywał ścieżkę, która nie istniała).
   *
   * Ponowienie jest bezpieczne: aktywacja planu jest idempotentna, a rezerwacja
   * `invoices/{session.id}` — zwolniona powyżej — pilnuje, by faktura powstała raz.
   */
  logger.error(kontekst, 'Faktura NIE wystawiona mimo płatności — proszę Stripe o ponowienie zdarzenia');
  throw new Error(`Fakturownia nie wystawiła faktury dla sesji ${session.id}: ${wynik?.error ?? 'nieznany błąd'}`);
}

/**
 * Opłacona faktura Stripe — u nas oznacza ODNOWIENIE subskrypcji na kolejny miesiąc.
 *
 * Audyt 2026-07-10: fakturę VAT wystawialiśmy wyłącznie przy pierwszym checkoucie.
 * Klient płacił co miesiąc, a dokument księgowy dostawał raz — problem podatkowy
 * po obu stronach.
 *
 * Pierwszy okres pomijamy: `billing_reason === 'subscription_create'` obsłużył już
 * `checkout.session.completed`, a rezerwacja `invoices/{id}` chroni przed dublem.
 */
async function obsluzOplaconaFakture(faktura) {
  if (faktura.billing_reason !== 'subscription_cycle') {
    logger.debug({ invoiceId: faktura.id, powod: faktura.billing_reason },
      'invoice.paid pominięty — to nie odnowienie');
    return;
  }

  const user = await users.findByStripeCustomer(faktura.customer);
  if (!user) {
    logger.error({ invoiceId: faktura.id, customer: faktura.customer },
      'Odnowienie subskrypcji: nie znaleziono użytkownika — faktura NIE wystawiona');
    return;
  }

  // Sesja Stripe tu nie istnieje; kluczem idempotencji jest identyfikator faktury.
  await wystawFakture(
    { id: faktura.id, amount_total: faktura.amount_paid },
    user,
    { opis: 'Subskrypcja PrzetargAI Standard (odnowienie, 1 miesiąc)' },
  );
  logger.info({ userId: user.id, invoiceId: faktura.id }, 'Faktura za odnowienie wystawiona');
}

/**
 * Zmiana statusu subskrypcji. Dotąd obsługiwana WYŁĄCZNIE dla Fittera — użytkownik
 * PrzetargAI, któremu wygasła karta, zachowywał plan Standard w nieskończoność.
 */
async function obsluzZmianeSubskrypcji(sub) {
  if (nalezyDoFittera(sub)) return;

  const user = await users.findByStripeCustomer(sub.customer);
  if (!user) {
    logger.warn({ subId: sub.id, customer: sub.customer }, 'Zmiana subskrypcji: nie znaleziono użytkownika');
    return;
  }

  // `cancel_at_period_end` to zapowiedź, nie fakt: klient zapłacił do końca okresu
  // i ma prawo korzystać. Dostęp odbiera dopiero `customer.subscription.deleted`.
  const nalezyTier = tierPrzetargAi(sub.status);
  if (user.premium_tier === nalezyTier) return;

  await users.setTier(user.id, nalezyTier);
  audit({ userId: user.id, action: nalezyTier === 'standard' ? 'subscription_restored' : 'subscription_suspended' });
  logger.info({ userId: user.id, status: sub.status, tier: nalezyTier }, 'Plan zaktualizowany po zmianie subskrypcji');

  // Powrót do Standard (np. po opłaceniu zaległości) też dowozi feed od razu (D-046).
  if (nalezyTier === 'standard') await dowiezFeedPoAktywacji(await users.findById(user.id));
}

async function obsluzUsuniecieSubskrypcji(sub) {
  if (nalezyDoFittera(sub)) return;

  const user = await users.findByStripeCustomer(sub.customer);
  if (!user) return;

  await users.setTier(user.id, 'free');
  await users.setStripeSubscription(user.id, null);
  audit({ userId: user.id, action: 'subscription_cancelled' });
  logger.info({ userId: user.id }, 'Subskrypcja anulowana — powrót do planu Free');
}

export default router;
