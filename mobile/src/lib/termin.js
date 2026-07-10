/**
 * Opis terminu składania ofert — najważniejsza informacja na karcie przetargu.
 *
 * Audyt 2026-07-10: dopasowanie raz utworzone zostawało w feedzie na zawsze, bez
 * żadnego oznaczenia. Użytkownik widział ofertę, na którą nie mógł już złożyć
 * wniosku, i nie miał jak tego odróżnić od aktualnej. Pilne przetargi (jutro!)
 * wyglądały tak samo jak te sprzed miesiąca.
 */

const DZIEN_MS = 86_400_000;

/**
 * @param {string|null|undefined} deadline znacznik ISO (UTC)
 * @param {number} [teraz] czas odniesienia w ms — do testów
 * @returns {{stan: 'brak'|'minal'|'dzis'|'jutro'|'wkrotce'|'odlegly', etykieta: string, pilny: boolean, minal: boolean}}
 */
export function opisTerminu(deadline, teraz = Date.now()) {
  if (!deadline) {
    return { stan: 'brak', etykieta: 'Termin nieznany', pilny: false, minal: false };
  }

  const czas = new Date(deadline).getTime();
  if (Number.isNaN(czas)) {
    return { stan: 'brak', etykieta: 'Termin nieznany', pilny: false, minal: false };
  }

  const pozostalo = czas - teraz;
  if (pozostalo <= 0) {
    return { stan: 'minal', etykieta: 'Termin minął', pilny: false, minal: true };
  }

  const dni = Math.ceil(pozostalo / DZIEN_MS);
  if (dni <= 1) {
    // Mniej niż doba — liczymy godziny, bo różnica między „dziś" a „jutro" decyduje.
    const godziny = Math.max(1, Math.ceil(pozostalo / 3_600_000));
    return {
      stan: 'dzis',
      etykieta: godziny === 1 ? 'Zostala godzina' : `Zostało ${godziny} godz.`,
      pilny: true,
      minal: false,
    };
  }
  if (dni === 2) return { stan: 'jutro', etykieta: 'Zostały 2 dni', pilny: true, minal: false };
  if (dni <= 7) return { stan: 'wkrotce', etykieta: `Zostało ${dni} dni`, pilny: true, minal: false };

  return { stan: 'odlegly', etykieta: `Zostało ${dni} dni`, pilny: false, minal: false };
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
