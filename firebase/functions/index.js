import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';

/*
 * PrzetargAI na Cloud Functions v2 — migracja z Railway (plan:
 * plans/MIGRACJA-FIREBASE.md, decyzja D-024).
 *
 * Całe API mieszka w JEDNEJ funkcji HTTPS `api` (Express sam routuje po ścieżce),
 * a cykl dzienny w `dailyTenderFetch`. Trasy `/api/fitter/*` NIE przechodzą —
 * Fitter Welder Pro został na Railway i ma tam własny webhook Stripe.
 */

setGlobalOptions({ region: 'europe-central2', maxInstances: 10 });

initializeApp();

// Sekrety z Secret Manager — wstrzykiwane do process.env przy starcie funkcji.
// Deklaracja jest jednocześnie listą uprawnień: funkcja widzi tylko to, co tu jest.
const JWT_SECRET = defineSecret('JWT_SECRET');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_STANDARD = defineSecret('STRIPE_PRICE_STANDARD');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const FAKTUROWNIA_API_KEY = defineSecret('FAKTUROWNIA_API_KEY');
// Nazwa konta w Fakturowni nie jest sekretem, ale MUSI dojechać do środowiska
// funkcji: `features.invoicing` wymaga OBU wartości. Bez niej wystawianie faktur
// VAT byłoby po cichu wyłączone mimo wgranego klucza API (audyt 2026-07-10).
const FAKTUROWNIA_DOMAIN = defineSecret('FAKTUROWNIA_DOMAIN');
const ADMIN_API_KEY = defineSecret('ADMIN_API_KEY');

const SEKRETY_API = [
  JWT_SECRET, ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_STANDARD, RESEND_API_KEY, FAKTUROWNIA_API_KEY, FAKTUROWNIA_DOMAIN,
  ADMIN_API_KEY,
];

/*
 * Aplikacja budowana RAZ na instancję funkcji, nie na żądanie.
 *
 * Audyt 2026-07-10 (CRITICAL): `createApp()` w handlerze tworzył nową apkę przy
 * każdym wywołaniu, a z nią nowe liczniki `express-rate-limit` (MemoryStore).
 * Licznik prób resetował się co żądanie, więc WSZYSTKIE limity były martwe:
 * zgadywanie hasła i klucza administratora bez żadnego ograniczenia.
 *
 * Import jest leniwy, bo config.js waliduje sekrety już przy ładowaniu modułu,
 * a te istnieją dopiero w środowisku uruchomionej funkcji. Cache trzyma OBIETNICĘ,
 * żeby dwa równoległe pierwsze żądania nie zbudowały dwóch aplikacji.
 */
let aplikacja = null;
function pobierzAplikacje() {
  // Cache trzyma OBIETNICĘ, żeby dwa równoległe pierwsze żądania nie zbudowały
  // dwóch aplikacji (a z nimi dwóch zestawów liczników limitera). Gdy budowa
  // padnie (np. brak sekretu przy zimnym starcie), czyścimy cache — inaczej
  // zapamiętalibyśmy odrzuconą obietnicę i instancja byłaby martwa aż do restartu.
  aplikacja ??= import('./src/app.js')
    .then(({ createApp }) => createApp())
    .catch((err) => { aplikacja = null; throw err; });
  return aplikacja;
}

/** Całe API pod jedną funkcją — Express sam routuje po ścieżce. */
/*
 * timeoutSeconds 300: domyslne 60 s nie miescilo backfillu planu Standard
 * (do 30 wywolan AI po puli ~1500 ogloszen) - /admin/match-user konczyl sie
 * 504 w trakcie incydentu D-046, a webhook aktywacji tez przelicza feed.
 */
export const api = onRequest({ secrets: SEKRETY_API, memory: '512MiB', timeoutSeconds: 300 }, async (req, res) => {
  const app = await pobierzAplikacje();
  return app(req, res);
});

/**
 * Codzienne pobranie przetargów o 12:00 czasu polskiego (D-021) — nośnikiem
 * jest Cloud Scheduler zamiast node-crona.
 *
 * Dopasowania liczą się z PULI otwartych przetargów, nie tylko z ogłoszeń
 * pobranych w tym cyklu (naprawa P-4), więc job ma sens także przy zerze nowych:
 * konto Free odbiera wtedy przetargi odroczone wczoraj przez dzienny limit.
 */
export const dailyTenderFetch = onSchedule(
  {
    schedule: '0 12 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [JWT_SECRET, ANTHROPIC_API_KEY, RESEND_API_KEY],
  },
  async () => {
    const { runTenderFetch } = await import('./src/jobs/fetchTenders.js');
    const wynik = await runTenderFetch();

    if (!wynik.ok) {
      // Rzucamy, żeby Cloud Scheduler odnotował NIEPOWODZENIE i uruchomił ponowienie.
      // Wcześniej job logował „zakończony" i kończył się sukcesem także wtedy, gdy
      // BZP było nieosiągalne albo cykl dopasowań padł (audyt 2026-07-10) — nikt
      // by się nie dowiedział, że użytkownicy nie dostali dziś żadnych przetargów.
      console.error(JSON.stringify({ severity: 'ERROR', message: 'dailyTenderFetch NIE POWIÓDŁ SIĘ', ...wynik }));
      throw new Error(`dailyTenderFetch: ${wynik.error ?? 'nieznany błąd'}`);
    }

    console.log(JSON.stringify({ severity: 'INFO', message: 'dailyTenderFetch zakończony', ...wynik }));
  },
);

/**
 * Przypomnienia o terminach składania ofert dla ZAPISANYCH przetargów (D-050).
 * Co 6 godzin — częściej niż cykl dobowy, bo terminy „za kilka godzin" muszą
 * zdążyć. Push idzie tylko do użytkowników z tokenem; wpis oznaczany jako
 * powiadomiony, więc każde przypomnienie leci dokładnie raz.
 */
export const remindDeadlines = onSchedule(
  {
    schedule: '0 */6 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 300,
    memory: '256MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runReminderCheck } = await import('./src/jobs/remindDeadlines.js');
    const wynik = await runReminderCheck();
    console.log(JSON.stringify({ severity: 'INFO', message: 'remindDeadlines zakończony', ...wynik }));
  },
);
