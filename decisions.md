# Decisions — PrzetargAI

Rejestr decyzji architektonicznych i biznesowych. Najnowsze na górze.

---

## D-015 — Buildy mobilne przez Codemagic (nie EAS)
**Data:** 2026-05-21
Buildy iOS/Android realizuje Codemagic (`codemagic.yaml`), nie EAS Build —
zgodnie z narzędziami właściciela projektu. `eas.json` usunięty; EAS/Expo
służy wyłącznie do rejestracji projektu (`eas init`) dla tokenów push.
iOS wg sprawdzonych wzorców: trwały klucz RSA w grupie `ios_signing` (limit
certyfikatów Apple), code signing w skryptach (bez deklaratywnego bloku
`ios_signing:` powodującego „No matching profiles"), `export_options.plist`
generowany przez `xcode-project use-profiles`, `ITSAppUsesNonExemptEncryption=false`,
aplikacja iPhone-only (`supportsTablet:false`) — unika błędów walidacji iPad.
Android: podpis release wstrzyka skrypt do wygenerowanego `build.gradle`.

## D-014 — SQLite na trwałym wolumenie Railway
**Data:** 2026-05-21
System plików Railway jest ulotny — produkcyjnie baza SQLite musi leżeć na
zamontowanym wolumenie (`DATABASE_PATH=/data/data.db`). `BACKUP_DIR` domyślnie
trafia obok bazy, więc kopie też są na wolumenie. Szczegóły: `runbooks/deploy.md`.

## D-013 — Kopie zapasowe: AES-256-GCM + Backblaze B2
**Data:** 2026-05-21
Kopia zapasowa bazy: spójny snapshot przez `VACUUM INTO`, szyfrowanie
AES-256-GCM (klucz `BACKUP_ENCRYPTION_KEY`), format pliku
`[12 B IV][16 B authTag][szyfrogram]`. Zapis lokalny + wysyłka do B2
(natywne API v2). Brak kluczy B2 → kopia tylko lokalna (graceful degradation).
Retencja sterowana `BACKUP_RETENTION` (domyślnie 14 ostatnich kopii).

## D-012 — Mobile: React Navigation zamiast Expo Router
**Data:** 2026-05-21
Aplikacja mobilna (Expo SDK 54, React 19, RN 0.81) używa React Navigation
(native-stack) zamiast Expo Router. Powód: jawna, przewidywalna konfiguracja
stosów (auth ↔ aplikacja), łatwiejsza do weryfikacji. Token sesji trzymany
w `expo-secure-store`. Kod w czystym JS (spójnie z backendem).

## D-011 — Landing jako statyczny HTML/CSS/JS
**Data:** 2026-05-21
Landing page to statyczne pliki (bez frameworka), hostowane na Vercel.
Powód: zakres MVP landingu jest minimalny (cennik + checkout) — statyka jest
szybsza, niezawodna i wystarczająca. Przepływ płatności to czysty JS po stronie
klienta (`upgrade.js`). Strony `/upgrade/success` i `/upgrade/cancel` zgodne
z URL-ami zwracanymi przez backend.

## D-010 — Zweryfikowany endpoint API BZP
**Data:** 2026-05-20
Publiczny endpoint odczytu ogłoszeń BZP (bez uwierzytelniania):
`GET https://ezamowienia.gov.pl/mo-board/api/v1/notice`.
Parametry wymagane: `NoticeType` (=`ContractNotice`), `PublicationDateFrom`,
`PublicationDateTo`, `PageSize`, `PageNumber` (numeracja od 1).
Odpowiedź to tablica JSON. Pole `htmlBody` (duże, kilka–kilkadziesiąt KB)
jest usuwane przed zapisem do `tenders.raw_data`.

## D-009 — Graceful degradation usług zewnętrznych
**Data:** 2026-05-20
Backend uruchamia się i działa lokalnie nawet bez kluczy API (Stripe, Claude,
Resend, Fakturownia, Sentry). Brakująca usługa loguje ostrzeżenie i działa
w trybie ograniczonym (np. AI → scoring heurystyczny, email → log do konsoli).
**Powód:** umożliwia testowanie pełnego pipeline'u zanim człowiek uzupełni klucze.

## D-008 — Magic link TTL 10 minut, jednorazowy
**Data:** 2026-05-20
Token magic link do checkoutu: ważny 10 min, jednorazowy (`used_at`), tabela `magic_links`.

## D-007 — Pre-filtr heurystyczny przed AI
**Data:** 2026-05-20
Przed wywołaniem Claude przetargi są wstępnie filtrowane heurystyką (pokrycie słów
kluczowych i kodów CPV). AI ocenia tylko shortlistę kandydatów.
**Powód:** kontrola kosztów AI — bez tego każdy przetarg × każdy użytkownik = wywołanie AI.

## D-006 — Model AI: claude-haiku-4-5 do matchingu
**Data:** 2026-05-20
Scoring dopasowań używa Claude Haiku 4.5 (tani, szybki, wystarczający do oceny trafności).
Pricing skonfigurowany w `services/ai.js`; koszt zapisywany w `ai_usage`.

## D-005 — Rozszerzenie schematu users o profil firmy
**Data:** 2026-05-20
Minimalny schemat z briefu (user_id, nip, email, hash, tier) nie wystarcza do
matchingu. Dodano: `company_name`, `keywords` (JSON), `cpv_codes` (JSON),
`stripe_customer_id`, `stripe_subscription_id`, `push_token`.
**Powód:** dopasowanie przetargów wymaga kryteriów. Multi-profil pozostaje wycięty —
jeden profil na użytkownika.

## D-004 — Baza danych: node:sqlite zamiast better-sqlite3
**Data:** 2026-05-20
Użyto wbudowanego modułu `node:sqlite` (Node 24) zamiast `better-sqlite3`.
**Powód:** zero kompilacji natywnej → brak ryzyka błędu instalacji na Windows;
API niemal identyczne (DatabaseSync). Ostrzeżenie „experimental" wyciszone flagą
`--disable-warning=ExperimentalWarning` w skryptach npm.

## D-003 — Monorepo z podkatalogami backend/mobile/landing
**Data:** 2026-05-20
Zamiast płaskiej struktury z briefu — monorepo. `.env` jest po stronie backendu
(jedyny konsument); mobile i landing mają własne mechanizmy konfiguracji
(Expo / Vercel). Katalogi `data/`, `logs/` żyją wewnątrz `backend/`.

## D-002 — Strategia iOS: darmowe narzędzie B2B
**Data:** 2026-05-20
Aplikacja iOS bez zakupów w aplikacji (bez StoreKit). Subskrypcja przez przeglądarkę:
`przetargai.pl/upgrade?user_id={id}&token={magic_link}`. Omija 30% prowizji Apple.

## D-001 — Zakres MVP: tylko Free + Standard (199 zł)
**Data:** 2026-05-20
MVP obejmuje wyłącznie plan Free i Standard. Plan Pro (399 zł), multi-profil,
webhook API, asystent ofert, blog, AnalyzeScreen, dark mode, CI/CD (H14) — poza zakresem.
Mapowanie planów: free = 5 dopasowań/dobę bez push; standard = nielimitowane + push.
