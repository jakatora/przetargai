# PrzetargAI

Monitoring przetargów publicznych dla polskich firm budowlanych i IT.
AI dopasowuje ogłoszenia z Biuletynu Zamówień Publicznych (BZP) do profilu firmy
i wysyła powiadomienia o nowych, trafnych przetargach.

## Model produktu

| Plan | Cena | Limity |
|------|------|--------|
| Free | 0 zł | 5 dopasowań / dobę, bez powiadomień push |
| Standard | 199 zł / mc | nielimitowane dopasowania + powiadomienia push |

Plan **Pro (399 zł)** jest świadomie poza zakresem MVP.

## Architektura (monorepo)

```
przetarg-ai/
├── backend/      Node.js + SQLite — API REST (GOTOWE)
├── mobile/       React Native + Expo (iOS + Android) (GOTOWE)
├── landing/      Strona + Stripe Checkout (Vercel) (GOTOWE)
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
npm run dev                   # uruchamia serwer na http://localhost:3000
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
