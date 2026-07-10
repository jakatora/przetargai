# Migracja backendu: Railway → Firebase

**Decyzja usera:** 2026-07-09 — pełna migracja backendu PrzetargAI na Firebase
(potwierdzona po przedstawieniu kosztów; zastępuje D-004/Railway dla tego projektu).
**Status (2026-07-10):** F0–F4 wykonane (kod + 166 testów + E2E na emulatorze);
Blaze włączony, Firestore w `europe-central2`. Czeka na zgodę usera na deploy
(F5) — procedura: `runbooks/wdrozenie-firebase.md`. Potem F6/F7 (przełączenie ruchu).

## Zasady przeprowadzki

1. **Railway zostaje nietknięty do końca migracji** — to nasz rollback. Powrót
   w każdej chwili = przestawienie `API_URL` w mobile.
2. **Fitter Welder Pro NIE przechodzi** — trasy `/api/fitter/*` i tabele `fitter_*`
   zostają na Railway na stałe. Migracja ich nie dotyka.
3. **Czysta logika przechodzi bez zmian**: `lib/cpv.js`, `lib/textNorm.js`,
   `lib/scoring.js`, `lib/pricing.js`, walidacje Zod, trasy Express (Functions v2
   opakowuje całą apkę Express w jedną funkcję HTTPS). Przepisujemy WYŁĄCZNIE
   warstwę danych (SQLite → Firestore) i harmonogram (node-cron → Cloud Scheduler).
4. Region wszystkiego: **europe-central2 (Warszawa)** — dane w Polsce, niska latencja.

## Architektura docelowa

| Element | Dziś (Railway) | Docelowo (Firebase) |
|---|---|---|
| HTTP API | Express 5 na stałym serwerze | ta sama apka Express w **Cloud Functions v2** `api` (onRequest) |
| Baza | SQLite (plik na wolumenie) | **Firestore** |
| Cron 12:00 | node-cron w procesie | **onSchedule('0 12 * * *', tz Europe/Warsaw)** |
| Sekrety | .env na Railway | **defineSecret** (Secret Manager): JWT, ANTHROPIC, STRIPE×3, RESEND, FAKTUROWNIA×2, ADMIN |
| Push | Expo push (token w users) | bez zmian — mobile ma już `google-services.json` (FCM) |
| Stripe webhook | raw body przed express.json | `req.rawBody` (Functions dają go natywnie — prościej niż dziś) |
| Kopie zapasowe | AES+B2 (nieskonfigurowane!) | Firestore PITR / eksport zarządzany — bez własnego kodu |

## Model danych Firestore (bez JOIN-ów)

- `users/{uid}` — email, password_hash, premium_tier, keywords[], cpv_codes[],
  company_nip?, company_name?, theme, stripe_customer_id, push_token, created_at.
  Unikalność email/NIP: zapytanie po polu (indeks automatyczny) w transakcji.
- `tenders/{bzp_external_id}` — **docID = zewnętrzne ID** ⇒ upsert naturalny.
  Pola: title, organization, cpv[] (już rozbite parserem!), deadline (Timestamp),
  url, published_at, fetched_at. Indeks: deadline.
- `users/{uid}/matches/{tenderId}` — score, reasoning, scorer, notified, created_at
  **+ zdenormalizowane pola przetargu** (title, deadline, url, organization) ⇒ feed
  to JEDNO zapytanie orderBy(created_at desc), izolacja IDOR gratis (subkolekcja).
- `users/{uid}/evaluations/{tenderId}` — score, scorer, evaluated_at. Ślad każdej
  oceny ⇒ przetarg odrzucony NIE wraca do AI (w SQLite łataliśmy to top-N; tu mamy
  i ślad, i top-N).
- `ai_usage/{id}` + **agregat `ai_usage_monthly/{YYYY-MM}`** (FieldValue.increment)
  ⇒ budżet AI czytany 1 odczytem, bez skanowania.
- `magic_links/{token}` z **polityką TTL** na expires_at (samo się sprząta).
- `audit_logs/{id}` z TTL 90 dni (RODO — dziś rośnie bez końca).

