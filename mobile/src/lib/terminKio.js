/**
 * Kalkulator terminu na wniesienie odwołania do KIO — podzadanie 3/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie".
 *
 * WYŁĄCZNIE czysta funkcja liczenia daty granicznej — bez UI, bez modelu, bez
 * storage. Kolejne podzadania wpną ją w {@link ../lib/poprzetargowaKontrola}
 * (pole `terminOdwolaniaKio`) i w odliczanie na ekranie.
 *
 * Podstawa prawna:
 *  - art. 515 ust. 1 ustawy Pzp — długość terminu na odwołanie od czynności
 *    zamawiającego (tu: informacja o wyborze najkorzystniejszej oferty):
 *      • wartość ≥ progi unijne:  10 dni (komunikacja elektroniczna) / 15 dni (inaczej),
 *      • wartość < progi unijne:   5 dni (komunikacja elektroniczna) / 10 dni (inaczej).
 *  - art. 8 ust. 1 Pzp odsyła przy obliczaniu terminów do Kodeksu cywilnego:
 *      • art. 111 § 2 KC — dnia zdarzenia (przekazania informacji o wyniku) NIE
 *        liczymy; bieg terminu zaczyna się następnego dnia. Stąd data graniczna
 *        = data ogłoszenia wyniku + N dni.
 *      • art. 115 KC — jeżeli koniec terminu wypada w sobotę, niedzielę albo dzień
 *        ustawowo wolny od pracy, termin upływa najbliższego dnia roboczego.
 *
 * Cała arytmetyka idzie w UTC (Date.UTC / getUTC*), żeby wynik nie zależał od
 * strefy czasowej środowiska (test, telefon) — liczymy dni kalendarzowe, nie chwile.
 * Wyjątek: CHWILA upływu terminu (odliczanie) to 24:00 czasu polskiego — patrz
 * {@link ./dataUtc koniecDniaPL}.
 */

import { koniecDniaPL, naDzienUTC } from './dataUtc.js';

export const MS_DZIEN = 24 * 60 * 60 * 1000;
const MS_GODZINA = 60 * 60 * 1000;

/**
 * Tryby wyznaczające długość terminu wg art. 515 ust. 1 Pzp. Enum jak
 * `STATUSY_KONTROLI` ({ wartosc, dni, etykieta }). Skróty `unijny`/`krajowy`
 * zakładają komunikację elektroniczną (obecnie standard w Pzp); warianty
 * `*_pisemny` to przekazanie informacji w inny sposób niż elektroniczny.
 */
export const TRYBY_KIO = [
  { wartosc: 'unijny', dni: 10, etykieta: 'Powyżej progów unijnych (elektronicznie)' },
  { wartosc: 'unijny_pisemny', dni: 15, etykieta: 'Powyżej progów unijnych (poza komunikacją elektroniczną)' },
  { wartosc: 'krajowy', dni: 5, etykieta: 'Poniżej progów unijnych (elektronicznie)' },
  { wartosc: 'krajowy_pisemny', dni: 10, etykieta: 'Poniżej progów unijnych (poza komunikacją elektroniczną)' },
];

/**
 * Domyślny tryb, gdy wołający nie zna reżimu. Świadomie NAJKRÓTSZY termin
 * (krajowy, 5 dni): zawyżenie terminu jest groźne — spóźnione odwołanie KIO
 * odrzuca, więc lepiej pokazać wcześniejszą datę graniczną niż uśpić czujność.
 */
export const TRYB_KIO_DOMYSLNY = 'krajowy';

/**
 * Wpis z {@link TRYBY_KIO}, którym FAKTYCZNIE liczymy termin: podany tryb albo — gdy
 * nieznany/pusty — {@link TRYB_KIO_DOMYSLNY}. Eksport (2026-09-25), żeby orkiestrator mógł
 * zapisać w podstawie terminu prawdziwy tryb, a nie ten, o który go poproszono.
 * @param {string} [tryb]
 * @returns {{wartosc: string, dni: number, etykieta: string}}
 */
