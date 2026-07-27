/**
 * „BANK REFERENCJI Z DATĄ WAŻNOŚCI DOŚWIADCZENIA" — czysta logika bez importów z React
 * Native (testowalna `node:test`). Ekran `BankReferencjiScreen` tylko renderuje to, co tu
 * policzone, a kolor dokłada przez motyw.js na podstawie semantycznego `ton`.
 *
 * PROBLEM: wykonawca odpada z przetargu nie przez cenę, tylko przez warunek udziału —
 * nie wie, że jego doświadczenie ma „termin przydatności" i orientuje się w dniu składania
 * oferty, że kluczowa robota sprzed 6 lat już się nie liczy.
 *
 * PODSTAWA PRAWNA (okres liczenia doświadczenia — rozporządzenie w sprawie podmiotowych
 * środków dowodowych, wydane na podst. art. 128 ust. 6 Pzp):
 *   • roboty budowlane — wykonane nie wcześniej niż w okresie ostatnich 5 lat przed upływem
 *     terminu składania ofert,
 *   • dostawy i usługi — w okresie ostatnich 3 lat.
 * Zamawiający MOŻE ten okres wydłużyć „w celu zapewnienia konkurencji", ale nie skrócić —
 * więc 5/3 lata to najkrótsze, bezpieczne okno; liczymy do niego (zawyżenie ważności byłoby
 * groźne — lepiej ostrzec za wcześnie).
 *
 * Referencja „przestaje się liczyć" w dniu: dataZakończenia + okno (5/3 lata). Po tej dacie
 * dla nowego przetargu doświadczenia nie wolno już wykazać tą robotą.
 */

import { naDzienUTC, dodajLata, roznicaDni, dzisiajUTC, odmianaDni } from './dataUtc.js';

/** Rodzaje doświadczenia i długość okna liczenia (lata). */
export const RODZAJE = Object.freeze({
  roboty: { etykieta: 'Roboty budowlane', lata: 5 },
  dostawy: { etykieta: 'Dostawy', lata: 3 },
  uslugi: { etykieta: 'Usługi', lata: 3 },
});

/** Ile dni przed końcem okna zaczynamy ostrzegać, że doświadczenie zaraz przestanie się liczyć. */
export const PROG_WYGASA_DNI = 180;

/**
 * Okno liczenia (lata) dla rodzaju. Nieznany rodzaj → 3 lata (krótsze, bezpieczniejsze —
 * ostrzeżemy wcześniej, niż gdyby okazało się dostawą/usługą).
 * @param {string} rodzaj
 * @returns {number}
 */
export function oknoLat(rodzaj) {
  return RODZAJE[rodzaj]?.lata ?? 3;
}

/**
 * Data, do której referencja jeszcze się liczy (dataZakończenia + okno lat), jako ms UTC albo
 * null gdy brak/zła data zakończenia.
 * @param {string|Date} dataZakonczenia
 * @param {string} rodzaj
 * @returns {number|null}
 */
export function dataWaznosciMs(dataZakonczenia, rodzaj) {
  const koniec = naDzienUTC(dataZakonczenia);
  if (koniec === null) return null;
  return dodajLata(koniec, oknoLat(rodzaj));
}

export const STATUSY = Object.freeze({
  wazna: { etykieta: 'Aktualne', ton: 'sukces' },
  wygasa: { etykieta: 'Wkrótce nieaktualne', ton: 'ostrzezenie' },
  wygasla: { etykieta: 'Już się nie liczy', ton: 'danger' },
  nieznana: { etykieta: 'Uzupełnij datę', ton: 'neutral' },
});

/**
 * Status ważności jednej referencji względem „dziś" (czas wstrzykiwany).
 * @param {{dataZakonczenia?: string, rodzaj?: string}} ref
 * @param {number} teraz Date.now()-podobny znacznik (do wstrzyknięcia w teście)
 * @returns {{status: string, ton: string, dni: number|null, dataWaznosci: number|null}}
 */
