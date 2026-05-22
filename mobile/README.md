# PrzetargAI — Aplikacja mobilna

Aplikacja React Native (Expo) na iOS i Android — feed dopasowanych przetargów,
szczegóły ogłoszenia, konto i profil firmy.

## Wymagania

- Node.js ≥ 20
- Aplikacja **Expo Go** na telefonie (do testów) lub emulator iOS/Android
- Uruchomiony backend PrzetargAI (`../backend`, domyślnie port 3100)

## Uruchomienie

```powershell
npm install
npm start          # uruchamia serwer deweloperski Expo
```

Następnie zeskanuj kod QR aplikacją Expo Go (Android) lub Aparatem (iOS).

> Adres backendu w trybie dev jest wykrywany automatycznie z IP maszyny
> dewelopera (`src/config.js`). Telefon i komputer muszą być w tej samej sieci.

## Struktura

```
App.js                    Punkt wejścia — providery + nawigacja
src/
├── config.js             Adres API (auto-wykrywanie w dev)
├── theme.js              Kolory, odstępy, zaokrąglenia
├── api/client.js         Klient REST backendu
├── context/AuthContext.js Sesja, logowanie, bezpieczne przechowywanie tokenu
├── navigation/           Stos nawigacji (auth ↔ aplikacja)
├── services/push.js      Rejestracja powiadomień push (Expo)
├── components/           Button, TextField, Screen, MatchCard
├── lib/format.js         Formatowanie dat i kwot (po polsku)
└── screens/              Login, Register, MatchFeed, MatchDetail, Account
```

## Ekrany

| Ekran | Opis |
|-------|------|
| Login / Register | Logowanie i rejestracja firmy (walidacja NIP po stronie backendu) |
| MatchFeed | Lista dopasowanych przetargów (pull-to-refresh) |
| MatchDetail | Szczegóły, uzasadnienie AI, link do BZP, feedback |
| Account | Plan, edycja profilu firmy, przejście na Standard, wylogowanie |

## Subskrypcja (strategia iOS)

Aplikacja nie zawiera zakupów w aplikacji. Przycisk „Przejdź na Standard”
generuje magic link i otwiera w przeglądarce stronę `przetargai.pl/upgrade`,
gdzie płatność obsługuje Stripe — zgodnie z modelem darmowego narzędzia B2B.

## Powiadomienia push

Token push jest pobierany po zalogowaniu i wysyłany do backendu. Do działania
na produkcji wymagany jest projekt **EAS** (`eas init`) — w trybie dev brak
projektu EAS jest obsługiwany łagodnie (push pomijany, bez błędu).

## Build produkcyjny

Buildy realizuje **Codemagic** wg `codemagic.yaml` w katalogu głównym repo
(workflowy `ios-release` i `android-release`). Aplikacja jest „managed" — natywne
katalogi `ios/`/`android/` generuje w CI `expo prebuild`, dlatego nie ma ich w repo.

Przed pierwszym buildem:
- ustaw produkcyjny `API_URL` w `src/config.js`,
- podmień placeholdery ikon w `assets/` na docelowe,
- skonfiguruj Codemagic UI (App Store Connect API, grupa `ios_signing`,
  keystore Androida) — patrz `runbooks/deploy.md`.

Skrypt `scripts/configure-android-release-signing.mjs` automatycznie konfiguruje
podpis release Androida w wygenerowanym `build.gradle`.
