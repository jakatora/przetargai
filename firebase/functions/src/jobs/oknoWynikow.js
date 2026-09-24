import { logger } from '../lib/logger.js';
import { parsujWynik } from '../lib/wynikiParser.js';
import { pobierzSuroweWynikiDnia, dniWZakresie } from '../services/bzp.js';
import { pobierzWynikiTed } from '../services/tedWyniki.js';
import { rozstrzygniecia, oknoWynikow as repoOkna } from '../db/repos.js';

/*
 * OKNO ROZSTRZYGNIĘĆ (etap 6) — kompletne źródło „co się w tych przetargach stało".
 *
 * Co to zmienia wobec `aggregateResults`: tamten job pobierał 30 dni BZP, liczył
 * agregat i WYRZUCAŁ dane źródłowe. Pojedyncze rozstrzygnięcie — kto wygrał, ilu
 * startowało, czy część unieważniono — nie zostawało nigdzie, więc benchmark
 * „u TEGO zamawiającego" nie miał z czego powstać, a każdy przeliczenie agregatu
 * wymagało ponownego przemielenia rejestru (~390 s samego ruchu sieciowego).
 * Tu rozstrzygnięcia LĄDUJĄ w bazie, a agregat liczy się z nich.
 *
 * Dwa rejestry, dwa tempa:
 *   • BZP — doba po dobie, z checkpointem (jak okno ogłoszeń); ~200–500 wyników
 *     dziennie, a `PageNumber` jest ignorowany, więc doba to jedno zapytanie
 *     (z docinaniem po województwach na suficie 500).
 *   • TED — jedno zapytanie z paginacją na całe okno; zmierzone 3 427 polskich
 *     rozstrzygnięć od 2026-09-01.
 *
 * 🚨 ŚWIADOMIE NIE DEDUPLIKUJEMY BZP↔TED. Polskie postępowanie idzie albo do BZP
 * (poniżej progów unijnych), albo do TED (powyżej) — nie do obu. Sztuczne
 * scalanie po nazwie zamawiającego łączyłoby RÓŻNE postępowania i psuło próbkę
 * bardziej, niż ratuje. Identyfikatory postępowań obu rejestrów są rozłączne
 * (`ocds-148610-…` vs UUID), więc nie ma po czym scalać uczciwie.
 */

/** Ile dni wstecz trzymamy otwarte okno rozstrzygnięć BZP. */
export const DNI_OKNA_BZP = 14;

/** Ile dni wstecz pytamy TED w jednym przebiegu. */
export const DNI_OKNA_TED = 7;

/**
 * Ile czasu wolno zużyć na JEDEN przebieg.
 *
 * Funkcja ma 1800 s; zostawiamy zapas na zapis partiami i ślad przebiegu.
 */
export const BUDZET_OKNA_MS = 1_200_000;

/**
 * Czy dobę wolno zamknąć jako kompletną.
 *
 * „Dzisiaj" NIGDY nie jest kompletne — BZP publikuje wyniki przez cały dzień.
 * Doba z błędem również zostaje otwarta.
 */
function dobaKompletna(wpis, dzisiaj) {
  if (wpis.dzien >= dzisiaj) return false;
  return !wpis.blad;
}

/** Doby do pobrania w tym przebiegu: od najświeższej, z pominięciem domkniętych. */
export function wybierzDniWynikow({ dni, checkpoint, dzisiaj }) {
  const stan = checkpoint?.dni ?? {};
  return [...dni]
    .sort((a, b) => (a < b ? 1 : -1))
    .filter((dzien) => dzien >= dzisiaj || !stan[dzien]?.kompletny);
}

/** Nowy stan checkpointu; doby poza oknem wypadają, żeby dokument nie rósł bez końca. */
export function zaktualizujCheckpointWynikow({ checkpoint, raport = [], pominieteDni = [], dni, dzisiaj, teraz }) {
  const wOknie = new Set(dni);
  const stan = {};
  for (const [dzien, wpis] of Object.entries(checkpoint?.dni ?? {})) {
    if (wOknie.has(dzien)) stan[dzien] = wpis;
  }
  for (const wpis of raport) {
    stan[wpis.dzien] = {
      ogloszen: wpis.ogloszen ?? 0,
      czesci: wpis.czesci ?? 0,
      blad: wpis.blad ?? null,
      kompletny: dobaKompletna(wpis, dzisiaj),
      zaktualizowano_o: teraz,
    };
  }
  for (const dzien of pominieteDni) {
    if (!stan[dzien]) stan[dzien] = { kompletny: false, ogloszen: 0, blad: null, zaktualizowano_o: teraz };
  }
  return { dni: stan };
}

/** Ile dób okna wciąż czeka na domknięcie (do `/health`). */
export function dobyNiedomknieteWynikow({ dni, checkpoint, dzisiaj }) {
  return wybierzDniWynikow({ dni, checkpoint, dzisiaj }).filter((d) => d < dzisiaj).length;
}

