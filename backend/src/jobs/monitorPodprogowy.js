import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { db } from '../db/index.js';
import { createPodprogoweRepo } from '../db/podprogoweRepo.js';
import { createPreferencjeRadaruRepo } from '../db/preferencjeRadaruRepo.js';
import WSZYSTKIE_ADAPTERY from '../services/adaptery/index.js';
import { zbierzIWepnij } from '../services/adaptery/scalPodprogowe.js';
import { uzupelnijRegulamin } from '../services/regulaminZakupowy.js';

/*
 * MONITOR ZAMÓWIEŃ PODPROGOWYCH (ulepszenie „Radar zamówień podprogowych — poniżej
 * 170 tys. zł", podzadanie 6/7).
 *
 * Usługa OKRESOWEGO (scheduler) i RĘCZNEGO (endpoint /odswiez) odświeżania. Dla
 * KAŻDEJ zapisanej preferencji użytkownika (branża/region/próg):
 *   1) uruchamia WSZYSTKIE adaptery źródeł (Baza Konkurencyjności, platformazakupowa,
 *      eZamawiający, e-propublico…) tą samą ścieżką `zbierzIWepnij`
 *      (adapter → normalizacja → upsert z dedupem po `hash_dedup`),
 *   2) dla NOWO dodanych ogłoszeń domawia regulamin zakupowy zamawiającego
 *      (`uzupelnijRegulamin`: URL z BIP + best-effort streszczenie mini-procedury).
 *
 * ŚCIEŻKA PIENIĘDZY (płatne AI): streszczenie regulaminu to jedyny płatny krok i
 * odpalamy je WYŁĄCZNIE dla ogłoszeń realnie dodanych w tym przebiegu (`dodane` z
 * `zbierzIWepnij`) — dedup po `hash_dedup` gwarantuje, że każde znalezisko przejdzie
 * tędy RAZ w życiu, więc cyklicznie nie płacimy w kółko za to samo. Sama bramka
 * budżetu (`aiBudgetAllows`) siedzi w usłudze regulaminu (denial-of-wallet), a przy
 * AI-down / wyczerpanym budżecie zapis degraduje się gracefully do samego
 * `regulamin_url` (bez streszczenia). Wiele źródeł/apek dzieli tę samą pulę
 * `ai_usage`, więc bramka jest wspólna dla całego backendu.
 *
 * ODPORNOŚĆ: błąd pojedynczego adaptera (źródło niedostępne) nie przerywa pozostałych;
 * błąd pojedynczej preferencji nie przerywa całego przebiegu — łapiemy per rekord i
 * lecimy dalej, nieudane wróci w następnym cyklu (jak monitorSwz/monitorWaloryzacji).
 * Adaptery i usługa regulaminu są WSTRZYKIWANE, więc job testujemy bez sieci ani AI.
 */

/** Domyślne repozytoria na singletonie `db` (leniwe — nie dotykają bazy przy imporcie). */
const repoDomyslne = createPodprogoweRepo(db);
const prefRepoDomyslne = createPreferencjeRadaruRepo(db);

/**
 * Odświeża JEDNĄ preferencję: przelatuje wszystkie adaptery, upsertuje kwalifikujące
 * się ogłoszenia (dedup) i domawia regulaminy dla nowo dodanych.
 *
 * @param {object} p
 * @param {{branza?: string|null, region?: string|null, prog_netto?: number}} p.pref preferencja
 * @param {{upsert: Function, ustawRegulamin: Function}} p.repo repo ogłoszeń podprogowych
 * @param {import('../services/adaptery/kontrakt.js').AdapterZrodla[]} [p.adaptery] adaptery źródeł
 * @param {typeof uzupelnijRegulamin} [p.uzupelnij] usługa domówienia regulaminu
 * @param {typeof zbierzIWepnij} [p.zbierz] ścieżka scalania (adapter→normalizacja→upsert)
 * @param {(url: string) => Promise<string>} [p.pobierzStrone] wstrzykiwalny transport HTML (regulamin)
 * @returns {Promise<{branza: string|null, region: string|null, zrodla: object[],
 *   dodano: number, regulaminy: number}>}
 */
