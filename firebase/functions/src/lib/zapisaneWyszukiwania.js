import { createHash } from 'node:crypto';
import { normalizujFiltry as normalizujFiltryKatalogu, ZRODLA } from './katalogPrzetargow.js';
import { nazwaWojewodztwa } from './wojewodztwa.js';

/*
 * ZAPISANE WYSZUKIWANIA trybu „Wszystkie" (etap 5) — CZYSTA logika.
 *
 * Katalog pokazuje rynek TERAZ. Zapisane wyszukiwanie zamienia jedno spojrzenie
 * na listę w stałą obserwację: „powiedz mi, gdy pojawi się coś takiego". To jest
 * obietnica złożona użytkownikowi i cały ten plik pilnuje dwóch sposobów, na jakie
 * dałoby się ją złamać.
 *
 * 1. FILTRY MUSZĄ ZNACZYĆ TO SAMO, CO W KATALOGU. Gdyby zapis przechodził przez
 *    własny normalizator, alert obejmowałby inny zbiór niż lista, z której został
 *    zapisany — a użytkownik nie miałby jak tej rozbieżności zobaczyć. Dlatego
 *    normalizacja jest DELEGOWANA do `katalogPrzetargow.normalizujFiltry`, a nie
 *    powtórzona tutaj.
 *
 * 2. ALERT MUSI MIEĆ HAMULEC. Powiadomienie przy każdym przebiegu harmonogramu to
 *    nie monitoring, tylko spam — a jego realnym skutkiem jest wyłączenie push dla
 *    CAŁEJ aplikacji, czyli utrata także przypomnień o terminach. Stąd minimalny
 *    odstęp wynikający z częstotliwości, limit liczby obserwacji i odrzucanie
 *    duplikatów.
 *
 * Zero I/O, zero `Date.now()` — czas zawsze wstrzykiwany.
 */

/**
 * Jak często sprawdzamy dane wyszukiwanie.
 *
 * `minutyMin` to MINIMALNY odstęp między sprawdzeniami, nie obietnica punktualności:
 * harmonogram budzi się co 2 h, więc „godzinowa" znaczy „nie częściej niż raz na
 * godzinę", a realnie co drugą. Nazwanie tego inaczej byłoby obietnicą, której
 * nośnik (Cloud Scheduler) nie może dotrzymać.
 */
export const CZESTOTLIWOSCI = [
  {
    kod: 'godzinowa',
    etykieta: { pl: 'Na bieżąco', en: 'As it happens' },
    opis: {
      pl: 'Sprawdzamy przy każdym przebiegu monitoringu — nie częściej niż raz na godzinę.',
      en: 'Checked on every monitoring run — no more often than once an hour.',
    },
    minutyMin: 60,
  },
  {
    kod: 'dzienna',
    etykieta: { pl: 'Raz dziennie', en: 'Once a day' },
    opis: {
      pl: 'Jedno zbiorcze powiadomienie na dobę.',
      en: 'One combined notification per day.',
    },
    minutyMin: 24 * 60,
  },
  {
    kod: 'tygodniowa',
    etykieta: { pl: 'Raz w tygodniu', en: 'Once a week' },
    opis: {
      pl: 'Jedno zbiorcze powiadomienie na tydzień.',
      en: 'One combined notification per week.',
    },
    minutyMin: 7 * 24 * 60,
  },
];

export const CZESTOTLIWOSC_DOMYSLNA = 'dzienna';

const PO_KODZIE = new Map(CZESTOTLIWOSCI.map((c) => [c.kod, c]));

/**
 * Limity antyspamowe.
 *
 * Liczba obserwacji i liczba WŁĄCZONYCH alertów to dwa różne limity, bo to dwa
 * różne koszty: pierwszy to miejsce w bazie, drugi to powiadomienia w telefonie
 * użytkownika i odczyty przy każdym przebiegu harmonogramu. Zapisać wolno więcej,
 * niż da się sensownie śledzić.
 */
export const MAKS_WYSZUKIWAN = 20;
export const MAKS_ALERTOW = 10;
export const MAKS_DLUGOSC_NAZWY = 60;

/**
 * Ile trafień wymieniamy z nazwy w jednym powiadomieniu. Reszta idzie jako
 * „i jeszcze N" — push z trzydziestoma tytułami jest nie do przeczytania,
 * a centrum alertów i tak trzyma pełną listę.
 */
export const MAKS_TRAFIEN_W_ALERCIE = 5;

