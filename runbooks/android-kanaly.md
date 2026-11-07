# Android: dwa kanały — AAB dla Google Play i APK ze strony (od 2026-11-07)

Google Play wymaga Play Billing dla usług cyfrowych i zabrania kierowania do płatności poza Play
oraz aktualizacji spoza Play. Plan Standard sprzedajemy przez Stripe, a apka ma pasek „pobierz APK
ze strony”. Dlatego AAB dla Play budujemy z `EXPO_PUBLIC_KANAL=kanal-google-play`
(`mobile/src/lib/kanal.js`): bez przycisków zakupu i ceny, bez zachęty do Standard, bez paska APK.
Informacja o próbie i o tym, co jest w planie Standard, zostaje. APK ze strony, web/Windows i iOS
budujemy bez zmiennej — wszystko jak dotąd.

## Pułapka: stara paczka JS

Zmienna `EXPO_PUBLIC_*` trafia do paczki przy pakowaniu. Pomiar 7.11: pakowanie bez zmiennej po
pakowaniu z nią dało paczkę ZE znacznikiem Play (pamięć Metro), a gradle pomija zadanie paczki,
gdy jej wyniki już są. Jeden przebieg `bundleRelease assembleRelease` dałby ten sam kanał w obu
plikach. Dlatego dwa osobne przebiegi, każdy po `czysc-paczke-js.mjs`, i sprawdzenie GOTOWEGO pliku.

## Przepis (Git Bash, JDK 21 jak w `runbooks/wydanie-1.1.6.md`)

```bash
cd mobile
# 1. APK ze strony — kanał „strona”
node scripts/czysc-paczke-js.mjs
(cd android && ./gradlew.bat assembleRelease)
node scripts/sprawdz-kanal.mjs android/app/build/outputs/apk/release/app-release.apk strona
cp android/app/build/outputs/apk/release/app-release.apk ~/Documents/PrzetargAI-<wersja>.apk

# 2. AAB dla Google Play — kanał „play”
node scripts/czysc-paczke-js.mjs
(cd android && EXPO_PUBLIC_KANAL=kanal-google-play ./gradlew.bat bundleRelease)
node scripts/sprawdz-kanal.mjs android/app/build/outputs/bundle/release/app-release.aab play
cp android/app/build/outputs/bundle/release/app-release.aab ~/Documents/PrzetargAI-<wersja>.aab
```

`sprawdz-kanal.mjs` czyta `assets/index.android.bundle` z pliku i szuka napisu `kanal-google-play`
(jest w paczce tylko wtedy, gdy wpisał go build) oraz napisu kontrolnego z kodu apki. Kod 0 = zgodnie,
1 = zły kanał (NIE wysyłać), 2 = nie da się przeczytać. Wersje 1.2.2 i starsze: kanał „strona”.

## Po zmianie

- Strona pobierania i `landing/wersja.json` dotyczą tylko APK ze strony i Windows. Build z Play nie
  pokazuje paska, więc podbicie `wersja.json` przed akceptacją w Play nikomu nie podsuwa APK.
- Strażnik `mobile/test/kanal.test.js`: każdy plik z linkiem Stripe albo ceną musi sprawdzać
  `POKAZUJ_ZAKUP`; napisu `kanal-google-play` nie może być w kodzie.
- iOS (Codemagic) budujemy bez zmiennej — zakup przez stronę opisuje notatka dla recenzenta App Store.
