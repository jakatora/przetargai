import { wyslijZLimitem, LIMIT_ODCZYTU_MS } from './zapytanieSieciowe.js';
import { normalizujNip } from './dokumentyOferty.js';

/*
 * „Wpisz NIP — resztę wstawimy": dane firmy z Białej listy podatników VAT
 * Ministerstwa Finansów (https://wl-api.mf.gov.pl). API jest publiczne, bez
 * klucza; po NIP zwraca nazwę, adres, REGON, KRS i status VAT — dokładnie to, co
 * trzeba przepisać do każdego oświadczenia w ofercie.
 *
 * Wołamy je PROSTO z telefonu (każde urządzenie = własny adres IP, limity MF
 * liczone są per IP), bez pośrednika na naszym backendzie. Czyste części
 * (adres zapytania, mapowanie, komunikaty) są testowane bez sieci; samo
 * pobieranie dostaje wstrzyknięty `fetchFn`.
 *
 * Granice: Biała lista zna tylko podatników VAT (czynnych i zwolnionych). Firma
 * spoza rejestru VAT dostanie „nie znaleziono" i wpisuje dane ręcznie — pola
 * i tak zostają edytowalne.
 */

const BAZA = 'https://wl-api.mf.gov.pl/api/search/nip';

/** Adres zapytania: sam NIP cyframi + data dzienna (MF wymaga parametru `date`). */
export function adresBialejListy(nip, dzisiaj) {
  const d = new Date(dzisiaj ?? Date.now());
  const data = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  return `${BAZA}/${normalizujNip(nip)}?date=${data.slice(0, 10)}`;
}

const tekst = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Odpowiedź MF → dane do formularza wykonawcy. `null`, gdy brak podmiotu.
 * Siedziba (`residenceAddress`) ma pierwszeństwo przed adresem działalności —
 * w oświadczeniach podaje się adres siedziby.
 */
export function mapujPodmiotBialejListy(json) {
  const s = json && typeof json === 'object' ? json.result?.subject : null;
  if (!s || typeof s !== 'object') return null;
  const krs = tekst(s.krs);
  const reprezentanci = (Array.isArray(s.representatives) ? s.representatives : [])
    .map((r) => [tekst(r?.firstName), tekst(r?.lastName)].filter(Boolean).join(' ') || tekst(r?.companyName))
    .filter(Boolean);
  return {
    nazwa: tekst(s.name) ?? '',
    nip: normalizujNip(s.nip),
    adres: tekst(s.residenceAddress) ?? tekst(s.workingAddress) ?? '',
    regon: tekst(s.regon) ?? '',
    rejestr: krs ? `KRS ${krs}` : 'CEIDG',
    statusVat: tekst(s.statusVat) ?? '',
    reprezentanci,
  };
}

const KOMUNIKATY_MF = Object.freeze({
  'WL-115': 'Biała lista odrzuciła NIP jako nieprawidłowy — sprawdź cyfry.',
  'WL-100': 'Biała lista: nieprawidłowe zapytanie.',
  'WL-101': 'Biała lista: nieprawidłowa data zapytania.',
  'WL-102': 'Biała lista: data zapytania z przyszłości.',
  'WL-103': 'Biała lista: data zapytania sprzed początku rejestru.',
  'WL-130': 'Biała lista: przekroczony limit zapytań — spróbuj za chwilę.',
});

/** Komunikat błędu z odpowiedzi MF (po polsku, bez surowych kodów dla użytkownika). */
export function komunikatBialejListy(json) {
  const kod = json && typeof json === 'object' ? json.code : null;
  return KOMUNIKATY_MF[kod] ?? 'Biała lista nie odpowiedziała poprawnie — wpisz dane ręcznie albo spróbuj później.';
}

/**
 * Pobiera dane firmy po NIP. Nigdy nie rzuca.
 * @returns {Promise<{dane: object|null, blad: string|null}>}
 */
export async function pobierzDanePoNip(nip, { fetchFn = fetch, dzisiaj } = {}) {
  const cyfry = normalizujNip(nip);
  if (!/^\d{10}$/.test(cyfry)) return { dane: null, blad: 'NIP ma 10 cyfr — uzupełnij, zanim pobierzesz dane.' };

  let res;
  try {
    res = await wyslijZLimitem(adresBialejListy(cyfry, dzisiaj), { method: 'GET', headers: { Accept: 'application/json' } }, { fetchFn, limitMs: LIMIT_ODCZYTU_MS, ponowienia: 1 });
  } catch {
    return { dane: null, blad: 'Brak połączenia z Białą listą — sprawdź internet i spróbuj ponownie.' };
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) return { dane: null, blad: komunikatBialejListy(json) };

  const dane = mapujPodmiotBialejListy(json);
  if (!dane) return { dane: null, blad: 'Nie znalazłem tego NIP na Białej liście VAT — wpisz dane ręcznie.' };
  return { dane, blad: null };
}
