# PrzetargAI

Monitoring przetargów publicznych dla polskich firm. AI dopasowuje ogłoszenia
z BZP, TED (zamówienia unijne) i Bazy Konkurencyjności do profilu firmy, a ~35 narzędzi
prowadzi wykonawcę od decyzji „startować czy nie" do złożenia oferty.

Aplikacja: [Google Play](https://play.google.com/store/apps/details?id=pl.przetargai.app) ·
[App Store](https://apps.apple.com/pl/app/id6773018962) · strona: https://przetargai.web.app

## Model produktu

| Plan | Cena | Limity |
|------|------|--------|
| Free | 0 zł | 5 dopasowań / dobę |
| Standard | 49 zł / mc (brutto) | nielimitowane dopasowania |

Wiążąca treść: regulamin (`/regulamin`, `firebase/functions/src/routes/legal.js`).

## Architektura (monorepo)

```
przetarg-ai/
├── backend/      Node.js + SQLite na Railway — moduły /api/przetarg/* (przez most z Cloud Functions) i inne projekty
├── firebase/     Cloud Functions v2 + Firestore — PRODUKCJA PrzetargAI (europe-central2)
├── mobile/       React Native + Expo (iOS + Android)
├── desktop/      Wersja na Windows: eksport webowy aplikacji w Electronie
├── landing/      Strona (wersje robocze; żywa strona = firebase/hosting)
├── plans/        Dokumenty zakresu / planu MVP
├── runbooks/     Procedury operacyjne i awaryjne
├── agent_log.md  Dziennik prac
├── decisions.md  Rejestr decyzji architektonicznych i biznesowych
└── blockers.md   Blokery (w tym pozycje wymagające działania człowieka)
```

## Strategia iOS

Aplikacja iOS to **darmowe narzędzie B2B** — bez zakupów w aplikacji.
Subskrypcję kupuje się na stronie (`przetargai.pl/upgrade`) przez przeglądarkę,
co omija 30% prowizji Apple. Płatności obsługuje wyłącznie Stripe Checkout na landingu.

## Start (backend)

```powershell
cd backend
npm install
Copy-Item .env.example .env   # uzupełnij klucze API
npm run migrate               # tworzy bazę i schemat
npm run dev                   # uruchamia serwer na http://localhost:3100
npm test                      # testy jednostkowe
```

Backend uruchamia się również **bez kluczy API zewnętrznych** — usługi
(Stripe, Claude, Resend, Fakturownia, Sentry) działają wtedy w trybie
ograniczonym (graceful degradation), co pozwala testować całość lokalnie.

## Stan projektu

- [x] Tydzień 1 — Backend: auth, BZP, AI matching, Stripe, email, faktury
- [x] Tydzień 2 — Mobile (React Native/Expo) + landing page
- [x] Tydzień 3 — Przygotowanie do wdrożenia: kopie zapasowe, konfiguracja
  Railway/EAS, strony prawne, metadane sklepów, runbooki
  *(właściwy deploy wymaga kont Railway/Vercel/EAS — patrz `runbooks/deploy.md`)*
- [ ] Tydzień 4 — Akceptacja w sklepach, kampania outreach, pierwsi klienci

### Uruchomienie

| Część | Komenda | Katalog |
|-------|---------|---------|
| Backend | `npm run dev` | `backend/` |
| Aplikacja mobilna | `npm start` (Expo) | `mobile/` |
| Landing | `npx serve .` | `landing/` |
