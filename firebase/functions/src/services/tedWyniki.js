import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { kodWojewodztwaZNuts } from '../lib/nuts.js';

/*
 * Rozstrzygnięcia z TED — drugie źródło statystyk wygrywalności.
 *
 * DLACZEGO: statystyki cen i konkurencji liczą się dziś WYŁĄCZNIE z BZP, czyli
 * z rynku PONIŻEJ progów unijnych. Największe kontrakty — te, w których firma
 * najczęściej pyta „czy w ogóle mam szanse" — były w nich niewidoczne.
 * Zmierzona objętość (read-only, 2026-09-24): 3 427 polskich ogłoszeń o wyniku
 * w oknie od 2026-09-01, 6 851 od 2026-08-01.
 *
 * Typy formularzy zweryfikowane na żywo: `form-type = result` → `can-standard`
 * (rozstrzygnięcie), `form-type = cont-modif` → `can-modif` (zmiana umowy).
 * `chan` NIE ISTNIEJE.
 *
 * ── 🚨 TRZY PUŁAPKI ZMIERZONE NA 250 OGŁOSZENIACH (2026-09-24) ───────────────
 *
 * 1. TABLICE PÓL NIE SĄ WYRÓWNANE MIĘDZY SOBĄ. Długość równa liczbie części
 *    (`result-lot-identifier`) ma tylko: winner-name 162/250, winner-size
 *    113/250, tender-value 168/250, contract-conclusion-date 166/250.
 *    Ogłoszenie 659988-2026: 14 części, 14 nazw zwycięzców, ale 7 rozmiarów
 *    firm. Zipowanie po indeksie przypisałoby firmie cudzy rozmiar — czyli
 *    fałszywy sygnał „u tego zamawiającego wygrywają mali".
 *    → Zipujemy WYŁĄCZNIE pola o długości równej liczbie części. Reszta jest
 *      pomijana; pola jednoelementowe trafiają na poziom ogłoszenia.
 *
 * 2. `received-submissions-type-code` ma ZMIENNĄ KOLEJNOŚĆ kodów między
 *    ogłoszeniami (`tenders,t-esubm,…` vs `t-esubm,t-oth-eea,…`), więc czytanie
 *    po pozycji daje losowe liczby. Pary `code[i]` ↔ `val[i]` są za to spójne
 *    w 250/250. Kody powtarzają się per część, ale długość dzieli się przez
 *    liczbę części tylko w 208/250 → tam, gdzie się nie dzieli, liczba ofert
 *    per część zostaje `null`, a nie zgadnięta.
 *
 * 3. `buyer-country-sub` to NUTS, nie TERYT — obsługiwany osobnym słownikiem
 *    (lib/nuts.js). Wspólny normalizator z `PL426` zrobiłby świętokrzyskie.
 *
 * Wyjście ma ten sam kształt, co `lib/wynikiParser.js` (BZP), żeby benchmark
 * liczył się z obu rejestrów jednym kodem.
 */

/** Pola eForms pobierane dla rozstrzygnięcia. Błędna nazwa = HTTP 400 z pełną listą. */
const POLA_WYNIKU = [
  'publication-number', 'notice-type', 'procedure-identifier',
  'title-proc', 'buyer-name', 'buyer-country-sub',
  'classification-cpv', 'publication-date', 'contract-nature-main-lot',
  'result-lot-identifier', 'winner-name', 'winner-size', 'winner-decision-date',
  'tender-value', 'tender-value-cur', 'tender-value-lowest', 'tender-value-highest',
  'estimated-value-lot', 'result-value-notice',
  'received-submissions-type-code', 'received-submissions-type-val',
  'non-award-justification', 'contract-conclusion-date',
];

/** Pola eForms pobierane dla ZMIANY UMOWY (`can-modif`). */
const POLA_MODYFIKACJI = [
  'publication-number', 'notice-type', 'procedure-identifier',
  'title-proc', 'buyer-name', 'buyer-country-sub', 'publication-date',
  'classification-cpv', 'result-lot-identifier', 'contract-identifier',
  'tender-value', 'tender-value-cur', 'result-value-notice',
  'modification-previous-notice-identifier', 'modification-reason-description',
];