export function trybKio(tryb) {
  return TRYBY_KIO.find((t) => t.wartosc === tryb)
    ?? TRYBY_KIO.find((t) => t.wartosc === TRYB_KIO_DOMYSLNY);
}

function dniDlaTrybu(tryb) {
  return trybKio(tryb).dni;
}

/*
 * `naDzienUTC` — sprowadzenie wejścia do znacznika UTC północy dnia kalendarzowego.
 * Poprawka 2026-09-25: jedna implementacja w `dataUtc.js` (była tu kopia z furtką
 * `new Date(str)`, przez którą „10.06.2026" liczyło się jak 6 października). Re-eksport
 * zostaje, bo importują go stąd kalkulatorTerminow i odsetkiOpoznienie.
 */
export { naDzienUTC };

/**
 * Niedziela Wielkanocna dla danego roku (algorytm Gaussa/Meeusa, kalendarz
 * gregoriański). Zwraca { miesiac (1-12), dzien }. Potrzebna do ruchomych dni
 * wolnych: Poniedziałek Wielkanocny (+1) i Boże Ciało (+60).
 */
function wielkanoc(rok) {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return { miesiac, dzien };
}

// Dni ustawowo wolne od pracy o stałej dacie (miesiąc-dzień). 24.12 dodane
// ustawą obowiązującą od 2025 r. (Wigilia dniem wolnym).
const STALE_DNI_WOLNE = new Set([
  '1-1', // Nowy Rok
  '1-6', // Trzech Króli
  '5-1', // Święto Pracy
  '5-3', // Święto Konstytucji 3 Maja
  '8-15', // Wniebowzięcie NMP / Święto Wojska Polskiego
  '11-1', // Wszystkich Świętych
  '11-11', // Narodowe Święto Niepodległości
  '12-24', // Wigilia (od 2025 r.)
  '12-25', // Boże Narodzenie (1. dzień)
  '12-26', // Boże Narodzenie (2. dzień)
]);

/** Zbiór znaczników UTC ruchomych dni wolnych (zależnych od Wielkanocy) dla roku. */
function ruchomeDniWolne(rok) {
  const { miesiac, dzien } = wielkanoc(rok);
  const wielkanocMs = Date.UTC(rok, miesiac - 1, dzien);
  return new Set([
    wielkanocMs, // Niedziela Wielkanocna
    wielkanocMs + 1 * MS_DZIEN, // Poniedziałek Wielkanocny
    wielkanocMs + 49 * MS_DZIEN, // Zielone Świątki (Zesłanie Ducha Świętego)
    wielkanocMs + 60 * MS_DZIEN, // Boże Ciało
  ]);
}

