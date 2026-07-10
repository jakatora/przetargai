# PrzetargAI — Backend

API REST (Node.js + SQLite) dla monitoringu przetargów publicznych.

## Wymagania

- Node.js **≥ 22.5** (wykorzystuje wbudowany moduł `node:sqlite`).

## Uruchomienie

```powershell
npm install
Copy-Item .env.example .env   # i uzupełnij klucze API
npm run migrate               # tworzy bazę i schemat
npm run seed                  # (opcjonalnie) konto demo
npm run dev                   # serwer z auto-reloadem
npm test                      # testy jednostkowe
```

Konto demo (po `npm run seed`): `demo@przetargai.pl` / `demo1234`.

Backend startuje również **bez kluczy API** — usługi zewnętrzne działają wtedy
w trybie degradacji (graceful degradation):

| Usługa | Brak klucza → zachowanie |
|--------|--------------------------|
| Anthropic (AI) | matching używa scoringu heurystycznego |
| Stripe | `/upgrade` zwraca 503 |
| Resend (email) | treść maila trafia do logów |
| Fakturownia | faktura pomijana, wpis w logach |
| Sentry | monitoring błędów wyłączony |

## Endpointy API

### Publiczne

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| GET | `/health` | Health check (UptimeRobot) |
| POST | `/auth/register` | Rejestracja firmy (walidacja NIP) |
| POST | `/auth/login` | Logowanie → token JWT |
| POST | `/upgrade` | Checkout subskrypcji (z magic linkiem) — wołane przez landing |
| POST | `/webhooks/stripe` | Webhook Stripe (surowe body) |

### Wymagają nagłówka `Authorization: Bearer <token>`

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| GET | `/auth/me` | Profil zalogowanego użytkownika |
| PATCH | `/auth/me` | Aktualizacja profilu (nazwa, słowa kluczowe, CPV) |
| PUT | `/auth/me/push-token` | Zapis tokenu push (Expo) |
| POST | `/auth/upgrade-link` | Wygenerowanie magic linku do checkoutu |
| GET | `/matches` | Lista dopasowań (paginacja `?limit&offset`) |
| GET | `/matches/:id` | Szczegóły dopasowania |
| POST | `/matches/:id/feedback` | Feedback (`{ "helpful": true }`) |

### Wymagają nagłówka `x-admin-key: <ADMIN_API_KEY>`

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| POST | `/admin/fetch-tenders` | Ręczne pobranie przetargów + matching (`?pages`) |
| GET | `/admin/stats` | Statystyki systemu |
| GET | `/admin/ai-budget` | Stan budżetu AI (limit miękki/twardy) |

## Architektura

```
src/
├── config/env.js     Walidacja zmiennych środowiskowych (zod) + flagi funkcji
├── db/               node:sqlite — schemat, migracje, warstwa repozytoriów
├── lib/              Czyste helpery (nip, scoring, pricing, errors, logger…)
├── middleware/       auth (JWT), adminAuth, obsługa błędów
├── routes/           Trasy HTTP (auth, matches, upgrade, webhooks, admin)
├── services/         BZP, AI (Claude), matching, Stripe, email, faktury, push
├── jobs/             fetchTenders (pobieranie + matching) + scheduler (cron)
├── app.js            Złożenie aplikacji Express
└── index.js          Punkt wejścia (start serwera + scheduler)
```

## Przepływ matchingu

1. `scheduler` (cron `TENDER_FETCH_CRON`, domyślnie codziennie 12:00 w strefie
   `SCHEDULER_TZ` = Europe/Warsaw) lub `/admin/fetch-tenders` uruchamia job.
2. `services/bzp` pobiera ogłoszenia → `tenders.upsert` zapisuje nowe.
3. Dla każdego użytkownika z profilem: `services/matching` liczy wynik
   (pre-filtr heurystyczny → ocena Claude z monitoringiem kosztów).
4. Wynik ≥ `MATCH_CONFIDENCE_THRESHOLD` tworzy dopasowanie.
   Plan Free: maks. `FREE_TIER_DAILY_MATCH_LIMIT`/dobę. Standard: bez limitu + push.

## Monitoring kosztów AI

Każde wywołanie Claude zapisuje koszt w tabeli `ai_usage`. Po przekroczeniu
limitu miękkiego (`AI_BUDGET_SOFT_USD`) — ostrzeżenie w logach; po twardym
(`AI_BUDGET_HARD_USD`) — wywołania AI są wstrzymywane (fallback heurystyczny).
