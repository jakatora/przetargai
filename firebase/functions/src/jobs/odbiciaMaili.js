import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { podsumujMaile, czasMaila, odbiciaZaWysokie } from '../lib/odbiciaMaili.js';
import { odbiteAdresy, stanOdbic } from '../db/repos.js';

/*
 * ODBICIA MAILI co 6 h (2026-11-07, lib/odbiciaMaili.js): lista wysłanych maili z Resend (GET /emails, od najnowszych,
 * po 100) z ostatnich `godzin` → odbite adresy do `odbite_adresy` (`sendEmail` ich pomija) i odsetek odbić z doby
 * do `_health/maile_odbicia` (`/health.maile`, strażnik zdrowia).
 */
const API = 'https://api.resend.com/emails';
export const NA_STRONE = 100;
export const MAKS_STRON = 20;

async function pobierzStrone({ after, fetchFn, klucz }) {
  const url = `${API}?limit=${NA_STRONE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${klucz}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Resend GET /emails odpowiedział ${res.status}`);
  return res.json();
}

export async function runOdbiciaMaili({
  teraz = nowIso(), godzin = 48, fetchFn = fetch, klucz = env.RESEND_API_KEY, maksStron = MAKS_STRON,
  adresy = odbiteAdresy, stan = stanOdbic,
} = {}) {
  const wynik = { ok: true, zakonczony_o: teraz, godzin, maili: 0, strony: 0, odbite_adresy: 0, nowe_adresy: 0, maili_24h: 0, odbite_24h: 0, odsetek: null, error: null };
  if (!klucz) return { ...wynik, ok: false, error: 'brak RESEND_API_KEY' };
  const granica = Date.parse(teraz) - godzin * 3_600_000;
  const maile = [];
  try {
    let after = null;
    for (let i = 0; i < maksStron; i++) {
      const strona = await pobierzStrone({ after, fetchFn, klucz });
      const dane = Array.isArray(strona?.data) ? strona.data : [];
      wynik.strony++;
      maile.push(...dane);
      const ostatni = dane.at(-1);
      // Lista idzie od najnowszych — koniec okna albo listy kończy odczyt.
      if (!strona?.has_more || !ostatni || czasMaila(ostatni) < granica) break;
      after = ostatni.id;
    }
  } catch (err) {
    wynik.ok = false;
    wynik.error = err.message;
  }
  const wOknie = maile.filter((m) => !(czasMaila(m) < granica));
  const podsumowanie = podsumujMaile(wOknie, { teraz });
  Object.assign(wynik, {
    maili: wOknie.length, odbite_adresy: podsumowanie.adresy.size,
    maili_24h: podsumowanie.maili24h, odbite_24h: podsumowanie.odbite24h,
    odsetek: podsumowanie.odsetek === null ? null : Math.round(podsumowanie.odsetek * 1000) / 1000,
  });
  if (podsumowanie.adresy.size) {
    try {
      wynik.nowe_adresy = await adresy.zapisz(podsumowanie.adresy, teraz);
    } catch (err) {
      wynik.ok = false;
      wynik.error = `zapis odbitych: ${err.message}`;
    }
  }
  wynik.za_wysokie = odbiciaZaWysokie(wynik);
  await stan.zapiszPrzebieg(wynik).catch((err) => logger.error({ err: err.message }, 'odbiciaMaili: nie zapisano śladu'));
  logger.info(wynik, 'odbiciaMaili: zakończono');
  return wynik;
}
