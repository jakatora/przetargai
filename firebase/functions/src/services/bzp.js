import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';
import { parsujWadium } from '../lib/wadium.js';
import { parsujKryterium, parsujCzesci } from '../lib/ogloszenieMeta.js';
import { stanTempa, pobierzZPonowieniem, TEMPO_DOMYSLNE } from '../lib/tempoZapytan.js';

/*
 * Klient publicznego API Biuletynu Zamówień Publicznych (e-Zamówienia).
 *
 * Zweryfikowany endpoint (2026-05): GET {BASE}/notice
 *   Wymagane parametry: NoticeType, PublicationDateFrom, PublicationDateTo,
 *                       PageSize, PageNumber (numeracja od 1).
 *   Odpowiedź: tablica JSON ogłoszeń.
 * Czytanie ogłoszeń krajowych BZP nie wymaga uwierzytelniania.
 * Szczegóły i diagnostyka: runbooks/bzp-api.md.
 */

const BASE = env.BZP_API_BASE_URL.replace(/\/+$/, '');
const SEARCH_PATH = env.BZP_SEARCH_PATH.startsWith('/')
  ? env.BZP_SEARCH_PATH
  : `/${env.BZP_SEARCH_PATH}`;

/*
 * 🚨 PAGINACJA BZP — zmierzone na żywo 2026-07-17 ([[reference_bzp_api_dane]]).
 * Nie zmieniaj tej strategii bez ponownego pomiaru:
 *  • `PageNumber` jest IGNOROWANY — 3 strony × PageSize=100 zwróciły IDENTYCZNE 100
 *    ogłoszeń. Pętla po stronach pobiera w kółko to samo.
 *  • `PageSize` sufit = 500 (1000 → HTTP 400).
 *  • BZP publikuje 400–500 ogłoszeń DZIENNIE — nawet okno 1-dniowe trafia sufit.
 *  • Daty przyjmują godziny, ale sufiks `Z` (UTC) zwraca ZERO wyników.
 *  • Z filtrów działa WYŁĄCZNIE `OrganizationProvince` (PL+TERYT). `OrderType`,
 *    `CpvCode`, `SearchText`, `SortingColumn` są ignorowane (zwracają to samo).
 *
 * Stąd jedyna poprawna strategia: pętla DZIEŃ PO DNIU; gdy dzień trafi sufit —
 * dociąć ten sam dzień po 16 województwach.
 */

/** Sufit `PageSize` w API BZP. Powyżej (1000) API zwraca HTTP 400. */
export const SUFIT_ZAPYTANIA = 500;

/**
 * Kody TERYT województw (NIE NUTS) — jedyny filtr, który BZP honoruje.
 * Służą do docięcia doby, która nie mieści się w sufitie jednego zapytania.
 */
export const WOJEWODZTWA_TERYT = [
  'PL02', 'PL04', 'PL06', 'PL08', 'PL10', 'PL12', 'PL14', 'PL16',
  'PL18', 'PL20', 'PL22', 'PL24', 'PL26', 'PL28', 'PL30', 'PL32',
];

/** Lista dni `YYYY-MM-DD` od `from` do `to` włącznie (czysta logika). */
export function dniWZakresie(from, to) {
  const dni = [];
  const koniec = new Date(`${dateOnly(to)}T00:00:00Z`).getTime();
  let biezacy = new Date(`${dateOnly(from)}T00:00:00Z`).getTime();
  while (biezacy <= koniec) {
    dni.push(new Date(biezacy).toISOString().slice(0, 10));
    biezacy += 86_400_000;
  }
  return dni;
}

