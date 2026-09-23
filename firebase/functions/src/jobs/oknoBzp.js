import { logger } from '../lib/logger.js';
import { env } from '../config.js';
import { pobierzOgloszeniaBzp, dniWZakresie } from '../services/bzp.js';
import { oknoBzp as repoOkna, tenders } from '../db/repos.js';
import { pustyLicznik } from '../lib/licznikZrodla.js';

/*
 * OKNO POBIERANIA BZP z checkpointem (P0-2).
 *
 * Problem, który to rozwiązuje: okno `BZP_LOOKBACK_DAYS` (7 dni) to w najgorszym
 * razie 7 × 17 = 119 zapytań, a `dailyTenderFetch` ma twardy limit 540 s na CAŁY
 * cykl (pobieranie + dopasowania). Bez pamięci między przebiegami każdy przebieg
 * zaczynał od najstarszej doby i — gdy zabrakło czasu albo BZP zdławiło ruch —
 * ginął zawsze na tych samych dniach. Audyt 2026-09-23 zmierzył efekt: 1 330
 * ogłoszeń w oknie, w którym BZP opublikowało ~5 030.
 *
 * Z checkpointem przebieg pyta WYŁĄCZNIE o doby, których jeszcze nie domknął,
 * zaczynając od najświeższych. Okno domyka się w kilku przebiegach zamiast nigdy,
 * a `/health` widzi, ile dób zostało.
 *
 * Idempotencja: `tenders.upsert` ma docId = identyfikator zewnętrzny ogłoszenia,
 * więc ponowne pobranie tej samej doby niczego nie duplikuje — wznawianie jest
 * bezpieczne z konstrukcji.
 */

/**
 * Czy dobę wolno zamknąć jako kompletną.
 *
 * „Dzisiaj" NIGDY nie jest kompletne: BZP publikuje przez cały dzień, więc
 * zamknięcie dzisiejszej doby zamroziłoby feed do jutra. Doba z błędem albo
 * z brakującym województwem też zostaje otwarta — liczby mogą wyglądać ładnie,
 * a i tak brakuje w niej kawałka rynku.
 */
function dobaKompletna(wpis, dzien, dzisiaj) {
  if (dzien >= dzisiaj) return false;
  if (wpis.blad) return false;
  return (wpis.wojewodztwaBezDanych ?? 0) === 0;
}

/**
 * Które doby pobrać w tym przebiegu i w jakiej kolejności.
 *
 * Kolejność: od najświeższej. Gdy zabraknie budżetu, tracimy najstarsze doby —
 * te, o które użytkownik i tak pyta najrzadziej (termin składania już blisko).
 *
 * @param {{dni: string[], checkpoint: object|null, dzisiaj: string}} opts
 * @returns {string[]} doby `YYYY-MM-DD`, malejąco
 */
export function wybierzDni({ dni, checkpoint, dzisiaj }) {
  const stan = checkpoint?.dni ?? {};
  return [...dni]
    .sort((a, b) => (a < b ? 1 : -1))
    .filter((dzien) => dzien >= dzisiaj || !stan[dzien]?.kompletny);
}

/**
 * Nowy stan checkpointu po przebiegu.
 *
 * @param {{checkpoint: object|null, raport: object[], pominieteDni?: string[],
 *   dni: string[], dzisiaj: string, teraz: string}} opts
 *   `raport` — wpisy z `licznik.dni` (jeden na przetworzoną dobę).
 *   `pominieteDni` — doby, których budżet nie objął; zostają otwarte.
 */
export function zaktualizujCheckpoint({ checkpoint, raport = [], pominieteDni = [], dni, dzisiaj, teraz }) {
  const wOknie = new Set(dni);
  const stan = {};

  // Przenosimy wyłącznie doby, które nadal są w oknie — inaczej dokument rósłby
  // bez końca i z czasem przekroczył limit 1 MiB.
  for (const [dzien, wpis] of Object.entries(checkpoint?.dni ?? {})) {
    if (wOknie.has(dzien)) stan[dzien] = wpis;
  }

  for (const wpis of raport) {
    stan[wpis.dzien] = {
      pobrano: wpis.pobrano ?? 0,
      ucietySufit: wpis.ucietySufit ?? false,
      zapytania: wpis.zapytania ?? 0,
      wojewodztwaBezDanych: wpis.wojewodztwaBezDanych ?? 0,
      blad: wpis.blad ?? null,
      kompletny: dobaKompletna(wpis, wpis.dzien, dzisiaj),
      zaktualizowano_o: teraz,
    };
  }

  // Doby poza budżetem zostają dokładnie tam, gdzie były: nie dopisujemy im
  // nieprawdziwego „kompletny", żeby następny przebieg po nie wrócił.
  for (const dzien of pominieteDni) {
    if (!stan[dzien]) stan[dzien] = { kompletny: false, pobrano: 0, blad: null, zaktualizowano_o: teraz };
  }

  return { dni: stan };
}

