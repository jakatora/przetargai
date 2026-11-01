import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders, rozstrzygniecia, mapaZamawiajacych } from '../db/repos.js';
import { zbudujMapy, wojewodztwoZNazwy } from '../lib/wojewodztwoZamawiajacego.js';

/*
 * WOJEWÓDZTWO ZAMAWIAJĄCEGO DLA PLATFORMAZAKUPOWA I E-PROPUBLICO (2026-11-01). Listy tych platform nie podają
 * regionu — 1.11 bez województwa było 4587 z 4587 otwartych przetargów PZ i 139 z 139 ePP. Mapę „nazwa → województwo”
 * budujemy z BZP (rozstrzygnięcia z roku + otwarte ogłoszenia), raz na tydzień; codziennie dopisujemy województwo
 * przetargom PZ/ePP, które go nie mają. Zmierzone 1.11: przypisane 78% PZ i 76% ePP; dokładna nazwa trafna w
 * 3494/3499, reguły „Gmina X” / „… w X” w 89/96 (mylą gminy o tej samej nazwie w dwóch województwach).
 *
 * TED świadomie pomijamy: tam null znaczy „kilka regionów / cały kraj” i ma nie odcinać przetargu regułą „teren”.
 */
export const ZRODLA_BEZ_REGIONU = new Set(['platformazakupowa', 'epropublico']);
export const SWIEZOSC_MAPY_DNI = 7;

/** Przebudowa mapy z BZP: rozstrzygnięcia z `dni` (strony po 1000) + otwarte ogłoszenia BZP. */
export async function runMapaZamawiajacych({ teraz = Date.now(), dni = 365, maksStron = 200, repoWynikow = rozstrzygniecia, przetargi = tenders, repoMap = mapaZamawiajacych } = {}) {
  const rekordy = [];
  let kursor = null;
  for (let i = 0; i < maksStron; i++) {
    const strona = await repoWynikow.strona({ od: new Date(teraz - dni * 86_400_000).toISOString().slice(0, 10), kursor, limit: 1000, pola: ['zamawiajacy', 'wojewodztwo', 'miasto'] });
    for (const r of strona.pozycje) rekordy.push({ org: r.zamawiajacy, woj: r.wojewodztwo, miasto: r.miasto });
    if (strona.koniec || !strona.kursor) break;
    kursor = strona.kursor;
  }
  const otwarte = await przetargi.otwarteDoWojewodztwa(new Date(teraz).toISOString());
  for (const t of otwarte) if (t.source === 'bzp') rekordy.push({ org: t.organization, woj: t.wojewodztwo });
  const mapy = zbudujMapy(rekordy);
  await repoMap.zapisz(mapy, new Date(teraz).toISOString());
  const wynik = { rekordow: rekordy.length, nazw: mapy.poNazwie.size, miast: mapy.poMiescie.size, miejscownikow: mapy.poMiejscowniku.size };
  logger.info(wynik, 'runMapaZamawiajacych: zakończono');
  return wynik;
}

/** Dopisanie województwa otwartym przetargom PZ/ePP bez regionu. Mapa starsza niż tydzień → przebudowa najpierw. */
export async function runWojewodztwaZamawiajacych({ teraz = Date.now(), przetargi = tenders, repoMap = mapaZamawiajacych, przebuduj = runMapaZamawiajacych } = {}) {
  let mapy = await repoMap.wczytaj().catch(() => null);
  const stara = !mapy?.zbudowano_o || teraz - Date.parse(mapy.zbudowano_o) > SWIEZOSC_MAPY_DNI * 86_400_000;
  let przebudowa = null;
  if (stara) {
    przebudowa = await przebuduj({ teraz });
    mapy = await repoMap.wczytaj({ swiezoscMs: 0 });
  }
  const wynik = { ok: true, przebudowa, kandydaci: 0, przypisane: 0, bledy: 0 };
  if (!mapy) return { ...wynik, ok: false };
  const otwarte = await przetargi.otwarteDoWojewodztwa(new Date(teraz).toISOString());
  for (const t of otwarte) {
    if (!ZRODLA_BEZ_REGIONU.has(t.source) || t.wojewodztwo) continue;
    wynik.kandydaci += 1;
    const kod = wojewodztwoZNazwy(t.organization, mapy);
    if (!kod) continue;
    try {
      await przetargi.ustawWojewodztwoZNazwy(t.id, `PL${kod}`);
      wynik.przypisane += 1;
    } catch (err) {
      wynik.bledy += 1;
      logger.warn({ err: err.message, tenderId: t.id }, 'Województwo z nazwy: zapis nie powiódł się');
    }
  }
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runWojewodztwaZamawiajacych: zakończono');
  return wynik;
}

/** Przy wczytywaniu listy PZ/ePP: województwo z nazwy dla nowej pozycji (mapa wczytana raz na przebieg). */
export function wojewodztwoNowejPozycji(t, mapy) {
  if (!t || t.wojewodztwo || !mapy) return t;
  const kod = wojewodztwoZNazwy(t.organization, mapy);
  return kod ? { ...t, wojewodztwo: `PL${kod}`, wojewodztwo_z_nazwy: true } : t;
}
