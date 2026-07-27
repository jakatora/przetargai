import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { db } from '../db/index.js';
import { createCzarnaSkrzynka } from '../services/czarnaSkrzynka.js';

/*
 * MONITOR DOSTĘPNOŚCI PLATFORMY składania ofert (ulepszenie „Czarna skrzynka składania
 * oferty — dowody na awarię platformy", podzadanie 2/7).
 *
 * Rejestrator lotu utrwala DOWÓD (nie)dostępności e-Zamówień / platformy zakupowej w
 * godzinach przed terminem. KIO konsekwentnie kładzie ciężar udowodnienia awarii na
 * wykonawcę, a bez utrwalonych NA BIEŻĄCO pomiarów odwołanie przepada — dlatego job pinguje
 * cyklicznie i zapisuje wynik (kod HTTP, czas odpowiedzi, znacznik czasu serwera) do
 * append-only logu sesji (typ zdarzenia 'ping'). Sama DETEKCJA awarii i budowa pakietu
 * dowodowego to osobny krok (3/7) — tu wyłącznie utrwalamy surowe pomiary.
 *
 * Dostępność platformy to fakt GLOBALNY, więc pingujemy RAZ na cykl, a wynik utrwalamy w
 * logu KAŻDEJ otwartej sesji (oferta jeszcze niezłożona: `hash_oferty IS NULL`) — mniej
 * ruchu sieciowego i jeden, spójny znacznik czasu. Bez otwartych sesji przebieg jest
 * no-opem: nie rusza sieci (zero kosztu). Transport (`ping`) i cel (`url`) są WSTRZYKIWANE,
 * więc job testujemy deterministycznie bez sieci. Błąd zapisu jednej sesji nie przerywa
 * pozostałych (łapiemy per sesja, jak monitorSejf/monitorPodprogowy).
 */

/**
 * Domyślny cel pingu — centralna platforma e-Zamówień, przez którą składa się większość
 * ofert. Świadomie stała modułowa (a nie kolejny wpis w env): to podzadanie dodaje TYLKO
 * próg `DOSTEPNOSC_PLATFORMY_CRON`, a cel i tak jest wstrzykiwalny (`url`).
 */
export const URL_PLATFORMY_DOMYSLNY = 'https://ezamowienia.gov.pl';

/**
 * Jedno sprawdzenie dostępności: mierzy kod HTTP i czas odpowiedzi. Serwer, który
 * odpowiada (nawet 3xx/4xx), traktujemy jako DOSTĘPNY; 5xx lub błąd sieci (timeout,
 * ECONNREFUSED, DNS) => NIEDOSTĘPNY, z zachowanym komunikatem. Nie rzuca — awaria platformy
 * jest wynikiem do utrwalenia, a nie wyjątkiem do połknięcia.
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, teraz?: () => number}} [deps]
 * @returns {Promise<{url: string, kodHttp: number|null, czasMs: number, dostepna: boolean, blad?: string}>}
 */
export async function pingPlatformy(url, { fetchImpl = fetch, teraz = () => Date.now() } = {}) {
  const start = teraz();
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual' });
    const kodHttp = typeof res?.status === 'number' ? res.status : null;
    return { url, kodHttp, czasMs: teraz() - start, dostepna: kodHttp != null && kodHttp < 500 };
  } catch (err) {
    return { url, kodHttp: null, czasMs: teraz() - start, dostepna: false, blad: err.message };
  }
}

/**
 * Jeden przebieg cyklicznego monitora dostępności: pinguje platformę (o ile są otwarte
 * sesje) i utrwala wynik w logu każdej z nich. Zależności wstrzykiwane => bez sieci/zegara.
 * @param {{skrzynka?: object, ping?: typeof pingPlatformy, url?: string}} [deps]
 * @returns {Promise<{ok: boolean, sesje: number, zapisane: number, bledy: number,
 *   wynik: object|null, durationMs: number}>}
 */
export async function runDostepnoscMonitor({
  skrzynka = createCzarnaSkrzynka(db),
  ping = pingPlatformy,
  url = URL_PLATFORMY_DOMYSLNY,
} = {}) {
  const startedAt = Date.now();
  const sesje = skrzynka.sesjeOtwarte();
  let zapisane = 0;
  let bledy = 0;
  let wynik = null;

  if (sesje.length > 0) {
    wynik = await ping(url);
    for (const s of sesje) {
      try {
        skrzynka.zapiszPing(s.id, wynik);
        zapisane++;
      } catch (err) {
        bledy++;
        logger.error({ sesja: s.id, err: err.message }, 'dostepnoscPlatformy: błąd zapisu wyniku');
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    {
      sesje: sesje.length, zapisane, bledy,
      kodHttp: wynik?.kodHttp ?? null, dostepna: wynik?.dostepna ?? null, durationMs,
    },
    'dostepnoscPlatformy: zakończono',
  );
  return { ok: true, sesje: sesje.length, zapisane, bledy, wynik, durationMs };
}

// Ręczne uruchomienie: `node src/jobs/dostepnosc-platformy.js`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runDostepnoscMonitor()
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie dostepnoscPlatformy zakończone');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'dostepnoscPlatformy: błąd krytyczny');
      process.exit(1);
    });
}
