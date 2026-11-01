import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders } from '../db/repos.js';
import { pobierzDokumenty, idPostepowaniaEz } from '../services/eZamowieniaDokumenty.js';
import { rodzajDokumentu } from '../lib/noweDokumenty.js';
import { parsujOtwarcie, scalOtwarcie } from '../lib/otwarcieOfert.js';
import { liniePdf } from '../services/tekstPdf.js';
import { pobierzPdfBase64 } from './autoAnalizaSwz.js';

/*
 * INFORMACJA Z OTWARCIA OFERT DLA CAŁEGO RYNKU (2026-11-01). Monitoring dokumentów czyta ją tylko dla
 * przetargów z Zapisanych i czołówki feedu. Tu — dla każdego przetargu BZP/TED prowadzonego na e-Zamówieniach,
 * dzień–trzy po terminie ofert: kwota, którą zamawiający przeznaczył, liczba ofert i rozpiętość cen. Obie
 * strony są BRUTTO, więc „najniższa oferta / budżet” to uczciwa miara tego, jak nisko schodzą ceny w branży
 * (czego z ogłoszeń o wyniku policzyć się nie da: wartość szacunkowa jest netto). Z tego powstaje
 * benchmark „ile dać” na karcie startu.
 *
 * Koszt: jedno publiczne żądanie listy plików + PDF (≤ 5 MB) na przetarg, ZERO AI. Każdy przetarg najwyżej
 * `MAKS_PROB` razy, nie częściej niż co `ODSTEP_PROB_H` (informacja bywa publikowana dzień po otwarciu).
 */
export const OKNO_OD_H = 72;
export const OKNO_DO_H = 6;
export const MAKS_PROB = 3;
export const ODSTEP_PROB_H = 16;

async function czytajOtwarcieDomyslnie(dok) {
  const linie = await liniePdf(Buffer.from(await pobierzPdfBase64(dok.url), 'base64'));
  return parsujOtwarcie(Array.isArray(linie) ? linie : []);
}

/** Czy przetarg jest do (ponownej) próby: e-Zamówienia, bez liczby ofert, limit prób i odstęp. */
export function doProby(t, teraz) {
  if (!idPostepowaniaEz(t)) return false;
  if (Number.isFinite(t.otwarcie_ofert?.oferty)) return false;
  const p = t.otwarcie_rynek;
  if ((p?.proby ?? 0) >= MAKS_PROB) return false;
  return !p?.o || teraz - Date.parse(p.o) >= ODSTEP_PROB_H * 3_600_000;
}

export async function runOtwarcieRynku({
  teraz = Date.now(), limit = 220, budzetMs = 420_000, przetargi = tenders,
  pobierz = pobierzDokumenty, czytajOtwarcie = czytajOtwarcieDomyslnie,
} = {}) {
  const start = Date.now();
  const wynik = { ok: true, kandydaci: 0, sprawdzone: 0, z_plikami: 0, odczytane: 0, z_ofertami: 0, kopie: 0, bledy_platformy: 0, bledy: 0 };
  const od = new Date(teraz - OKNO_OD_H * 3_600_000).toISOString();
  const doIso = new Date(teraz - OKNO_DO_H * 3_600_000).toISOString();
  const kandydaci = (await przetargi.doOtwarciaRynku(od, doIso))
    .filter((t) => doProby(t, teraz))
    // Najpierw te, które jeszcze nie miały próby, potem najstarszy termin.
    .sort((a, b) => (a.otwarcie_rynek?.proby ?? 0) - (b.otwarcie_rynek?.proby ?? 0) || String(a.deadline).localeCompare(String(b.deadline)));
  wynik.kandydaci = kandydaci.length;

  for (const t of kandydaci.slice(0, limit)) {
    if (Date.now() - start > budzetMs) break;
    const proba = { proby: (t.otwarcie_rynek?.proby ?? 0) + 1, o: nowIso(), pliki: 0 };
    let dokumenty;
    try {
      dokumenty = await pobierz(idPostepowaniaEz(t));
    } catch (err) {
      wynik.bledy_platformy += 1;
      logger.warn({ err: err.message, tenderId: t.id }, 'Otwarcie rynku: e-Zamówienia nie odpowiedziały');
      continue;
    }
    try {
      wynik.sprawdzone += 1;
      proba.pliki = dokumenty.length;
      if (dokumenty.length) wynik.z_plikami += 1;
      const przeczytane = new Set(t.otwarcie_ofert?.przeczytane ?? []);
      let otwarcie = t.otwarcie_ofert ?? null;
      let czytano = false;
      for (const d of dokumenty.filter((x) => rodzajDokumentu(x) === 'otwarcie' && x.rozszerzenie === 'pdf' && !przeczytane.has(x.id)).slice(0, 2)) {
        const odczyt = await czytajOtwarcie(d).catch((err) => {
          logger.warn({ err: err.message, tenderId: t.id, dokument: d.id }, 'Otwarcie rynku: nie odczytano PDF-a');
          return null;
        });
        otwarcie = scalOtwarcie(otwarcie, odczyt, d);
        czytano = true;
        if (odczyt) wynik.odczytane += 1;
      }
      if (Number.isFinite(otwarcie?.oferty)) wynik.z_ofertami += 1;
      wynik.kopie += await przetargi.zapiszOtwarcieRynku(t.id, { otwarcie: czytano ? otwarcie : null, poprzednie: t.otwarcie_ofert ?? null, proba });
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, tenderId: t.id }, 'Otwarcie rynku: przetarg pominięty');
    }
  }
  wynik.ok = wynik.bledy === 0;
  wynik.durationMs = Date.now() - start;
  logger.info(wynik, 'runOtwarcieRynku: zakończono');
  return wynik;
}
