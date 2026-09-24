import { features } from '../config.js';
import { cykl, oknoBzp, oknoBk } from '../db/repos.js';
import { nowIso } from '../lib/ids.js';
import { zbudujZakresDanych, znacznikiSynchronizacji } from '../lib/zakresDanych.js';
import { logger } from '../lib/logger.js';

/*
 * Stan źródeł danych dla API (P1-4).
 *
 * Każda karta ogłoszenia pokazuje, kiedy jego rejestr ostatnio się zsynchronizował.
 * Bez cache oznaczałoby to trzy odczyty Firestore (`_health/cykl` + dwa checkpointy
 * okien) na KAŻDE przewinięcie listy — czyli koszt proporcjonalny do przewijania,
 * a nie do zmian. Znaczniki zmieniają się co godziny, więc minuta cache jest
 * bezpieczna i o rząd wielkości tańsza.
 *
 * Awaria odczytu NIE może wywrócić listy przetargów: bez stanu źródeł karta
 * po prostu nie pokaże czasu synchronizacji. Lista jest ważniejsza.
 */

const CACHE_MS = 60_000;

let cache = null;

/** Wymusza ponowny odczyt (testy i sytuacje, gdy świeżość ma znaczenie). */
export function wyczyscCacheZakresu() {
  cache = null;
}

export async function pobierzZakresDanych({ swiezy = false } = {}) {
  if (!swiezy && cache && Date.now() < cache.wygasa) return cache.zakres;

  let slad = null;
  let stanBzp = null;
  let stanBk = null;
  try {
    [slad, stanBzp, stanBk] = await Promise.all([
      cykl.ostatniPrzebieg(), oknoBzp.wczytaj(), oknoBk.wczytaj(),
    ]);
  } catch (err) {
    logger.warn({ err: err.message }, 'zakres danych: nie udało się odczytać śladów źródeł');
  }

  const zakres = zbudujZakresDanych({
    teraz: nowIso(),
    wlaczone: { bzp: true, ted: features.ted, baza_konkurencyjnosci: features.bk },
    zrodlaCyklu: slad?.zrodla ?? {},
    oknoBzp: stanBzp?.ostatni_przebieg ?? null,
    oknoBk: stanBk?.ostatni_przebieg ?? null,
  });

  cache = { zakres, wygasa: Date.now() + CACHE_MS };
  return zakres;
}

/** Skrót „kod źródła → stan i czas ostatniej synchronizacji" do kart ogłoszeń. */
export async function pobierzZnacznikiZrodel() {
  return znacznikiSynchronizacji(await pobierzZakresDanych());
}