const MINUTA_MS = 60_000;

/** Nazwa nadana przez człowieka — przycięta, bez nadmiarowych białych znaków. */
export function normalizujNazwe(surowa) {
  if (typeof surowa !== 'string') return '';
  return surowa.replace(/\s+/g, ' ').trim().slice(0, MAKS_DLUGOSC_NAZWY);
}

const ETYKIETY_ZRODEL = new Map(ZRODLA.map((z) => [z.kod, z.etykieta]));

/**
 * Propozycja nazwy wyliczona z filtrów — do wstępnego wypełnienia pola na ekranie.
 *
 * Nazwa NIE jest wyprowadzana automatycznie przy zapisie: wyszukiwanie bez nazwy
 * jest odrzucane przez trasę. Lista dziesięciu pozycji „BZP · Małopolskie · CPV
 * 45000000" jest nie do odróżnienia okiem, a nazwa to jedyne, po czym użytkownik
 * pozna SWOJĄ obserwację. Aplikacja proponuje, człowiek nazywa.
 */
export function proponowanaNazwa(filtry = {}) {
  const f = filtry ?? {};
  const czesciPl = [];
  const czesciEn = [];

  const zrodlo = ETYKIETY_ZRODEL.get(f.zrodlo);
  if (zrodlo) { czesciPl.push(zrodlo.pl); czesciEn.push(zrodlo.en); }

  const region = nazwaWojewodztwa(f.region);
  if (region) { czesciPl.push(region); czesciEn.push(region); }

  if (f.cpv) { czesciPl.push(`CPV ${f.cpv}`); czesciEn.push(`CPV ${f.cpv}`); }

  const fraza = typeof f.q === 'string' ? f.q.trim() : '';
  if (fraza) { czesciPl.push(`„${fraza}"`); czesciEn.push(`“${fraza}”`); }

  if (f.wartosc_min !== null && f.wartosc_min !== undefined && f.wartosc_min !== '') {
    czesciPl.push(`od ${f.wartosc_min} zł`);
    czesciEn.push(`from ${f.wartosc_min} PLN`);
  }
  if (f.wartosc_max !== null && f.wartosc_max !== undefined && f.wartosc_max !== '') {
    czesciPl.push(`do ${f.wartosc_max} zł`);
    czesciEn.push(`up to ${f.wartosc_max} PLN`);
  }

  if (!czesciPl.length) return { pl: 'Wszystkie przetargi', en: 'All tenders' };

  return {
    pl: czesciPl.join(' · ').slice(0, MAKS_DLUGOSC_NAZWY),
    en: czesciEn.join(' · ').slice(0, MAKS_DLUGOSC_NAZWY),
  };
}

/**
 * Sprowadza wejście do zamrożonego kształtu zapisanego wyszukiwania.
 *
 * `limit` wypada ze zbioru filtrów świadomie: to rozmiar strony listy, a nie część
 * definicji „czego szukam". Zostawiony w środku zmieniałby odcisk i robił z dwóch
 * identycznych obserwacji dwie różne.
 */
export function normalizujWyszukiwanie(wejscie = {}) {
  const we = wejscie ?? {};
  const { limit, ...filtry } = normalizujFiltryKatalogu(we.filtry ?? {});

  return Object.freeze({
    nazwa: normalizujNazwe(we.nazwa),
    filtry: Object.freeze(filtry),
    // Tylko jawne `false` wyłącza alert: obserwacja bez powiadomienia jest zakładką,
    // a użytkownik, który zapisuje wyszukiwanie, chce być informowany.
    alert_wlaczony: we.alert_wlaczony === false ? false : true,
    czestotliwosc: PO_KODZIE.has(we.czestotliwosc) ? we.czestotliwosc : CZESTOTLIWOSC_DOMYSLNA,
  });
}

/**
 * Pola, które definiują ZBIÓR obserwowanych ogłoszeń.
 *
 * Świadomie WĘŻSZE niż odcisk kursora katalogu (`katalogPrzetargow.odciskFiltrow`),
 * bo pytanie jest inne. Kursor pyta „czy to ta sama STRONA tej samej listy" i musi
 * uwzględniać sortowanie. Tu pytamy „czy to ta sama OBSERWACJA" — a dwie obserwacje
 * różniące się wyłącznie kolejnością wyników przysyłałyby te same trafienia dwa razy.
 */
const POLA_ZBIORU = [
  'zrodlo', 'region', 'termin', 'cpv', 'q',
  'opublikowano_od', 'opublikowano_do', 'termin_od', 'termin_do',
  'wartosc_min', 'wartosc_max',
];

