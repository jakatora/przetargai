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

/**
 * Gdzie Twoja cena leży na tle rynku (widełki P25–mediana–P75 z rozstrzygnięć).
 * Dla kalkulatora ceny: zamiast samych liczb użytkownik dostaje słowo i ostrzeżenie.
 * Nie jest to „cena tego przetargu" — reguła jak na karcie: nie zaniżaj oferty.
 * @returns {{pozycja: 'ponizej_p25'|'ponizej_mediany'|'powyzej_mediany'|'powyzej_p75', ton: string, tekst: string, procentMediany: number}|null}
 */
export function pozycjaWzgledemRynku(kwota, rynek) {
  const k = Number(kwota);
  if (!rynek || !Number.isFinite(k) || k <= 0 || !Number.isFinite(rynek.mediana) || rynek.mediana <= 0) return null;
  const procentMediany = Math.round((k / rynek.mediana) * 100);
  if (k < rynek.p25) {
    return { pozycja: 'ponizej_p25', ton: 'ostrzezenie', procentMediany, tekst: `Poniżej 25 % rozstrzygnięć (${procentMediany} % mediany) — zamawiający może wezwać do wyjaśnień rażąco niskiej ceny (art. 224). Sprawdź, czy nic nie pominięto.` };
  }
  if (k <= rynek.mediana) {
    return { pozycja: 'ponizej_mediany', ton: 'sukces', procentMediany, tekst: `Poniżej mediany (${procentMediany} % mediany) — cenowo konkurencyjna, a wciąż w widełkach rynku.` };
  }
  if (k <= rynek.p75) {
    return { pozycja: 'powyzej_mediany', ton: 'neutral', procentMediany, tekst: `Powyżej mediany (${procentMediany} % mediany) — zarobisz, ale przy kryterium „cena 100 %" trudno wygrać.` };
  }
  return { pozycja: 'powyzej_p75', ton: 'ostrzezenie', procentMediany, tekst: `Powyżej 75 % rozstrzygnięć (${procentMediany} % mediany) — ceną raczej nie wygrasz; licz na kryteria jakościowe albo obniż koszty.` };
}