export async function odswiezPreferencje({
  pref,
  repo,
  adaptery = WSZYSTKIE_ADAPTERY,
  uzupelnij = uzupelnijRegulamin,
  zbierz = zbierzIWepnij,
  pobierzStrone,
} = {}) {
  if (!pref) throw new TypeError('odswiezPreferencje: `pref` wymagane');
  if (!repo || typeof repo.upsert !== 'function') {
    throw new TypeError('odswiezPreferencje: `repo` musi mieć metodę upsert(rekord)');
  }

  const branza = (pref.branza ?? '').toString();
  const region = (pref.region ?? '').toString();
  // Próg z preferencji (o ile ustawiony) trafia do normalizacji; dolną granicę
  // Bazy Konkurencyjności (80 tys.) trzyma sama normalizacja.
  const konfig = Number.isFinite(pref.prog_netto) ? { prog_netto: pref.prog_netto } : {};

  const zrodla = [];
  const dodane = [];
  for (const adapter of adaptery) {
    try {
      const podsumowanie = await zbierz({ adapter, repo, branza, region, konfig });
      zrodla.push(podsumowanie);
      if (Array.isArray(podsumowanie.dodane)) dodane.push(...podsumowanie.dodane);
    } catch (err) {
      logger.warn({ zrodlo: adapter?.zrodlo, err: err.message }, 'monitorPodprogowy: adapter niedostępny — pomijam');
      zrodla.push({
        zrodlo: adapter?.zrodlo ?? null,
        blad: err.message,
        pobrano: 0, zakwalifikowano: 0, dodano: 0, duplikaty: 0, odrzucono: 0, dodane: [],
      });
    }
  }

  // Domawianie regulaminów TYLKO dla nowo dodanych ogłoszeń (patrz nagłówek —
  // ścieżka pieniędzy). Błąd jednego znaleziska nie psuje pozostałych.
  let regulaminy = 0;
  for (const znalezisko of dodane) {
    try {
      const po = await uzupelnij({ znalezisko, repo, ...(pobierzStrone ? { pobierzStrone } : {}) });
      if (po?.regulamin_url) regulaminy++;
    } catch (err) {
      logger.warn({ id: znalezisko?.id, err: err.message }, 'monitorPodprogowy: regulamin nieuzupełniony — pomijam');
    }
  }

  return {
    branza: branza || null,
    region: region || null,
    zrodla,
    dodano: dodane.length,
    regulaminy,
  };
}

/**
 * Jeden przebieg cyklicznego monitora: dla każdej zapisanej preferencji (wszystkich
 * userów) odświeża strumień. Błąd pojedynczej preferencji nie przerywa całości.
 *
 * @param {{repo?: object, prefRepo?: object,
 *   adaptery?: import('../services/adaptery/kontrakt.js').AdapterZrodla[],
 *   uzupelnij?: typeof uzupelnijRegulamin, zbierz?: typeof zbierzIWepnij,
 *   pobierzStrone?: (url: string) => Promise<string>}} [deps]
 * @returns {Promise<{ok: boolean, preferencje: number, dodano: number,
 *   regulaminy: number, bledy: number, durationMs: number}>}
 */
export async function runPodprogowyMonitor({
  repo = repoDomyslne,
  prefRepo = prefRepoDomyslne,
  adaptery = WSZYSTKIE_ADAPTERY,
  uzupelnij = uzupelnijRegulamin,
  zbierz = zbierzIWepnij,
  pobierzStrone,
} = {}) {
  const startedAt = Date.now();
  const preferencje = prefRepo.listAll();
  let dodano = 0;
  let regulaminy = 0;
  let bledy = 0;

  for (const pref of preferencje) {
    try {
      const wynik = await odswiezPreferencje({ pref, repo, adaptery, uzupelnij, zbierz, pobierzStrone });
      dodano += wynik.dodano;
      regulaminy += wynik.regulaminy;
    } catch (err) {
      bledy++;
      logger.error({ pref: pref?.id, err: err.message }, 'monitorPodprogowy: błąd preferencji');
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    { preferencje: preferencje.length, dodano, regulaminy, bledy, durationMs },
    'monitorPodprogowy: zakończono',
  );
  return { ok: true, preferencje: preferencje.length, dodano, regulaminy, bledy, durationMs };
}

// Ręczne uruchomienie: `node src/jobs/monitorPodprogowy.js`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runPodprogowyMonitor()
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie monitorPodprogowy zakończone');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'monitorPodprogowy: błąd krytyczny');
      process.exit(1);
    });
}
