/**
 * Kalkulator terminów Pzp — liczy datę graniczną „N dni od zdarzenia" z uwzględnieniem
 * polskich dni wolnych (soboty, niedziele, święta stałe i ruchome wg Wielkanocy).
 *
 * Silnik dni wolnych (Wielkanoc Gaussa/Meeusa, święta, art. 115 KC) jest współdzielony
 * z `terminKio.js` — jedno źródło prawdy o kalendarzu, przetestowane w terminKio.test.js.
 *
 * Podstawa liczenia:
 *  - dni KALENDARZOWE (domyślnie): art. 111 § 2 KC — dnia zdarzenia NIE liczymy, bieg
 *    zaczyna się następnego dnia (koniec = zdarzenie + N dni); art. 115 KC — jeśli koniec
 *    wypada w sobotę/niedzielę/dzień ustawowo wolny, termin upływa najbliższego dnia roboczego.
 *  - dni ROBOCZE: liczymy wyłącznie dni robocze, zaczynając od dnia po zdarzeniu
 *    (soboty/niedziele/święta pomijamy, nie licząc ich do N).
 *
 * Cała arytmetyka w UTC (dni kalendarzowe, nie chwile) — wynik niezależny od strefy.
 */

import { naDzienUTC, formatujDate, czyDzienWolny, MS_DZIEN } from './terminKio.js';

export const TRYBY = [
  { wartosc: 'kalendarzowe', etykieta: 'Dni kalendarzowe' },
  { wartosc: 'robocze', etykieta: 'Dni robocze' },
];

/** Częste terminy Pzp — prefill jednym dotknięciem (dni + tryb liczenia). */
export const SZABLONY = [
  { klucz: 'kio5', etykieta: 'Odwołanie KIO — 5 dni (poniżej progów UE, elektronicznie)', dni: 5, tryb: 'kalendarzowe' },
  { klucz: 'kio10', etykieta: 'Odwołanie KIO — 10 dni (powyżej progów UE elektronicznie / poniżej pisemnie)', dni: 10, tryb: 'kalendarzowe' },
  { klucz: 'kio15', etykieta: 'Odwołanie KIO — 15 dni (powyżej progów UE, pisemnie)', dni: 15, tryb: 'kalendarzowe' },
];

const DNI_TYG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/**
 * @param {{dataZdarzenia: string|Date, dni: number|string, tryb?: 'kalendarzowe'|'robocze'}} wejscie
 * @returns {{ok: false, powod: 'brak_daty'|'zla_liczba'} |
 *   {ok: true, tryb: string, data: string, dzienTygodnia: string, przesuniety: boolean,
 *    dniPrzesuniecia?: number, dataSurowa?: string, dniWolnePominiete?: number}}
 */
export function obliczTermin({ dataZdarzenia, dni, tryb = 'kalendarzowe' } = {}) {
  const startMs = naDzienUTC(dataZdarzenia);
  if (startMs === null) return { ok: false, powod: 'brak_daty' };
  const n = Number(dni);
  if (!Number.isInteger(n) || n < 1) return { ok: false, powod: 'zla_liczba' };

  if (tryb === 'robocze') {
    let ms = startMs;
    let policzone = 0;
    let dniWolnePominiete = 0;
    while (policzone < n) {
      ms += MS_DZIEN;
      if (czyDzienWolny(ms)) dniWolnePominiete++;
      else policzone++;
    }
    return {
      ok: true,
      tryb: 'robocze',
      data: formatujDate(ms),
      dzienTygodnia: DNI_TYG[new Date(ms).getUTCDay()],
      przesuniety: false,
      dniWolnePominiete,
    };
  }

  // kalendarzowe (art. 111 § 2 + art. 115 KC)
  const surowyMs = startMs + n * MS_DZIEN;
  let ms = surowyMs;
  while (czyDzienWolny(ms)) ms += MS_DZIEN;
  const dniPrzesuniecia = Math.round((ms - surowyMs) / MS_DZIEN);
  return {
    ok: true,
    tryb: 'kalendarzowe',
    data: formatujDate(ms),
    dataSurowa: formatujDate(surowyMs),
    dzienTygodnia: DNI_TYG[new Date(ms).getUTCDay()],
    przesuniety: dniPrzesuniecia > 0,
    dniPrzesuniecia,
  };
}
