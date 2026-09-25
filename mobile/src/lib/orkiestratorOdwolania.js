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
import { oblicz_termin_kio, pozostaly_czas_do, formatujDate, trybKio, TRYBY_KIO } from './terminKio.js';
import { dzisiajPL, naDzienUTC } from './dataUtc.js';

const MS_DZIEN = 24 * 60 * 60 * 1000;

/**
 * Domyślny próg przypomnienia: powiadamiamy, gdy do UPŁYWU terminu zostały nie
 * więcej niż tyle dni. Świadomie krótko (2 dni) — terminy KIO są krótkie (5–15
 * dni), a przypomnienie ma trafić tuż przed decyzją „walcz / odpuść", nie na
 * samym początku, gdy jest jeszcze dużo czasu.
 */
export const DOMYSLNY_PROG_PRZYPOMNIENIA_DNI = 2;

/** `YYYY-MM-DD…` → polski zapis `DD.MM.RRRR` (bez przesuwania dnia przez strefę). */
function formatujDatePL(iso) {
  const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Niepusty, przycięty string albo null. */
function tekstAlboNull(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Data (ISO lub DD.MM.RRRR) → krótki polski zapis `DD.MM` albo null. */
function formatujDzienMiesiac(data) {
  const ms = naDzienUTC(data);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Skąd wzięła się data, od której liczono termin KIO (pole `zrodlo` podstawy). */
export const ZRODLA_DATY_KIO = Object.freeze({
  postepowanie: 'dzień przekazania informacji o wyniku', // data z danych postępowania
  podana: 'dzień przekazania informacji o wyniku', // użytkownik podał, kiedy dostał informację
  dzien_oznaczenia: 'dzień oznaczenia wyniku', // brak daty — liczone od dnia oznaczenia przegranej
});

const OSTRZEZENIE_WCZESNIEJSZA_INFORMACJA =
  'Jeśli informację o wyniku otrzymałeś wcześniej — termin biegnie od tamtego dnia i może już być krótszy.';

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
 *     `opcje.dataOtrzymaniaInformacji` (albo starsza nazwa `opcje.dataOgloszeniaWyniku`)
 *     → DZIŚ (w Polsce). „Dziś" to tylko proxy — użytkownik mógł dostać informację
 *     wcześniej, a wtedy termin jest krótszy.
 *  3. Razem z terminem utrwala PODSTAWĘ (`podstawaTerminuKio`): od jakiego dnia
 *     liczono, ile dni, jaki tryb faktycznie przyjęto i skąd była data. Poprawka
 *     2026-09-25: wcześniej termin liczył się PO CICHU od „dziś" w trybie 5-dniowym
 *     i ekran nie miał jak tego pokazać ({@link opisPodstawyTerminuKio}).
 *
 * NIE nadpisuje istniejącego terminu (idempotentnie, jak reszta ścieżki) — dzięki
 * temu bezpiecznie domyka też kontrole założone starszą wersją kodu (bez terminu).
 * Best-effort: brak id postępowania → `null` (hook nie może wywrócić UI); błąd
 * samego wyliczenia terminu nie kasuje już założonej kontroli — zwracamy ją.
 * Nieczytelna PODANA data → brak terminu (nie liczymy po cichu od „dziś").
 *
 * @param {object} magazyn magazyn z `getItem`/`setItem` (np. `../lib/storage`)
 * @param {object} postepowanie tender/postępowanie (jak w utworzKontrolePoPrzegranej)
 * @param {{ teraz?: number, dataOtrzymaniaInformacji?: string, dataOgloszeniaWyniku?: string,
 *   tryb?: 'unijny'|'unijny_pisemny'|'krajowy'|'krajowy_pisemny' }} [opcje]
 *   `dataOtrzymaniaInformacji` — dzień, w którym przekazano informację o wyniku
 *   (`YYYY-MM-DD` lub `DD.MM.RRRR`); `tryb` domyślnie {@link ./terminKio.TRYB_KIO_DOMYSLNY}.
 * @returns {Promise<import('./poprzetargowaKontrola.js').PoprzetargowaKontrola|null>}
 */
export async function uruchomSciezkeOdwolania(magazyn, postepowanie, opcje = {}) {
  const kontrola = await utworzKontrolePoPrzegranej(magazyn, postepowanie);
  if (!kontrola) return null;

  // Termin wyliczamy tylko raz — istniejącego nie ruszamy (idempotentnie).
  if (!kontrola.terminOdwolaniaKio) {
    const teraz = typeof opcje.teraz === 'number' ? opcje.teraz : Date.now();
    const podana =
      tekstAlboNull(opcje.dataOtrzymaniaInformacji) ?? tekstAlboNull(opcje.dataOgloszeniaWyniku);
    let dataOgloszenia;
    let zrodlo;
    if (kontrola.dataOgloszeniaWyniku) {
      dataOgloszenia = kontrola.dataOgloszeniaWyniku;
      zrodlo = 'postepowanie';
    } else if (podana) {
      dataOgloszenia = podana;
      zrodlo = 'podana';
    } else {
      // „Dziś" = dzień kalendarzowy w POLSCE (poprawka 2026-09-25) — wg UTC między 00:00 a
      // 01:00/02:00 czasu polskiego byłby to jeszcze wczoraj i termin KIO wyszedłby o dzień za wcześnie.
      dataOgloszenia = formatujDate(dzisiajPL(teraz));
      zrodlo = 'dzien_oznaczenia';
    }

    const dzienMs = naDzienUTC(dataOgloszenia);
    const termin = oblicz_termin_kio(dataOgloszenia, opcje.tryb);
    if (termin && dzienMs !== null) {
      const tryb = trybKio(opcje.tryb); // tryb, którym FAKTYCZNIE liczono (nieznany → domyślny)
      const liczoneOd = formatujDate(dzienMs);
      kontrola.terminOdwolaniaKio = termin;
      // Zapisujemy też, z jakiej daty policzyliśmy termin (jeśli jej nie było) — jako ISO.
      if (!kontrola.dataOgloszeniaWyniku) kontrola.dataOgloszeniaWyniku = liczoneOd;
      kontrola.podstawaTerminuKio = { liczoneOd, dni: tryb.dni, tryb: tryb.wartosc, zrodlo };
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

  // Koniec dnia granicznego = 24:00 czasu polskiego (z pozostaly_czas_do, poprawka 2026-09-25).
  const uplywMs = teraz + czas.pozostaloMs;
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

/**
 * Czytelny opis PODSTAWY terminu KIO pod licznikiem na ekranie wyniku (2026-09-25):
 * od jakiego dnia liczono, ile dni i w jakim trybie — plus ostrzeżenie, gdy liczono od
 * dnia oznaczenia wyniku (użytkownik mógł dostać informację wcześniej, a termin biegnie
 * od dnia jej przekazania — art. 515 ust. 1 Pzp — więc może być już krótszy).
 *
 * Rekord sprzed tej poprawki nie ma `podstawaTerminuKio` — pokazujemy wtedy samą datę,
 * od której liczono, z ostrzeżeniem (nie wiemy, czy to nie był tylko „dziś").
 *
 * @param {{ terminOdwolaniaKio?: string|null, dataOgloszeniaWyniku?: string|null,
 *   podstawaTerminuKio?: {liczoneOd: string, dni: number, tryb: string, zrodlo: string|null}|null }|null} kontrola
 * @returns {{ tekst: string, tryb: string|null, ostrzezenie: string|null }|null}
 *   null, gdy nie ma terminu albo nie wiadomo, od czego go liczono
 */
export function opisPodstawyTerminuKio(kontrola) {
  if (!kontrola || typeof kontrola !== 'object' || !kontrola.terminOdwolaniaKio) return null;

  const p = kontrola.podstawaTerminuKio;
  const od = p && typeof p === 'object' ? formatujDzienMiesiac(p.liczoneOd) : null;
  if (od && Number.isInteger(p.dni)) {
    const zrodlo = ZRODLA_DATY_KIO[p.zrodlo] ?? null;
    // Ostrzegamy zawsze, gdy data NIE pochodzi z postępowania ani od użytkownika.
    const znanaData = p.zrodlo === 'postepowanie' || p.zrodlo === 'podana';
    return {
      tekst: `Liczone od ${od}${zrodlo ? ` (${zrodlo})` : ''}, ${p.dni} dni.`,
      tryb: TRYBY_KIO.find((t) => t.wartosc === p.tryb)?.etykieta ?? null,
      ostrzezenie: znanaData ? null : OSTRZEZENIE_WCZESNIEJSZA_INFORMACJA,
    };
  }

  const odStare = formatujDzienMiesiac(kontrola.dataOgloszeniaWyniku);
  if (!odStare) return null;
  return { tekst: `Liczone od ${odStare}.`, tryb: null, ostrzezenie: OSTRZEZENIE_WCZESNIEJSZA_INFORMACJA };
}
