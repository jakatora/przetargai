/**
 * Orkiestrator ścieżki odwołania — podzadanie 13/13 ulepszenia „Prześwietlenie
 * oferty zwycięzcy i szansa na odwołanie".
 *
 * Spina istniejące klocki (podzadania 1–12) w JEDEN przepływ uruchamiany po
 * wykryciu przegranej:
 *   przegrana → założenie kontroli (2/13) → WYLICZENIE terminu KIO (3/13)
 *             → (dalej ekrany: wniosek → upload → analiza → decyzja)
 * plus czysta decyzja o powiadomieniu użytkownika o zbliżającym się terminie KIO
 * (samo zaplanowanie powiadomienia robi cienki adapter
 * {@link ../services/powiadomieniaKio}).
 *
 * DLACZEGO tu: `utworzKontrolePoPrzegranej` celowo NIE liczyło terminu KIO (to
 * było „na kolejne podzadanie"), więc `terminOdwolaniaKio` zostawał `null` i
 * countdown na ekranie wyniku nie miał z czego liczyć. Orkiestrator domyka tę
 * lukę: po przegranej od razu wylicza termin i utrwala go w rekordzie kontroli.
 *
 * Magazyn wstrzykujemy parametrem (jak w {@link ./poprzetargowaKontrola}), a
 * `teraz` da się podać w opcjach — dzięki temu całość jest testowalna w
 * node:test bez react-native.
 */

import {
  utworzKontrolePoPrzegranej,
  zapiszKontrole,
} from './poprzetargowaKontrola.js';
import { oblicz_termin_kio, pozostaly_czas_do } from './terminKio.js';

const MS_DZIEN = 24 * 60 * 60 * 1000;

/**
 * Domyślny próg przypomnienia: powiadamiamy, gdy do UPŁYWU terminu zostały nie
 * więcej niż tyle dni. Świadomie krótko (2 dni) — terminy KIO są krótkie (5–15
 * dni), a przypomnienie ma trafić tuż przed decyzją „walcz / odpuść", nie na
 * samym początku, gdy jest jeszcze dużo czasu.
 */
export const DOMYSLNY_PROG_PRZYPOMNIENIA_DNI = 2;

