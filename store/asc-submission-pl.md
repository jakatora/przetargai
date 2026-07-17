# PrzetargAI — App Store submission (Polski only, v1.0)

Pełna paczka informacji do wklejenia w App Store Connect dla wersji 1.0.
Wszystkie wartości w blokach ` ``` ` to dosłowny tekst do skopiowania.

---

## Krok 0 — Wymagania przed kliknięciem „Submit for Review"

Aby ASC pozwolił submitować, MUSZĄ być:
- ✅ Build dodany do wersji (z TestFlight)
- ✅ Minimum 3 screenshoty 1284×2778 lub 1242×2688
- ✅ Privacy Policy URL
- ✅ App Information — wszystkie wymagane pola
- ✅ App Review Information — demo account + notatki
- ✅ Export Compliance odpowiedziane

---

## 1. App Information (General → App Information)

| Pole | Wartość |
|---|---|
| **Name** | `PrzetargAI` |
| **Subtitle** | `Przetargi z BZP i TED dla firm` (30/30 zn) |
| **Bundle ID** | `pl.przetargai.app` |
| **SKU** | `PRZETARGAI` |
| **Primary Language** | Polish (Poland) |
| **Category Primary** | `Business` |
| **Category Secondary** | `Productivity` |
| **Content Rights** | `Does NOT use third-party content` |

### Age Rating (Apple Age Rating Questionnaire)
Wszystkie pytania → **None / No**:
- Cartoon or Fantasy Violence: None
- Realistic Violence: None
- Sexual Content: None
- Profanity: None
- Alcohol/Tobacco/Drugs: None
- Mature/Suggestive Themes: None
- Horror/Fear: None
- Gambling: None
- Medical/Treatment Information: None
- Unrestricted Web Access: **No**
- Gambling and Contests: **No**

**Wynik:** `4+` (dla wszystkich grup wiekowych)

---

## 2. Pricing and Availability

| Pole | Wartość |
|---|---|
| **Price** | `Free (0.00 PLN)` |
| **Availability** | Tylko **Poland** (na start) |
| **Pre-order** | OFF |
| **Educational Discount** | OFF |
| **Distribute on App Store, Mac App Store** | App Store only |

---

## 3. App Privacy

### 3.1 Privacy Policy URL (Required)
```
https://jakatora.github.io/przetargai/polityka-prywatnosci.html
```

### 3.2 Get Started → App Privacy form

Klikasz „**Get Started**" → odpowiadasz na pytania o zbieranie danych.

#### „Do you or your third-party partners collect data from this app?" → **Yes**

#### „Do you or your third-party partners use this data to track users?" → **No**
(Nie trackujemy między apkami/witrynami dla reklam.)

### 3.3 Data Types — co zaznaczyć

**Contact Info** → ☑ Yes:
- ☑ Email Address
  - Linked to user: **Yes**
  - Used for tracking: **No**
  - Purposes: `App Functionality`, `Customer Support`

**Identifiers** → ☑ Yes:
- ☑ User ID
  - Linked: **Yes**, Tracking: **No**
  - Purposes: `App Functionality`
- ☑ Device ID (jeśli push token się liczy, Apple czasem prosi)
  - Linked: **Yes**, Tracking: **No**
  - Purposes: `App Functionality`

**Usage Data** → ☑ Yes:
- ☑ Product Interaction (logi audytu)
  - Linked: **Yes**, Tracking: **No**
  - Purposes: `App Functionality`, `Analytics`

**Diagnostics** → ☑ Yes:
- ☑ Crash Data, Performance Data (Sentry)
  - Linked: **No** (anonim Sentry session)
  - Tracking: **No**
  - Purposes: `App Functionality`

**Financial Info** → ☑ Yes (po Stripe LIVE):
- ☑ Purchase History
  - Linked: **Yes**, Tracking: **No**
  - Purposes: `App Functionality`, `Purchases`

**Other Data Types** → ☑ Yes:
- ☑ Custom: „Profile firmy (NIP, nazwa, słowa kluczowe, kody CPV)"
  - Linked: **Yes**, Tracking: **No**
  - Purposes: `App Functionality`

#### NIE ZBIERAMY — przy każdej kategorii zaznacz **No**:
- Location
- Health & Fitness
- Sensitive Info (np. orientacja, religia)
- Contacts
- User Content (zdjęcia, filmy, audio)
- Browsing History
- Search History
- Audio Data

---

## 4. App Store → Version 1.0 (Prepare for Submission)

### 4.1 Promotional Text (170 zn — można aktualizować bez review)
```
AI codziennie analizuje przetargi z BZP i TED i pokazuje tylko te dopasowane do Twojej firmy. Zamiast setek ogłoszeń — kilka trafnych każdego dnia.
```
Alternatywy (obie < 170 zn):
- „Codziennie analizujemy przetargi z BZP i TED przez AI i pokazujemy tylko dopasowane do Twojej firmy. Filtruj po trafności i nie przegap żadnej okazji."
- „AI codziennie wybiera z BZP i TED tylko przetargi dopasowane do Twojej firmy. Zamiast setek ogłoszeń — kilka trafnych dziennie."

### 4.2 Description (4000 zn)
```
WAŻNE ZASTRZEŻENIE: PrzetargAI jest niezależną, prywatną aplikacją. NIE jest aplikacją rządową ani urzędową. Nie jest powiązana z Urzędem Zamówień Publicznych, platformą e-Zamówienia, Unią Europejską ani żadną inną instytucją państwową i nie działa w ich imieniu.

