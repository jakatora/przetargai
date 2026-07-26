import { createHash } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { isMainModule, nowIso } from '../lib/ids.js';
import { postepowaniaSwz, swzWersje } from '../db/repos.js';
import { zarejestrujRoznice } from '../services/roznicaSwz.js';

/*
 * MONITOR PUBLIKACJI ZAMAWIAJĄCEGO (ulepszenie „Radar pytań i odpowiedzi do SWZ",
 * podzadanie 5/7).
 *
 * Zamawiający aż do terminu składania ofert publikuje odpowiedzi na pytania i nowe
 * wersje SWZ — czasem tuż przed terminem. Ten monitor okresowo (scheduler) i na
 * żądanie (endpoint /odswiez) dociąga te publikacje dla postępowań wciąż w oknie
 * i przy KAŻDEJ nowej wersji:
 *   1) zapisuje ją jako kolejną wersję dokumentu (`swz_wersja`, dedup po haszu),
 *   2) uruchamia silnik różnic (services/roznicaSwz.js) — porównanie z poprzednią
 *      wersją tworzy wpis `zmiany_swz` (czytelny diff + best-effort opis skutku).
 *
 * ŹRÓDŁO PUBLIKACJI jest WSTRZYKIWANE (`pobierzPublikacje`) — dokładnie jak GUS w
 * monitorWaloryzacji.js. Realny scraper platformy zamawiającego wpina się TU;
 * domyślny `pobierzPublikacjeSwz` to bezpieczny stub (nic nie pobiera), więc dopóki
 * źródła nie ma, cykliczny przebieg jest no-opem, a wersje wgrywa się ręcznie
 * endpointem /odswiez (klient/integracja podaje treść nowo opublikowanej wersji).
 *
 * ŚCIEŻKA PIENIĘDZY (płatne AI): opis skutku liczy Claude, ale WYŁĄCZNIE dla
 * genuinnie nowej wersji (dedup po haszu odcina powtórki) i tylko gdy istnieje
 * poprzednia wersja do porównania; samo wywołanie przechodzi wspólną bramkę budżetu
 * w `zarejestrujRoznice`/`opiszSkutekZmiany` (denial-of-wallet), a przy AI-down/budżecie
 * zmiana i tak zapisuje się z samym diffem. Błąd jednego postępowania nie przerywa
 * całego przebiegu (łapiemy per rekord).
 */

/** Hasz treści SWZ (SHA-256 hex) — podstawa dedupu „czy to nowa wersja?". */
export function haszTresci(tresc) {
  return createHash('sha256').update(String(tresc ?? '')).digest('hex');
}

/**
 * Domyślne źródło publikacji: brak wpiętego scrapera => pusta lista. Realna
 * integracja z platformą zamawiającego zastępuje tę funkcję (parametr
 * `pobierzPublikacje`). Zwraca listę kandydatów na wersje SWZ.
 * @param {object} _postepowanie
 * @returns {Promise<Array<{hash?: string, tresc?: string, sciezka?: string, dataPublikacji?: string}>>}
 */
export async function pobierzPublikacjeSwz(_postepowanie) {
  return [];
}

/**
 * Wchłania listę kandydatów na wersje SWZ dla JEDNEGO postępowania: każdą genuinnie
 * nową wersję zapisuje (`swz_wersja`, dedup po haszu) i — o ile istnieje poprzednia
 * wersja — puszcza przez silnik różnic (`zarejestruj`), tworząc wpis `zmiany_swz`.
 * Kandydaci przetwarzani po kolei; każdy kolejny porównywany z poprzednim (łańcuch
 * wersji). Pierwsza wersja postępowania to baza — nie ma z czym jej porównać.
 *
 * @param {{postepowanie: {id: string},
 *          kandydaci?: Array<{hash?: string, tresc?: string, sciezka?: string, dataPublikacji?: string}>,
 *          zarejestruj?: typeof zarejestrujRoznice}} wejscie
 * @returns {Promise<{noweWersje: number, zmiany: number, wersje: object[], zmiany_wpisy: object[]}>}
 */