/** Znacznik ms → dzień kalendarzowy UTC jako `YYYY-MM-DD` (spójnie z terminKio). */
function isoDzienUTC(ms) {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** `YYYY-MM-DD…` → polski zapis `DD.MM.RRRR` (bez przesuwania dnia przez strefę). */
function formatujDatePL(iso) {
  const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Niepusty, przycięty string albo null. */
function tekstAlboNull(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Uruchamia ścieżkę odwołania po wykryciu przegranej. Woła się z miejsca, w
 * którym etap postępowania zmienia się na „przegrana" (zamiast bezpośredniego
 * {@link ./poprzetargowaKontrola.utworzKontrolePoPrzegranej}).
 *
 * Kroki:
 *  1. Zakłada (idempotentnie) poprzetargową kontrolę oferty zwycięzcy.
 *  2. Jeśli kontrola nie ma jeszcze `terminOdwolaniaKio` — WYLICZA go
 *     {@link ./terminKio.oblicz_termin_kio} i utrwala. Dzień przekazania
 *     informacji o wyniku bierzemy w kolejności: realna data z postępowania →
 *     `opcje.dataOgloszeniaWyniku` → DZIŚ. „Dziś" to bezpieczny proxy, bo
 *     użytkownik oznacza przegraną wtedy, gdy dowiedział się o wyniku.
 *
 * NIE nadpisuje istniejącego terminu (idempotentnie, jak reszta ścieżki) — dzięki
 * temu bezpiecznie domyka też kontrole założone starszą wersją kodu (bez terminu).
 * Best-effort: brak id postępowania → `null` (hook nie może wywrócić UI); błąd
 * samego wyliczenia terminu nie kasuje już założonej kontroli — zwracamy ją.
 *
 * @param {object} magazyn magazyn z `getItem`/`setItem` (np. `../lib/storage`)
 * @param {object} postepowanie tender/postępowanie (jak w utworzKontrolePoPrzegranej)
 * @param {{ teraz?: number, dataOgloszeniaWyniku?: string,
 *   tryb?: 'unijny'|'unijny_pisemny'|'krajowy'|'krajowy_pisemny' }} [opcje]
 * @returns {Promise<import('./poprzetargowaKontrola.js').PoprzetargowaKontrola|null>}
 */
export async function uruchomSciezkeOdwolania(magazyn, postepowanie, opcje = {}) {
  const kontrola = await utworzKontrolePoPrzegranej(magazyn, postepowanie);
  if (!kontrola) return null;

  // Termin wyliczamy tylko raz — istniejącego nie ruszamy (idempotentnie).
  if (!kontrola.terminOdwolaniaKio) {
    const teraz = typeof opcje.teraz === 'number' ? opcje.teraz : Date.now();
    const dataOgloszenia =
      kontrola.dataOgloszeniaWyniku ??
      tekstAlboNull(opcje.dataOgloszeniaWyniku) ??
      isoDzienUTC(teraz);

    const termin = oblicz_termin_kio(dataOgloszenia, opcje.tryb);
    if (termin) {
      kontrola.terminOdwolaniaKio = termin;
      // Zapisujemy też, z jakiej daty policzyliśmy termin (jeśli jej nie było).
      if (!kontrola.dataOgloszeniaWyniku) kontrola.dataOgloszeniaWyniku = dataOgloszenia;
      await zapiszKontrole(magazyn, kontrola);
    }
  }

  return kontrola;
}

/**
 * Czysta DECYZJA o powiadomieniu użytkownika o zbliżającym się terminie KIO —
 * treść i moment odpalenia. Samo zaplanowanie lokalnego powiadomienia (expo)
 * robi {@link ../services/powiadomieniaKio.zaplanujPowiadomienieOTerminieKio};
 * tutaj tylko logika (żeby dała się przetestować bez react-native).
 *
 * Zwraca `null`, gdy nie ma o czym przypominać: brak/niepoprawny termin albo
 * termin już minął (spóźnionego odwołania KIO i tak nie przyjmie). W przeciwnym
 * razie liczy moment odpalenia: `progDniPrzypomnienia` dni przed UPŁYWEM terminu,
 * a gdy do upływu jest już mniej — odpala natychmiast (`uruchomOMs = teraz`).
 *
 * @param {{ terminOdwolaniaKio?: string|null }|null} kontrola rekord kontroli
 * @param {{ teraz?: number, progDniPrzypomnienia?: number }} [opcje]
 * @returns {{ uruchomOMs: number, tytul: string, tresc: string, terminPL: string|null,
 *   dni: number, pozostaloMs: number }|null}
 */
export function powiadomienieOTerminieKio(kontrola, opcje = {}) {
  const teraz = typeof opcje.teraz === 'number' ? opcje.teraz : Date.now();
  const termin = kontrola && typeof kontrola === 'object' ? kontrola.terminOdwolaniaKio : null;

  const czas = pozostaly_czas_do(termin, teraz);
  if (!czas || czas.poTerminie) return null;

  const progDni =
    typeof opcje.progDniPrzypomnienia === 'number' && opcje.progDniPrzypomnienia >= 0
      ? opcje.progDniPrzypomnienia
      : DOMYSLNY_PROG_PRZYPOMNIENIA_DNI;

  const uplywMs = teraz + czas.pozostaloMs; // koniec dnia granicznego (z pozostaly_czas_do)
  const uruchomOMs = Math.max(teraz, uplywMs - progDni * MS_DZIEN);
  const terminPL = formatujDatePL(termin);

  return {
    uruchomOMs,
    tytul: 'Termin odwołania do KIO',
    tresc:
      `Ostatni dzień na odwołanie do KIO: ${terminPL}. ` +
      'Zdecyduj, czy walczyć, czy odpuścić — po terminie KIO odrzuci odwołanie.',
    terminPL,
    dni: czas.dni,
    pozostaloMs: czas.pozostaloMs,
  };
}
