# Blockers — PrzetargAI

Format: `[BLOCKER: nazwa]` aktywny · `[RESOLVED: nazwa]` rozwiązany.
Aby zamknąć blocker: „Blocker {nazwa} rozwiązany. Sprawdź, oznacz, kontynuuj."

---

## [BLOCKER: HUMAN] Klucze API usług zewnętrznych

Backend działa lokalnie bez nich (tryb ograniczony), ale do uruchomienia pełnej
funkcjonalności trzeba uzupełnić w `backend/.env`:

| Zmienna | Skąd | Status |
|---------|------|--------|
| `ANTHROPIC_API_KEY` | console.anthropic.com | ⛔ do uzupełnienia |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com (TEST) | ⛔ do uzupełnienia |
| `STRIPE_PRICE_STANDARD` | Stripe → Products → „PrzetargAI Standard" 199 zł + 23% VAT | ⛔ do uzupełnienia |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks (po dodaniu endpointu `/webhooks/stripe`) | ⛔ do uzupełnienia |
| `FAKTUROWNIA_API_KEY` + `FAKTUROWNIA_DOMAIN` | Fakturownia → Ustawienia → API | ⛔ do uzupełnienia |
| `RESEND_API_KEY` | resend.com (3k maili/mc darmowo) | ⛔ do uzupełnienia |
| `SENTRY_DSN_BACKEND` | sentry.io → projekt „przetargai-backend" (Node.js) | ⛔ do uzupełnienia |
| `B2_ACCOUNT_ID` + `B2_APP_KEY` | Backblaze B2 → bucket „przetargai-backups" | ⛔ do uzupełnienia |
| `RAILWAY_TOKEN` | Railway → Settings → Tokens | ⛔ do uzupełnienia (deploy) |

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
