import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { pobierzWojewodztwaTed } from '../services/ted.js';
import { tenders, users } from '../db/repos.js';

/*
 * WOJEWÓDZTWA TED WSTECZ (2026-11-07, POST /admin/ted-wojewodztwa). Województwo z NUTS zapisujemy od 25.10; otwarte
 * ogłoszenia TED pobrane wcześniej (7.11: 1069) go nie miały, więc reguła „teren” ich nie odsiewała — konto, które
 * zaznaczyło zachodniopomorskie, dalej widziało przetargi unijne z całej Polski. Kolejne przebiegi biorą tylko to,
 * czego brakuje; `null` z API (kilka województw) zostaje bez zmian.
 */
export async function runTedWojewodztwa({ teraz = nowIso(), limit = 2000, pobierz = pobierzWojewodztwaTed } = {}) {
  const bez = (await tenders.otwarteZeZrodla('ted', teraz)).filter((t) => !t.wojewodztwo).slice(0, limit);
  const numery = new Map(bez.map((t) => [String(t.id).replace(/^ted:/, ''), t.id]));
  const zApi = await pobierz([...numery.keys()]);
  const kody = new Map();
  for (const [numer, kod] of zApi) if (kod && numery.has(numer)) kody.set(numery.get(numer), kod);
  const kopie = kody.size ? await tenders.ustawWojewodztwa(kody) : 0;
  const konta = kody.size ? await users.wymusPrzegladKontZTerenem() : 0;
  const wynik = { bez_wojewodztwa: bez.length, z_api: zApi.size, uzupelnione: kody.size, kopie_w_feedach: kopie, konta_do_przegladu: konta };
  logger.info(wynik, 'Województwa TED uzupełnione wstecz');
  return wynik;
}
