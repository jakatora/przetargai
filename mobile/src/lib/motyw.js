/**
 * Motyw jasny/ciemny — czysta logika, zero importów z React Native,
 * więc testowalna zwykłym node:test.
 *
 * Trzy preferencje użytkownika: 'system' (podążaj za telefonem),
 * 'jasny', 'ciemny'. Preferencja jest trwała (magazyn lokalny), schemat
 * to wynik jej rozstrzygnięcia względem ustawienia systemowego.
 *
 * Tokeny semantyczne zamiast surowych hexów w ekranach — test parytetu
 * pilnuje, żeby nowy token istniał w OBU paletach (najczęstsza awaria
 * dark mode to `undefined` w ciemnej palecie = niewidoczny element).
 */

export const PREFERENCJE = ['system', 'jasny', 'ciemny'];

/** Etykiety do UI — trzymane przy logice, żeby ekran nie wymyślał własnych. */
export const ETYKIETY_PREFERENCJI = {
  system: 'Systemowy',
  jasny: 'Jasny',
  ciemny: 'Ciemny',
};

/** Śmieci z magazynu (stara wersja, literówka) nie mogą wywrócić aplikacji. */
export function normalizujPreferencje(surowa) {
  return PREFERENCJE.includes(surowa) ? surowa : 'system';
}

/**
 * @param {string} preferencja 'system' | 'jasny' | 'ciemny'
 * @param {string|null|undefined} schematSystemowy 'light' | 'dark' | null (useColorScheme)
 * @returns {'jasny'|'ciemny'}
 */
export function wybierzSchemat(preferencja, schematSystemowy) {
  const pref = normalizujPreferencje(preferencja);
  if (pref !== 'system') return pref;
  return schematSystemowy === 'dark' ? 'ciemny' : 'jasny';
}

export const PALETY = {
  /*
   * System wizualny 2026-10 (docs/design-system.md): granatowy „atrament" zamiast czerni,
   * jeden niebieski akcent zgodny z ikoną aplikacji, żółty zakreślacz dla fragmentów,
   * które aplikacja wyciągnęła z dokumentów. Pary kontrastu pilnuje test/motyw.test.js.
   */
  jasny: {
    bg: '#f3f6fa',              // tło ekranu („papier")
    surface: '#ffffff',         // karty, nagłówek, arkusze
    powierzchniaWtorna: '#f7f9fc', // wnętrze karty, pole szukania, wiersz listy
    text: '#0f1b2d',            // atrament — tekst główny
    textMuted: '#526075',       // tekst drugoplanowy (6,4:1 na surface)
    border: '#dde3ec',          // linie i obramowania kart (dekoracyjne)
    obramowaniePola: '#848fa2', // obramowanie kontrolek formularza (≥3:1, WCAG 1.4.11)
    blue: '#1d4ed8',            // akcent: główne akcje, linki, zaznaczenie
    green: '#15803d',
    danger: '#b91c1c',
    naAkcencie: '#ffffff',      // tekst/ikona NA wypełnionym akcencie (blue/green/danger)
    // Tła semantyczne (wcześniej twarde hexy rozsiane po ekranach):
    wyroznienie: '#e8effd',     // delikatne tło akcentu (zaznaczony chip, baner informacyjny)
    ostrzezenieTlo: '#fef3c7',  // pasek błędu dociągania feedu
    ostrzezenieTekst: '#92400e',
    ostrzezenieAkcent: '#b45309', // akcent „pilne/ostrzeżenie" na BIAŁYM tle (obwódka+tytuł banera, chip) — żywy bursztyn, AA ≥4.5:1; nie mylić z ostrzezenieTekst (tekst na bursztynowym tle)
    neutralneTlo: '#e9eef5',    // plakietka „Plan Free"
    sukcesTlo: '#dcfce7',       // plakietka „Plan Standard"
    sukcesAkcent: '#15803d',    // akcent „sukces/łatwiejszy start" jako MAŁY tekst (badge „Łatwiejszy start", potwierdzenie, tytuł banera „w porę") — AA ≥4.5:1 na surface I sukcesTlo
    dangerTlo: '#fee2e2',       // tło czerwonej flagi (prześwietlenie umowy)
    zakreslacz: '#fde68a',      // wyróżnik marki: fragment wyciągnięty z dokumentu (SWZ, uzasadnienie)
    atrament: '#0f1b2d',        // ciemny blok (panel „Wybrane dziś", plan Standard)
    naAtramencie: '#ffffff',
    atramentDrugi: '#b8c4d8',   // tekst drugoplanowy na atramencie
    cien: 'rgba(15, 27, 45, 0.08)', // kolor cienia kart uniesionych (theme.uniesienie)
  },
  ciemny: {
    bg: '#0b1322',
    surface: '#131d31',
    powierzchniaWtorna: '#18233a',
    text: '#e6ecf6',
    textMuted: '#9aa8bf',
    border: '#263250',
    obramowaniePola: '#5a6a8e',
    blue: '#7aa2ff',            // jaśniejszy — kontrast na ciemnym tle
    green: '#34c27a',
    danger: '#f87171',
    naAkcencie: '#0b1630',      // ciemny tekst na jasnym akcencie (wzorem Material 3: onPrimary)
    wyroznienie: '#1a2847',
    ostrzezenieTlo: '#3a2e10',
    ostrzezenieTekst: '#fcd34d',
    ostrzezenieAkcent: '#fbbf24', // żywy bursztyn na ciemnym tle (obwódka+tytuł banera, chip)
    neutralneTlo: '#222d47',
    sukcesTlo: '#11372a',
    sukcesAkcent: '#4ade80',    // jaśniejsza zieleń na ciemnym tle (mały tekst) — AA ≥4.5:1 na surface I sukcesTlo
    dangerTlo: '#3b1518',
    zakreslacz: '#4a3c0e',
    atrament: '#1c2a47',
    naAtramencie: '#ffffff',
    atramentDrugi: '#b8c4d8',
    cien: 'rgba(0, 0, 0, 0.45)',
  },
};
