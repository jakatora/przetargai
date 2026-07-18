import { logger } from '../lib/logger.js';
import { parsujWynik } from '../lib/wynikiParser.js';
import { agregujWyniki } from '../lib/wynikiAgregacja.js';
import { pobierzSuroweWynikiDnia } from '../services/bzp.js';
import { wynikiStats } from '../db/repos.js';
import { dniWZakresie } from '../services/bzp.js';

/**
 * Cykl agregacji wyników postępowań (runda 16).
 *
 * Statystyki cen/konkurencji zmieniają się wolno — liczymy je z SZERSZEGO okna
 * (domyślnie 30 dni) na osobnym, rzadszym harmonogramie niż dzienny matching.
 *
 * Kluczowa oszczędność pamięci: parsujemy dzień po dniu i TRZYMAMY tylko małe wyniki
 * (kilka pól/część), NIE surowe `htmlBody` (~27 KB × tysiące = dziesiątki MB). Surowe
 * ogłoszenia dnia są odrzucane zaraz po sparsowaniu.
 *
 * @param {{dni?: number, pobierzDzien?: Function, teraz?: number}} [opts]
 *   `pobierzDzien`/`teraz` wstrzykiwane w testach.
 */
export async function runWynikiAggregation({
  dni = 30,
  pobierzDzien = pobierzSuroweWynikiDnia,
  teraz = Date.now(),
} = {}) {
  const start = Date.now();
  const od = new Date(teraz - (dni - 1) * 86_400_000).toISOString().slice(0, 10);
  const do_ = new Date(teraz).toISOString().slice(0, 10);
  const listaDni = dniWZakresie(od, do_);

  const sparsowane = [];
  let bledneDni = 0;
  for (const dzien of listaDni) {
    try {
      const surowe = await pobierzDzien(dzien);
      for (const s of surowe) {
        const w = parsujWynik(s);
        if (w) sparsowane.push(w); // tylko małe pola — surowe htmlBody odrzucone
      }
    } catch (err) {
      bledneDni++;
      logger.error({ err: err.message, dzien }, 'Agregacja wyników: dzień pominięty');
    }
  }

  const buckety = agregujWyniki(sparsowane);
  const zapisane = await wynikiStats.zapisz(buckety);

  const wynik = {
    ok: true, dni: listaDni.length, bledneDni,
    ogloszen: sparsowane.length, bucketow: zapisane, durationMs: Date.now() - start,
  };
  logger.info(wynik, 'runWynikiAggregation: zakończono');
  return wynik;
}
