import { BENCHMARK_WARTOSCI, ZRODLO_BENCHMARKU } from './wartosciBenchmarkDane.js';
import { kodWojewodztwa } from './wojewodztwa.js';

/**
 * Orientacyjna wartość zamówienia z historycznych KWOT KONTRAKTÓW (ogłoszenia wynikowe
 * BZP/TED 2024–2025), per DZIAŁ CPV (2 cyfry) × województwo. BZP nie podaje wartości przy
 * ogłoszeniu przetargu — to statystyczny benchmark, który tę lukę wypełnia.
 *
 * Świadomie NIE zwracamy jednej liczby jako „wartości TEGO przetargu" (to byłoby zgadywanie
 * i groziło zaniżeniem oferty), tylko WIDEŁKI P25–mediana–P75 dla podobnych zamówień, z
 * jawną etykietą „orientacyjnie". Cała logika czysta i testowalna; dane z modułu offline.
 */

export { ZRODLO_BENCHMARKU };

/** Dział CPV = dwie pierwsze cyfry pierwszego kodu CPV (np. „45233120-0" → „45"). */
export function dzialCpv(cpv) {
  if (!cpv) return null;
  const m = String(cpv).match(/\d{2}/);
  return m ? m[0] : null;
}

/**
 * Orientacyjna wartość wg działu CPV i województwa.
 * Preferuje dane REGIONALNE (gdy jest grupa dla województwa), inaczej krajowe dla działu CPV.
 * @returns {{p25:number, mediana:number, p75:number, n:number, poziom:'wojewodztwo'|'kraj'}|null}
 */
export function orientacyjnaWartosc(cpv, wojewodztwo) {
  const dz = dzialCpv(cpv);
  if (!dz) return null;
  const wpis = BENCHMARK_WARTOSCI[dz];
  if (!wpis) return null;

  const kod = kodWojewodztwa(wojewodztwo);
  const reg = kod && wpis.w ? wpis.w[kod] : null;
  const zrodlo = reg || wpis.k;
  if (!zrodlo) return null;

  const [p25, mediana, p75, n] = zrodlo;
  return { p25, mediana, p75, n, poziom: reg ? 'wojewodztwo' : 'kraj' };
}
