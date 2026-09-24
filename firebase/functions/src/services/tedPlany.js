import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { parseCpvCodes, cpvDivisions } from '../lib/cpv.js';
import { kodWojewodztwaZNuts } from '../lib/nuts.js';
import { isValidNip } from '../lib/nip.js';

/*
 * TED — ogłoszenia PLANOWANIA (`form-type = planning`): wstępne ogłoszenia
 * informacyjne. Zasila Radar planów postępowań — jedyne źródło przewagi CZASOWEJ,
 * której nie da się kupić szybszym pollingiem: plan wyprzedza ogłoszenie o tygodnie
 * albo miesiące.
 *
 * Dlaczego TED, a nie plany z BZP (art. 23 Pzp): API BZP przyjmuje wyłącznie
 * ContractNotice i TenderResultNotice — 14 innych typów zwraca 400 (zmierzone
 * 2026-09-24). Plany BZP są dla nas niedostępne bez omijania regulaminu; mówi
 * o tym ekran „Zakres danych".
 *
 * Pomiar na żywym API (2026-09-24, Polska, 30 dni = 208 ogłoszeń):
 *   • future-notice (przewidywana data ogłoszenia) — 102/208,
 *   • wartość szacunkowa — 11/208, wyłącznie PLN,
 *   • buyer-identifier — 208/208, ale jako WOLNY TEKST („NIP: …, REGON: …",
 *     „NIP 701-007-37-77 Regon …", sam REGON) → `wyciagnijNip` z sumą kontrolną,
 *   • procedure-identifier — 0/208 (plan nie ma jeszcze postępowania).
 */

const POLA = [
  'publication-number',
  'notice-type',
  'title-proc',
  'description-proc',
  'buyer-name',
  'buyer-identifier',
  'buyer-country-sub',
  'place-of-performance-subdiv-lot',
  'classification-cpv',
  'publication-date',
  'future-notice',
  'estimated-value-proc',
  'estimated-value-cur-proc',
];

/** Maks. długość opisu w pozycji — pozycja ląduje w indeksie radaru, nie cały dokument. */
const MAKS_OPIS = 500;

/**
 * Rodzaje ogłoszeń planowania eForms. `skracaTermin` — WOI, które pozwala
 * zamawiającemu SKRÓCIĆ termin składania ofert (art. 138 / 155 Pzp): na samo
 * ogłoszenie trzeba być gotowym wcześniej, bo czasu będzie mniej niż zwykle.
 */
export const RODZAJE_PLANU = Object.freeze({
  'pin-rtl': {
    pl: 'Wstępne ogłoszenie informacyjne — zamawiający może skrócić termin składania ofert',
    en: 'Prior information notice — the buyer may shorten the tender deadline',
    skracaTermin: true,
  },
  'pin-only': {
    pl: 'Wstępne ogłoszenie informacyjne',
    en: 'Prior information notice',
    skracaTermin: false,
  },
  'pin-buyer': {
    pl: 'Wstępne ogłoszenie informacyjne na profilu nabywcy',
    en: 'Prior information notice on the buyer profile',
    skracaTermin: false,
  },
  'pin-tran': {
    pl: 'Zamiar zawarcia umowy o transport publiczny (rozp. 1370/2007)',
    en: 'Intended public transport service contract (Reg. 1370/2007)',
    skracaTermin: false,
  },
  'pin-cfc-standard': {
    pl: 'Wstępne ogłoszenie informacyjne jako zaproszenie do ubiegania się',
    en: 'Prior information notice as a call for competition',
    skracaTermin: false,
  },
  'pin-cfc-social': {
    pl: 'Wstępne ogłoszenie informacyjne (usługi społeczne) jako zaproszenie',
    en: 'Prior information notice (social services) as a call for competition',
    skracaTermin: false,
  },
});

const RODZAJ_NIEZNANY = { pl: 'Ogłoszenie planowania', en: 'Planning notice', skracaTermin: false };

/** Pierwsza wartość z obiektu wielojęzycznego TED — polski przed innymi. */
function poPolsku(wielojezyczne) {
  if (!wielojezyczne || typeof wielojezyczne !== 'object') return null;
  const wartosc = wielojezyczne.pol ?? Object.values(wielojezyczne)[0];
  const pojedyncza = Array.isArray(wartosc) ? wartosc[0] : wartosc;
  return pojedyncza ? String(pojedyncza).trim() : null;
}

function pierwsza(pole) {
  const wartosc = Array.isArray(pole) ? pole[0] : pole;
  return wartosc == null || wartosc === '' ? null : String(wartosc);
}

/** „2026-11-02+01:00" / „2027-08-16Z" → „2026-11-02". Dzień zamawiającego, nie chwila UTC. */
function samaData(surowa) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(surowa ?? ''));
  return m ? m[1] : null;
}

/**
 * NIP zamawiającego z wolnego tekstu `buyer-identifier`. Bierze pierwszy ciąg
 * 10 cyfr (z dozwolonymi myślnikami/spacjami między grupami) o POPRAWNEJ sumie
 * kontrolnej. Sam REGON (9 cyfr) i śmieci dają null — NIP służy do złączenia planu
 * z późniejszym ogłoszeniem tego samego zamawiającego, więc zgadywanie jest gorsze
 * niż brak.
 * @param {string|string[]|null|undefined} identyfikatory
 * @returns {string|null}
 */
