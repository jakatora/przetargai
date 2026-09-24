import { kodWojewodztwa } from './wojewodztwa.js';

/**
 * Tryb „Wszystkie" na głównej liście (P1-3) — czysta logika stanu.
 *
 * Feed „Dla mnie" pokazuje WYCINEK rynku: to, co silnik uznał za pasujące do
 * profilu, w granicach dziennego limitu planu. Tryb „Wszystkie" pokazuje rynek
 * bez tego filtra. Dwa tryby oznaczają dwa niezależne stany listy — i dlatego
 * wszystko, co da się policzyć bez Reacta, liczy się tutaj.
 *
 * Zero importów z React Native: ten plik ma być testowalny zwykłym node:test.
 */

export const TRYBY = [
  { wartosc: 'dlamnie', etykieta: { pl: 'Dla mnie', en: 'For me' } },
  { wartosc: 'wszystkie', etykieta: { pl: 'Wszystkie', en: 'All' } },
];

export const TRYB_DOMYSLNY = 'dlamnie';

/** Klucze magazynu — tryb i filtry przeżywają restart aplikacji. */
export const KLUCZ_TRYBU = 'przetargai.lista_tryb';
export const KLUCZ_FILTROW = 'przetargai.katalog_filtry';

export const SORTOWANIA = ['najnowsze', 'termin'];
export const STATUSY_TERMINU = ['aktywne', 'poterminie', 'wszystkie'];
export const ZRODLA = ['bzp', 'ted', 'baza_konkurencyjnosci'];

/**
 * Domyślny zestaw filtrów katalogu.
 *
 * Jedyne zawężenie to `termin: 'aktywne'` — postępowanie po terminie nie jest
 * ofertą, tylko historią. Wszystko inne jest puste, bo tryb „Wszystkie", który
 * startuje z założonym filtrem, przestaje być „wszystkie".
 */
export const FILTRY_DOMYSLNE = Object.freeze({
  zrodlo: null,
  region: null,
  cpv: '',
  q: '',
  sort: 'najnowsze',
  termin: 'aktywne',
  wartosc_min: '',
  wartosc_max: '',
});

export function normalizujTryb(surowy) {
  return TRYBY.some((t) => t.wartosc === surowy) ? surowy : TRYB_DOMYSLNY;
}