/** Odcisk ZBIORU wyników — klucz duplikatu i stabilny identyfikator obserwacji. */
export function odciskWyszukiwania(filtry) {
  const klucz = JSON.stringify(POLA_ZBIORU.map((p) => filtry?.[p] ?? null));
  return createHash('sha256').update(klucz).digest('base64url').slice(0, 12);
}

function odstepMs(czestotliwosc) {
  return (PO_KODZIE.get(czestotliwosc) ?? PO_KODZIE.get(CZESTOTLIWOSC_DOMYSLNA)).minutyMin * MINUTA_MS;
}

/**
 * Czy wyszukiwanie jest wymagalne w chwili `terazIso`.
 *
 * Nieczytelny albo brakujący znacznik ostatniego sprawdzenia znaczy „jeszcze nigdy",
 * a nie „nigdy więcej". Odwrotna interpretacja cicho uciszałaby obserwację na zawsze —
 * i to dokładnie tę, przy której coś poszło nie tak przy poprzednim zapisie.
 */
export function czyNalezySprawdzic(wpis, terazIso) {
  if (!wpis || wpis.alert_wlaczony === false) return false;

  const teraz = Date.parse(terazIso);
  if (!Number.isFinite(teraz)) return false;

  const ostatnio = Date.parse(wpis.ostatnio_sprawdzone_o ?? '');
  if (!Number.isFinite(ostatnio)) return true;

  return teraz - ostatnio >= odstepMs(wpis.czestotliwosc);
}

/** Kiedy NAJWCZEŚNIEJ wypada kolejne sprawdzenie (null = nigdy nie sprawdzano). */
export function nastepneSprawdzenie(wpis) {
  const ostatnio = Date.parse(wpis?.ostatnio_sprawdzone_o ?? '');
  if (!Number.isFinite(ostatnio)) return null;
  return new Date(ostatnio + odstepMs(wpis?.czestotliwosc)).toISOString();
}

const KOMUNIKATY = {
  limit_wyszukiwan: {
    pl: `Masz już ${MAKS_WYSZUKIWAN} zapisanych wyszukiwań — usuń jedno, żeby dodać nowe.`,
    en: `You already have ${MAKS_WYSZUKIWAN} saved searches — delete one to add another.`,
  },
  limit_alertow: {
    pl: `Alert może być włączony w maksymalnie ${MAKS_ALERTOW} wyszukiwaniach. Wyłącz alert w innym albo zapisz to wyszukiwanie bez powiadomień.`,
    en: `Alerts can be enabled for at most ${MAKS_ALERTOW} searches. Turn one off, or save this search without notifications.`,
  },
  duplikat: {
    pl: 'Masz już zapisane wyszukiwanie z dokładnie tymi filtrami — drugie przysyłałoby te same powiadomienia po raz drugi.',
    en: 'You already have a saved search with exactly these filters — a second one would deliver the same notifications twice.',
  },
};

/**
 * Bramka zapisu: limity i duplikat.
 *
 * `pomijanyId` wyłącza wpis edytowany z porównania — bez tego zapis wyszukiwania
 * z niezmienionymi filtrami (np. sama zmiana nazwy) byłby duplikatem samego siebie.
 *
 * @returns {{ok: true} | {ok: false, kod: string, komunikat: {pl: string, en: string}, istniejaceId?: string}}
 */
export function sprawdzLimity({ istniejace = [], odcisk, alertWlaczony = true, pomijanyId = null }) {
  const pozostale = pomijanyId ? istniejace.filter((w) => w?.id !== pomijanyId) : istniejace;

  const duplikat = pozostale.find((w) => w?.odcisk === odcisk);
  if (duplikat) {
    return { ok: false, kod: 'duplikat', komunikat: KOMUNIKATY.duplikat, istniejaceId: duplikat.id ?? null };
  }

  if (pozostale.length >= MAKS_WYSZUKIWAN) {
    return { ok: false, kod: 'limit_wyszukiwan', komunikat: KOMUNIKATY.limit_wyszukiwan };
  }

  if (alertWlaczony) {
    const zAlertem = pozostale.filter((w) => w?.alert_wlaczony === true).length;
    if (zAlertem >= MAKS_ALERTOW) {
      return { ok: false, kod: 'limit_alertow', komunikat: KOMUNIKATY.limit_alertow };
    }
  }

  return { ok: true };
}
