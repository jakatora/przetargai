# Blockers — PrzetargAI

Format: `[BLOCKER: nazwa]` aktywny · `[RESOLVED: nazwa]` rozwiązany.
Aby zamknąć blocker: „Blocker {nazwa} rozwiązany. Sprawdź, oznacz, kontynuuj."

---

## [RESOLVED: Deploy Firebase] 2026-07-10 — WDROŻONE (D-043)

User nazwał operacje → 9 sekretów w Secret Managerze (Stripe LIVE!), firestore
(reguły+indeksy+TTL) i functions (api `api-00001`+, dailyTenderFetch) na produkcji;
webhook LIVE `we_1TreqyAthGwugrLCyMXRWUft` na URL funkcji; pierwszy cykl:
1500 ogłoszeń (bzp 500 + ted 1000), /health cron.ok=true; /demo/tier → 404 ✓.

### (archiwum) [BLOCKER: HUMAN] Deploy Firebase — zgoda na publikację (2026-07-10)

Migracja D-024: kod F0–F4 gotowy (testy 166/166), Blaze włączony, Firestore
w `europe-central2`. Czeka wyłącznie na jawną zgodę usera na: zapis 9 sekretów
do Secret Managera + `firebase deploy --only firestore` + `--only functions`.
Procedura i punkty powrotu: `runbooks/wdrozenie-firebase.md`.

## [BLOCKER: HUMAN] Decyzja: scraping platform zakupowych (etap 2 źródeł) (2026-07-10)

D-039: BZP + TED są zintegrowane (oficjalne, darmowe API). Następna warstwa —
zapytania ofertowe < 130 tys. zł z platform (platformazakupowa.pl, Logintrade,
OnePlace, SmartPZP, eB2B) — NIE MA publicznych API; wymaga programu scrapingowego
(adapter per platforma, monitoring zmian HTML, przegląd ToS/prawny). To także
pokrywa portale spółek (PKP/PGE/Orlen… prowadzą postępowania NA tych platformach).
Architektura gotowa (rejestr źródeł). **Decyzja usera:** czy wchodzimy w scraping
(nakład + ryzyko ToS), a jeśli tak — od której platformy zaczynamy
(rekomendacja: platformazakupowa.pl — publiczna lista HTML, największy wolumen JST).

## [BLOCKER: HUMAN] Google Play — płatności poza Play (2026-07-10, runda 30)

Opis w `store/listing.md` reklamował zakup subskrypcji przez stronę WWW, a apka
otwiera Stripe Checkout w przeglądarce — polityka płatności Google Play wymaga
Play Billing dla usług cyfrowych konsumowanych w aplikacji i zakazuje kierowania
do zewnętrznej płatności (mitygacja istnieje tylko dla App Store 3.1.1).
Zdanie z opisu usunięte; zostaje DECYZJA PRODUKTOWA przed publikacją na Androida:
wdrożyć Play Billing **albo** ukryć CTA zakupu w buildzie Android.

## [BLOCKER: HUMAN] iOS Push capability w Apple Developer Portal (2026-07-10, runda 30)

Prebuild (expo-notifications) dodaje entitlement `aps-environment` automatycznie.
Przed pierwszym `fetch-signing-files` w Codemagic trzeba w Apple Developer Portal
(Identifiers → `pl.przetargai.app`) włączyć capability **Push Notifications** —
inaczej podpis IPA padnie albo push nie zadziała. Szczegóły: `runbooks/deploy.md` §4.

## [RESOLVED: TIER A keys + Railway deploy] 2026-05-23
Wszystkie klucze TIER A uzupełnione, backend wdrożony na Railway, Stripe webhook utworzony,
`/health` zwraca 200. Patrz `agent_log.md` wpis z 2026-05-23 i `decisions.md` D-016 / D-017.

| Zmienna | Status |
|---------|--------|
| `ANTHROPIC_API_KEY` | ✅ (wkleity w czacie — zalecana rotacja, w vault: prefix `sk-ant-api03-atNxS…`) |
| `STRIPE_SECRET_KEY` | ✅ TEST mode `sk_test_51TZ…` |
| `STRIPE_PRICE_STANDARD` | ✅ `price_1TaDxo…` (produkt „PrzetargAI Standard" 199 PLN/mc utworzony) |
| `STRIPE_WEBHOOK_SECRET` | ✅ `whsec_FTNi…` (endpoint `we_1TaKsv…` na `backend-production-a43e3.up.railway.app/webhooks/stripe`) |
| `RESEND_API_KEY` | ✅ `re_j6ofN…` (wkleity w czacie — zalecana rotacja) |
| `RAILWAY_TOKEN` | ✅ Project Access Token, deploy zrealizowany (zalecana rotacja po stabilizacji) |

## [BLOCKER: HUMAN] Klucze TIER B/C — niekrytyczne dla TEST, wymagane przed LIVE

| Zmienna | Skąd | Status |
|---------|------|--------|
| `FAKTUROWNIA_API_KEY` + `FAKTUROWNIA_DOMAIN` | Fakturownia → Ustawienia → API | ⛔ **wymagane przed Stripe LIVE** (polskie B2B fakturowanie) |
| `SENTRY_DSN_BACKEND` | sentry.io → projekt „przetargai-backend" (Node.js) | ⛔ niekrytyczne, graceful degradation |
| `B2_ACCOUNT_ID` + `B2_APP_KEY` | Backblaze B2 → bucket „przetargai-backups" | ⛔ niekrytyczne (backupy tylko lokalne na wolumenie Railway) |

Wygenerowane lokalnie (gotowe): `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, `ADMIN_API_KEY`.

## [RESOLVED: API BZP] Kontrakt API BZP zweryfikowany

Endpoint odczytu ogłoszeń potwierdzony i działający (2026-05-20):
`GET https://ezamowienia.gov.pl/mo-board/api/v1/notice`. Klient pobiera
realne dane (test: 50 ogłoszeń, pipeline matchingu utworzył dopasowanie).
Mapowanie pól pozostaje defensywne — zmiana kontraktu w przyszłości to nadal
scenariusz eskalacji #1; diagnostyka w `runbooks/bzp-api.md`.

## [BLOCKER: HUMAN] Konta i zasoby do założenia

- Domena `przetargai.pl` (nazwa.pl lub OVH, ~80 zł/rok).
- Repozytorium prywatne GitHub „przetargai".
- UptimeRobot (free) — monitoring `/health` po deployu.
- Konta deweloperskie Apple Developer / Google Play (Tydzień 3–4).
- Codemagic — konfiguracja UI dla apki PrzetargAI: grupa `ios_signing`
  (`CERTIFICATE_PRIVATE_KEY`), grupa `google_credentials`
  (`GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`), nowy keystore `przetargai_keystore`.
  Integracja App Store Connect „ProbWin AI Connect Key" jest reużywalna
  (poziom konta). Szczegóły: `runbooks/deploy.md`.
- `npx eas init` w `mobile/` — tylko rejestracja projektu Expo dla powiadomień push
  (buildy idą przez Codemagic).
- Docelowe ikony aplikacji mobilnej w `mobile/assets/` (obecnie placeholdery z szablonu Expo).
