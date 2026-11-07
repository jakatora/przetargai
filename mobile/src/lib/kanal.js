/*
 * KANAŁ DYSTRYBUCJI BUILDU (2026-11-07). Ten sam kod trafia do AAB w Google Play, do APK ze strony
 * i do wersji web/Windows. Google Play wymaga Play Billing dla usług cyfrowych i zabrania kierowania
 * do płatności poza Play (zakup Standard idzie przez Stripe) oraz aktualizacji spoza Play (pasek
 * „pobierz APK ze strony”). Build dla Play ustawia przy budowaniu
 * `EXPO_PUBLIC_KANAL=kanal-google-play` — wtedy apka nie pokazuje zakupu ani paska APK.
 * Bez zmiennej (APK ze strony, web, Windows, iOS) wszystko jak dotąd.
 *
 * Wartość wpisuje bundler przy budowaniu (zmienne `EXPO_PUBLIC_*`), więc pomyłkę widać dopiero
 * w gotowym pliku: `node scripts/sprawdz-kanal.mjs <plik.aab|.apk> play|strona` szuka napisu
 * `kanal-google-play` w paczce JS. Tego napisu celowo NIE ma w kodzie poniżej (sprawdzamy tylko
 * końcówkę „play”), żeby był w paczce wyłącznie wtedy, gdy wpisał go build.
 */

/** 'play' dla wartości kończącej się członem „play” (np. `kanal-google-play`), inaczej 'strona'. */
export function kanalZWartosci(wartosc) {
  return /(^|-)play$/i.test(String(wartosc ?? '').trim()) ? 'play' : 'strona';
}

export const KANAL = kanalZWartosci(process.env.EXPO_PUBLIC_KANAL);

/** Czy wolno pokazać zakup planu Standard (Stripe) i jego cenę. */
export const POKAZUJ_ZAKUP = KANAL !== 'play';
