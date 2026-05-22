# START_PRZETARGAI — Zakres MVP

Źródło prawdy dla zakresu prac. Każda zmiana zakresu → wpis w `decisions.md`.

## Cel

Działający produkt przynoszący pierwszych płacących klientów w 3–4 tygodnie.
Cel KPI: 3–5 płacących klientów do dnia 28.

## W zakresie MVP

**Backend (Node.js + SQLite)**
- Rejestracja firmy z walidacją NIP, logowanie, sesje JWT (30 dni).
- Audit logging dostępu do danych (RODO).
- Integracja z publicznym API BZP — pobieranie ogłoszeń o przetargach.
- Silnik AI matchingu (Claude) z uzasadnieniem dopasowania.
- Monitoring kosztów AI: limit miękki 200 USD, twardy 500 USD.
- Stripe Checkout (na landingu) + webhook + magic link.
- Faktury (Fakturownia, VAT 23%), email transakcyjny (Resend).
- Powiadomienia push o nowych dopasowaniach (Standard).

**Mobile (React Native + Expo, iOS + Android)**
- Ekrany: logowanie/rejestracja, feed dopasowań, szczegóły dopasowania, konto.
- Przycisk „Ulepsz" → przeglądarka (`przetargai.pl/upgrade`), bez IAP.

**Landing (Vercel, przetargai.pl)**
- Tabela cen (Free + Standard 199 zł), zrzuty ekranu, Stripe Checkout.

## Poza zakresem MVP (świadomie wycięte)

Plan Pro (399 zł) · multi-profil · webhook API / integracje CRM ·
asystent pisania ofert · blog · AnalyzeScreen · CI/CD (H14) ·
dark mode i zaawansowana dostępność · programy poleceń i lojalnościowe ·
automatyczne kampanie win-back.

## Plany i limity

| Plan | Cena | Dopasowania | Push |
|------|------|-------------|------|
| Free | 0 zł | 5 / dobę | nie |
| Standard | 199 zł / mc | bez limitu | tak |

## Kamienie milowe

- **Dzień 7** — backend działa lokalnie; AI matching daje sensowne wyniki.
- **Dzień 14** — MVP mobile na fizycznych urządzeniach; landing wdrożony.
- **Dzień 21** — wszystko wdrożone; 3–5 beta testerów; zgłoszenia do sklepów w kolejce.
- **Dzień 28** — akceptacja Apple/Google; 30+ wiadomości outreach; 3–5 płacących klientów.

## Strategia iOS

Aplikacja iOS = darmowe narzędzie B2B, bez zakupów w aplikacji. Subskrypcja przez
przeglądarkę — omija prowizję Apple. Bez StoreKit.
