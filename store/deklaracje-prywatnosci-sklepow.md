# PrzetargAI — deklaracje prywatności w sklepach (do wklejenia w konsolach)

Stan kodu: wydanie 1.1.1 (2026-09-24), BEZ Meta SDK. Dotychczasowe deklaracje były
nieprawdziwe: App Store pokazuje „Data Not Collected", Google Play „nie zbiera danych".
Aplikacja zbiera dane konta i profilu firmy, a przetwarzają je dostawcy wymienieni
w polityce prywatności (Google Firebase, Stripe, Resend, Anthropic, Expo, Railway/Backblaze).
Rozbieżność deklaracji z działaniem to typowy powód odrzucenia aktualizacji.

Formularzy nie da się wypełnić przez API — tylko w przeglądarce:
- Google Play Console → PrzetargAI → Zasady → Treść aplikacji → **Bezpieczeństwo danych**
- App Store Connect → PrzetargAI → **Prywatność aplikacji** (App Privacy)

Zasada dla obu: dostawca, który przetwarza dane W NASZYM IMIENIU (procesor), to nie jest
„udostępnianie" (Play) ani „tracking" (Apple). Śledzenia reklamowego nie ma.

---

## Google Play — Bezpieczeństwo danych

Pytania ogólne:
- Czy aplikacja zbiera lub udostępnia dane użytkownika wymagane do ujawnienia? **Tak**
- Czy wszystkie dane są szyfrowane podczas przesyłania? **Tak** (HTTPS)
- Czy użytkownik może poprosić o usunięcie danych? **Tak** — w aplikacji: Konto → Usuń konto
  (usuwa profil wraz z podkolekcjami) oraz e-mailem (adres z polityki prywatności).
  Link do strony o usuwaniu danych: `https://przetargai.web.app/polityka-prywatnosci`

Typy danych (dla każdego: **Zbierane: tak, Udostępniane: nie**, przetwarzane efemerycznie: nie,
wymagane / opcjonalne jak niżej):

| Kategoria Play | Typ | Wymagane? | Cel (Play) | Skąd w aplikacji |
|---|---|---|---|---|
| Dane osobowe | Adres e-mail | Wymagane | Funkcje aplikacji, Zarządzanie kontem | rejestracja, logowanie, reset hasła, e-maile z alertami |
| Dane osobowe | Identyfikatory użytkownika | Wymagane | Funkcje aplikacji, Zarządzanie kontem | id konta w bazie |
| Dane osobowe | Inne informacje | Opcjonalne | Funkcje aplikacji, Personalizacja | nazwa firmy, NIP, słowa kluczowe, kody CPV, regiony, maks. wartość |
| Informacje finansowe | Historia zakupów | Opcjonalne | Funkcje aplikacji, Zarządzanie kontem | plan (Free/Standard), identyfikator klienta Stripe; płatność na stronie Stripe, dane karty NIE trafiają do nas |
| Aktywność w aplikacji | Inne treści tworzone przez użytkownika | Opcjonalne | Funkcje aplikacji | zapisane przetargi, notatki, statusy, obserwowane plany |
| Aktywność w aplikacji | Historia wyszukiwania w aplikacji | Opcjonalne | Funkcje aplikacji | zapisane wyszukiwania z alertami |
| Aktywność w aplikacji | Interakcje z aplikacją | Opcjonalne | Analityka | ocena trafności dopasowania („pomocne / niepomocne") |
| Pliki i dokumenty | Pliki i dokumenty | Opcjonalne | Funkcje aplikacji | Sejf dokumentów, Rejestrator oferty (pliki wgrywane przez użytkownika) |
| Identyfikatory urządzenia lub inne | Identyfikatory urządzenia lub inne | Opcjonalne | Funkcje aplikacji | token powiadomień push (Expo) |

NIE zbieramy: lokalizacji, kontaktów, zdjęć z galerii (poza plikami, które użytkownik sam
wskaże w Sejfie), zdrowia, wiadomości, dzienników awarii, identyfikatora reklamowego.

⚠️ Jeśli kiedyś wejdzie Meta App Events (Android): dochodzi „Identyfikatory urządzenia lub inne"
→ **Udostępniane: TAK** (Meta, cel: reklama/marketing, analityka) oraz „Interakcje z aplikacją"
udostępniane Meta. Wtedy formularz I polityka prywatności muszą to wymieniać.

---

## App Store — App Privacy

„Czy Ty lub Twoi partnerzy zbieracie dane z tej aplikacji?" → **Tak**.
Dla wszystkich typów poniżej: **Linked to the user: Yes**, **Used for tracking: No**.

| Kategoria Apple | Typ | Cele (Apple) |
|---|---|---|
| Contact Info | Email Address | App Functionality |
| Contact Info | Name *(nazwa firmy — jeśli JDG, bywa imieniem i nazwiskiem)* | App Functionality |
| Identifiers | User ID | App Functionality |
| Identifiers | Device ID *(token push)* | App Functionality |
| Purchases | Purchase History | App Functionality |
| User Content | Other User Content *(notatki, zapisane przetargi, dokumenty w Sejfie)* | App Functionality |
| Search History | Search History *(zapisane wyszukiwania)* | App Functionality |
| Usage Data | Product Interaction *(ocena trafności dopasowań)* | Analytics, App Functionality |
| Other Data | Other Data Types *(NIP, słowa kluczowe, kody CPV, regiony)* | App Functionality, Product Personalization |

Nie deklarujemy: Location, Contacts, Health, Financial Info (karta — obsługuje Stripe na stronie),
Diagnostics (brak Sentry/crash reportingu w aplikacji), Browsing History, Sensitive Info.

---

## Po wypełnieniu

- Sprawdź, czy link do polityki w obu konsolach wskazuje JEDEN adres z aktualną treścią
  (bez Sentry, z Expo): `https://przetargai.web.app/polityka-prywatnosci` — po wdrożeniu
  hostingu z 2026-09-24. Adres `jakatora.github.io/przetargai/...` (GitHub Pages z `docs/`)
  aktualizuje się dopiero po wypchnięciu `main`.
- Play: e-mail pomocy w karcie sklepu to `kkprotigwelding@gmail.com` (z innego projektu) —
  zmień na adres z polityki.