function firstOf(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Normalizuje surowe ogłoszenie BZP do modelu wewnętrznego.
 * Mapowanie jest defensywne (obsługuje warianty nazw pól) — kontrakt API
 * e-Zamówienia bywa zmieniany; patrz runbooks/bzp-api.md.
 */
export function normalizeNotice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const externalId = firstOf(raw, [
    'bzpNumber', 'noticeNumber', 'number', 'noticeId', 'objectId', 'id',
  ]);
  if (!externalId) return null;

  // Surowe dane bez ogromnego pola htmlBody (oszczędność miejsca w bazie).
  // Zanim je odrzucimy, wyciągamy z niego to, co decyduje o starcie — np. wadium.
  const { htmlBody, ...rawLite } = raw;
  const wadium = parsujWadium(htmlBody);
  const kryterium = parsujKryterium(htmlBody);
  const liczbaCzesci = parsujCzesci(htmlBody);

  const tenderId = firstOf(raw, ['tenderId']);
  const url = firstOf(raw, ['htmlUrl', 'url', 'link', 'noticeUrl'])
    ?? (tenderId ? `https://ezamowienia.gov.pl/mp-client/search/list/${tenderId}` : null);

  return {
    externalId: String(externalId),
    title: String(firstOf(raw, ['orderObject', 'title', 'subject', 'name', 'orderName']) ?? 'Bez tytułu'),
    organization: firstOf(raw, ['organizationName', 'orderingEntityName', 'contractingAuthority', 'buyerName', 'institution']),
    cpvMain: firstOf(raw, ['cpvCode', 'mainCpv', 'cpv']),
    budget: toNumber(firstOf(raw, ['estimatedValue', 'orderValue', 'value', 'budget'])),
    currency: firstOf(raw, ['currency']) ?? 'PLN',
    // Normalizacja do UTC przy WEJŚCIU danych: cała baza porównuje daty
    // leksykograficznie, a BZP miesza formaty i strefy (lib/daty.js).
    deadline: doUtcIso(firstOf(raw, ['submittingOffersDate', 'offerDeadline', 'tenderSubmissionDeadline', 'deadline'])),
    publishedAt: doUtcIso(firstOf(raw, ['publicationDate', 'publishDate', 'noticeDate', 'createdDate'])),
    url,
    // Wadium wyciągnięte z htmlBody (D-056). Termin wniesienia = termin składania ofert.
    wadium_wymagane: wadium.wymagane,
    wadium_kwota: wadium.kwota,
    wadium_wiele_czesci: wadium.wieleCzesci ?? false,
    // Meta z htmlBody (rundy 5-6): kryterium oceny + liczba części.
    kryterium_oceny: kryterium,
    liczba_czesci: liczbaCzesci,
    // Wymiary do statystyk wyników (R17): rodzaj + województwo (PL+TERYT).
    rodzaj: firstOf(raw, ['orderType']),
    wojewodztwo: firstOf(raw, ['organizationProvince']),
    /*
     * NIP zamawiajacego — klucz benchmarku „u TEGO urzedu" (etap 6). Nazwa nie
     * nadaje sie na klucz: ta sama jednostka pisze sie raz „SAD REJONOWY
     * W RZESZOWIE", raz „Sad Rejonowy w Rzeszowie", wiec grupowanie po nazwie
     * rozbija jednego zamawiajacego na kilku i zaniza kazda probke.
     */
    zamawiajacy_nip: firstOf(raw, ['organizationNationalId']),
    /*
     * Identyfikator POSTEPOWANIA (ocds-…) — ten sam w ogloszeniu o zamowieniu
     * i w ogloszeniu o WYNIKU (etap 6). Bez niego rozstrzygniecie nie ma po czym
     * trafic do przetargu w bazie: numer BZP wyniku jest INNY niz numer ogloszenia
     * o zamowieniu. Zmierzone: pole obecne w 3974/3974 ogloszen o zamowieniu
     * i 200/200 wynikow.
     */
    postepowanie_id: tenderId ? String(tenderId) : null,
    raw: rawLite,
  };
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  return data?.content ?? data?.items ?? data?.notices ?? data?.results ?? data?.data ?? [];
}

/*
 * Tempo, ponawianie i backoff mieszkają we WSPÓLNEJ bibliotece lib/tempoZapytan.js —
 * ta sama wiedza (m.in. „403 to dławienie, nie trwały błąd") obowiązuje każde źródło.
 * Re-eksport zostaje, bo testy odporności BZP celują w tę nazwę, a strategia
 * docinania doby jest specyficzna dla BZP i musi móc podmienić tempo.
 */
