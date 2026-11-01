import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders, rozstrzygniecia, mapaZamawiajacych, modelCpvTytulu } from '../db/repos.js';
import { zbudujMapy, wojewodztwoZNazwy, nipZNazwy } from '../lib/wojewodztwoZamawiajacego.js';
import { nauczModel, przewidzDzial, modelDoTekstu, modelZTekstu } from '../lib/dzialCpvZTytulu.js';

/*
 * WOJEWÓDZTWO ZAMAWIAJĄCEGO I DZIAŁ CPV DLA PLATFORMAZAKUPOWA I E-PROPUBLICO (2026-11-01). Listy tych platform nie
 * podają regionu ani CPV — 1.11 bez województwa było 4587 z 4587 otwartych przetargów PZ i 139 z 139 ePP. Z BZP
 * (rozstrzygnięcia z roku + otwarte ogłoszenia), raz na tydzień, budujemy mapę „nazwa → województwo”
 * (`lib/wojewodztwoZamawiajacego.js`) i model „tytuł → dział CPV” (`lib/dzialCpvZTytulu.js`); codziennie dopisujemy
 * je przetargom PZ/ePP, które ich nie mają. Zmierzone 1.11: województwo dla 78% PZ i 76% ePP (dokładna nazwa trafna
 * w 3494/3499, reguły „Gmina X” / „… w X” w 89/96); dział z tytułu przy progu 0,99 — 89,6% trafnych, ~32% tytułów.
 *
 * TED świadomie pomijamy: tam null znaczy „kilka regionów / cały kraj” i ma nie odcinać przetargu regułą „teren”.
 */
export const ZRODLA_BEZ_REGIONU = new Set(['platformazakupowa', 'epropublico']);
export const SWIEZOSC_MAPY_DNI = 7;
/** Ile przetargów z nowo nadanym województwem przenosi je do kopii w jednym przebiegu (2 zapytania na przetarg). */
export const MAKS_KOPII_NA_PRZEBIEG = 300;

/** Przebudowa mapy i modelu z BZP: rozstrzygnięcia z `dni` (strony po 1000) + otwarte ogłoszenia BZP. */
export async function runMapaZamawiajacych({
  teraz = Date.now(), dni = 365, maksStron = 200, repoWynikow = rozstrzygniecia, przetargi = tenders, repoMap = mapaZamawiajacych, repoModelu = modelCpvTytulu,
} = {}) {
  const rekordy = [];
  const tytuly = [];
  let kursor = null;
  for (let i = 0; i < maksStron; i++) {
    const strona = await repoWynikow.strona({ od: new Date(teraz - dni * 86_400_000).toISOString().slice(0, 10), kursor, limit: 1000, pola: ['zamawiajacy', 'zamawiajacyNip', 'wojewodztwo', 'miasto', 'tytul', 'cpv'] });
    for (const r of strona.pozycje) {
      rekordy.push({ org: r.zamawiajacy, woj: r.wojewodztwo, miasto: r.miasto, nip: r.zamawiajacyNip });
      tytuly.push({ tytul: r.tytul, cpv: Array.isArray(r.cpv) ? r.cpv[0] : r.cpv });
    }
    if (strona.koniec || !strona.kursor) break;
    kursor = strona.kursor;
  }
  const otwarte = await przetargi.otwarteDoWojewodztwa(new Date(teraz).toISOString());
  for (const t of otwarte) {
    if (t.source !== 'bzp') continue;
    rekordy.push({ org: t.organization, woj: t.wojewodztwo, nip: t.zamawiajacy_nip });
    tytuly.push({ tytul: t.title, cpv: t.cpv_main });
  }
  const mapy = zbudujMapy(rekordy);
  await repoMap.zapisz(mapy, new Date(teraz).toISOString());
  const model = nauczModel(tytuly);
  await repoModelu.zapisz({ tekst: modelDoTekstu(model), dzialy: model.dzialy, n: model.n }, new Date(teraz).toISOString());
  const wynik = { rekordow: rekordy.length, nazw: mapy.poNazwie.size, nipow: mapy.poNazwieNip.size, miast: mapy.poMiescie.size, miejscownikow: mapy.poMiejscowniku.size, tytulow: model.n, slow: Object.keys(model.slowa).length };
  logger.info(wynik, 'runMapaZamawiajacych: zakończono');
  return wynik;
}

