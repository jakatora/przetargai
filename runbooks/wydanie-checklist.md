# Checklista wydania PrzetargAI — stan na 2026-07-10

Werdykt: **kod GOTOWY (GO)** — wszystkie bramki techniczne zielone.
Do wypuszczenia brakuje wyłącznie kroków wymagających działań/decyzji właściciela
(sekcja „RĘKA CZŁOWIEKA"). Kolejność wdrożenia: `wdrozenie-firebase.md`.

## ✅ Zweryfikowane dziś (ostatnia runda)

### Testy — wszystkie zielone
- backend Railway **125/125** · Firebase **211/211** (świeży emulator, 2× stabilnie)
- smoke E2E **29/29** (rejestracja, IDOR, admin, brak wycieków haseł/ID Stripe)
- mobile **40/40** + esbuild bez ostrzeżeń

### Płatność — PEŁNY cykl życia na kluczach TESTOWYCH (podpisane webhooki, Stripe CLI)
1. Rejestracja bez NIP → magic link (jednorazowy — drugi odczyt odrzucony) ✓
2. `GET /upgrade` → 303 → prawdziwy Checkout (PL, „PrzetargAI Standard 199,00 zł/mc",
   kody promocyjne włączone, cancel → nasza strona) ✓
3. Karta testowa 4242 → redirect na `/upgrade/success` ✓
4. `checkout.session.completed` (podpis zweryfikowany) → **tier=standard,
   stripe_customer_id + stripe_subscription_id zapisane w Firestore** ✓
5. `invoice.paid (subscription_create)` → poprawnie POMINIĘTY (strażnik `billing_reason`
   — bez podwójnej faktury za pierwszy miesiąc) ✓
6. Duplikat dostawy → idempotentnie zignorowany (cichy 200 + log „duplikat") ✓
7. Anulowanie subskrypcji w Stripe → `customer.subscription.deleted` → **powrót na Free** ✓
8. Fakturownia niepodpięta = tryb degradacji (aktywacja działa, faktura wstrzymana,
   rezerwacja zwolniona — wystawi się po podpięciu kluczy) ✓
9. `/auth/me` NIE ujawnia identyfikatorów Stripe (serializacja) ✓

Narzędzie do powtórzenia tego testu: `firebase/functions/skrypty/serwer-platnosci.mjs`
(+ `stripe listen --api-key sk_test_… --forward-to http://127.0.0.1:3199/webhooks/stripe`;
sekret nasłuchu w env `HARNESS_WEBHOOK_SECRET`). Bezpiecznik: odmawia pracy na kluczu ≠ `sk_test_`.

### Aplikacja — funkcjonalnie (przeklikane na emulatorze w tej sesji)
- rejestracja (bez NIP, „Powtórz hasło" z walidacją) · logowanie · feed z paginacją
- szczegóły + „Otwórz w BZP/TED (UE)" · feedback 👍/👎 · ściąga CPV · profil
- tryb ciemny (Systemowy/Jasny/Ciemny, trwały) · przełącznik planów demo (tylko DEV)
- źródła: BZP + TED (rejestr źródeł, izolacja awarii, `zrodla` w /health)

### Konfiguracja wydania
- `app.json`: name/slug/scheme, version 1.0.0, bundle `pl.przetargai.app`,
  `userInterfaceStyle: automatic`, adaptive icon, `googleServicesFile`,
  `ITSAppUsesNonExemptEncryption: false`
- Ikona 1024×1024 brandowa; **naprawiona dziś pod iOS** (pełnokadrowa — wypieczone
  zaokrąglenie dawało białe narożniki po masce Apple); bez kanału alfa ✓
- codemagic.yaml: realny bump versionCode (sed po prebuildzie + weryfikacja),
  strażnik `google-services.json`, poprawne nazwy zmiennych publikacji
- Trasa `/demo/tier` NIE istnieje na produkcji (strażnik testowy) ✓

## AKTUALIZACJA 2026-07-10 (noc) — PRODUKCJA LIVE (D-043/D-044)

- ✅ **Backend wdrożony i LIVE**: sekrety (Stripe LIVE 49 zł), firestore, functions,
  webhook LIVE `we_1Treqy…`; 1500 ogłoszeń; `/demo/tier`→404 na prodzie.
- ✅ **Błąd produkcyjny naprawiony (D-044)**: fire-and-forget backfill ginął po
  odpowiedzi (Functions zamrażają tło) → `await`; E2E na prodzie: rejestracja →
  **5 dopasowań natychmiast** → checkout LIVE 49,00 PLN. Testy 213/213.
- ✅ **Aplikacja celuje w produkcję domyślnie** (config.js; rollback przez
  `EXPO_PUBLIC_API_URL`); landing/config.js → funkcje; Codemagic grupa `produkcja`
  w obu workflow.
- ✅ **Produkcyjny APK** podpisany `przetargai-upload.jks` (na Pulpicie).
  ⚠️ Stary APK (debug) trzeba ODINSTALOWAĆ przed instalacją nowego.
- ⚠️ **Resend: domena przetargai.pl NIEZWERYFIKOWANA** — maile nie wychodzą
  (graceful). Wymaga: zakup domeny → resend.com/domains → rekordy DNS.
- ℹ️ Stripe TEST webhook Railway zostaje aktywny (tryby rozłączne; rollback).

## AKTUALIZACJA 2026-07-10 (wieczór) — wykonane samodzielnie (D-042)

- ✅ **Cennik 49 zł brutto/mc**: ceny Stripe TEST `price_1TreKwAom97JfF2j0wih4iDJ`
  (już w backend/.env) i LIVE `price_1TreKyAthGwugrLCNHv2A9je`
  (produkt `prod_UrN5yRoczKBAEu`) + wszystkie teksty/strony/fallback faktury.
  (Opis testu płatności niżej wspomina 199 zł — tyle kosztował plan W CHWILI testu.)
- ✅ **EAS projectId** `d8e781a8-e84e-4e7a-a837-9fae1d059005` w app.json — push odblokowany.
- ✅ **Codemagic**: grupa `ios_signing` (CERTIFICATE_PRIVATE_KEY, Secure) na obu
  wpisach przetargai; aplikacja podpięta do repo.
- ✅ **Keystore Androida wygenerowany**: `~/.api-keys/przetargai/przetargai-upload.jks`
  (hasła w `przetargai-keystore.properties` obok).
- ✅ **Commit `859aeaf` + push** na GitHub (w tym `google-services.json` dla CI).

## 🖐 RĘKA CZŁOWIEKA — dokładnie co zrobić (kolejność)

1. **Odblokuj deploy** — napisz w czacie DOSŁOWNIE:
   > wgraj sekrety JWT_SECRET, ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   > STRIPE_PRICE_STANDARD, RESEND_API_KEY, FAKTUROWNIA_API_KEY, FAKTUROWNIA_DOMAIN,
   > ADMIN_API_KEY do Secret Managera projektu przetargai i wdróż firestore oraz functions
   > na projekt przetargai, a potem utwórz webhook LIVE Stripe na adres funkcji
   Klasyfikator uprawnień wymaga nazwania tych operacji — wszystko inne już zrobione.
2. **Apple — umowa**: developer.apple.com → zaakceptuj zaległą umowę Developer Program
   (API zwraca REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED). Potem jedną komendą:
   `node firebase/functions/skrypty/asc-push-capability.mjs`
   (rejestruje bundle `pl.przetargai.app` + włącza Push Notifications).
3. **Codemagic UI (2 min)**: wgraj keystore `~/.api-keys/przetargai/przetargai-upload.jks`
   jako referencję **przetargai_keystore** (hasła w pliku .properties obok).
4. **Google Play — decyzja płatności**: Play Billing ALBO ukrycie CTA zakupu
   w buildzie Android (blockers.md; opis sklepu już oczyszczony).
   Do publikacji Play potrzebny też `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`
   (api-keys.md §13) — nie ma go w vaultach.
5. **Przełączenie apki na Firebase** (dopiero po dobie stabilnego crona):
   `EXPO_PUBLIC_API_URL` w Codemagic + wygaszenie crona/webhooka Railway
   (`wdrozenie-firebase.md` etap 6).
6. Landing na Vercel + domena (metadane sklepów wskazują przetargai.pl).

## Znane, świadome ograniczenia startu
- E-maile (Resend) i faktury (Fakturownia) w trybie degradacji do czasu podpięcia kluczy
  na produkcji — aktywacja planu działa niezależnie.
- Feed pokazuje TED i BZP; zapytania <130 tys. zł (platformy zakupowe) = etap 2 (decyzja).
