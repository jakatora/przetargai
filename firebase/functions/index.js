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
 * Domykanie okna BZP co 3 godziny (P0-2).
 *
 * DLACZEGO OSOBNA FUNKCJA: pełne okno 7 dni to do 119 zapytań, a zmierzony czas
 * na żywym API (2026-09-24) to 389 s przy 87 zapytaniach. `dailyTenderFetch` ma
 * twardy limit 540 s i musi jeszcze policzyć dopasowania — pobieranie po prostu
 * się tam nie mieści i było cicho ucinane (audyt 2026-09-23: 1 330 ogłoszeń
 * zamiast ~3 000 unikalnych w oknie).
 *
 * Ta funkcja robi JEDNO: dopobiera doby, których checkpoint jeszcze nie domknął.
 * Bez dopasowań, bez AI, bez kosztów poza odczytem publicznego API BZP.
 * Idempotencja: docId przetargu = identyfikator z BZP, więc powtórki są nieszkodliwe.
 */
export const bzpOknoFetch = onSchedule(
  {
    schedule: '20 */3 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 1800,
    memory: '512MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runBzpOkno } = await import('./src/jobs/oknoBzp.js');
    const wynik = await runBzpOkno();

    if (!wynik.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: 'bzpOknoFetch NIE POWIÓDŁ SIĘ', ...wynik }));
      throw new Error(`bzpOknoFetch: ${wynik.error ?? 'nieznany błąd'}`);
    }
    console.log(JSON.stringify({ severity: 'INFO', message: 'bzpOknoFetch zakończony', ...wynik }));
  },
);

/**
 * Domykanie okna Bazy Konkurencyjności co 3 godziny, w przeplocie z BZP (etap 3).
 *
 * DLACZEGO OSOBNA FUNKCJA: wartość zamówienia i CPV są WYŁĄCZNIE w szczegółach
 * (`GET /announcements/{id}`), więc pełny import to N+1 — przy 1 135 aktywnych
 * ogłoszeniach i 171 nowych dziennie (pomiar 2026-09-24) nie ma szans zmieścić się
 * w `dailyTenderFetch`, który musi jeszcze policzyć dopasowania. Checkpoint pobiera
 * szczegóły tylko dla ogłoszeń nowych i zmienionych, więc przebieg jest krótki.
 *
 * Harmonogram przesunięty o 50 minut względem `bzpOknoFetch`, żeby dwa importy nie
 * konkurowały o ten sam budżet instancji i o łącze.
 *
 * Bez dopasowań, bez AI, bez kosztów poza odczytem publicznego API BK.
 * Idempotencja: docId przetargu = `bk:<id>`, więc powtórki są nieszkodliwe.
 */
export const bkOknoFetch = onSchedule(
  {
    schedule: '50 */3 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 900,
    memory: '512MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runBkOkno } = await import('./src/jobs/oknoBk.js');
    const wynik = await runBkOkno();

    if (!wynik.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: 'bkOknoFetch NIE POWIÓDŁ SIĘ', ...wynik }));
      throw new Error(`bkOknoFetch: ${wynik.error ?? 'nieznany błąd'}`);
    }
    console.log(JSON.stringify({ severity: 'INFO', message: 'bkOknoFetch zakończony', ...wynik }));
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

/**
 * MONITORING ZAPISANYCH WYSZUKIWAŃ (etap 5) — co 2 godziny.
 *
 * DLACZEGO CO 2 GODZINY, a nie rzadziej: obietnica produktu brzmi „zmiana terminu
 * jest u Ciebie w ciągu 6 godzin". Budżet tej obietnicy dzieli się na dwa etapy,
 * które składają się szeregowo:
 *
 *   wykrycie      — okna źródeł chodzą co 3 h (`bzpOknoFetch` :20, `bkOknoFetch` :50),
 *                   więc zmiana jest w bazie najpóźniej ~3 h po publikacji,
 *   powiadomienie — ten job, co 2 h.
 *
 * Najgorszy przypadek to 3 h + 2 h = 5 h, czyli godzina zapasu na opóźnienie
 * harmonogramu i ponowienie. Przy przebiegu co 6 h najgorszy przypadek wynosiłby
 * 9 h i obietnica byłaby nieprawdziwa.
 *
 * Minuta :35 rozdziela ten job od obu okien pobierania, żeby trzy zadania nie biły
 * się o ten sam budżet instancji.
 *
 * Bez płatnego AI (strażnik w test/monitorWyszukiwan.test.js czyta źródło joba),
 * więc częstotliwość nie przekłada się na koszt modelu. RESEND_API_KEY jest potrzebny
 * do e-maili dla kont bez tokenu push; bez niego job działa w trybie degradacji.
 */
export const monitorWyszukiwan = onSchedule(
  {
    schedule: '35 */2 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [JWT_SECRET, RESEND_API_KEY],
  },
  async () => {
    const { runMonitorWyszukiwan } = await import('./src/jobs/monitorWyszukiwan.js');
    const wynik = await runMonitorWyszukiwan();

    if (!wynik.ok) {
      /*
       * Rzucamy, żeby Cloud Scheduler odnotował NIEPOWODZENIE i ponowił przebieg.
       * Ponowienie jest bezpieczne: alert ma deterministyczny klucz (docId), więc
       * nie wyśle się drugi raz, a obserwacje obsłużone przed błędem mają już
       * przesunięty checkpoint.
       */
      console.error(JSON.stringify({ severity: 'ERROR', message: 'monitorWyszukiwan: część obserwacji padła', ...wynik }));
      throw new Error(`monitorWyszukiwan: ${wynik.bledy} obserwacji zakończyło się błędem`);
    }
    console.log(JSON.stringify({ severity: 'INFO', message: 'monitorWyszukiwan zakończony', ...wynik }));
  },
);

