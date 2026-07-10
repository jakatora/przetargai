# PrzetargAI — Landing Page

Statyczna strona produktowa (HTML/CSS/JS) — bez frameworka, gotowa do hostowania
na Vercel pod domeną `przetargai.pl`.

## Strony

| Ścieżka | Plik | Opis |
|---------|------|------|
| `/` | `index.html` | Strona główna: hero, funkcje, cennik, FAQ |
| `/regulamin` | `regulamin.html` | Regulamin serwisu |
| `/polityka-prywatnosci` | `polityka-prywatnosci.html` | Polityka prywatności |
| `/upgrade` | `upgrade.html` | Aktywacja subskrypcji — otwierana z aplikacji mobilnej |
| `/upgrade/success` | `upgrade/success.html` | Po udanej płatności Stripe |
| `/upgrade/cancel` | `upgrade/cancel.html` | Po anulowaniu płatności |
| (dowolna nieznana) | `404.html` | Brandowana strona 404 (Vercel serwuje automatycznie) |

## Zasoby i skrypty

| Plik | Rola |
|------|------|
| `nav.js` | Mobilne menu (hamburger) — `aria-expanded`, Escape, zamykanie po kliknięciu linku |
| `og-image.png` | Podgląd społecznościowy 1200×630 (`og:image`, `twitter:image`) |
| `robots.txt` | Indeksacja; wyklucza `/upgrade`, wskazuje sitemapę |
| `sitemap.xml` | Mapa strony (`/`, `/regulamin`, `/polityka-prywatnosci`) |

`index.html` zawiera dane strukturalne JSON-LD (`Organization`, `SoftwareApplication`
z ofertami Free/Standard, `FAQPage`). **Gdy zmieniasz pytania w sekcji FAQ, zaktualizuj
też blok `FAQPage`** — inaczej dane strukturalne rozjadą się z treścią strony.

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