export function wyciagnijNip(identyfikatory) {
  const teksty = (Array.isArray(identyfikatory) ? identyfikatory : [identyfikatory])
    .filter((t) => t != null)
    .map(String);
  for (const tekst of teksty) {
    // Ciągi cyfr z pojedynczymi separatorami: „842-00-06-338", „821 000 65 10".
    for (const ciag of tekst.match(/\d(?:[\s-]?\d)*/g) ?? []) {
      const kandydaci = [ciag, ...ciag.split(/\s+/)];
      for (const k of kandydaci) {
        const cyfry = k.replace(/\D/g, '');
        if (cyfry.length === 10 && isValidNip(cyfry)) return cyfry;
      }
    }
  }
  return null;
}

function liczba(surowa) {
  if (surowa == null || surowa === '') return null;
  const n = Number(pierwsza(surowa));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ogłoszenie planowania TED → pozycja planu w kształcie, który rozumieją czyste
 * moduły radaru (`lib/radarPlanow.js`, `lib/przygotowaniaPlanu.js`,
 * `lib/zmianyPlanu.js`): `przedmiot`, `cpv`, `region`, `terminWszczecia`, `wartosc`.
 * @returns {object|null} null, gdy brakuje numeru albo tytułu
 */
export function mapujPlanTed(notice) {
  const numer = notice?.['publication-number'];
  const przedmiot = poPolsku(notice?.['title-proc']);
  if (!numer || !przedmiot) return null;

  const rodzaj = pierwsza(notice['notice-type']) ?? 'nieznany';
  const opisRodzaju = RODZAJE_PLANU[rodzaj] ?? RODZAJ_NIEZNANY;
  const cpv = parseCpvCodes(notice['classification-cpv'] ?? []);
  const opis = poPolsku(notice['description-proc']);
  const wartosc = liczba(notice['estimated-value-proc']);
  const linki = notice.links?.html ?? {};

  return {
    id: String(numer),
    zrodlo: 'ted',
    rodzaj,
    rodzaj_opis: { pl: opisRodzaju.pl, en: opisRodzaju.en },
    skraca_termin: opisRodzaju.skracaTermin,
    przedmiot,
    opis: opis ? opis.slice(0, MAKS_OPIS) : null,
    cpv,
    cpv_dzialy: cpvDivisions(cpv),
    zamawiajacy: poPolsku(notice['buyer-name']),
    zamawiajacy_nip: wyciagnijNip(notice['buyer-identifier']),
    // TED podaje NUTS, nie TERYT — osobny słownik (lib/nuts.js), bo wspólny
    // normalizator wziąłby „PL636" za kod 36.
    region: kodWojewodztwaZNuts(pierwsza(notice['buyer-country-sub']))
      ?? kodWojewodztwaZNuts(pierwsza(notice['place-of-performance-subdiv-lot'])),
    terminWszczecia: samaData(notice['future-notice']),
    wartosc,
    waluta: wartosc != null ? (pierwsza(notice['estimated-value-cur-proc']) ?? 'PLN') : null,
    opublikowano: samaData(notice['publication-date']),
    url: linki.POL ?? Object.values(linki)[0] ?? `https://ted.europa.eu/pl/notice/-/detail/${numer}`,
  };
}

/** Zapytanie eForms o polskie ogłoszenia planowania od dnia `odDnia` (YYYYMMDD). */
export function zapytaniePlanow(odDnia) {
  return `(place-of-performance IN (POL)) AND (publication-date >= ${odDnia}) AND (form-type = planning) SORT BY publication-date DESC`;
}

/**
 * Pobiera polskie ogłoszenia planowania z TED, z paginacją. 208 ogłoszeń / 30 dni,
 * więc 250 × 20 stron = 5000 mieści z zapasem nawet roczny import.
 * @throws przy niedostępności API — job zapisuje błąd w śladzie i NIE kasuje radaru
 */
export async function pobierzPlanyTed({
  odDnia,
  rozmiarStrony = 250,
  maksStron = 20,
  fetchImpl = fetch,
  licznik,
} = {}) {
  const query = zapytaniePlanow(odDnia);
  const zebrane = [];
  let total = Infinity;
  let surowych = 0;

  for (let page = 1; page <= maksStron && surowych < total; page++) {
    const odpowiedz = await fetchImpl(`${env.TED_API_BASE_URL}/v3/notices/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, fields: POLA, page, limit: rozmiarStrony }),
    });
    if (!odpowiedz.ok) {
      throw new Error(`TED API (plany) odpowiedziało ${odpowiedz.status}: ${(await odpowiedz.text()).slice(0, 300)}`);
    }
    const dane = await odpowiedz.json();
    total = dane.totalNoticeCount ?? 0;
    const surowe = dane.notices ?? [];
    surowych += surowe.length;

    const strona = surowe.map(mapujPlanTed).filter(Boolean);
    if (licznik) {
      licznik.zapytania += 1;
      licznik.surowe += surowe.length;
      licznik.odrzucone += surowe.length - strona.length;
    }
    zebrane.push(...strona);
    if (surowe.length === 0) break; // pusta strona = koniec, nie pętla
  }

  if (surowych < total && Number.isFinite(total)) {
    logger.warn({ zebrane: zebrane.length, total }, 'TED plany: sufit stron uciął pobieranie');
  }
  return zebrane;
}
