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
  jasny: {
    bg: '#f4f7fc',
    surface: '#ffffff',
    text: '#14213d',
    textMuted: '#5b6577',
    border: '#e3e8f2',
    blue: '#2563eb',
    green: '#16a34a',
    danger: '#dc2626',
    white: '#ffffff',
    // Tła semantyczne (wcześniej twarde hexy rozsiane po ekranach):
    wyroznienie: '#eaeffa',     // wiersz działu w ściądze CPV
    ostrzezenieTlo: '#fef3c7',  // pasek błędu dociągania feedu
    ostrzezenieTekst: '#92400e',
    neutralneTlo: '#e7ebf3',    // plakietka „Plan Free"
    sukcesTlo: '#dcfce7',       // plakietka „Plan Standard"
    dangerTlo: '#fee2e2',       // tło czerwonej flagi (prześwietlenie umowy)
  },
  ciemny: {
    bg: '#0f1526',
    surface: '#19213a',
    text: '#e8edf8',
    textMuted: '#9aa7c0',
    border: '#2b3554',
    blue: '#5b8cff',            // jaśniejszy — kontrast na ciemnym tle
    green: '#2fae66',
    danger: '#f47171',
    white: '#ffffff',
    wyroznienie: '#1e2947',
    ostrzezenieTlo: '#3b2f12',
    ostrzezenieTekst: '#fcd34d',
    neutralneTlo: '#273252',
    sukcesTlo: '#143c2a',
    dangerTlo: '#3b1518',       // czytelny na ciemnym tle wariant czerwonego tła
  },
};
