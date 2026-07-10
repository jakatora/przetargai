# Runbook — Wdrożenie produkcyjne

Kolejność: backend (Railway) → Stripe webhook → landing (Vercel) → aplikacja (EAS).

## 0. Wymagania wstępne

Konta: Railway, Vercel, Stripe, Anthropic, Resend, Fakturownia, Sentry,
Backblaze B2, Apple Developer, Google Play, domena `przetargai.pl`.
Klucze API zebrane wg `blockers.md`.

---

## 1. Backend → Railway

1. Railway → **New Project** → **Deploy from GitHub repo** (repo `przetargai`).
2. W ustawieniach serwisu ustaw **Root Directory** na `backend`.
   Plik `backend/railway.json` skonfiguruje build (Nixpacks) i healthcheck `/health`.
3. **Wolumen na bazę** (SQLite wymaga trwałego dysku — system plików Railway
   jest ulotny): dodaj **Volume** zamontowany np. w `/data`.
4. W zakładce **Variables** ustaw zmienne środowiskowe z `backend/.env.example`:
   - `NODE_ENV=production`
   - `DATABASE_PATH=/data/data.db` (ścieżka na wolumenie)
   - `JWT_SECRET`, `ADMIN_API_KEY`, `BACKUP_ENCRYPTION_KEY` — wygenerowane sekrety
   - `ANTHROPIC_API_KEY`, `STRIPE_*`, `RESEND_API_KEY`, `FAKTUROWNIA_*`,
     `SENTRY_DSN_BACKEND`, `B2_*`
   - `APP_URL` = publiczny adres backendu, `LANDING_URL=https://przetargai.pl`
   - `PORT` ustawia Railway automatycznie.
5. Deploy. Po wdrożeniu sprawdź `https://<backend>/health` → `{"status":"ok"}`.

---

## 2. Stripe — produkt i webhook

1. Stripe → **Products** → utwórz „PrzetargAI Standard": 199 zł + 23% VAT,
   cykl miesięczny. Skopiuj `price_...` do `STRIPE_PRICE_STANDARD`.
2. Stripe → **Developers → Webhooks** → dodaj endpoint:
   `https://<backend>/webhooks/stripe`, zdarzenia (KOMPLET — handler wstrzymuje
   aktywację przy `payment_status !== 'paid'` i czeka na `async_payment_succeeded`;
   bez `subscription.updated` niepłacący nigdy nie traci planu):
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `invoice.paid`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
3. Skopiuj `whsec_...` do `STRIPE_WEBHOOK_SECRET` w Railway i zredeployuj.

---

## 3. Landing → Vercel

1. W `landing/config.js` ustaw `API_URL` na publiczny adres backendu z Railway.
2. Vercel → **New Project** → import repo, **Root Directory** = `landing`.
   `landing/vercel.json` włącza czyste URL-e i nagłówki bezpieczeństwa.
3. Deploy. Podłącz domenę `przetargai.pl` (Vercel → Domains; ustaw rekordy DNS
   u rejestratora domeny).
4. Sprawdź: strona główna, `/upgrade`, `/regulamin`, `/polityka-prywatnosci`.

---

## 4. Aplikacja mobilna → Codemagic

Buildy iOS i Android realizuje **Codemagic** wg `codemagic.yaml` (katalog główny repo).
Aplikacja Expo jest „managed" — natywne katalogi `ios/`/`android/` generuje w CI
`expo prebuild`.

**Przygotowanie:**
1. Backend aplikacji: produkcyjny build bez zmiennych celuje w stałą `RAILWAY`
   z `mobile/src/config.js`. Inny backend (np. Firebase po migracji D-024) wskazuje
   się zmienną **`EXPO_PUBLIC_API_URL`** ustawioną w środowisku builda
   (Codemagic → workflow → Environment variables) — zmienne `EXPO_PUBLIC_*`
   trafiają do bundla przy budowaniu, w kodzie nic się nie edytuje.
2. Podmień placeholdery ikon w `mobile/assets/` na docelowe.
3. Powiadomienia push: uruchom raz `npx eas init` w `mobile/` — rejestruje projekt
   Expo i zapisuje `projectId` w `app.json` (same buildy idą przez Codemagic).
   **iOS dodatkowo:** w Apple Developer Portal (Identifiers → `pl.przetargai.app`)
   włącz capability **Push Notifications** ZANIM Codemagic pobierze pliki podpisu
   (`fetch-signing-files`) — prebuild dodaje entitlement `aps-environment`
   automatycznie (expo-notifications) i profil bez tej capability nie podpisze IPA.

**Konfiguracja Codemagic UI** (dla nowej apki PrzetargAI):
- Dodaj aplikację (repo `przetargai`) — Codemagic wykryje `codemagic.yaml`.
- Integracja App Store Connect — **reużyj istniejącą „ProbWin AI Connect Key"**
  (klucz API jest na poziomie konta; już wpisana w `codemagic.yaml`).
- Grupa zmiennych **ios_signing** z `CERTIFICATE_PRIVATE_KEY` — trwały klucz RSA
  (base64, Secure), aby uniknąć limitu certyfikatów Apple (błąd 409).
- Grupa zmiennych **google_credentials** z `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`
  (konto usługi Google Play, JSON).
- Keystore Androida — wgraj **nowy** keystore jako referencję **przetargai_keystore**
  (keystore jest per-aplikacja, nie współdziel z innymi apkami).

**Kolejność po stronie Apple** (przed pierwszym buildem): App ID w Developer Portal,
aplikacja w App Store Connect, podpisane umowy, API Key z rolą Admin.

**Build:** uruchom workflow `ios-release` / `android-release` z panelu Codemagic.
iOS trafia na TestFlight, Android na ścieżkę „internal" Google Play (jako szkic).
Metadane sklepów uzupełnij wg `store/listing.md`.

---

## 5. Monitoring po wdrożeniu

- **UptimeRobot** — monitor HTTP na `https://<backend>/health`, interwał 5 min.
- **Sentry** — sprawdź, czy projekt `przetargai-backend` odbiera zdarzenia.
- Zweryfikuj pełny przepływ: rejestracja → dopasowania → `/upgrade` →
  płatność testowa Stripe → webhook → zmiana planu na Standard.

---

## 6. Weryfikacja kopii zapasowych

Po wdrożeniu uruchom ręczny backup i potwierdź wysyłkę do B2:
`POST https://<backend>/admin/backup` z nagłówkiem `x-admin-key`.
Harmonogram (`BACKUP_CRON`, domyślnie 03:00) zadziała automatycznie.