**Pula kandydatów (P-4) bez JOIN-a:** dzienny job czyta raz `tenders where
deadline > now` (~500–2000 doc.), trzyma w pamięci; per user: heurystyka
in-memory na całej puli → top-N kandydatów → `getAll()` na ich evaluations
(sprawdzenie „już oceniono") → AI dla świeżych → batched write matches+evaluations.

## Koszty (szacunek, 100 aktywnych userów)

Dzienny job: ~2 000 odczytów (pula, RAZ dla wszystkich) + 100×60 exists + zapisy
~100×35 ⇒ ~8 000 odczytów + 3 500 zapisów dziennie. Limity darmowe Firestore:
50 000 odczytów / 20 000 zapisów **dziennie** ⇒ **0 zł** przy tej skali.
Functions: darmowe 2 mln wywołań/mc ⇒ 0 zł. Realny rachunek pojawia się dopiero
przy ~1 000+ userów (rzędu kilkudziesięciu zł/mc). Anthropic bez zmian ($1/$5 Haiku).
**Wymagany plan Blaze** (karta) — bez niego Functions nie wywołują zewnętrznych API.

## Etapy

| Etap | Zakres | Status |
|---|---|---|
| **F0** | Projekt `przetargai` + apka Android + `google-services.json` w mobile/ + wpis w app.json | ✅ 2026-07-09 |
| **F0b** | **USER: włączyć Blaze** → https://console.firebase.google.com/project/przetargai/usage/details | ⏳ |
| **F1** | Workspace `firebase/` (firebase.json, .firebaserc, functions/ Node 22), port apki Express BEZ tras fitter, emulatory, /health na emulatorze | |
| **F2** | Warstwa danych Firestore (`db/firestore-repos.js`), port 95 testów na emulator | |
| **F3** | Silnik dopasowań + evaluations + onSchedule 12:00 Europe/Warsaw | |
| **F4** | Stripe (rawBody), upgrade flow, magic links z TTL | |
| **F5** | Resend + Fakturownia + admin + agregat budżetu AI + Sentry | |
| **F6** | Mobile: API_URL → URL funkcji (docelowo api.przetargai.pl), prebuild z FCM, APK | |
| **F7** | Eksport userów z Railway (wymaga zgody na odczyt), przełączenie, wygaszenie tras przetargai na Railway (Fitter zostaje) | |

## Ryzyka

- **R1**: Blaze wymaga karty — bez tego stoimy po F1 (emulatory działają bez Blaze).
- **R2**: zimny start funkcji ~1–3 s przy pierwszym wejściu (min_instances=0).
  Akceptowalne na start; opcja 1 ciepła instancja ≈ 25–30 zł/mc.
- **R3**: Firestore ≠ SQL — brak transakcji wielokolekcyjnych; batched writes
  wystarczają dla naszych przepływów (match+evaluation to jeden batch).
- **R4**: plan produktowy `MIGRACJA-AGENT-AI.md` §6 (zmiany schematu SQL) wymaga
  przepisania na model dokumentowy — po F3, przed E3.
- **R5**: eksport produkcyjnych userów z Railway wymaga zgody na dostęp do wolumenu;
  jeśli na prodzie są tylko konta testowe (rejestracja i tak zwracała 500) —
  zaczynamy od pustej bazy i F7 się upraszcza.

## Wpływ na dotychczasowe decyzje

- D-004 (node:sqlite) — pozostaje w mocy dla Fittera na Railway; PrzetargAI przechodzi na Firestore.
- D-017 (deploy przez Railway GraphQL) — dla PrzetargAI zastąpione przez `firebase deploy`.
- D-021 (cron 12:00 Europe/Warsaw) — bez zmian merytorycznych, nośnik: Cloud Scheduler.
- D-022/D-023 (pula kandydatów, NIP opcjonalny) — logika przechodzi 1:1, zmienia się tylko zapis.
- Runner migracji SQLite (E0) — zostaje w repo dla Fittera; Firestore jest bezschematowy
  (wersjonowanie dokumentów polem `v` w razie potrzeby).