PrzetargAI to narzędzie dla firm, które chcą wygrywać zamówienia publiczne — bez codziennego przeglądania setek ogłoszeń.

Aplikacja codziennie analizuje ogłoszenia z publicznych rejestrów zamówień i dzięki sztucznej inteligencji pokazuje Ci tylko te przetargi, które pasują do profilu Twojej firmy. Każde dopasowanie ma ocenę trafności i krótkie uzasadnienie generowane przez AI.

FUNKCJE
• Dopasowanie przetargów przez AI z oceną trafności (model Claude)
• Codzienna, automatyczna analiza nowych ogłoszeń
• Powiadomienia push o nowych, trafnych przetargach (plan Standard)
• Wyjaśnienie ogłoszenia przez AI prostym językiem
• Szczegóły ogłoszenia: zamawiający, termin składania ofert, wartość, kod CPV
• Zapisywanie przetargów i przypomnienia o terminie składania ofert
• Bezpośredni link do pełnego ogłoszenia u źródła

JAK TO DZIAŁA
1. Zakładasz konto i opisujesz profil firmy — słowa kluczowe i kody CPV.
2. PrzetargAI codziennie pobiera nowe ogłoszenia z publicznych rejestrów.
3. Sztuczna inteligencja ocenia każde ogłoszenie pod kątem Twojego profilu i pokazuje tylko trafne.

PLANY
• Free — 5 dopasowanych przetargów dziennie, bezpłatnie i bezterminowo
• Standard (49 zł/mc) — nielimitowane dopasowania oraz powiadomienia push

ŹRÓDŁA INFORMACJI URZĘDOWYCH
Wszystkie ogłoszenia pochodzą z oficjalnych, publicznie dostępnych rejestrów prowadzonych przez instytucje publiczne:

1) Biuletyn Zamówień Publicznych (BZP), prowadzony przez Urząd Zamówień Publicznych na platformie e-Zamówienia:
https://ezamowienia.gov.pl
Urząd Zamówień Publicznych: https://www.uzp.gov.pl

2) TED (Tenders Electronic Daily) — Dziennik Urzędowy Unii Europejskiej, zamówienia powyżej progów unijnych:
https://ted.europa.eu

PrzetargAI wyłącznie prezentuje i porządkuje informacje z tych publicznych źródeł. Wiążąca jest zawsze treść ogłoszenia opublikowana u źródła — oceny dopasowania i wyjaśnienia generuje sztuczna inteligencja i mają charakter wyłącznie informacyjny. Nie stanowią porady prawnej ani oficjalnej informacji urzędowej.