export function statusReferencji(ref = {}, teraz = Date.now()) {
  const dataWaznosci = dataWaznosciMs(ref.dataZakonczenia, ref.rodzaj);
  if (dataWaznosci === null) {
    return { status: 'nieznana', ton: STATUSY.nieznana.ton, dni: null, dataWaznosci: null };
  }
  const dni = roznicaDni(dzisiajUTC(teraz), dataWaznosci);
  let status;
  if (dni < 0) status = 'wygasla';
  else if (dni <= PROG_WYGASA_DNI) status = 'wygasa';
  else status = 'wazna';
  return { status, ton: STATUSY[status].ton, dni, dataWaznosci };
}

/** Ludzki opis licznika ważności (badge/podpis). */
export function etykietaWaznosci({ status, dni } = {}) {
  if (status === 'nieznana' || dni === null || dni === undefined) {
    return 'Uzupełnij datę zakończenia';
  }
  if (status === 'wygasla') {
    const n = Math.abs(dni);
    return `Już się nie liczy (${n} ${odmianaDni(n)} po oknie)`;
  }
  if (status === 'wygasa') {
    if (dni === 0) return 'Przestaje się liczyć dziś';
    return `Przestanie się liczyć za ${dni} ${odmianaDni(dni)}`;
  }
  return 'Doświadczenie aktualne';
}

/** Kolejność listy: najpierw „wkrótce nieaktualne" (działaj teraz), potem aktualne, braki, na końcu wygasłe. */
const PRIORYTET = { wygasa: 0, wazna: 1, nieznana: 2, wygasla: 3 };

/**
 * Sortuje referencje wg pilności (nie mutuje wejścia). W obrębie statusu — wg dni rosnąco
 * (najbliższy koniec okna pierwszy).
 * @param {Array} lista referencje
 * @param {number} teraz
 * @returns {Array} nowa, posortowana lista z doklejonym polem `_ocena` (status/ton/dni/dataWaznosci)
 */
export function sortujReferencje(lista, teraz = Date.now()) {
  const wzbogacone = (Array.isArray(lista) ? lista : []).map((r) => ({
    ...r,
    _ocena: statusReferencji(r, teraz),
  }));
  return wzbogacone.sort((a, b) => {
    const pa = PRIORYTET[a._ocena.status] ?? 9;
    const pb = PRIORYTET[b._ocena.status] ?? 9;
    if (pa !== pb) return pa - pb;
    const da = a._ocena.dni ?? Number.POSITIVE_INFINITY;
    const db = b._ocena.dni ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/**
 * Czy zgromadzone referencje spełniają warunek udziału z SWZ. Liczy tylko doświadczenie
 * AKTUALNE na dzień składania oferty (`teraz`) — wygasłe się nie liczy.
 * @param {Array} referencje
 * @param {{rodzaj?: string, minWartosc?: number, minLiczba?: number}} warunek
 * @param {number} teraz
 * @returns {{spelnia: boolean, maja: number, potrzeba: number, brakuje: number}}
 */
export function sprawdzWarunek(referencje, warunek = {}, teraz = Date.now()) {
  const potrzeba = Math.max(1, Math.trunc(warunek.minLiczba ?? 1));
  const minWartosc = Number(warunek.minWartosc) || 0;
  const rodzaj = warunek.rodzaj;
  const maja = (Array.isArray(referencje) ? referencje : []).filter((r) => {
    if (rodzaj && r.rodzaj !== rodzaj) return false;
    if (minWartosc > 0 && !(Number(r.wartosc) >= minWartosc)) return false;
    const s = statusReferencji(r, teraz).status;
    return s === 'wazna' || s === 'wygasa'; // aktualne (także tuż przed końcem okna)
  }).length;
  return { spelnia: maja >= potrzeba, maja, potrzeba, brakuje: Math.max(0, potrzeba - maja) };
}
