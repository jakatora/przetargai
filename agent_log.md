# Agent Log — PrzetargAI

Dziennik prac. Najnowsze wpisy na górze.

---

## 2026-05-23 — Backend LIVE na Railway + Stripe webhook

### Wykonane
- **Code: usunięcie landingu** (D-016). Backend serwuje upgrade flow w pełni:
  - `GET /upgrade?user_id=&token=` → 303 redirect do Stripe Checkout (magic link z maila)
  - `GET /upgrade/success`, `GET /upgrade/cancel` → mobile-first HTML, zero JS, zero zależności
  - `services/stripe.js`: `success_url`/`cancel_url` z `LANDING_URL` na `APP_URL`
  - `services/magicLink.js`: link mailowy wskazuje na backend, nie landing
  - 16/16 testów dalej zielone. Commit `0770fb2`.
- **Deploy backendu (D-017): Railway GraphQL z Project Access Token**, nie CLI/UI:
  - Projekt `adventurous-magic` (auto-name), service `backend`, root dir `backend`
  - Wolumen `/data` na SQLite (id `2e7a8a1e-…`)
  - Domena: `backend-production-a43e3.up.railway.app` (HTTPS auto)
  - 28 zmiennych env: 23 z lokalnego `.env`, 2 stransformowane (NODE_ENV=production, DATABASE_PATH=/data/data.db), PORT pominięty (Railway), STRIPE_WEBHOOK_SECRET dodany po wygenerowaniu
  - Build/deploy ~30 s przez Nixpacks
- **Stripe webhook**: utworzony przez API (`we_1TaKsvAom97JfF2jmoJ5Hx4c`), eventy:
  `checkout.session.completed`, `customer.subscription.deleted`. Secret `whsec_…` zapisany w:
  Railway vars + `backend/.env` + `~/.api-keys/keys.env` (vault user-poziom, opisany w MEMORY).
- **Smoke test**: `GET /health` → `200 {"status":"ok","app":"PrzetargAI","env":"production","db":true}` — wolumen + SQLite konfiguracja działa.

### Następne kroki
- **E2E test:** rejestracja (POST `/auth/register`) → magic link → `/upgrade` → Stripe Checkout `4242 4242 4242 4242` → webhook → upgrade na Standard. Można zrobić curl'em.
- **Mobile build:** w `mobile/src/config.js` (gałąź `else`/production) wstaw `API_URL=https://backend-production-a43e3.up.railway.app` → Codemagic workflows `android-release` / `ios-release`. Wymaga: ikony, konta Apple/Google, konfiguracja Codemagic UI.
- **Fakturownia (TIER B)** — wymagane przed włączeniem Stripe LIVE.
- **Domena `przetargai.pl`** — opcjonalna, do podpięcia jako custom domain do backendu Railway (`serviceDomainCreate` z `customDomain`). Bez landingu domena jest tylko ładnym aliasem.

---

## 2026-05-21 — Zmiana: buildy mobilne przez Codemagic

Na życzenie właściciela buildy aplikacji idą przez **Codemagic**, nie EAS.
- Dodano `codemagic.yaml` (workflowy `ios-release`, `android-release`).
- `mobile/scripts/configure-android-release-signing.mjs` — podpis release Androida.
- Usunięto `mobile/eas.json`; `app.json`: iPhone-only (`supportsTablet:false`),
  `ITSAppUsesNonExemptEncryption=false`.
- Zastosowano lekcje z [[codemagic-flutter-ios-lessons]] (trwały cert, brak
  bloku `ios_signing:`, auto `export_options.plist`).
- Zaktualizowano `runbooks/deploy.md`, `mobile/README.md`, `store/listing.md`, `blockers.md`.

---

## 2026-05-21 — Tydzień 3 (przygotowanie do wdrożenia)

### Wykonane
- **Kopie zapasowe** — serwis `backup.js`: spójny snapshot (`VACUUM INTO`),
  szyfrowanie AES-256-GCM, zapis lokalny + wysyłka do Backblaze B2 (`b2.js`).
  Harmonogram dobowy (`BACKUP_CRON`), `POST /admin/backup`, `npm run backup`.
  Zweryfikowano: backup + odszyfrowanie dają poprawny plik SQLite.
