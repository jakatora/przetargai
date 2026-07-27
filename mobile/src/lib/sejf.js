/**
 * Prezentacja „SEJFU DOKUMENTÓW FIRMY" — czysta logika bez importów z React Native,
 * więc testowalna zwykłym `node:test` (ulepszenie „Sejf podmiotowych środków
 * dowodowych z licznikiem świeżości", podzadanie 7/7).
 *
 * Ekran `SejfScreen` i sekcja dopasowania sejf↔SWZ w `RadarSwzScreen` tylko RENDERUJĄ
 * to, co policzył backend (świeżość liczy `waznoscDokumentow.js`, a listę wzbogaca
 * `sejfDokumentow.opiszDokument`). Tu żyją reguły „status/licznik → słowo" oraz
 * kolejność listy dokumentów. Trzymamy je pod testem, żeby ekran ich nie wymyślał na
 * nowo, a kolor dokłada już tylko sam ekran przez useTheme() — tu jest jedynie
 * SEMANTYCZNY `ton` (paleta zależy od jasny/ciemny i żyje w motyw.js).
 *
 * Kontrakt z backendem: status ∈ {'gotowy','zamow_nowy','przeterminowany'} albo null
 * dla dokumentu terminowego BEZ daty wystawienia. `dniDoWaznosci` to liczba dni zapasu
 * (ujemna = po terminie) albo null (bezterminowy oraz terminowy-bez-daty — rozróżnia je
 * status: bezterminowy jest 'gotowy', terminowy-bez-daty ma status null).
 */

// ── Status → etykieta + semantyczny ton koloru ────────────────────────────────

/**
 * Etykiety i „ton" statusów. `ton` to KLASA koloru (nie hex): ekran mapuje ją na
 * tokeny motyw.js — 'sukces'→sukcesAkcent/sukcesTlo, 'ostrzezenie'→ostrzezenieAkcent,
 * 'danger'→danger/dangerTlo, 'neutral'→textMuted/neutralneTlo. Dzięki temu paleta
 * (jasny/ciemny, kontrast AA) zostaje w jednym miejscu, a lib jest bez kolorów.
 */
export const STATUSY = Object.freeze({
  przeterminowany: { etykieta: 'Przeterminowany', ton: 'danger' },
  zamow_nowy: { etykieta: 'Zamów nowy', ton: 'ostrzezenie' },
  gotowy: { etykieta: 'Gotowy do użycia', ton: 'sukces' },
  // Dokument terminowy bez daty wystawienia (status null z backendu) — trzeba uzupełnić.
  nieznany: { etykieta: 'Uzupełnij datę', ton: 'neutral' },
});

/**
 * Opis statusu do badge'a. Nieznany/null → koszyk „uzupełnij datę" (neutralny),
 * żeby dokument bez daty nie udawał „gotowego".
 * @param {string|null|undefined} status
 * @returns {{etykieta: string, ton: string}}
 */
export function opisStatusu(status) {
  return STATUSY[status] ?? STATUSY.nieznany;
}

// ── Formatowanie licznika dni ────────────────────────────────────────────────

/** Odmiana „dzień/dni": w polskim dni to zawsze „dni" poza dokładnie jednym. */
function odmianaDni(n) {
  return n === 1 ? 'dzień' : 'dni';
}

/**
 * Ludzki opis licznika ważności dokumentu.
 *  • bezterminowy (gotowy, brak licznika)       → „Bezterminowy",
 *  • terminowy bez daty wystawienia (status null)→ „Uzupełnij datę wystawienia",
 *  • ostatni dzień ważności (0)                  → „Traci ważność dziś",
 *  • zapas (>0)                                  → „Ważny jeszcze N dni",
 *  • po terminie (<0)                            → „Przeterminowany N dni temu".
 * @param {{status: string|null, dniDoWaznosci: number|null}} dok wzbogacony dokument
 * @returns {string}
 */
export function etykietaLicznika({ status, dniDoWaznosci } = {}) {
  if (dniDoWaznosci === null || dniDoWaznosci === undefined || !Number.isFinite(dniDoWaznosci)) {
    // Brak licznika: bezterminowy jest gotowy, terminowy-bez-daty ma status null.
    return status === 'gotowy' ? 'Bezterminowy' : 'Uzupełnij datę wystawienia';
  }
  const n = Math.trunc(dniDoWaznosci);
  if (n === 0) return 'Traci ważność dziś';
  if (n > 0) return `Ważny jeszcze ${n} ${odmianaDni(n)}`;
  const dni = Math.abs(n);
  return `Przeterminowany ${dni} ${odmianaDni(dni)} temu`;
}

// ── Kolejność listy dokumentów w sejfie ───────────────────────────────────────

/*
 * Priorytet grup: najpierw to, co wymaga reakcji użytkownika. Przeterminowane
 * (bezużyteczne w przetargu) na samą górę, potem „zamów nowy" (jeszcze zdążysz),
 * potem dokumenty bez daty (do uzupełnienia), a gotowe — na dół. null (status
 * nieznany) traktujemy jak priorytet 2 (do uzupełnienia).
 */
const PRIORYTET = { przeterminowany: 0, zamow_nowy: 1, gotowy: 3 };
function priorytet(status) {
  return PRIORYTET[status] ?? 2; // null / nieznany → tuż przed gotowymi
}

/** Klucz sortowania w obrębie grupy: mniej dni = pilniejsze; brak licznika na koniec. */
function kluczDni(dniDoWaznosci) {
  return Number.isFinite(dniDoWaznosci) ? dniDoWaznosci : Number.MAX_SAFE_INTEGER;
}

/**
 * Szereguje dokumenty sejfu do listy:
 *   1. wg statusu: przeterminowane → zamów nowy → (bez daty) → gotowe,
 *   2. w obrębie grupy — najmniej dni do ważności najpierw (bezterminowy na koniec),
 *   3. przy remisie — stabilnie po typie dokumentu.
 * Zwraca NOWĄ tablicę (bez mutacji wejścia).
 * @param {Array} lista wzbogacone dokumenty sejfu (repo `lista` → panel)
 * @returns {Array}
 */
export function sortujDokumenty(lista) {
  if (!Array.isArray(lista)) return [];
  return [...lista].sort((a, b) => {
    const pa = priorytet(a.status);
    const pb = priorytet(b.status);
    if (pa !== pb) return pa - pb;
    const da = kluczDni(a.dniDoWaznosci);
    const db = kluczDni(b.dniDoWaznosci);
    if (da !== db) return da - db;
    return String(a.typ_dokumentu ?? '').localeCompare(String(b.typ_dokumentu ?? ''));
  });
}
