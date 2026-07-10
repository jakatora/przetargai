# Wdrożenie PrzetargAI na Firebase

Stan na 2026-07-10. Projekt: `przetargai`, region `europe-central2` (Warszawa).
Railway zostaje jako **rollback** — nie wygaszamy go w tym samym kroku.

## Zasada bezpieczeństwa

Wdrożenie backendu **niczego nie psuje**, dopóki aplikacja mobilna wskazuje na Railway.
Dwa systemy mogą stać obok siebie. Ryzyko pojawia się dopiero przy dwóch krokach:

1. **Włączenie crona na Firebase** przy wciąż działającym cronie na Railway
   → dwa harmonogramy liczą dopasowania równolegle, z osobnymi licznikami budżetu AI.
2. **Podłączenie webhooka Stripe do Firebase** przy wciąż działającym webhooku Railway
   → dwa handlery reagują na tę samą płatność (rejestry idempotencji są ROZŁĄCZNE).

Dlatego kolejność poniżej rozdziela „wdrożyć" od „przełączyć ruch".

---

## Etap 1 — Sekrety (wymaga zgody użytkownika)

Dziewięć wartości kopiowanych z `backend/.env` do Secret Managera projektu `przetargai`:

```
JWT_SECRET  ANTHROPIC_API_KEY  STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STANDARD  RESEND_API_KEY  FAKTUROWNIA_API_KEY
FAKTUROWNIA_DOMAIN  ADMIN_API_KEY
```

Bez nich funkcja nie wystartuje: `config.js` rzuca przy braku `JWT_SECRET` (fail-fast
przy zimnym starcie, zamiast cichej awarii o 12:00 w cronie).

**`JWT_SECRET` musi być IDENTYCZNY jak na Railway** — inaczej tokeny wydane przez
stary backend przestaną działać po przełączeniu aplikacji i wszyscy zostaną wylogowani.

**`STRIPE_WEBHOOK_SECRET` z `.env` należy do endpointu Railway.** Endpoint Firebase
dostanie własny sekret dopiero po utworzeniu dla niego webhooka w Stripe (etap 5).
Do tego czasu weryfikacja podpisu na Firebase będzie odrzucać zdarzenia — i dobrze,
bo obsługuje je Railway.

## Etap 2 — Reguły i indeksy Firestore

⚠️ Wszystkie komendy `firebase` uruchamiaj **w katalogu `firebase/`** — tam leży
`firebase.json`; z korzenia repo kończą się błędem „Not in a Firebase app directory".

```
cd firebase
firebase deploy --only firestore --project przetargai
```

Wdraża: `firestore.rules` (klient NIE ma bezpośredniego dostępu — cały ruch przez API),
indeks `collectionGroup` dla `/admin/recent-matches` oraz **polityki TTL** dla
`magic_links`, `audit_logs` (90 dni — zawiera adresy IP), `stripe_events` (30 dni)
i `invoices` (rok).

⚠️ TTL usuwa dokumenty po polu `ttl` typu **Timestamp**. Deklaracja na polu tekstowym
nie robi nic — pilnuje tego `test/retencja.test.js`.

## Etap 3 — Funkcje

```
firebase deploy --only functions --project przetargai
```

Publikuje `api` (całe API w jednej funkcji HTTPS) i `dailyTenderFetch` (Cloud Scheduler,
12:00 Europe/Warsaw). Pierwsze wdrożenie włączy potrzebne API (Cloud Functions, Cloud Build,
Artifact Registry, Cloud Scheduler).

**Cron zacznie działać od razu.** Jeśli cron na Railway nadal biegnie — patrz Etap 6.

## Etap 4 — Weryfikacja z zewnątrz

```
BASE=https://europe-central2-przetargai.cloudfunctions.net/api
curl -s $BASE/health                      # {"status":"ok","db":true,"cron":{...},"wersja":"..."}
curl -s $BASE/polityka-prywatnosci | head # strona prawna dla sklepów
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
     -d '{"email":"test@x.pl","password":"haslo12345"}'
```

`/health` zwróci `cron.ok = false` i `ostatni_przebieg: null` — cykl jeszcze nie biegł.
To normalne przez pierwszą dobę; **nie daje 503**, ale jest widoczne.

Po pierwszym cronie sprawdź `cron.ok = true` i `matchesCreated > 0`.

## Etap 5 — Webhook Stripe (osobny endpoint)

W panelu Stripe utwórz **nowy** endpoint webhooka:

```
https://europe-central2-przetargai.cloudfunctions.net/api/webhooks/stripe
```

Zdarzenia: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `invoice.paid`,
`customer.subscription.updated`, `customer.subscription.deleted`.

Skopiuj jego **signing secret** i nadpisz `STRIPE_WEBHOOK_SECRET` w Secret Managerze,
a potem wdróż funkcje ponownie (sekrety wczytują się przy starcie instancji).

⚠️ **Nie zostawiaj obu endpointów aktywnych.** Rejestry idempotencji Railway (SQLite)
i Firebase (Firestore) są rozłączne — ta sama płatność zostałaby obsłużona dwa razy,
z dwiema fakturami VAT. Wyłącz endpoint Railway w tym samym kroku.

## Etap 6 — Przełączenie ruchu (osobna decyzja)

Kolejność ma znaczenie:

1. **Wyłącz cron PrzetargAI na Railway** (albo cały serwis, jeśli Fitter ma własny).
   Fitter Welder Pro zostaje na Railway — jego trasy `/api/fitter/*` muszą działać dalej.
2. Przełącz Stripe webhook (etap 5).
3. Ustaw `EXPO_PUBLIC_API_URL=https://europe-central2-przetargai.cloudfunctions.net/api`
   w środowisku builda (Codemagic → Environment variables dla workflow mobilnych).
   W kodzie nic się nie edytuje — `mobile/src/config.js` czyta tę zmienną przy
   budowaniu bundla; build BEZ zmiennej nadal celuje w Railway (fallback).
4. Zbuduj i opublikuj nową wersję aplikacji.

Do czasu kroku 3 aplikacja użytkowników korzysta z Railway — nic im nie znika.

## Rollback

Dopóki Railway żyje: przywróć `API_URL`, włącz z powrotem cron i webhook Railway.
Dane w Firestore zostają (nic nie usuwamy), ale konta założone przez Firebase
nie istnieją w SQLite — dlatego **przełączamy ruch dopiero po tym, jak Firebase
działa poprawnie przez dobę z cronem**.

## Znane blokery po stronie aplikacji mobilnej

- `versionCode` = 1 → Google Play odrzuci każdą aktualizację. Podbić przed publikacją.
- brak `extra.eas.projectId` → `registerForPushNotifications()` zwraca `null`,
  czyli **płatna funkcja push nie działa**.
- APK podpisany kluczem debug → Play go nie przyjmie; użyć `upload-keystore.jks`.
- App Store 3.1.1: opis w `store/listing.md` kieruje do zakupu przez WWW.
- Stripe działa w trybie **TEST** — klienci nie zapłacą prawdziwych pieniędzy,
  dopóki nie przełączysz kluczy na LIVE i nie utworzysz cen LIVE.