PrzetargAI nie reprezentuje żadnej instytucji państwowej.

PrzetargAI to darmowe narzędzie B2B. Subskrypcję Standard aktywujesz wygodnie przez stronę internetową.
```

> **ZGODNOŚĆ (po odrzuceniu Google Play 2026-07-12 — „twierdzenia wprowadzające w błąd").**
> Ten sam wymóg obowiązuje w App Store (Apple 5.2.3 / 2.3.1). Opis MUSI zawierać:
> pełne, DZIAŁAJĄCE URL-e do źródeł informacji urzędowych + widoczne zastrzeżenie
> o braku powiązania z instytucją państwową. Nie usuwać przy edycjach.

### 4.3 Keywords (100 zn, oddzielone PRZECINKAMI bez spacji)
```
przetargi,zamówienia publiczne,BZP,przetarg,budowlane,oferty,monitoring,biznes,zamówienia,AI
```

### 4.4 Support URL
```
https://jakatora.github.io/przetargai/
```

### 4.5 Marketing URL (Optional ale wypełnij)
```
https://jakatora.github.io/przetargai/
```

### 4.6 Copyright
```
2026 Krzysztof Kapusta
```

### 4.7 What's New in This Version (przy każdej nowej wersji)

Wersja 1.0.6 (AKTUALNA — bez emoji, bullet • OK):
```
Ta aktualizacja zamienia PrzetargAI w kompletne narzędzie do pracy z przetargami:

• Wyjaśnienie AI — otwórz przetarg i poproś o prosty opis: czego dotyczy, co
  zwykle trzeba przygotować, na co zwrócić uwagę i czy nadaje się dla małej firmy.
• Zapisane przetargi z etapami pracy — prowadź kilka postępowań naraz: Rozważam,
  Przygotowuję ofertę, Oferta złożona, Wygrana lub Przegrana.
• Notatki przy przetargu — zapisz, jakie dokumenty zebrać i o co dopytać zamawiającego.
• Przypomnienia o terminie — powiadomienie, zanim minie termin składania ofert.
• Wyszukiwarka i sortowanie — znajdź konkretny przetarg albo ustaw listę według
  terminu, trafności lub daty dodania.
• Filtr trafności — pokazuj tylko przetargi powyżej wybranego procentu dopasowania.
• Poprawki stabilności i wydajności.
```

Wersja 1.0.3:
```
Szybciej znajdziesz to, co ważne:

• Wyszukiwarka — filtruj przetargi po nazwie lub zamawiającym, z tolerancją odmian.
• Sortowanie — ustaw kolejność: Trafność, Termin (najbliższy pierwszy) lub Najnowsze.
• Drobne poprawki.
```

Wersja 1.0.2 (poprzednia):
```
Zapisuj przetargi i nie przegap terminu:

• Zapisane przetargi — dotknij gwiazdki, aby zebrać interesujące ogłoszenia i wrócić do nich później.
• Przypomnienie o terminie — włącz powiadomienie, a damy Ci znać, zanim upłynie termin składania ofert.
```

Wersja 1.0.1 (poprzednia):
```
Więcej źródeł i pełna kontrola nad listą przetargów:

• TED — monitorujemy teraz także przetargi unijne powyżej progów, których nie ma w BZP.
• Filtr trafności — ustaw minimalny procent dopasowania (70%, 80%, 90%).
• Ściąga kodów CPV — nie musisz znać kodów. Wyszukaj swoją branżę.
• Tryb ciemny — jasny, ciemny albo zgodny z ustawieniem telefonu.
• Prostsza rejestracja — wystarczą e-mail i hasło, bez NIP-u.
• Plan Standard 49 zł/mies. — nielimitowane dopasowania i powiadomienia push.
```

---

## 5. App Store Connect → App Review Information

### 5.1 Sign-in required
**Yes** ☑

### 5.2 Demo Account
| Pole | Wartość |
|---|---|
| **User name** | `apple-review@przetargai.demo` |
| **Password** | `AppleReview2026!` |

### 5.3 Contact Information
| Pole | Wartość |
|---|---|
| **First name** | `Krzysztof` |
| **Last name** | `Kapusta` |
| **Phone** | (Twój numer telefonu) |
| **Email** | `jakatora68@gmail.com` |

### 5.4 Notes for Apple Reviewer
```
PrzetargAI is a B2B SaaS tool for Polish small/medium businesses. The app monitors the public procurement bulletin (BZP — Biuletyn Zamówień Publicznych) and uses Claude AI (Anthropic) to match tenders to the company's profile based on keywords and CPV codes.

DEMO ACCOUNT (pre-configured construction industry profile):
- Email: apple-review@przetargai.demo
- Password: AppleReview2026!

After login you'll see 5 real tender matches from the Polish public procurement bulletin (BZP) with AI-generated relevance scores (72-92) and reasoning in Polish. The matching algorithm runs server-side using Claude Haiku 4.5 model.

DATA SOURCE:
All tender data comes from the official Polish government API at ezamowienia.gov.pl/mo-board/api/v1/notice (Biuletyn Zamówień Publicznych — public domain information published by the Polish Public Procurement Office). No scraping, no private data — it's the official public registry mandated by Polish law.

SUBSCRIPTION FLOW (important — explains why no StoreKit):
The "Standard" 49 PLN/month subscription is sold through our external website (jakatora.github.io/przetargai), not through in-app purchases. This is intentional — the app itself is free; the Standard subscription is a separate web-based B2B service handled by Stripe.

The "Aktywuj Standard" / "Upgrade" button in the Account screen opens an external browser to handle the magic-link upgrade flow. The app does NOT use StoreKit because it's a free professional tool, not a digital content app.

Reference: App Store Review Guideline 3.1.3(b) "Free professional services" — apps that are free and offer professional services (like B2B SaaS, banking, etc.) can use external payment systems for service activation.

PRIVACY:
Full privacy policy: https://jakatora.github.io/przetargai/polityka-prywatnosci.html
Terms: https://jakatora.github.io/przetargai/regulamin.html

Both pages are also served by the backend at https://backend-production-a43e3.up.railway.app/polityka-prywatnosci