export { TEMPO_DOMYSLNE };

/**
 * Pobiera ogłoszenia o przetargach z publicznego API BZP.
 * @param {{publishedFrom?: string, publishedTo?: string, page?: number, size?: number}} opts
 *   page — numeracja od 0 (przeliczana na PageNumber API od 1).
 * @returns {Promise<Array>} znormalizowane ogłoszenia
 */
export async function searchNotices({ publishedFrom, publishedTo, page = 0, size = 50, province, licznik, tempo } = {}) {
  const to = publishedTo ?? dateOnly(Date.now());
  const from = publishedFrom
    ?? dateOnly(Date.now() - env.BZP_LOOKBACK_DAYS * 86_400_000);

  const url = new URL(BASE + SEARCH_PATH);
  url.searchParams.set('NoticeType', env.BZP_NOTICE_TYPE);
  url.searchParams.set('PublicationDateFrom', from);
  url.searchParams.set('PublicationDateTo', to);
  url.searchParams.set('PageSize', String(size));
  url.searchParams.set('PageNumber', String(page + 1)); // API BZP numeruje strony od 1
  // Jedyny filtr, który BZP realnie honoruje — służy do docięcia doby na sufitie.
  if (province) url.searchParams.set('OrganizationProvince', province);

  logger.info({ from, to, page: page + 1, size, province }, 'BZP: pobieranie ogłoszeń');
  const res = await pobierzZPonowieniem(url, tempo ?? stanTempa(), { zrodlo: 'BZP' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BZP API odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const surowe = extractList(data);
  const notices = surowe.map(normalizeNotice).filter(Boolean);

  // Akumulator pomiarów okna (lib/licznikZrodla.js) — bez niego nie da się
  // zrekonsyliować liczby w bazie z liczbą po stronie BZP.
  if (licznik) {
    licznik.zapytania += 1;
    licznik.surowe += surowe.length;
    licznik.odrzucone += surowe.length - notices.length;
  }

  /*
   * Wczesne ostrzeżenie o zmianie schematu BZP. `normalizeNotice` jest wyrozumiały:
   * brak tytułu daje „Bez tytułu", brak identyfikatora — odrzucenie ogłoszenia.
   * Gdyby BZP przemianowało pola, feed po cichu wypełniłby się bezużytecznymi
   * wpisami, a heurystyka przestałaby cokolwiek trafiać. Lepiej krzyknąć w logu.
   */
  const odrzucone = surowe.length - notices.length;
  const bezTytulu = notices.filter((n) => n.title === 'Bez tytułu').length;
  const bezCpv = notices.filter((n) => !n.cpvMain).length;

  if (notices.length && (bezTytulu / notices.length > 0.5 || bezCpv / notices.length > 0.9)) {
    logger.error({ pobrane: notices.length, bezTytulu, bezCpv },
      'BZP: podejrzenie ZMIANY SCHEMATU — większość ogłoszeń bez tytułu lub bez CPV');
  }
  if (odrzucone > 0) {
    logger.warn({ odrzucone, surowe: surowe.length }, 'BZP: ogłoszenia bez identyfikatora pominięte');
  }

  logger.info({ count: notices.length }, 'BZP: pobrano ogłoszenia');
  return notices;
}

/** Okno jednej doby. Bez sufiksu `Z` — UTC zwraca z BZP zero wyników. */
function oknoDoby(dzien) {
  return { publishedFrom: `${dzien}T00:00:00`, publishedTo: `${dzien}T23:59:59` };
}

/**
 * Pobiera jedną dobę. Gdy doba trafi sufit (500 = prawie na pewno są dalsze
 * ogłoszenia, których API nie odda), docina ją po 16 województwach — to jedyny
 * filtr, który BZP honoruje, a `PageNumber` jest ignorowany, więc paginacja odpada.
 */
async function pobierzDzien(dzien, licznik, tempo) {
  const okno = oknoDoby(dzien);
  let zapytania = 0;
  const zapytaj = async (dodatkowe = {}) => {
    await tempo.przedZapytaniem();
    zapytania += 1;
    return searchNotices({ ...okno, size: SUFIT_ZAPYTANIA, licznik, tempo, ...dodatkowe });
  };

  const zDnia = await zapytaj();
  if (zDnia.length < SUFIT_ZAPYTANIA) {
    return { ogloszenia: zDnia, ucietySufit: false, zapytania, wojewodztwaBezDanych: 0 };
  }

  logger.warn({ dzien, pobrane: zDnia.length },
    'BZP: doba trafiła sufit zapytania — docinam po województwach, inaczej zgubilibyśmy resztę dnia');

  // Seedujemy PIERWSZĄ stroną (500), zanim dołożymy województwa. Bez tego ogłoszenia
  // BEZ poprawnego kodu TERYT (zagraniczny zamawiający / luka w danych) — których nie
  // zwróci żadne z 16 zapytań `OrganizationProvince` — przepadałyby na dniu z sufitem
  // (audyt 2026-07-17). Dedup po externalId i tak scala nakładki.
  const wynik = new Map(zDnia.map((n) => [n.externalId, n]));
  let wojewodztwaBezDanych = 0;
  for (const woj of WOJEWODZTWA_TERYT) {
    try {
      const zWoj = await zapytaj({ province: woj });
      for (const n of zWoj) wynik.set(n.externalId, n);
      if (zWoj.length >= SUFIT_ZAPYTANIA) {
        // Pojedyncze województwo na sufitie = nie mamy już czym ciąć (BZP nie ma
        // innego działającego filtra). Krzyczymy — to sygnał do cięcia po godzinach.
        logger.error({ dzien, woj, pobrane: zWoj.length },
          'BZP: województwo też trafiło sufit — część ogłoszeń tej doby jest NIEOSIĄGALNA tym filtrem');
      }
    } catch (err) {
      // Awaria jednego województwa nie może zabrać reszty doby, ale MUSI być policzona:
      // doba z brakującym województwem jest niekompletna i nie wolno jej zamknąć
      // w checkpoincie jako gotowej (P0-2).
      wojewodztwaBezDanych += 1;
      logger.error({ err: err.message, dzien, woj }, 'BZP: województwo pominięte');
    }
  }
  return { ogloszenia: [...wynik.values()], ucietySufit: true, zapytania, wojewodztwaBezDanych };
}

/**
 * Pobiera ogłoszenia z zakresu dni — DZIEŃ PO DNIU (patrz komentarz o paginacji
 * na górze pliku). Zastępuje jedno zapytanie na całe okno, które przy 400–500
 * ogłoszeniach dziennie gubiło ~85% zakresu `BZP_LOOKBACK_DAYS`.
 *
 * Awaria pojedynczego dnia nie przerywa całości — lepiej oddać 6 dni z 7 niż nic.
 *
 * @param {{from?: string, to?: string, licznik?: object}} [opts] domyślnie ostatnie
 *   `BZP_LOOKBACK_DAYS` dni; `licznik` to akumulator pomiarów (lib/licznikZrodla.js);
 *   `dobyOgloszen` — opcjonalna mapa externalId → doby, w których ogłoszenie przyszło
 *   (checkpoint okna zostawia otwarte doby ogłoszeń, których nie udało się zapisać)
 * @returns {Promise<object[]>} znormalizowane ogłoszenia, zdeduplikowane po `externalId`
 */
export async function pobierzOgloszeniaBzp({
  from, to, licznik, dni: dniWejscie, budzetMs = Infinity, tempo: tempoWejscie, dobyOgloszen = null,
} = {}) {
  const tempo = stanTempa(tempoWejscie);
  const doDnia = to ?? dateOnly(tempo.teraz());
  const odDnia = from ?? dateOnly(tempo.teraz() - env.BZP_LOOKBACK_DAYS * 86_400_000);
  const dni = dniWejscie ?? dniWZakresie(odDnia, doDnia);

  const start = tempo.teraz();
  const wszystkie = new Map();
  const raport = [];
  const pominieteDni = [];

  for (const [i, dzien] of dni.entries()) {
    /*
     * Budżet czasu. `dailyTenderFetch` ma twardy limit 540 s — przekroczenie go
     * oznacza, że platforma zabija funkcję w połowie pętli: ślad cyklu się nie
     * zapisuje, dopasowania się nie liczą, a następny przebieg zaczyna od zera.
     * Lepiej oddać 4 doby i JAWNIE powiedzieć, że 3 zostały, niż zginąć po cichu.
     */
    if (tempo.teraz() - start >= budzetMs) {
      pominieteDni.push(...dni.slice(i));
      logger.warn({ pominieteDni: pominieteDni.length, budzetMs },
        'BZP: budżet czasu wyczerpany — reszta okna zostaje na następny przebieg');
      break;
    }

    try {
      const doba = await pobierzDzien(dzien, licznik, tempo);
      for (const n of doba.ogloszenia) {
        wszystkie.set(n.externalId, n);
        if (dobyOgloszen) dobyOgloszen.set(n.externalId, [...(dobyOgloszen.get(n.externalId) ?? []), dzien]);
      }
      raport.push({
        dzien,
        pobrano: doba.ogloszenia.length,
        ucietySufit: doba.ucietySufit,
        zapytania: doba.zapytania,
        wojewodztwaBezDanych: doba.wojewodztwaBezDanych,
      });
    } catch (err) {
      // Awaria doby nie przerywa okna, ale MUSI wyjść na wierzch. Do 2026-09-24
      // była wyłącznie logowana, więc ślad cyklu pokazywał sukces przy oknie,
      // w którym brakowało kilku tysięcy ogłoszeń (P0-2).
      raport.push({
        dzien, pobrano: 0, ucietySufit: false, zapytania: 1, wojewodztwaBezDanych: 0, blad: err.message,
      });
      logger.error({ err: err.message, dzien }, 'BZP: dzień pominięty — reszta okna leci dalej');
    }
  }

  if (licznik) {
    licznik.dni = raport;
    licznik.pominieteDni = pominieteDni;
  }

  logger.info({
    dni: dni.length,
    przetworzone: raport.length,
    bledneDni: raport.filter((d) => d.blad).length,
    pominieteDni: pominieteDni.length,
    ogloszenia: wszystkie.size,
  }, 'BZP: zakończono pobieranie dzień po dniu');
  return [...wszystkie.values()];
}

/* ======================= WYNIKI POSTĘPOWAŃ (runda 16) ======================= */
/*
 * Osobna ścieżka pobierania `TenderResultNotice` — SUROWE ogłoszenia z `htmlBody`
 * (parser wyników go potrzebuje). Świadomie NIE reużywa pobierzDzien/searchNotices,
 * bo te normalizują i odrzucają htmlBody. Obowiązuje TA SAMA pułapka paginacji co
 * wyżej (PageNumber ignorowany, sufit 500, docinanie po województwach) — przy zmianie
 * strategii zaktualizować OBA miejsca.
 */

/*
 * 🚨 NAZWY PÓL OKNA: `publishedFrom` / `publishedTo` — te same, co oddaje `oknoDoby`
 * i przyjmuje `searchNotices`.
 *
 * Wcześniej ta funkcja nazywała je `from` / `to`, a wołający robił
 * `zapytanieSurowe({ ...oknoDoby(dzien) })` — czyli przekazywał `publishedFrom`
 * i `publishedTo` do parametrów, których tu nie było. Do URL-a trafiało dosłowne
 * `PublicationDateFrom=undefined`, a BZP odpowiadało HTTP 500 z komunikatem
 * „The string 'undefined' was not recognized as a valid DateTime".
 *
 * Skutek: pobieranie WYNIKÓW postępowań z BZP nie działało ANI RAZU od rundy 16.
 * Nie było tego widać, bo job agregacji łapie błąd per doba, liczy statystyki
 * z pustej listy i kończy się `ok: true` — czyli „sukces" z zerem danych.
 * Test jednostkowy tego nie łapał, bo wstrzykiwał własny pobieracz doby.
 * Stąd `zbudujUrlWynikow` jest WYEKSPORTOWANY i pilnowany osobnym testem: adres
 * musi nieść prawdziwe daty, a nie cokolwiek, co da się skleić w string.
 */
export function zbudujUrlWynikow({ noticeType, publishedFrom, publishedTo, size = SUFIT_ZAPYTANIA, province }) {
  if (!publishedFrom || !publishedTo) {
    throw new Error(`BZP ${noticeType}: brak okna czasu (publishedFrom/publishedTo)`);
  }
  const url = new URL(BASE + SEARCH_PATH);
  url.searchParams.set('NoticeType', noticeType);
  url.searchParams.set('PublicationDateFrom', publishedFrom);
  url.searchParams.set('PublicationDateTo', publishedTo);
  url.searchParams.set('PageSize', String(size));
  if (province) url.searchParams.set('OrganizationProvince', province);
  return url;
}

async function zapytanieSurowe({ noticeType, publishedFrom, publishedTo, size = SUFIT_ZAPYTANIA, province }) {
  const url = zbudujUrlWynikow({ noticeType, publishedFrom, publishedTo, size, province });
  const res = await pobierzZPonowieniem(url, stanTempa(), { zrodlo: 'BZP' });
  if (!res.ok) throw new Error(`BZP ${noticeType} odpowiedziało ${res.status}`);
  return extractList(await res.json());
}

const idSurowego = (n) => String(n?.bzpNumber ?? n?.noticeNumber ?? n?.objectId ?? '');

/**
 * Czy ogłoszenie należy do żądanej doby.
 *
 * 🚨 ZMIERZONE NA ŻYWO (2026-09-24): filtr `OrganizationProvince` IGNORUJE górną
 * granicę okna czasu. Zapytanie o dobę 2026-09-23 z `province=PL14` oddało 127
 * ogłoszeń, z czego **11 opublikowano 2026-09-24**; na całej dobie było to 104 na 668.
 * Bez odsiania doba „23 września" niosła 564 ogłoszenia z 23-go i 104 z 24-go, więc
 * kolejna doba zapisywała te same dokumenty po raz drugi: licznik przebiegu kłamał
 * o połowę w górę, a rachunek za zapisy rósł o tyle samo.
 *
 * Odsiewanie niczego nie gubi: ogłoszenie spoza doby zostanie pobrane przy SWOJEJ
 * dobie (dzisiejsza nigdy nie jest domykana, a doby zamknięte były pobrane w całości).
 * Ogłoszenie bez daty publikacji zostaje — lepiej zapisać je raz za dużo niż stracić.
 */
export function czyZDoby(notice, dzien) {
  const data = notice?.publicationDate;
  if (!data) return true;
  return String(data).slice(0, 10) === dzien;
}

/** Jedna doba surowych ogłoszeń o wyniku, z docinaniem po województwach na suficie. */
export async function pobierzSuroweWynikiDnia(dzien) {
  const okno = oknoDoby(dzien);
  const zDnia = await zapytanieSurowe({ noticeType: 'TenderResultNotice', ...okno });
  if (zDnia.length < SUFIT_ZAPYTANIA) return zDnia.filter((n) => czyZDoby(n, dzien));

  const mapa = new Map(zDnia.map((n) => [idSurowego(n), n]));
  for (const woj of WOJEWODZTWA_TERYT) {
    try {
      const zWoj = await zapytanieSurowe({ noticeType: 'TenderResultNotice', ...okno, province: woj });
      for (const n of zWoj) mapa.set(idSurowego(n), n);
    } catch (err) {
      logger.error({ err: err.message, dzien, woj }, 'BZP wyniki: województwo pominięte');
    }
  }
  const zebrane = [...mapa.values()];
  const wDobie = zebrane.filter((n) => czyZDoby(n, dzien));
  if (wDobie.length !== zebrane.length) {
    logger.info({ dzien, zebrane: zebrane.length, wDobie: wDobie.length },
      'BZP wyniki: odsiano ogłoszenia spoza doby (filtr województwa ignoruje górną granicę okna)');
  }
  return wDobie;
}
