/**
 * Geometria design systemu — wspólna dla obu motywów.
 *
 * KOLORY celowo NIE są tu eksportowane: paleta zależy od motywu
 * (jasny/ciemny) i żyje w src/lib/motyw.js, a komponenty biorą ją przez
 * useTheme()/useStyle() z src/context/ThemeContext.js. Statyczny import
 * koloru zamroziłby go w chwili importu i przełącznik by go nie zmienił.
 */

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16 };