For any clarifications: jakatora68@gmail.com (Krzysztof Kapusta).
```

---

## 6. Build (TestFlight → App Store)

### Wymóg
Apple wymaga **Build dodany do wersji** przed Submit. Build powstaje z Codemagic → trafia do App Store Connect → pojawia się w **TestFlight** tabie po Apple processing (~5-30 min).

### Krok po kroku po przetworzeniu builda przez Apple
1. ASC → My Apps → PrzetargAI → **App Store** (lewy menu) → wersja `1.0.0`
2. Przewiń do sekcji **Build** → kliknij **+ Add Build**
3. Wybierz build `1.0.0 (102)` (wersja + build number z Codemagic)
4. Save

### Encryption Export Compliance (po dodaniu Build)
ASC zapyta o compliance. Odpowiedź:

| Pytanie | Odpowiedź |
|---|---|
| Does your app use encryption? | **Yes** (HTTPS to encryption) |
| Does your app qualify for exemption from US export regulations? | **Yes** — opiera się na exemption note 1 (apka używa tylko HTTPS/TLS dla komunikacji z backendem) |
| Does your app implement any standard encryption algorithms not exempt? | **No** |

`ITSAppUsesNonExemptEncryption: false` ustawione w `app.json` → Apple powinien automatycznie nie pytać.

---

## 7. App Store Screenshots — iPhone 6.7" Display

### Wymagane wymiary
**1284 × 2778 lub 1290 × 2796 lub 1242 × 2688** (Apple akceptuje dowolny z tych)

### Files na pulpicie
```
C:\Users\Startklaar\Desktop\PrzetargAI-store-assets\
├── screenshot-1-feed.png        1284×2778
├── screenshot-2-detail.png      1284×2778  ⭐ najczystszy
├── screenshot-3-profile.png     1284×2778
├── screenshot-4-plans.png       1284×2778
└── screenshot-5-push.png        1284×2778
```

### Minimum / Maximum
- **Minimum:** 3
- **Maximum:** 10
- **Zalecane:** 5-7 (Apple rekomenduje aby pokazać różne aspekty appki)

### Strategia dla pierwszego submission
1. Wgraj **screenshot-2-detail.png** (jedyny w pełni czysty)
2. Po dodaniu Build z TestFlight: zainstaluj na realnym iPhone → zrób **3-4 dodatkowe screenshoty z prawdziwej apki** (Power + Volume Up) → wgraj je
3. Razem 4-5 screenshotów (1 z Canva + 3-4 realne) — pełen comfort dla Apple QA

---

## 8. Po wgraniu wszystkiego — Submit for Review

1. **Górny prawy róg** strony wersji 1.0 → przycisk **Submit for Review** (lub **Add for Review**)
2. ASC zapyta jeszcze raz o **Advertising Identifier (IDFA)** → wybierz **No, this app does not use IDFA**
3. **Submit**

### Czas review (Apple)
- Najczęściej: **24-48 godzin**
- Pierwsza submission: czasem 2-7 dni (dłużej dla nowych deweloperów)
- Status: ASC → wersja → góra → status zmieni się z **Prepare for Submission** → **Waiting for Review** → **In Review** → (sukces) **Pending Developer Release** lub **Ready for Sale**

### Po Pending Developer Release
- Kliknij **Release this Version** w ASC, lub
- Zostaw `Automatic Release` (apka pojawi się w App Store w ciągu kilku godzin po aprobacie)

---

## 9. Możliwe „Metadata Rejected" — co naprawić

Najczęstsze powody odrzucenia metadata (NIE binarki):

| Powód | Fix |
|---|---|
| Privacy Policy URL nie działa | sprawdź `https://jakatora.github.io/przetargai/polityka-prywatnosci.html` w przeglądarce |
| Screenshots zawierają placeholder text (`reallygreatsite.com`) | wgraj nowe screenshoty z prawdziwej apki |
| Demo account nie działa | upewnij się że konto `apple-review@przetargai.demo` istnieje w produkcyjnej bazie + ma matche w feedzie |
| Subscription terms / pricing nie zgadza się z opisem | zostaw 49 PLN/mc spójnie wszędzie |
| Wymaga login bez wyjaśnienia po co | dodać w Notes for Reviewer kontekst (już mamy) |

---

## 10. Demo Account — health check

Przed Submit upewnij się że konto Apple reviewera **działa**:

```bash
curl -X POST https://backend-production-a43e3.up.railway.app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"apple-review@przetargai.demo","password":"AppleReview2026!"}'
```

Powinien zwrócić `200` z `token`. Jeśli `401` lub coś innego — konto trzeba odtworzyć (admin endpoint backendu).

---

## Bonus: Quick reference, gdyby coś zniknęło

- **Bundle ID**: `pl.przetargai.app`
- **Team ID**: `B7J6A7R258`
- **ASC App Apple ID**: (zobaczysz w ASC po utworzeniu app record, format `1234567890`)
- **Privacy URL**: `https://jakatora.github.io/przetargai/polityka-prywatnosci.html`
- **Terms URL**: `https://jakatora.github.io/przetargai/regulamin.html`
- **Support URL**: `https://jakatora.github.io/przetargai/`
- **Backend**: `https://backend-production-a43e3.up.railway.app`
- **Demo: Apple reviewer**: `apple-review@przetargai.demo` / `AppleReview2026!`
- **Demo: Google reviewer**: `play-review@przetargai.demo` / `PlayReview2026!`

---

**Wszystkie wartości copy-paste ready. Otwórz ASC, sekcję po sekcji wklejaj.**