/** Model z repozytorium do postaci, którą czyta `przewidzDzial` (albo null). */
export async function wczytajModelCpv(repoModelu = modelCpvTytulu) {
  const dane = await repoModelu.wczytaj().catch(() => null);
  return dane?.n ? modelZTekstu(dane.tekst, dane.dzialy, dane.n) : null;
}

/** Województwo i dział CPV dla otwartych przetargów PZ/ePP bez nich. Mapa starsza niż tydzień → przebudowa najpierw. */
export async function runWojewodztwaZamawiajacych({
  teraz = Date.now(), przetargi = tenders, repoMap = mapaZamawiajacych, repoModelu = modelCpvTytulu, przebuduj = runMapaZamawiajacych,
} = {}) {
  let mapy = await repoMap.wczytaj().catch(() => null);
  const stara = !mapy?.zbudowano_o || teraz - Date.parse(mapy.zbudowano_o) > SWIEZOSC_MAPY_DNI * 86_400_000;
  let przebudowa = null;
  if (stara) {
    przebudowa = await przebuduj({ teraz });
    mapy = await repoMap.wczytaj({ swiezoscMs: 0 });
  }
  const model = await wczytajModelCpv(repoModelu);
  const wynik = { ok: true, przebudowa, kandydaci: 0, przypisane: 0, dzialy: 0, nipy: 0, bledy: 0 };
  if (!mapy) return { ...wynik, ok: false };
  const otwarte = await przetargi.otwarteDoWojewodztwa(new Date(teraz).toISOString());
  const doZapisu = [];
  for (const t of otwarte) {
    if (!ZRODLA_BEZ_REGIONU.has(t.source)) continue;
    const kod = t.wojewodztwo ? null : wojewodztwoZNazwy(t.organization, mapy);
    const dzial = !t.cpv_main && !t.cpv_dzial_z_tytulu && model ? przewidzDzial(t.title, model)?.dzial ?? null : null;
    const nip = t.zamawiajacy_nip ? null : nipZNazwy(t.organization, mapy);
    if (!t.wojewodztwo) wynik.kandydaci += 1;
    if (kod) wynik.przypisane += 1;
    if (dzial) wynik.dzialy += 1;
    if (nip) wynik.nipy += 1;
    if (kod || dzial || nip) doZapisu.push({ id: t.id, ...(kod ? { wojewodztwo: `PL${kod}` } : {}), ...(dzial ? { cpvDzial: dzial } : {}), ...(nip ? { zamawiajacyNip: nip } : {}) });
  }
  try {
    await przetargi.ustawWojewodztwaZNazwy(doZapisu);
    // Kopie powstałe, zanim przetarg miał województwo (1.11 było ich 110 na 32 kontach) — karta listy czyta kopię.
    // Nowe pozycje list dostają województwo przy wczytaniu, więc tu zwykle zostaje garść; sufit na przebieg.
    wynik.kopie = 0;
    for (const z of doZapisu.filter((x) => x.wojewodztwo).slice(0, MAKS_KOPII_NA_PRZEBIEG)) {
      wynik.kopie += await przetargi.wojewodztwoDoKopii(z.id, z.wojewodztwo);
    }
  } catch (err) {
    wynik.bledy += 1;
    logger.warn({ err: err.message, ile: doZapisu.length }, 'Województwo/dział z nazwy: zapis nie powiódł się');
  }
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runWojewodztwaZamawiajacych: zakończono');
  return wynik;
}

/** Przy wczytywaniu listy PZ/ePP: województwo z nazwy i dział z tytułu dla nowej pozycji (mapa i model raz na przebieg). */
export function wojewodztwoNowejPozycji(t, mapy, model = null) {
  if (!t) return t;
  let wynik = t;
  if (!t.wojewodztwo && mapy) {
    const kod = wojewodztwoZNazwy(t.organization, mapy);
    if (kod) wynik = { ...wynik, wojewodztwo: `PL${kod}`, wojewodztwo_z_nazwy: true };
  }
  if (!t.zamawiajacy_nip && mapy) {
    const nip = nipZNazwy(t.organization, mapy);
    if (nip) wynik = { ...wynik, zamawiajacy_nip: nip, zamawiajacy_nip_z_nazwy: true };
  }
  if (!t.cpvMain && model) {
    const dzial = przewidzDzial(t.title, model)?.dzial;
    if (dzial) wynik = { ...wynik, cpv_dzial_z_tytulu: dzial };
  }
  return wynik;
}
