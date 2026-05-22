# Metadane do sklepów — PrzetargAI

Gotowe teksty do wklejenia w App Store Connect i Google Play Console.
Limity znaków podane przy każdym polu.

---

## Wspólne

- **Nazwa aplikacji:** PrzetargAI
- **Kategoria:** Biznes
- **Adres polityki prywatności:** https://przetargai.pl/polityka-prywatnosci
- **Adres wsparcia:** https://przetargai.pl
- **E-mail kontaktowy:** support@przetargai.pl
- **Klasyfikacja wiekowa:** 4+ / dla wszystkich (brak treści wrażliwych)

---

## App Store (Apple)

**Nazwa (max 30):**
```
PrzetargAI
```

**Podtytuł (max 30):**
```
Monitoring przetargów z BZP
```

**Tekst promocyjny (max 170):**
```
Nie przegap żadnego przetargu. AI codziennie analizuje BZP i powiadamia Cię o ogłoszeniach dopasowanych do profilu Twojej firmy.
```

**Słowa kluczowe (max 100, po przecinku):**
```
przetargi,zamówienia publiczne,BZP,przetarg,budowlane,oferty,monitoring,biznes,zamówienia
```

**Opis:**
```
PrzetargAI to narzędzie dla firm budowlanych i IT, które chcą wygrywać
zamówienia publiczne — bez codziennego przeglądania setek ogłoszeń.

Aplikacja codziennie analizuje ogłoszenia z Biuletynu Zamówień Publicznych
(BZP) i dzięki sztucznej inteligencji pokazuje Ci tylko te przetargi, które
pasują do profilu Twojej firmy. Każde dopasowanie ma ocenę trafności
i krótkie uzasadnienie.

FUNKCJE:
• Dopasowanie przetargów przez AI na podstawie profilu firmy
• Codzienna analiza ogłoszeń z BZP
• Powiadomienia push o nowych, trafnych przetargach (plan Standard)
• Szczegóły ogłoszenia: zamawiający, termin, wartość, kod CPV
• Link do pełnego ogłoszenia w BZP

PLANY:
• Free — 5 dopasowanych przetargów dziennie, bezpłatnie
• Standard — nielimitowane dopasowania i powiadomienia push

PrzetargAI to darmowe narzędzie B2B. Subskrypcję Standard aktywujesz
wygodnie przez stronę internetową.
```

---

## Google Play (Android)

**Nazwa aplikacji (max 30):**
```
PrzetargAI
```

**Krótki opis (max 80):**
```
AI monitoruje przetargi z BZP i powiadamia o ogłoszeniach dla Twojej firmy.
```

**Pełny opis (max 4000):**
```
PrzetargAI to narzędzie dla firm budowlanych i IT, które chcą wygrywać
zamówienia publiczne — bez codziennego przeglądania setek ogłoszeń.

Każdego dnia w Biuletynie Zamówień Publicznych pojawia się ponad 300 nowych
ogłoszeń. Ręczne wyszukiwanie tych istotnych dla Twojej firmy zajmuje godziny.
PrzetargAI robi to za Ciebie.

JAK TO DZIAŁA
1. Zakładasz konto i opisujesz profil firmy — słowa kluczowe i kody CPV.
2. PrzetargAI codziennie analizuje nowe ogłoszenia z BZP.
3. Sztuczna inteligencja ocenia trafność każdego przetargu i pokazuje Ci
   tylko te dopasowane do Twojej działalności.

FUNKCJE
• Dopasowanie przetargów przez AI z oceną trafności i uzasadnieniem
• Codzienna, automatyczna analiza ogłoszeń z BZP
• Powiadomienia push o nowych, trafnych przetargach (plan Standard)
• Szczegóły ogłoszenia: zamawiający, termin składania ofert, wartość, CPV
• Bezpośredni link do pełnego ogłoszenia w BZP

PLANY
• Free — 5 dopasowanych przetargów dziennie, bezpłatnie i bezterminowo
• Standard (199 zł/mc) — nielimitowane dopasowania oraz powiadomienia push

Dane o przetargach pochodzą z oficjalnego, publicznego źródła — Biuletynu
Zamówień Publicznych prowadzonego na platformie e-Zamówienia.

PrzetargAI to darmowe narzędzie B2B. Subskrypcję Standard aktywujesz
wygodnie przez stronę internetową przetargai.pl.
```

---

## Wymagane materiały graficzne (do przygotowania)

| Materiał | App Store | Google Play |
|----------|-----------|-------------|
| Ikona aplikacji | 1024×1024 px | 512×512 px |
| Grafika promocyjna (feature graphic) | — | 1024×500 px |
| Zrzuty ekranu (telefon) | min. 3 (6.7" i 6.5") | min. 2 (16:9 lub 9:16) |
| Zrzuty ekranu (tablet) | opcjonalnie | opcjonalnie |

Sugerowane zrzuty: ekran feedu dopasowań, szczegóły przetargu, ekran konta.
Ikony i grafiki można wygenerować w Canva (dostępny MCP Canva).

## Checklist zgłoszenia

- [ ] Ikony i zrzuty ekranu w `mobile/assets/`
- [ ] Konto Apple Developer (99 USD/rok) i Google Play (25 USD jednorazowo)
- [ ] Build iOS i Android przez Codemagic (workflowy `ios-release` / `android-release`)
- [ ] Publikacja: iOS → TestFlight, Android → ścieżka „internal" (przez Codemagic)
- [ ] Polityka prywatności opublikowana pod https://przetargai.pl/polityka-prywatnosci
- [ ] Wypełniony formularz prywatności (App Privacy / Data safety) w obu konsolach