/**
 * Rodzaj zamówienia w słowniku BZP — inaczej rozstrzygnięcia z TED wpadłyby do
 * INNYCH kubełków statystyki niż rozstrzygnięcia z BZP i benchmark liczyłby dwa
 * rozłączne rynki zamiast jednego. Zmierzone: pole obecne w 200/200 ogłoszeń
 * i zawsze równe liczbie części.
 */
const RODZAJ_TED_NA_BZP = { works: 'Works', supplies: 'Delivery', services: 'Services' };

/** Znacznik unieważnienia po stronie TED — `no-rece` = nie złożono żadnej oferty. */
const BRAK_ROZSTRZYGNIECIA = 'non-award-justification';

function tablica(wartosc) {
  if (Array.isArray(wartosc)) return wartosc;
  if (wartosc === null || wartosc === undefined) return [];
  return [wartosc];
}

/** Wartości z obiektu wielojęzycznego TED — polski przed innymi, zawsze jako tablica. */
function poPolskuLista(wielojezyczne) {
  if (!wielojezyczne || typeof wielojezyczne !== 'object') return tablica(wielojezyczne);
  return tablica(wielojezyczne.pol ?? Object.values(wielojezyczne)[0]);
}

function pierwszyTekst(wielojezyczne) {
  const lista = poPolskuLista(wielojezyczne);
  return lista.length ? String(lista[0]) : null;
}

