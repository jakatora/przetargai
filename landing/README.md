# PrzetargAI — Landing Page

Statyczna strona produktowa (HTML/CSS/JS) — bez frameworka, gotowa do hostowania
na Vercel pod domeną `przetargai.pl`.

## Strony

| Ścieżka | Plik | Opis |
|---------|------|------|
| `/` | `index.html` | Strona główna: hero, funkcje, cennik, FAQ |
| `/upgrade` | `upgrade.html` | Aktywacja subskrypcji — otwierana z aplikacji mobilnej |
| `/upgrade/success` | `upgrade/success.html` | Po udanej płatności Stripe |
| `/upgrade/cancel` | `upgrade/cancel.html` | Po anulowaniu płatności |

## Przepływ subskrypcji

1. Aplikacja mobilna generuje magic link i otwiera w przeglądarce
   `przetargai.pl/upgrade?user_id=<id>&token=<token>`.
2. `upgrade.js` wysyła `POST {API_URL}/upgrade` z `user_id` i `token`.
3. Backend weryfikuje magic link i zwraca `checkout_url` (Stripe Checkout).
4. Strona przekierowuje na Stripe; po płatności wraca na `/upgrade/success`.

## Konfiguracja

Adres backendu ustaw w **`config.js`**:

```js
window.PRZETARGAI = { API_URL: 'https://api.przetargai.pl' };
```

Lokalnie: `http://localhost:3100` (domyślnie).

## Podgląd lokalny

```powershell
# dowolny statyczny serwer, np.:
npx serve .
```

## Wdrożenie na Vercel

```powershell
npm i -g vercel
vercel --prod
```

`vercel.json` włącza `cleanUrls` (ścieżki bez `.html`) oraz nagłówki bezpieczeństwa.
Po wdrożeniu podepnij domenę `przetargai.pl` w panelu Vercel.
