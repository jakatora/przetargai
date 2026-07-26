/**
 * Prezentacja panelu „RADAR SWZ" — czysta logika bez importów z React Native,
 * więc testowalna zwykłym `node:test` (ulepszenie „Radar pytań i odpowiedzi do
 * SWZ", podzadanie 7/7).
 *
 * Ekran RadarSwz tylko RENDERUJE to, co policzył backend (termin pytań, pytania,
 * timeline zmian, checklista, werdykt bramki). Tu żyją reguły „liczba → słowo":
 * jak nazwać odliczanie do terminu pytań, jak pokolorować linie diffu, jakie
 * etykiety mają statusy pytań / sekcje oferty / poziomy bramki. Trzymamy je przy
 * sobie i pod testem, żeby ekran ich nie wymyślał na nowo (i żeby dark mode/kolory
 * dokładał już tylko sam ekran przez useTheme()).
 */

// ── Odliczanie do terminu pytań ──────────────────────────────────────────────

/** Polska odmiana „dzień/dni" (1 dzień, 2 dni, 5 dni). */
function slowoDni(n) {
  return Math.abs(n) === 1 ? 'dzień' : 'dni';
}

/**
 * Opis odliczania do terminu składania pytań do SWZ na podstawie obiektu
 * `termin_pytania` z backendu (`{ terminPytan, dniPozostalo, minelo }`).
 * Backend liczy datę i pozostałe dni; tu tylko nazywamy stan dla banera.
 *
 * @param {{terminPytan: string|null, dniPozostalo: number|null, minelo: boolean}|null|undefined} t
 * @returns {{stan: 'brak'|'minelo'|'dzis'|'pilne'|'ok', etykieta: string, pilny: boolean}}
 */
export function odliczaniePytan(t) {
  if (!t || !t.terminPytan) {
    return { stan: 'brak', etykieta: 'Termin pytań nieznany — uzupełnij daty postępowania', pilny: false };
  }
  if (t.minelo) {
    return { stan: 'minelo', etykieta: 'Termin na pytania do SWZ minął', pilny: false };
  }
  const dni = Number.isFinite(t.dniPozostalo) ? t.dniPozostalo : null;
  if (dni === null) {
    return { stan: 'ok', etykieta: 'Pytania do SWZ można jeszcze składać', pilny: false };
  }
  if (dni <= 0) {
    return { stan: 'dzis', etykieta: 'Ostatni dzień na pytania do SWZ — składasz jeszcze tylko dziś', pilny: true };
  }
  return {
    stan: dni <= 3 ? 'pilne' : 'ok',
    etykieta: `Na pytania do SWZ zostało ${dni} ${slowoDni(dni)}`,
    pilny: dni <= 3,
  };
}

// ── Pytania ──────────────────────────────────────────────────────────────────

/** Ludzka etykieta statusu pytania (cykl: szkic → wysłane → odpowiedziane). */
export const ETYKIETA_STATUSU_PYTANIA = Object.freeze({
  szkic: 'Szkic',
  wyslane: 'Wysłane',
  odpowiedziane: 'Odpowiedziane',
});

/** Etykieta statusu pytania z fallbackiem na surową wartość. */
export function statusPytaniaEtykieta(status) {
  return ETYKIETA_STATUSU_PYTANIA[status] ?? (status || 'Szkic');
}

// ── Timeline zmian: diff ─────────────────────────────────────────────────────

/**
 * Rozbija tekstowy diff (silnik różnic SWZ) na linie z typem do pokolorowania:
 *   • `+ …`  => 'dodane'   (nowa treść),
 *   • `- …`  => 'usuniete' (stara treść),
 *   • `…`    => 'zwiniete' (odległy, pominięty fragment),
 *   • reszta => 'kontekst'.
 * Wiodący znacznik `+`/`-`/spacja jest ścinany — do wyświetlenia zostaje sama treść.
 *
 * @param {string|null|undefined} diff
 * @returns {Array<{typ: 'dodane'|'usuniete'|'kontekst'|'zwiniete', tekst: string}>}
 */
export function parsujDiff(diff) {
  if (!diff || !String(diff).trim()) return [];
  return String(diff).split('\n').map((linia) => {
    if (linia === '…' || linia === '...') return { typ: 'zwiniete', tekst: '…' };
    const znak = linia[0];
    if (znak === '+') return { typ: 'dodane', tekst: linia.slice(1) };
    if (znak === '-') return { typ: 'usuniete', tekst: linia.slice(1) };
    if (znak === ' ') return { typ: 'kontekst', tekst: linia.slice(1) };
    return { typ: 'kontekst', tekst: linia };
  });
}

// ── Sekcje oferty i bramka ───────────────────────────────────────────────────

/** Ludzkie nazwy kanonicznych sekcji oferty (mapowanie zmian SWZ). */
export const ETYKIETA_SEKCJI = Object.freeze({
  harmonogram: 'Harmonogram',
  cena: 'Cena',
  parametry: 'Parametry',
});

/** Etykieta sekcji oferty z fallbackiem (pierwsza litera wielka). */
export function etykietaSekcji(sekcja) {
  if (ETYKIETA_SEKCJI[sekcja]) return ETYKIETA_SEKCJI[sekcja];
  const s = String(sekcja ?? '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Nagłówek banera bramki wg jej poziomu. */
export const ETYKIETA_POZIOMU_BRAMKI = Object.freeze({
  ok: 'Gotowe do wysłania',
  blokada: 'Wysyłka zablokowana',
  ostrzezenie: 'Wysłano mimo nieuwzględnionych zmian',
});

/** Etykieta poziomu bramki z fallbackiem. */
export function etykietaPoziomuBramki(poziom) {
  return ETYKIETA_POZIOMU_BRAMKI[poziom] ?? 'Stan wysyłki';
}
