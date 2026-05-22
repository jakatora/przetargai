# Runbook — Jak zdobyć klucze API

Przewodnik krok po kroku. Każdą wartość wklejasz do **`backend/.env`**
(zmienna podana przy każdej pozycji). Kolejność jest celowa.

Legenda: 🟢 można zrobić od razu · 🟡 wymaga domeny · 🔵 wymaga wdrożonego backendu.

---

## Już gotowe (nic nie robisz)

- `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, `ADMIN_API_KEY` — wygenerowane, są w `.env`.
- `CERTIFICATE_PRIVATE_KEY` (iOS) — reużywasz wartości z ProbWin AI w Codemagic.

---

## 1. 🟢 Anthropic — `ANTHROPIC_API_KEY`

1. Wejdź na **console.anthropic.com**, zaloguj się.
2. **Settings → Billing** — doładuj kredyty (np. 5–10 USD na start).
3. **Settings → API keys → Create Key**, nazwa np. „przetargai".
4. Skopiuj klucz `sk-ant-...` → `ANTHROPIC_API_KEY`.

> Bez tego klucza matching działa na heurystyce — backend i tak działa.

## 2. 🟢 Sentry — `SENTRY_DSN_BACKEND`

1. Wejdź na **sentry.io**, załóż konto (darmowy plan).
2. **Create Project** → platforma **Node.js** → nazwa „przetargai-backend".
3. Po utworzeniu skopiuj **DSN** (`https://...@o....ingest.sentry.io/...`)
   → `SENTRY_DSN_BACKEND`.

## 3. 🟢 Backblaze B2 — `B2_ACCOUNT_ID`, `B2_APP_KEY`

1. Wejdź na **backblaze.com**, załóż konto, włącz **B2 Cloud Storage**.
2. **Buckets → Create a Bucket**: nazwa `przetargai-backups`, typ **Private**.
3. **Application Keys → Add a New Application Key**:
   - Allow access to Bucket: `przetargai-backups`,
   - Type: Read and Write.
4. Po utworzeniu zobaczysz **keyID** i **applicationKey** (pokazane RAZ):
   - `keyID` → `B2_ACCOUNT_ID`
   - `applicationKey` → `B2_APP_KEY`
5. `B2_BUCKET` zostaw `przetargai-backups`.

## 4. 🟢 Fakturownia — `FAKTUROWNIA_API_KEY`, `FAKTUROWNIA_DOMAIN`

1. Załóż konto na **fakturownia.pl**.
2. Twój adres konta to `nazwa.fakturownia.pl` → `FAKTUROWNIA_DOMAIN` = `nazwa.fakturownia.pl`.
3. **Ustawienia → Ustawienia konta → Integracje / API** — skopiuj **kod autoryzacyjny API**
   → `FAKTUROWNIA_API_KEY`.

## 5. 🟢 Stripe — `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STANDARD`

1. Załóż konto na **dashboard.stripe.com** (dane polskiej firmy).
2. Zostań w trybie **TEST** (przełącznik w prawym górnym rogu).
3. **Developers → API keys** → skopiuj **Secret key** `sk_test_...`
   → `STRIPE_SECRET_KEY`.
4. **Products → Add product**:
   - Nazwa: `PrzetargAI Standard`,
   - Cena: **199 PLN**, model **Recurring**, okres **monthly**.
5. Po zapisaniu kliknij cenę i skopiuj **Price ID** `price_...`
   → `STRIPE_PRICE_STANDARD`.
6. (Opcjonalnie) włącz **Stripe Tax** dla automatycznego VAT 23%.

> `STRIPE_WEBHOOK_SECRET` zdobędziesz w kroku 9 (po wdrożeniu backendu).

---

## 6. 🟡 Domena `przetargai.pl`

1. Kup domenę na **nazwa.pl** lub **OVH** (~80 zł/rok).
2. Potrzebna do: landing page (Vercel), e-maili (Resend), linku polityki prywatności.

## 7. 🟡 Resend — `RESEND_API_KEY`

1. Załóż konto na **resend.com** (darmowo 3000 maili/mc).
2. **API Keys → Create API Key** → skopiuj `re_...` → `RESEND_API_KEY`.
3. **Domains → Add Domain** → `przetargai.pl` → dodaj pokazane rekordy DNS
   (SPF, DKIM) u rejestratora domeny. Po weryfikacji możesz wysyłać z
   `noreply@przetargai.pl`.

> Bez zweryfikowanej domeny e-maile działają w trybie testowym Resend.

---

## 8. 🟢 GitHub — repozytorium

1. **github.com → New repository**: nazwa `przetargai`, widoczność **Private**.
2. Posłuży do wdrożeń (Railway, Vercel, Codemagic podłączają się do repo).

## 9. 🔵 Stripe webhook — `STRIPE_WEBHOOK_SECRET`

Wykonujesz **po wdrożeniu backendu** (gdy znasz jego adres):

1. **Developers → Webhooks → Add endpoint**.
2. URL: `https://<adres-backendu>/webhooks/stripe`.
3. Zdarzenia: `checkout.session.completed`, `customer.subscription.deleted`.
4. Po zapisaniu skopiuj **Signing secret** `whsec_...` → `STRIPE_WEBHOOK_SECRET`.

## 10. 🔵 Railway — `RAILWAY_TOKEN` (opcjonalne)

Przy wdrożeniu przez panel Railway (GitHub) **token nie jest potrzebny**.
Token przyda się tylko do wdrożeń z CLI: **railway.app → Account Settings →
Tokens → Create Token** → `RAILWAY_TOKEN`.

## 11. 🔵 UptimeRobot

Po wdrożeniu: **uptimerobot.com** (darmowe konto) → **Add New Monitor** →
typ HTTP(s), URL `https://<backend>/health`, interwał 5 min.

---

## Sklepy mobilne (Tydzień 4)

### 12. Android keystore (`przetargai_keystore` w Codemagic)

Wygeneruj **nowy** keystore (per-aplikacja) — w PowerShell:

```powershell
keytool -genkeypair -v -keystore przetargai-upload.keystore `
  -alias przetargai -keyalg RSA -keysize 2048 -validity 10000
```

Zapamiętaj hasła. Plik `.keystore` wgraj w Codemagic UI jako referencję
`przetargai_keystore`. **Nie commituj go do repo.**

### 13. Google Play — `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`

1. **Google Play Console** (konto deweloperskie, 25 USD jednorazowo).
2. **Setup → API access** → połącz/utwórz projekt Google Cloud.
3. Utwórz **Service Account**, pobierz klucz **JSON**.
4. W Play Console nadaj temu kontu uprawnienia do publikacji.
5. Zawartość pliku JSON → zmienna `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`
   w Codemagic (grupa `google_credentials`).

### 14. Apple — już masz

Konto Apple Developer, Team ID, integracja App Store Connect — gotowe
(patrz pamięć / `runbooks/deploy.md`). Trzeba tylko utworzyć aplikację
w App Store Connect z bundle ID `pl.przetargai.app`.

---

## Podsumowanie — co gdzie trafia

| Zmienna | Plik / miejsce |
|---------|----------------|
| `ANTHROPIC_API_KEY`, `STRIPE_*`, `RESEND_API_KEY`, `FAKTUROWNIA_*`, `SENTRY_DSN_BACKEND`, `B2_*` | `backend/.env` (lokalnie) oraz zmienne w Railway (produkcja) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`, `CERTIFICATE_PRIVATE_KEY` | Codemagic (zmienne środowiskowe) |
| keystore `.keystore`, klucz `.p8` | Codemagic UI (nie do repo) |