const liczbaTekstem = (w) => {
  if (w === null || w === undefined || w === '') return '';
  const n = Number(String(w).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
};

/**
 * Odtwarza zestaw filtrów pole po polu.
 *
 * Magazyn lokalny przeżywa aktualizacje aplikacji, więc może zawierać zapis
 * ze starej wersji albo — po nieudanym zapisie — zwykłe śmieci. Nieznane pola
 * nie wchodzą do stanu, a nierozpoznane wartości wracają do domyślnych.
 */
export function normalizujFiltry(surowe) {
  const f = surowe && typeof surowe === 'object' ? surowe : {};
  return {
    zrodlo: ZRODLA.includes(f.zrodlo) ? f.zrodlo : null,
    region: kodWojewodztwa(f.region),
    cpv: f.cpv ? String(f.cpv).replace(/\D/g, '').slice(0, 8) : '',
    q: typeof f.q === 'string' ? f.q.slice(0, 120) : '',
    sort: SORTOWANIA.includes(f.sort) ? f.sort : FILTRY_DOMYSLNE.sort,
    termin: STATUSY_TERMINU.includes(f.termin) ? f.termin : FILTRY_DOMYSLNE.termin,
    wartosc_min: liczbaTekstem(f.wartosc_min),
    wartosc_max: liczbaTekstem(f.wartosc_max),
  };
}

/**
 * Parametry do `GET /tenders`. Puste pole NIE idzie do zapytania — inaczej
 * backend dostawałby `cpv=` i musiał zgadywać, czy to filtr, czy jego brak.
 */
export function parametryZapytania(filtry) {
  const f = normalizujFiltry(filtry);
  const parametry = { sort: f.sort, termin: f.termin };
  if (f.zrodlo) parametry.zrodlo = f.zrodlo;
  if (f.region) parametry.region = f.region;
  if (f.cpv) parametry.cpv = f.cpv;
  const fraza = f.q.trim();
  if (fraza) parametry.q = fraza;
  if (f.wartosc_min) parametry.wartosc_min = f.wartosc_min;
  if (f.wartosc_max) parametry.wartosc_max = f.wartosc_max;
  return parametry;
}

/** Pola, których ustawienie użytkownik widzi jako „założony filtr". */
const POLA_FILTROW = ['zrodlo', 'region', 'cpv', 'q', 'termin', 'wartosc_min', 'wartosc_max'];

/**
 * Ile filtrów jest założonych — do plakietki przy przycisku „Filtry".
 * Sortowanie się nie liczy: ono zmienia kolejność, nie zbiór wyników.
 */
export function liczbaAktywnychFiltrow(filtry) {
  const f = normalizujFiltry(filtry);
  return POLA_FILTROW.filter((pole) => {
    const wartosc = f[pole];
    if (pole === 'termin') return wartosc !== FILTRY_DOMYSLNE.termin;
    return wartosc !== null && wartosc !== '';
  }).length;
}

/**
 * Dokleja kolejną stronę, nie dublując pozycji.
 *
 * Odświeżenie źródła między stronami potrafi przesunąć wyniki tak, że ten sam
 * przetarg wraca na następnej stronie. Klucz listy w Reakcie musi być unikalny,
 * więc duplikat nie jest kosmetyką — to ostrzeżenie i pogubione elementy.
 * Kolejność zostaje SERWEROWA: sortowanie jest jego decyzją, nie naszą.
 */
export function scalStrone(poprzednie, nowe) {
  const widziane = new Set((poprzednie ?? []).map((t) => t.id));
  const wynik = [...(poprzednie ?? [])];
  for (const t of nowe ?? []) {
    if (t?.id && widziane.has(t.id)) continue;
    if (t?.id) widziane.add(t.id);
    wynik.push(t);
  }
  return wynik;
}

/** Pustka z założonym filtrem ma inne wyjście niż pustka bez niego. */
export function opisPustki(filtry) {
  if (liczbaAktywnychFiltrow(filtry) > 0) {
    return {
      pl: 'Żaden przetarg nie spełnia ustawionych filtrów. Zdejmij filtr albo poszerz zakres — na przykład zmień status terminu na „Wszystkie terminy".',
      en: 'No tender matches the filters you set. Remove a filter or widen the range — for instance switch the deadline status to “Any deadline”.',
    };
  }
  return {
    pl: 'Nie mamy w tej chwili żadnego ogłoszenia z otwartym terminem. Sprawdź „Zakres danych" w Koncie — zobaczysz tam, kiedy każdy rejestr ostatnio odpowiedział.',
    en: 'We currently hold no notice with an open deadline. Check “Data coverage” in Account — it shows when each register last responded.',
  };
}

/** Polska odmiana rzeczownika po liczbie: 1 przetarg, 2-4 przetargi, 5+ przetargów. */
function odmienPrzetargi(n) {
  const setki = n % 100;
  if (setki >= 12 && setki <= 14) return 'przetargów';
  const jednosci = n % 10;
  if (n === 1) return 'przetarg';
  if (jednosci >= 2 && jednosci <= 4) return 'przetargi';
  return 'przetargów';
}

/**
 * Licznik nad listą. Gdy backend nie wyczerpał danych, mówimy „co najmniej" —
 * liczba pobranych pozycji NIE jest liczbą przetargów na rynku i udawanie,
 * że jest, byłoby fałszywym pomiarem rynku.
 */
export function etykietaLicznika({ ile, wyczerpano }) {
  if (!ile) return null;
  if (wyczerpano) {
    return {
      pl: `${ile} ${odmienPrzetargi(ile)}`,
      en: `${ile} ${ile === 1 ? 'tender' : 'tenders'}`,
    };
  }
  return {
    pl: `co najmniej ${ile} ${odmienPrzetargi(ile)}`,
    en: `at least ${ile} ${ile === 1 ? 'tender' : 'tenders'}`,
  };
}

/**
 * Czy zmiana filtrów unieważnia kursor. Backend odrzuca kursor z innego zestawu
 * filtrów błędem 400, więc aplikacja musi wiedzieć o tym PRZED wysłaniem.
 */
export function czyResetowacKursor(stare, nowe) {
  const a = parametryZapytania(stare);
  const b = parametryZapytania(nowe);
  return JSON.stringify(a) !== JSON.stringify(b);
}