function liczba(wartosc) {
  if (wartosc === null || wartosc === undefined || wartosc === '') return null;
  const n = Number(String(wartosc).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function data(wartosc) {
  if (typeof wartosc !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(wartosc);
  return m ? m[1] : null;
}

/**
 * Wartość pola dla części `i` — TYLKO gdy tablica jest wyrównana do liczby części.
 *
 * To jest cała obrona przed pułapką 1: gdy długości się nie zgadzają, oddajemy
 * `null`, a nie „coś, co pasuje kształtem". Dane, które nie wiadomo do kogo
 * należą, są gorsze niż ich brak.
 */
function wyrownane(lista, czesci, indeks) {
  const t = tablica(lista);
  return t.length === czesci ? (t[indeks] ?? null) : null;
}

/**
 * Liczba ofert dla części z par `code[i]` ↔ `val[i]`.
 *
 * Kody powtarzają się blokiem per część, więc bierzemy `k = kody/części` sztuk
 * od pozycji `i*k`. Gdy podział nie wychodzi równo (42/250 ogłoszeń), oddajemy
 * `null` — liczba ofert zgadnięta z cudzej części zafałszowałaby „ilu masz
 * konkurentów", czyli dokładnie to, po co ktoś tu przychodzi.
 */
export function ofertyCzesci(notice, czesci, indeks) {
  const kody = tablica(notice['received-submissions-type-code']).map(String);
  const wartosci = tablica(notice['received-submissions-type-val']);
  if (!kody.length || kody.length !== wartosci.length) return { liczbaOfert: null, liczbaOfertMsp: null };
  if (czesci <= 0 || kody.length % czesci !== 0) return { liczbaOfert: null, liczbaOfertMsp: null };

  const naCzesc = kody.length / czesci;
  const od = indeks * naCzesc;
  const pary = new Map();
  for (let i = od; i < od + naCzesc; i++) pary.set(kody[i], liczba(wartosci[i]));

  return {
    liczbaOfert: pary.get('tenders') ?? null,
    liczbaOfertMsp: pary.get('t-sme') ?? null,
  };
}

/**
 * Ogłoszenie o wyniku z TED → znormalizowane rozstrzygnięcie (kształt `parsujWynik`).
 * @returns {object|null} null, gdy brakuje numeru publikacji
 */
export function mapujWynikTed(notice) {
  const numer = notice?.['publication-number'];
  if (!numer) return null;

  const identyfikatory = tablica(notice['result-lot-identifier']);
  const liczbaCzesci = identyfikatory.length;
  const zwyciezcy = poPolskuLista(notice['winner-name']);
  const waluta = tablica(notice['tender-value-cur'])[0] ?? 'PLN';
  const rodzajeCzesci = tablica(notice['contract-nature-main-lot']);

  const czesci = identyfikatory.map((identyfikator, i) => {
    const cenaWybrana = liczba(wyrownane(notice['tender-value'], liczbaCzesci, i));
    const uzasadnienieBraku = wyrownane(notice[BRAK_ROZSTRZYGNIECIA], liczbaCzesci, i);
    const uniewaznione = Boolean(uzasadnienieBraku);
    const nazwa = liczbaCzesci === zwyciezcy.length ? (zwyciezcy[i] ?? null) : null;
    const wielkosc = wyrownane(notice['winner-size'], liczbaCzesci, i);

    return {
      numer: i + 1,
      identyfikator: String(identyfikator),
      rozstrzygniecie: uniewaznione ? 'uniewaznienie' : (nazwa || cenaWybrana !== null ? 'umowa' : null),
      uniewaznione,
      powodBraku: uzasadnienieBraku ? String(uzasadnienieBraku) : null,
      cenaNajnizsza: liczba(wyrownane(notice['tender-value-lowest'], liczbaCzesci, i)),
      cenaNajwyzsza: liczba(wyrownane(notice['tender-value-highest'], liczbaCzesci, i)),
      cenaWybrana,
      // TED podaje wartość szacunkową i cenę oferty w TEJ SAMEJ bazie (netto,
      // eForms), więc tu rabat względem kosztorysu JEST policzalny — inaczej
      // niż w BZP, gdzie 4.3 jest netto, a 6.4 zwykle brutto.
      wartoscSzacowanaNetto: liczba(wyrownane(notice['estimated-value-lot'], liczbaCzesci, i)),
      wartoscUmowy: cenaWybrana,
      pozycjaCeny: null, // TED nie podaje widełek konkursu w tej samej strukturze co BZP
      ...ofertyCzesci(notice, liczbaCzesci, i),
      liczbaOfertOdrzuconych: null,
      wielkoscWykonawcy: wielkosc ? String(wielkosc) : null,
      wygralMaly: wielkosc ? /^(micro|small)$/i.test(String(wielkosc)) : null,
      zwyciezca: uniewaznione || !nazwa ? null : { nazwa: String(nazwa), nip: null, miasto: null, wojewodztwo: null },
      dataUmowy: data(wyrownane(notice['contract-conclusion-date'], liczbaCzesci, i)),
      dataWyboru: data(wyrownane(notice['winner-decision-date'], liczbaCzesci, i)),
      rodzaj: RODZAJ_TED_NA_BZP[String(rodzajeCzesci[i] ?? '').toLowerCase()] ?? null,
      waluta: String(waluta),
      // TED nie daje widełek min/max per część, więc kontrola arytmetyki BZP
      // nie ma tu czego sprawdzać — cena pochodzi z jednego pola.
      spojne: true,
    };
  });

  const rodzajOgloszenia = RODZAJ_TED_NA_BZP[String(rodzajeCzesci[0] ?? '').toLowerCase()] ?? null;

  return {
    externalId: `ted:${numer}`,
    // `procedure-identifier` (BT-04) — ten sam identyfikator w ogłoszeniu
    // o zamówieniu i w ogłoszeniu o wyniku. Zmierzone: obecny w 100/100 wyników
    // i 250/250 ogłoszeń konkursowych; zapytanie `procedure-identifier = "…"`
    // zwraca obie publikacje (np. 331270-2026 cn-standard + 657221-2026 can-standard).
    tenderId: tablica(notice['procedure-identifier'])[0]
      ? String(tablica(notice['procedure-identifier'])[0])
      : null,
    zrodlo: 'ted',
    tytul: pierwszyTekst(notice['title-proc']),
    zamawiajacy: pierwszyTekst(notice['buyer-name']),
    zamawiajacyNip: null, // TED nie podaje NIP-u zamawiającego w tym zestawie pól
    cpv: [...new Set(tablica(notice['classification-cpv']).map(String))],
    wojewodztwo: kodWojewodztwaZNuts(tablica(notice['buyer-country-sub'])[0]),
    miasto: null,
    rodzaj: rodzajOgloszenia,
    opublikowano: data(notice['publication-date']),
    wartoscSzacowanaNetto: null, // per ogłoszenie TED nie podaje; wartości są per część
    wartoscRozstrzygniecia: liczba(notice['result-value-notice']),
    url: notice.links?.html?.POL ?? Object.values(notice.links?.html ?? {})[0] ?? null,
    czesci,
  };
}

/**
 * Ogłoszenie o ZMIANIE UMOWY (`can-modif`) → zdarzenie „umowa zmieniona".
 *
 * Po co: etap 5 ma już typ zmiany „umowa" w historii postępowania, ale nikt go
 * nie zasilał. Zmiana umowy mówi wykonawcy rzecz praktyczną — że u tego
 * zamawiającego zakres i wynagrodzenie bywają renegocjowane po podpisaniu.
 */
export function mapujModyfikacjeTed(notice) {
  const numer = notice?.['publication-number'];
  if (!numer) return null;

  const wartosci = tablica(notice['tender-value']).map(liczba).filter((n) => n !== null);
  return {
    externalId: `ted:${numer}`,
    tenderId: tablica(notice['procedure-identifier'])[0]
      ? String(tablica(notice['procedure-identifier'])[0])
      : null,
    zrodlo: 'ted',
    typ: 'modyfikacja_umowy',
    tytul: pierwszyTekst(notice['title-proc']),
    zamawiajacy: pierwszyTekst(notice['buyer-name']),
    wojewodztwo: kodWojewodztwaZNuts(tablica(notice['buyer-country-sub'])[0]),
    cpv: [...new Set(tablica(notice['classification-cpv']).map(String))],
    opublikowano: data(notice['publication-date']),
    // Ogłoszenie zmieniane — to ono wskazuje, którego postępowania dotyczy zmiana.
    ogloszeniePierwotne: tablica(notice['modification-previous-notice-identifier'])[0]
      ? String(tablica(notice['modification-previous-notice-identifier'])[0])
      : null,
    umowy: tablica(notice['contract-identifier']).map(String),
    wartoscPoZmianie: liczba(notice['result-value-notice']),
    wartosciCzesci: wartosci,
    uzasadnienie: pierwszyTekst(notice['modification-reason-description']),
    url: notice.links?.html?.POL ?? Object.values(notice.links?.html ?? {})[0] ?? null,
  };
}

function dataTed(isoDzien) {
  return String(isoDzien).slice(0, 10).replaceAll('-', '');
}

async function szukajTed({ formType, pola, odDnia, rozmiarStrony, maksStron, licznik, mapuj }) {
  /*
   * `SORT BY publication-date DESC` z tego samego powodu, co w ogłoszeniach
   * konkursowych: przy ucięciu na suficie tracimy NAJSTARSZE, nie najnowsze.
   */
  const query = `(place-of-performance IN (POL)) AND (publication-date >= ${dataTed(odDnia)}) AND (form-type = ${formType}) SORT BY publication-date DESC`;

  const zebrane = [];
  let total = Infinity;

  for (let page = 1; page <= maksStron && zebrane.length < total; page++) {
    const odpowiedz = await fetch(`${env.TED_API_BASE_URL}/v3/notices/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, fields: pola, page, limit: rozmiarStrony }),
    });
    if (!odpowiedz.ok) {
      throw new Error(`TED ${formType} odpowiedziało ${odpowiedz.status}: ${(await odpowiedz.text()).slice(0, 300)}`);
    }

    const dane = await odpowiedz.json();
    total = dane.totalNoticeCount ?? 0;
    const surowe = dane.notices ?? [];
    const strona = surowe.map(mapuj).filter(Boolean);

    if (licznik) {
      licznik.zapytania += 1;
      licznik.surowe += surowe.length;
      licznik.odrzucone += surowe.length - strona.length;
    }
    zebrane.push(...strona);
    if (surowe.length === 0) break; // pusta strona = koniec, nie pętla
  }

  if (zebrane.length < total) {
    logger.warn({ formType, zebrane: zebrane.length, total },
      'TED: sufit stron uciął pobieranie rozstrzygnięć');
  }
  return zebrane;
}

/**
 * Rozstrzygnięcia z TED z okna czasu.
 * @throws przy niedostępności API — izolację zapewnia rejestr źródeł w jobie.
 */
export async function pobierzWynikiTed({ odDnia, rozmiarStrony = 250, maksStron = 20, licznik } = {}) {
  return szukajTed({
    formType: 'result', pola: POLA_WYNIKU, odDnia, rozmiarStrony, maksStron, licznik,
    mapuj: mapujWynikTed,
  });
}

/** Zmiany umów z TED z okna czasu (`can-modif`). */
export async function pobierzModyfikacjeTed({ odDnia, rozmiarStrony = 250, maksStron = 5, licznik } = {}) {
  return szukajTed({
    formType: 'cont-modif', pola: POLA_MODYFIKACJI, odDnia, rozmiarStrony, maksStron, licznik,
    mapuj: mapujModyfikacjeTed,
  });
}