/** Czy dany znacznik UTC (północ dnia) to dzień ustawowo wolny od pracy w PL. */
export function czyDzienUstawowoWolny(dniaMs) {
  const d = new Date(dniaMs);
  const klucz = `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  if (STALE_DNI_WOLNE.has(klucz)) return true;
  return ruchomeDniWolne(d.getUTCFullYear()).has(dniaMs);
}

/** Czy dany znacznik UTC to dzień wolny w rozumieniu art. 115 KC (sobota/niedziela/święto). */
export function czyDzienWolny(dniaMs) {
  const dzienTygodnia = new Date(dniaMs).getUTCDay(); // 0 = niedziela, 6 = sobota
  if (dzienTygodnia === 0 || dzienTygodnia === 6) return true;
  return czyDzienUstawowoWolny(dniaMs);
}

export function formatujDate(dniaMs) {
  const d = new Date(dniaMs);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Data graniczna wniesienia odwołania do KIO.
 *
 * Nazwa i sygnatura zgodnie ze specyfikacją podzadania (snake_case celowo —
 * to kontrakt wołany przez kolejne podzadania).
 *
 * @param {string|Date} data_ogloszenia_wyniku dzień przekazania informacji o
 *   wyborze najkorzystniejszej oferty (ISO `YYYY-MM-DD`, pełny ISO, `DD.MM.RRRR` lub `Date`).
 * @param {'unijny'|'unijny_pisemny'|'krajowy'|'krajowy_pisemny'} [tryb]
 *   reżim terminu wg art. 515 ust. 1 Pzp; nieznany/pusty → {@link TRYB_KIO_DOMYSLNY}.
 * @returns {string|null} data graniczna jako `YYYY-MM-DD` (ostatni dzień na
 *   wniesienie odwołania) albo `null`, gdy daty wejściowej nie da się odczytać
 *   (nie zgadujemy terminu prawnego z niepewnej daty).
 */
export function oblicz_termin_kio(data_ogloszenia_wyniku, tryb) {
  const startMs = naDzienUTC(data_ogloszenia_wyniku);
  if (startMs === null) return null;

  // art. 111 § 2 KC: dnia zdarzenia nie liczymy → koniec terminu = data + N dni.
  let terminMs = startMs + dniDlaTrybu(tryb) * MS_DZIEN;

  // art. 115 KC: przesuwamy na najbliższy dzień roboczy (może przeskoczyć kilka dni).
  while (czyDzienWolny(terminMs)) {
    terminMs += MS_DZIEN;
  }

  return formatujDate(terminMs);
}

/**
 * Odliczanie do upływu terminu — podzadanie 4/13. Czysta funkcja: ile jeszcze
 * czasu zostało do granicznej daty (np. {@link oblicz_termin_kio}) i czy termin
 * już minął. Zasila odliczanie na ekranie i pole pomocnicze kontroli
 * ({@link ../lib/poprzetargowaKontrola dolaczPozostalyCzas}).
 *
 * Termin PRAWNY obejmuje CAŁY dzień graniczny — odwołanie do KIO można wnieść aż
 * do końca tej daty. Dlatego moment upływu = KONIEC dnia granicznego = 24:00
 * czasu POLSKIEGO ({@link ./dataUtc koniecDniaPL}). Poprawka 2026-09-25: wcześniej
 * brana była północ UTC (01:00/02:00 w Polsce) — o 00:30 PL dnia następnego
 * odliczanie wciąż pokazywało, że termin trwa. Świadomie inaczej niż
 * {@link ../lib/termin opisTerminu}, gdzie `deadline` niesie konkretną godzinę
 * złożenia oferty.
 *
 * `dni`/`godziny` to rozbicie pozostałego czasu w DÓŁ (floor): „zostały co
 * najmniej 3 dni i 5 godz." — bez zawyżania, bo spóźnione odwołanie KIO odrzuca.
 * Po upływie zwracamy `poTerminie: true` z wyzerowanym `dni`/`godziny`
 * (surowy, ujemny dystans jest w `pozostaloMs`, gdyby ekran chciał go pokazać).
 *
 * @param {string|Date} termin data graniczna (ISO `YYYY-MM-DD`, pełny ISO, `DD.MM.RRRR` lub `Date`).
 * @param {number} [teraz] czas odniesienia w ms (Date.now()) — wstrzykiwany w testach.
 * @returns {{poTerminie: boolean, dni: number, godziny: number, pozostaloMs: number}|null}
 *   `null`, gdy `termin` jest nieczytelny (spójnie z {@link oblicz_termin_kio} —
 *   nie zgadujemy odliczania z niepewnej daty; ekran traktuje to jak „termin nieznany").
 */
export function pozostaly_czas_do(termin, teraz = Date.now()) {
  const dzienMs = naDzienUTC(termin);
  if (dzienMs === null) return null;

  const uplywMs = koniecDniaPL(dzienMs); // koniec dnia granicznego = 24:00 czasu polskiego
  const pozostaloMs = uplywMs - teraz;

  if (pozostaloMs <= 0) {
    return { poTerminie: true, dni: 0, godziny: 0, pozostaloMs };
  }

  return {
    poTerminie: false,
    dni: Math.floor(pozostaloMs / MS_DZIEN),
    godziny: Math.floor((pozostaloMs % MS_DZIEN) / MS_GODZINA),
    pozostaloMs,
  };
}
