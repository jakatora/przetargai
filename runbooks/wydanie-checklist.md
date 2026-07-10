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

## 🖐 RĘKA CZŁOWIEKA — przed publicznym startem (kolejność)

1. **Deploy Firebase** (zgoda + `wdrozenie-firebase.md` etapy 1–4): sekrety →
   firestore → functions → weryfikacja. Od razu potem decyzja o cronie Railway (etap 6.1).
2. **Stripe LIVE**: przełącz klucze `sk_live_…`, utwórz cenę LIVE (STRIPE_PRICE_STANDARD),
   **webhook LIVE na adres funkcji** (komplet 6 zdarzeń — `deploy.md` §2) i wtedy
   wyłącz endpoint Railway. Podepnij FAKTUROWNIA_* (faktury VAT dla B2B).
3. **Push**: `npx eas init` w mobile/ (projectId → app.json) oraz capability
   **Push Notifications** dla `pl.przetargai.app` w Apple Developer Portal
   PRZED pierwszym buildem iOS.
4. **Google Play — decyzja płatności**: Play Billing ALBO ukrycie CTA zakupu
   w buildzie Android (blockers.md; opis sklepu już oczyszczony).
5. **Codemagic env**: `EXPO_PUBLIC_API_URL` = adres funkcji (przełącza apkę na Firebase),
   grupy `ios_signing`/`google_credentials`, keystore `przetargai_keystore`.
6. **Commit + push repo** (m.in. `google-services.json` musi wejść do repo — CI go wymaga).
7. Landing na Vercel + domena (metadane sklepów wskazują przetargai.pl).

## Znane, świadome ograniczenia startu
- E-maile (Resend) i faktury (Fakturownia) w trybie degradacji do czasu podpięcia kluczy
  na produkcji — aktywacja planu działa niezależnie.
- Feed pokazuje TED i BZP; zapytania <130 tys. zł (platformy zakupowe) = etap 2 (decyzja).
