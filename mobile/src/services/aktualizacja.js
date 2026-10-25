import { wyslijZLimitem, LIMIT_ODCZYTU_MS } from '../lib/zapytanieSieciowe.js';
import { ADRES_WERSJI, wersjaZOdpowiedzi } from '../lib/aktualizacja.js';

/**
 * Najnowsza opublikowana wersja z `wersja.json` na stronie — albo null przy każdym problemie
 * (brak sieci, 404, śmieci). Best-effort: baner aktualizacji nigdy nie może wywalić feedu.
 * Znacznik czasu w adresie omija pamięć podręczną przeglądarki/Electrona.
 */
export async function pobierzNajnowszaWersje({ fetchFn = fetch, teraz = Date.now() } = {}) {
  try {
    const res = await wyslijZLimitem(`${ADRES_WERSJI}?t=${Math.floor(teraz / 60_000)}`, { method: 'GET', headers: { Accept: 'application/json' } }, { fetchFn, limitMs: LIMIT_ODCZYTU_MS, ponowienia: 0 });
    if (!res?.ok) return null;
    return wersjaZOdpowiedzi(await res.json());
  } catch {
    return null;
  }
}
