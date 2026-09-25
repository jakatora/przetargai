/**
 * Opis terminu składania ofert — najważniejsza informacja na karcie przetargu.
 *
 * Audyt 2026-07-10: dopasowanie raz utworzone zostawało w feedzie na zawsze, bez
 * żadnego oznaczenia. Użytkownik widział ofertę, na którą nie mógł już złożyć
 * wniosku, i nie miał jak tego odróżnić od aktualnej. Pilne przetargi (jutro!)
 * wyglądały tak samo jak te sprzed miesiąca.
 *
 * Poprawka 2026-09-25: „dziś/jutro/za N dni" to różnica dni KALENDARZOWYCH w Polsce, a nie
 * zaokrąglona w górę różnica chwil — termin jutro o 11:00 przy „teraz" pon 10:00 dawał
 * „Zostały 2 dni" (25 h → ceil = 2). Sama data bez godziny trwa do 24:00 czasu polskiego.
 */

import { chwilaUplywuTerminu, dzienPL, dzisiajPL, MS_DZIEN } from './dataUtc.js';

const GODZINA_MS = 3_600_000;

const BRAK = Object.freeze({ stan: 'brak', etykieta: 'Termin nieznany', pilny: false, minal: false });

/** „Zostały" dla 2–4, 22–24… (poza 12–14), w pozostałych przypadkach „Zostało". */
function zostalo(n) {
  const ost = n % 10;
  const przedost = Math.floor(n / 10) % 10;
  return przedost !== 1 && ost >= 2 && ost <= 4 ? 'Zostały' : 'Zostało';
}

/** Pozostałe godziny w DÓŁ — nie obiecujemy czasu, którego nie ma. */
function etykietaGodzin(pozostaloMs) {
  const godziny = Math.floor(pozostaloMs / GODZINA_MS);
  if (godziny < 1) return 'Mniej niż godzina';
  if (godziny === 1) return 'Została godzina';
  return `${zostalo(godziny)} ${godziny} godz.`;
}

/**
 * @param {string|null|undefined} deadline termin: ISO ze strefą (UTC), data z godziną bez
 *   strefy (czas polski) albo sama data `YYYY-MM-DD`/`DD.MM.RRRR` (do końca dnia)
 * @param {number} [teraz] czas odniesienia w ms — do testów
 * @returns {{stan: 'brak'|'minal'|'dzis'|'jutro'|'wkrotce'|'odlegly', etykieta: string, pilny: boolean, minal: boolean}}
 */
export function opisTerminu(deadline, teraz = Date.now()) {
  if (!deadline) return { ...BRAK };

  // Bez `new Date(str)` — nie zgadujemy terminu z zapisów nie-ISO („10.06.2026" → październik).
  const chwila = chwilaUplywuTerminu(deadline);
  if (!chwila) return { ...BRAK };

  const pozostalo = chwila.ms - teraz;
  if (pozostalo <= 0) {
    return { stan: 'minal', etykieta: 'Termin minął', pilny: false, minal: true };
  }

  // Dzień terminu w Polsce. Sama data upływa o 24:00, czyli w pierwszej chwili dnia
  // następnego — cofamy o 1 ms, żeby trafić w dzień, który podano.
  const dzienTerminu = dzienPL(chwila.zGodzina ? chwila.ms : chwila.ms - 1);
  const dni = Math.round((dzienTerminu - dzisiajPL(teraz)) / MS_DZIEN);

  if (dni <= 0) {
    // Dziś — liczą się godziny (o ile je znamy).
    return {
      stan: 'dzis',
      etykieta: chwila.zGodzina ? etykietaGodzin(pozostalo) : 'Termin dziś',
      pilny: true,
      minal: false,
    };
  }
  if (dni === 1) return { stan: 'jutro', etykieta: 'Termin jutro', pilny: true, minal: false };

  const etykieta = `${zostalo(dni)} ${dni} dni`;
  if (dni <= 7) return { stan: 'wkrotce', etykieta, pilny: true, minal: false };
  return { stan: 'odlegly', etykieta, pilny: false, minal: false };
}

/**
 * Skąd wzięła się ocena dopasowania. Backend to wie (`scorer`), ale aplikacja
 * dotąd tego nie pokazywała — mechaniczne trafienie w słowo kluczowe wyglądało
 * identycznie jak ocena modelu (audyt 2026-07-10).
 */
export function opisOceny(scorer) {
  return scorer === 'ai'
    ? { etykieta: 'Ocena AI', opis: 'Przetarg przeczytał i ocenił model AI.' }
    : { etykieta: 'Dopasowanie automatyczne', opis: 'Trafienie w słowa kluczowe i kody CPV — bez oceny AI.' };
}