/** Ile dób okna wciąż czeka na domknięcie (do śladu cyklu i `/health`). */
export function dobyNiedomkniete({ dni, checkpoint, dzisiaj }) {
  return wybierzDni({ dni, checkpoint, dzisiaj }).filter((d) => d < dzisiaj).length;
}

/**
 * Pobranie BZP z wznawianiem — wejście dla rejestru źródeł w `fetchTenders`.
 *
 * @param {object} licznik akumulator pomiarów (lib/licznikZrodla.js)
 * @param {{budzetMs?: number, teraz?: () => number}} opts
 */
export async function pobierzBzpZWznowieniem(licznik, { budzetMs = Infinity, teraz = () => Date.now() } = {}) {
  const dzisiaj = new Date(teraz()).toISOString().slice(0, 10);
  const odDnia = new Date(teraz() - env.BZP_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const dniOkna = dniWZakresie(odDnia, dzisiaj);

  const checkpoint = await repoOkna.wczytaj().catch((err) => {
    // Brak checkpointu nie może zablokować pobierania — w najgorszym razie
    // przebieg zrobi to, co robił dotąd: całe okno od nowa.
    logger.error({ err: err.message }, 'BZP: nie udało się wczytać checkpointu okna');
    return null;
  });

  const dni = wybierzDni({ dni: dniOkna, checkpoint, dzisiaj });
  logger.info({ dniOkna: dniOkna.length, doPobrania: dni.length, budzetMs },
    'BZP: wybrane doby do pobrania (wznawianie po checkpoincie)');

  const ogloszenia = await pobierzOgloszeniaBzp({ dni, licznik, budzetMs });

  const nowyStan = zaktualizujCheckpoint({
    checkpoint,
    raport: licznik?.dni ?? [],
    pominieteDni: licznik?.pominieteDni ?? [],
    dni: dniOkna,
    dzisiaj,
    teraz: new Date(teraz()).toISOString(),
  });

  if (licznik) {
    licznik.dobyOkna = dniOkna.length;
    licznik.dobyNiedomkniete = dobyNiedomkniete({ dni: dniOkna, checkpoint: nowyStan, dzisiaj });
  }

  await repoOkna.zapisz(nowyStan).catch((err) =>
    logger.error({ err: err.message }, 'BZP: nie udało się zapisać checkpointu okna'));

  return ogloszenia;
}

/**
 * Ile czasu wolno zużyć na JEDEN przebieg domykania okna.
 *
 * Pomiar 2026-09-24 na żywym API: całe okno 7 dni = 87 zapytań i 389 s (BZP bywa
 * wolne nocą). To się NIE mieści w 540 s `dailyTenderFetch`, który musi jeszcze
 * policzyć dopasowania — i właśnie dlatego okno nigdy się nie domykało. Osobna
 * funkcja `bzpOknoFetch` ma własny, dłuższy limit i biegnie częściej niż raz
 * na dobę, więc checkpoint domyka okno w kilku podejściach.
 */
export const BUDZET_OKNA_MS = 1_200_000;

/**
 * Domyka okno BZP: pobiera brakujące doby i zapisuje ogłoszenia.
 *
 * Świadomie NIE liczy dopasowań i NIE woła AI — to zadanie `dailyTenderFetch`.
 * Tu chodzi wyłącznie o kompletność danych źródłowych.
 */
export async function runBzpOkno({ budzetMs = BUDZET_OKNA_MS } = {}) {
  const start = Date.now();
  const licznik = pustyLicznik();
  let ogloszenia = [];
  let blad = null;

  try {
    ogloszenia = await pobierzBzpZWznowieniem(licznik, { budzetMs });
  } catch (err) {
    blad = err.message;
    logger.error({ err: err.message }, 'bzpOkno: pobieranie okna nie powiodło się');
  }

  let nowe = 0;
  let pominiete = 0;
  for (const ogloszenie of ogloszenia) {
    try {
      const { created } = await tenders.upsert(ogloszenie);
      if (created) nowe += 1;
    } catch (err) {
      pominiete += 1;
      logger.error({ err: err.message, externalId: ogloszenie?.externalId },
        'bzpOkno: pominięto ogłoszenie, którego nie dało się zapisać');
    }
  }
  if (nowe > 0) tenders.odswiezPule();

  const wynik = {
    ok: blad === null,
    error: blad,
    fetched: ogloszenia.length,
    newTenders: nowe,
    skipped: pominiete,
    surowe: licznik.surowe,
    odrzucone: licznik.odrzucone,
    zapytania: licznik.zapytania,
    doby_okna: licznik.dobyOkna ?? null,
    doby_niedomkniete: licznik.dobyNiedomkniete ?? null,
    doby_pominiete: (licznik.pominieteDni ?? []).length,
    durationMs: Date.now() - start,
    zakonczony_o: new Date().toISOString(),
  };

  await repoOkna.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'bzpOkno: nie udało się zapisać śladu przebiegu'));

  logger.info(wynik, 'bzpOkno: zakończono');
  return wynik;
}