export async function ingestujWersje({ postepowanie, kandydaci = [], zarejestruj = zarejestrujRoznice } = {}) {
  const postepowanieId = postepowanie.id;
  let poprzednia = swzWersje.latestForPostepowanie(postepowanieId);
  let noweWersje = 0;
  let zmiany = 0;
  const wersje = [];
  const zmianyWpisy = [];

  for (const k of kandydaci ?? []) {
    const tresc = k?.tresc ?? null;
    const sciezka = k?.sciezka ?? null;
    // Hasz z kandydata, a gdy go nie ma — z treści. Bez jednego i drugiego nie da
    // się zdeduplikować ani spełnić NOT NULL na `hash` => pomijamy kandydata.
    const hash = k?.hash ?? (tresc != null ? haszTresci(tresc) : null);
    if (!hash) continue;

    const { wersja, created } = swzWersje.add({
      postepowanieId, hash, tresc, sciezka, dataPublikacji: k?.dataPublikacji ?? null,
    });
    if (!created) continue; // znana wersja (ten sam hasz) — nic nowego

    noweWersje++;
    wersje.push(wersja);
    if (poprzednia) {
      const zmiana = await zarejestruj({ postepowanieId, poprzednia, nowa: wersja });
      if (zmiana) { zmiany++; zmianyWpisy.push(zmiana); }
    }
    poprzednia = wersja; // kolejnego kandydata porównujemy z tą właśnie dodaną wersją
  }

  return { noweWersje, zmiany, wersje, zmiany_wpisy: zmianyWpisy };
}

/**
 * Odświeżenie JEDNEGO postępowania (ręczne — endpoint /odswiez): łączy opcjonalną
 * wersję wgraną ręcznie (`pchnietaWersja` z body) z tym, co widzi automatyczne
 * źródło (`pobierzPublikacje`), i wchłania je przez `ingestujWersje`. Niedostępne
 * źródło nie wywraca żądania — logujemy i lecimy dalej z tym, co mamy.
 *
 * @param {{postepowanie: {id: string},
 *          pchnietaWersja?: {hash?: string, tresc?: string, sciezka?: string, dataPublikacji?: string}|null,
 *          pobierzPublikacje?: typeof pobierzPublikacjeSwz,
 *          zarejestruj?: typeof zarejestrujRoznice}} wejscie
 */
export async function odswiezPostepowanie({
  postepowanie,
  pchnietaWersja = null,
  pobierzPublikacje = pobierzPublikacjeSwz,
  zarejestruj = zarejestrujRoznice,
} = {}) {
  const kandydaci = [];
  if (pchnietaWersja && (pchnietaWersja.tresc != null || pchnietaWersja.sciezka != null)) {
    kandydaci.push(pchnietaWersja);
  }
  let zeZrodla = [];
  try {
    zeZrodla = (await pobierzPublikacje(postepowanie)) ?? [];
  } catch (err) {
    logger.warn({ err: err.message, postepowanie: postepowanie.id }, 'monitorSwz: źródło publikacji niedostępne');
  }
  kandydaci.push(...zeZrodla);
  return ingestujWersje({ postepowanie, kandydaci, zarejestruj });
}

/**
 * Jeden przebieg cyklicznego monitoringu: dla każdego postępowania wciąż w oknie
 * (przed terminem składania lub bez znanego terminu) dociąga publikacje ze źródła
 * i wchłania je. Błąd pojedynczego postępowania nie przerywa całości — łapiemy per
 * rekord i próbujemy dalej; nieudane wróci w następnym cyklu.
 *
 * @param {{pobierzPublikacje?: typeof pobierzPublikacjeSwz,
 *          zarejestruj?: typeof zarejestrujRoznice, teraz?: string}} [deps]
 * @returns {Promise<{ok: boolean, postepowania: number, zmienione: number,
 *                     noweWersje: number, zmiany: number, bledy: number, durationMs: number}>}
 */
export async function runSwzMonitor({
  pobierzPublikacje = pobierzPublikacjeSwz,
  zarejestruj = zarejestrujRoznice,
  teraz = null,
} = {}) {
  const startedAt = Date.now();
  const now = teraz ?? nowIso();
  const rekordy = postepowaniaSwz.doMonitoringu(now);
  let zmienione = 0;
  let noweWersje = 0;
  let zmiany = 0;
  let bledy = 0;

  for (const p of rekordy) {
    try {
      const kandydaci = (await pobierzPublikacje(p)) ?? [];
      const wynik = await ingestujWersje({ postepowanie: p, kandydaci, zarejestruj });
      noweWersje += wynik.noweWersje;
      zmiany += wynik.zmiany;
      if (wynik.noweWersje) zmienione++;
    } catch (err) {
      bledy++;
      logger.error({ err: err.message, postepowanie: p.id }, 'monitorSwz: błąd rekordu');
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    { postepowania: rekordy.length, zmienione, noweWersje, zmiany, bledy, durationMs },
    'monitorSwz: zakończono',
  );
  return { ok: true, postepowania: rekordy.length, zmienione, noweWersje, zmiany, bledy, durationMs };
}

// Ręczne uruchomienie: `node src/jobs/monitorSwz.js`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runSwzMonitor()
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie monitorSwz zakończone');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'monitorSwz: błąd krytyczny');
      process.exit(1);
    });
}