/**
 * Cotygodniowy przegląd e-mail (roadmap #10, D-057). Poniedziałek 8:00 czasu
 * polskiego — początek tygodnia, gdy firmy planują, w co startować. Wysyłamy tylko
 * do kont z ≥1 nowym dopasowaniem w minionym tygodniu (bez spamu). RESEND_API_KEY
 * do wysyłki; bez niego job działa w trybie degradacji (loguje, nie wysyła).
 */
export const weeklyDigest = onSchedule(
  {
    schedule: '0 8 * * 1',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: [JWT_SECRET, RESEND_API_KEY],
  },
  async () => {
    const { runWeeklyDigest } = await import('./src/jobs/weeklyDigest.js');
    const wynik = await runWeeklyDigest();
    console.log(JSON.stringify({ severity: 'INFO', message: 'weeklyDigest zakończony', ...wynik }));
  },
);

/**
 * Domykanie okna ROZSTRZYGNIĘĆ co 6 godzin (etap 6).
 *
 * DLACZEGO OSOBNA FUNKCJA: `aggregateResults` pobierał 30 dni BZP, liczył agregat
 * i WYRZUCAŁ dane źródłowe — pojedyncze rozstrzygnięcie nie zostawało nigdzie,
 * więc benchmark „u TEGO zamawiającego" nie miał z czego powstać, a każde
 * przeliczenie wymagało ponownego przemielenia rejestru (~390 s samego ruchu).
 * Tu rozstrzygnięcia z BZP i TED lądują w bazie, a agregat liczy się z nich.
 *
 * Minuta :05 i co 6 h rozdziela ten job od okien ogłoszeń (`bzpOknoFetch` :20,
 * `bkOknoFetch` :50) i od monitoringu (:35), żeby nie biły się o budżet instancji.
 *
 * Bez dopasowań, bez AI — koszt to odczyty publicznych API i zapisy do Firestore.
 */
export const wynikiOknoFetch = onSchedule(
  {
    schedule: '5 */6 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 1800,
    memory: '512MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runOknoWynikow } = await import('./src/jobs/oknoWynikow.js');
    const wynik = await runOknoWynikow();

    if (!wynik.ok) {
      console.error(JSON.stringify({ severity: 'ERROR', message: 'wynikiOknoFetch NIE POWIÓDŁ SIĘ', ...wynik }));
      throw new Error(`wynikiOknoFetch: ${wynik.error ?? 'nieznany błąd'}`);
    }
    console.log(JSON.stringify({ severity: 'INFO', message: 'wynikiOknoFetch zakończony', ...wynik }));
  },
);

/**
 * Przeliczenie BENCHMARKU rynku (etap 6) — codziennie o 3:40.
 *
 * Czyta wyłącznie zapisane rozstrzygnięcia, więc nie dotyka rejestrów i nie woła
 * AI. Dzięki temu benchmark da się odświeżyć po każdej poprawce parsera bez
 * ponownego mielenia BZP. Codziennie, bo `wynikiOknoFetch` dokłada dane co 6 h,
 * a mediana z wczoraj nie boli — byle metryczka `probka` mówiła prawdę.
 */
export const benchmarkPrzelicz = onSchedule(
  {
    schedule: '40 3 * * *',
    timeZone: 'Europe/Warsaw',
    timeoutSeconds: 1800,
    memory: '512MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runBenchmarkRynku } = await import('./src/jobs/benchmarkRynku.js');
    const wynik = await runBenchmarkRynku();
    console.log(JSON.stringify({ severity: 'INFO', message: 'benchmarkPrzelicz zakończony', ...wynik }));
  },
);

/**
 * Agregacja wyników postępowań (runda 16). Statystyki cen/konkurencji zmieniają się
 * wolno — liczymy je raz w tygodniu (niedziela 4:00) z szerokiego okna 30 dni.
 * Osobno od dziennego matchingu, bo pobiera inny typ ogłoszeń (TenderResultNotice).
 */
export const aggregateResults = onSchedule(
  {
    schedule: '0 4 * * 0',
    timeZone: 'Europe/Warsaw',
    // Gen2 dopuszcza do 3600 s. Budżet POBIERANIA i tak tnie się na 420 s w kodzie —
    // ten zapas chroni przed egzekucją, gdyby agregacja/zapis trwały dłużej (audyt R18).
    timeoutSeconds: 1800,
    memory: '512MiB',
    secrets: [JWT_SECRET],
  },
  async () => {
    const { runWynikiAggregation } = await import('./src/jobs/aggregateResults.js');
    const wynik = await runWynikiAggregation({ dni: 30 });
    console.log(JSON.stringify({ severity: 'INFO', message: 'aggregateResults zakończony', ...wynik }));
  },
);
