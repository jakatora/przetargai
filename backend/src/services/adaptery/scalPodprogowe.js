import { normalizujPodprogowe } from '../../lib/normalizacjaPodprogowe.js';

/*
 * ŚCIEŻKA scalania ogłoszeń podprogowych (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł", podzadanie 3/7): adapter → normalizacja → upsert.
 *
 * Reużywalna dla KAŻDEGO adaptera wspólnego kontraktu (./kontrakt.js), więc monitor
 * (podzadanie 6/7) przeleci nią po wszystkich źródłach jednakowo. Sam nie robi I/O
 * sieciowego (to adapter) ani nie zna SQL-a (to repo) — spina trzy warstwy i liczy
 * podsumowanie. Zapisujemy TYLKO ogłoszenia, które równocześnie:
 *   • przechodzą regułę progu dla swojego źródła (`kwalifikujeSie`), oraz
 *   • pasują do preferencji branży/regionu użytkownika (`dopasowanie.pasuje`).
 * Dedup po `hash_dedup` jest po stronie repo (upsert), więc kolejne cykle monitora
 * nie dublują ogłoszeń.
 */

/**
 * @param {object} p
 * @param {import('./kontrakt.js').AdapterZrodla} p.adapter adapter źródła
 * @param {{upsert: (rekord: object) => {rekord: object, created: boolean}, count?: Function}} p.repo
 * @param {string} [p.branza] preferencja branży użytkownika
 * @param {string} [p.region] preferencja regionu użytkownika
 * @param {{prog_netto?: number, prog_konkurencyjnosci?: number}} [p.konfig] progi
 * @returns {Promise<{zrodlo: string, pobrano: number, zakwalifikowano: number,
 *   dodano: number, duplikaty: number, odrzucono: number}>}
 */
export async function zbierzIWepnij({ adapter, repo, branza = '', region = '', konfig = {} }) {
  if (!adapter || typeof adapter.pobierz !== 'function') {
    throw new TypeError('zbierzIWepnij: `adapter` musi spełniać kontrakt (pobierz)');
  }
  if (!repo || typeof repo.upsert !== 'function') {
    throw new TypeError('zbierzIWepnij: `repo` musi mieć metodę upsert(rekord)');
  }

  const surowe = await adapter.pobierz(branza, region);
  const podsumowanie = {
    zrodlo: adapter.zrodlo,
    pobrano: Array.isArray(surowe) ? surowe.length : 0,
    zakwalifikowano: 0,
    dodano: 0,
    duplikaty: 0,
    odrzucono: 0,
  };

  for (const s of Array.isArray(surowe) ? surowe : []) {
    const { rekord, kwalifikujeSie, dopasowanie } = normalizujPodprogowe(s, { branza, region, ...konfig });
    if (!kwalifikujeSie || !dopasowanie.pasuje) {
      podsumowanie.odrzucono++;
      continue;
    }
    podsumowanie.zakwalifikowano++;
    const { created } = repo.upsert(rekord);
    if (created) podsumowanie.dodano++;
    else podsumowanie.duplikaty++;
  }

  return podsumowanie;
}