- **Wdrożenie backendu** — `backend/railway.json` (Nixpacks, healthcheck `/health`), `.nvmrc`.
- **EAS** — `mobile/eas.json` (profile development / preview / production).
- **Strony prawne** — polityka prywatności (RODO) i regulamin na landingu + linki w stopce.
- **Metadane sklepów** — `store/listing.md` (App Store + Google Play, gotowe teksty PL).
- **Runbooki** — `deploy.md` (Railway/Vercel/EAS/Stripe) i `incident.md`
  (awarie + przywracanie bazy z zaszyfrowanej kopii).
- Weryfikacja: 16 testów backendu przechodzi, serwer startuje z 2 zadaniami cron.

### Następne kroki (wymaga kont/kluczy użytkownika)
- Właściwy deploy: Railway (backend + wolumen na SQLite), Vercel (landing), EAS (buildy).
- `eas init`, docelowe ikony aplikacji, konta Apple/Google, domena `przetargai.pl`.

---

## 2026-05-21 — Tydzień 2: Landing page + aplikacja mobilna

### Wykonane
- **Landing page** (`landing/`) — statyczny HTML/CSS/JS, gotowy na Vercel:
  - Strona główna: hero, funkcje, „jak działa", cennik (Free / Standard 199 zł), FAQ.
  - Przepływ `/upgrade`: magic link → `POST /upgrade` → Stripe Checkout; strony success/cancel.
  - `vercel.json` (cleanUrls + nagłówki bezpieczeństwa).
- **Aplikacja mobilna** (`mobile/`) — React Native + Expo SDK 54:
  - Nawigacja React Navigation (native-stack): osobny stos auth i aplikacji.
  - Auth: token w expo-secure-store, AuthContext, odtwarzanie sesji przy starcie.
  - Ekrany: Login, Rejestracja, Feed dopasowań, Szczegóły przetargu, Konto.
  - Powiadomienia push (Expo), klient REST API, motyw spójny z landingiem.
  - Weryfikacja: `expo-doctor` 17/17, Metro bundle 973 modułów — bez błędów.

### Następne kroki
- Tydzień 3: deploy (backend → Railway, landing → Vercel), beta, zgłoszenia do sklepów.
- Uzupełnić klucze API (`blockers.md`), `eas init` (push + buildy), docelowe ikony aplikacji.

---

## 2026-05-20 — Stage 1–5: Backend MVP

Start: 2026-05-20. Plan: PrzetargAI MVP (3–4 tygodnie).
Wszystkie sekrety obecne: częściowo — lokalne sekrety wygenerowane,
klucze API zewnętrzne do uzupełnienia (patrz `blockers.md`).
Strategia iOS: darmowe narzędzie B2B.

### Wykonane
- **Stage 1 — Inicjalizacja**
  - Utworzono repozytorium `c:\Users\Startklaar\Documents\przetarg-ai` (`git init`, branch `main`).
  - Struktura monorepo: `backend/`, `plans/`, `runbooks/`, `backups/`.
  - Pliki workflow: `agent_log.md`, `decisions.md`, `blockers.md`.
  - `.gitignore`, `.env.example`, `.env` (z wygenerowanymi sekretami lokalnymi).
  - Wygenerowano: `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, `ADMIN_API_KEY` (PowerShell RNG).
- **Stage 2 — Szkielet backendu**
  - Node.js (ESM) + Express, walidacja env (zod), logger (pino).
  - Baza: `node:sqlite` (wbudowane w Node 24 — bez kompilacji natywnej).
  - Schemat: users, tenders, matches, feedback, audit_logs, ai_usage, magic_links.
- **Stage 3 — Auth**
  - Walidacja NIP (algorytm sumy kontrolnej), rejestracja firmy, login, JWT (30 dni).
  - Audit logging dostępu do danych (RODO).
- **Stage 4 — Integracja BZP**
  - Klient API BZP (konfigurowalny), ingest przetargów, job pobierający (cron).
  - Endpoint zweryfikowany na żywo: `mo-board/api/v1/notice` — test pobrał 50 ogłoszeń.
- **Stage 5 — Silnik AI matchingu**
  - Pre-filtr heurystyczny (słowa kluczowe / CPV) → scoring Claude z uzasadnieniem.
  - Monitoring kosztów AI: limit miękki 200 USD / twardy 500 USD (tabela `ai_usage`).
  - Tabela `feedback` na preferencje użytkownika.
- **Stage 5b — Płatności i komunikacja**
  - Stripe Checkout + webhook + magic link (TTL 10 min).
  - Email (Resend), faktury (Fakturownia) — z graceful degradation.

### Następne kroki
- Tydzień 2: aplikacja mobilna (React Native/Expo) + landing page.
- Uzupełnić klucze API zewnętrznych usług — patrz `blockers.md`.