/**
 * Domyka okno rozstrzygnięć z obu rejestrów.
 *
 * Bez dopasowań i bez AI — to wyłącznie kompletność danych źródłowych.
 *
 * @param {{dniBzp?: number, dniTed?: number, budzetMs?: number, teraz?: number,
 *   pobierzDzienBzp?: Function, pobierzTed?: Function}} [opts] wstrzykiwane w testach
 */
export async function runOknoWynikow({
  dniBzp = DNI_OKNA_BZP,
  dniTed = DNI_OKNA_TED,
  budzetMs = BUDZET_OKNA_MS,
  teraz = Date.now(),
  pobierzDzienBzp = pobierzSuroweWynikiDnia,
  pobierzTed = pobierzWynikiTed,
} = {}) {
  const start = Date.now();
  const dzisiaj = new Date(teraz).toISOString().slice(0, 10);
  const odDnia = new Date(teraz - (dniBzp - 1) * 86_400_000).toISOString().slice(0, 10);
  const dniOkna = dniWZakresie(odDnia, dzisiaj);

  const checkpoint = await repoOkna.wczytaj().catch((err) => {
    // Brak checkpointu nie może zablokować pobierania — w najgorszym razie
    // przebieg zrobi całe okno od nowa.
    logger.error({ err: err.message }, 'okno wyników: nie udało się wczytać checkpointu');
    return null;
  });

  const doPobrania = wybierzDniWynikow({ dni: dniOkna, checkpoint, dzisiaj });
  const raport = [];
  const pominieteDni = [];
  let zapisaneBzp = 0;
  let czesciBzp = 0;

  for (const dzien of doPobrania) {
    if (Date.now() - start > budzetMs) {
      // Reszta dób zostaje OTWARTA — następny przebieg po nie wróci.
      pominieteDni.push(...doPobrania.slice(doPobrania.indexOf(dzien)));
      logger.warn({ pominietych: pominieteDni.length }, 'okno wyników: budżet czasu wyczerpany');
      break;
    }
    try {
      const surowe = await pobierzDzienBzp(dzien);
      const sparsowane = surowe.map(parsujWynik).filter((w) => w?.externalId);
      const { zapisane, czesci } = await rozstrzygniecia.zapiszWiele(sparsowane);
      zapisaneBzp += zapisane;
      czesciBzp += czesci;
      raport.push({ dzien, ogloszen: zapisane, czesci, blad: null });
    } catch (err) {
      raport.push({ dzien, ogloszen: 0, czesci: 0, blad: err.message });
      logger.error({ err: err.message, dzien }, 'okno wyników: doba BZP pominięta');
    }
  }

  let zapisaneTed = 0;
  let czesciTed = 0;
  let bladTed = null;
  try {
    const odTed = new Date(teraz - (dniTed - 1) * 86_400_000).toISOString().slice(0, 10);
    const wyniki = await pobierzTed({ odDnia: odTed });
    const { zapisane, czesci } = await rozstrzygniecia.zapiszWiele(wyniki);
    zapisaneTed = zapisane;
    czesciTed = czesci;
  } catch (err) {
    // TED nie może zabrać BZP tego, co już zapisane — awaria jednego rejestru
    // nie kasuje przebiegu (ta sama zasada, co w rejestrze źródeł pobierania).
    bladTed = err.message;
    logger.error({ err: err.message }, 'okno wyników: TED pominięty');
  }

  const nowyStan = zaktualizujCheckpointWynikow({
    checkpoint, raport, pominieteDni, dni: dniOkna, dzisiaj,
    teraz: new Date().toISOString(),
  });
  await repoOkna.zapisz(nowyStan).catch((err) =>
    logger.error({ err: err.message }, 'okno wyników: nie udało się zapisać checkpointu'));

  const bledneDni = raport.filter((w) => w.blad).length;
  const wynik = {
    // Przebieg jest OK, gdy przeszedł chociaż jeden rejestr — inaczej awaria TED
    // (HTTP 429 zdarza się regularnie) wywracałaby zapisane już wyniki BZP.
    ok: bledneDni < raport.length || bladTed === null,
    error: bladTed,
    doby_okna: dniOkna.length,
    doby_pobrane: raport.length,
    doby_bledne: bledneDni,
    doby_pominiete: pominieteDni.length,
    doby_niedomkniete: dobyNiedomknieteWynikow({ dni: dniOkna, checkpoint: nowyStan, dzisiaj }),
    bzp_ogloszen: zapisaneBzp,
    bzp_czesci: czesciBzp,
    ted_ogloszen: zapisaneTed,
    ted_czesci: czesciTed,
    durationMs: Date.now() - start,
    zakonczony_o: new Date().toISOString(),
  };

  await repoOkna.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'okno wyników: nie udało się zapisać śladu przebiegu'));

  logger.info(wynik, 'oknoWynikow: zakończono');
  return wynik;
}
