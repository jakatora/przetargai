/**
 * Geometria i typografia design systemu — wspólne dla obu motywów
 * (opis kierunku: docs/design-system.md).
 *
 * KOLORY celowo NIE są tu eksportowane: paleta zależy od motywu
 * (jasny/ciemny) i żyje w src/lib/motyw.js, a komponenty biorą ją przez
 * useTheme()/useStyle() z src/context/ThemeContext.js. Statyczny import
 * koloru zamroziłby go w chwili importu i przełącznik by go nie zmienił.
 */

/** Rytm odstępów 4/8 pt. */
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

/**
 * Promienie z hierarchią: drobne elementy (chip, plakietka) mniej zaokrąglone niż karty,
 * karty mniej niż arkusze. `pelny` = pigułka.
 */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pelny: 999 };

/**
 * Skala pisma (systemowy font: San Francisco / Roboto / Segoe UI — natywny wygląd,
 * skalowanie Dynamic Type i bez dodatkowej paczki fontów w aplikacji).
 * Rozkładamy do stylu: `{ ...typografia.tytul, color: k.text }`.
 */
export const typografia = {
  ekran: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.4 },
  tytul: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.2 },
  sekcja: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.1 },
  karta: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  tresc: { fontSize: 15, lineHeight: 22 },
  drobny: { fontSize: 13, lineHeight: 18 },
  etykieta: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
};

/** Minimalny obszar dotyku (Apple HIG 44 pt / Material 48 dp). */
export const DOTYK = 44;

/**
 * Cień karty uniesionej (panel „Wybrane dziś", arkusze). `boxShadow` działa w RN 0.76+
 * (nowa architektura) i w react-native-web, więc jedna definicja na wszystkie platformy.
 * Zwykłe karty listy NIE mają cienia — tylko obramowanie; cień oznacza „ważniejsze".
 *
 * @param {object} k paleta z motywu (potrzebny token `cien`)
 */
export function uniesienie(k) {
  return { boxShadow: `0px 1px 2px ${k.cien}, 0px 8px 24px ${k.cien}` };
}
