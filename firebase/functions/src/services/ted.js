import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';
import { wyciagnijNip } from '../lib/nip.js';
import { wojewodztwoRealizacji } from '../lib/nuts.js';
import { warunkiZTed } from '../lib/warunkiUdzialu.js';
import { parsujKryteriaTed } from '../lib/kryteriaTed.js';

/*
 * TED (Tenders Electronic Daily) — dziennik zamówień publicznych UE.
 *
 * DLACZEGO: polskie postępowania POWYŻEJ progów unijnych trafiają do TED,
 * a do BZP już NIE — bez tego adaptera aplikacja nie widziała największych
 * zamówień (zmierzone 2026-07-10: ~900 polskich ogłoszeń konkursowych / 2 dni,
 * wolumen porównywalny z BZP).
 *
 * API zweryfikowane na żywo: POST /v3/notices/search — publiczne, bez klucza.
 * Pola to identyfikatory eForms (BT-*); nazwy sprawdzone sondą — błędna nazwa
 * pola zwraca 400 z pełną listą dozwolonych.
 */

const POLA = [
  'publication-number',
  // BT-04: identyfikator POSTEPOWANIA, wspolny dla ogloszenia o zamowieniu
  // i o wyniku (etap 6). Zmierzone: obecny w 250/250 ogloszen konkursowych;
  // zapytanie `procedure-identifier = "…"` zwraca obie publikacje.
  'procedure-identifier',
  'title-proc',
  'buyer-name',
  // Wolny tekst „NIP: …, REGON: …" — klucz złączenia plan → ogłoszenie (Radar planów)
  // i benchmarku per zamawiający. Zmierzone: poprawny NIP w 199/250 ogłoszeń.
  'buyer-identifier',
  'classification-cpv',
  'publication-date',
  'deadline-receipt-tender-date-lot',
  // Selekcja pod klienta (spec §6.1): warunki udziału (BT-750) i województwo z NUTS.
  'selection-criterion-description-lot',
  'selection-criteria-source',
  'buyer-country-sub',
  'place-of-performance-subdiv-lot',
  // Za co są punkty (2026-11-01, `lib/kryteriaTed.js`): typ, nazwa, waga i opis kryteriów oceny.
  'award-criterion-type-lot',
  'award-criterion-name-lot',
  'award-criterion-number-lot',
  'award-criterion-number-weight-lot',
  'award-criterion-description-lot',
];

/** Pierwsza wartość z obiektu wielojęzycznego TED — polski przed innymi. */
function poPolsku(wielojezyczne) {
  if (!wielojezyczne || typeof wielojezyczne !== 'object') return null;
  const wartosc = wielojezyczne.pol ?? Object.values(wielojezyczne)[0];
  const pojedyncza = Array.isArray(wartosc) ? wartosc[0] : wartosc;
  return pojedyncza ? String(pojedyncza) : null;
}

/**
 * TED podaje terminy jako „2026-09-08+02:00" — data z offsetem, BEZ godziny.
 * Silnik V8 zinterpretowałby to jako PÓŁNOC (początek dnia), a termin „do 8 września"
 * znaczy „do końca 8 września". Odcinamy offset i oddajemy samą datę do doUtcIso,
 * które liczy koniec dnia czasu polskiego. Pełne znaczniki z godziną przechodzą wprost.
 */
function znacznikTed(surowy) {
  if (typeof surowy !== 'string') return null;
  const sameDataZOffsetem = /^(\d{4}-\d{2}-\d{2})[+-]\d{2}:\d{2}$/.exec(surowy);
  return doUtcIso(sameDataZOffsetem ? sameDataZOffsetem[1] : surowy);
}

/** Najwcześniejszy termin ze wszystkich części zamówienia — ten dyktuje pośpiech. */
function najwczesniejszyTermin(listaTerminow) {
  const znormalizowane = (listaTerminow ?? []).map(znacznikTed).filter(Boolean);
  if (!znormalizowane.length) return null;
  return znormalizowane.sort()[0];
}

/**
 * Ogłoszenie TED → znormalizowany przetarg (kształt `tenders.upsert`).
 * @returns {object|null} null, gdy brakuje danych, bez których wpis jest bezużyteczny
 */
export function mapujOgloszenieTed(notice) {
  const numer = notice?.['publication-number'];
  const title = poPolsku(notice?.['title-proc']);
  if (!numer || !title) return null;

  const cpv = [...new Set(notice['classification-cpv'] ?? [])].join(', ');
  const linki = notice.links?.html ?? {};
  const kryteria = parsujKryteriaTed(notice);

  return {
    externalId: `ted:${numer}`,
    title,
    organization: poPolsku(notice['buyer-name']),
    cpvMain: cpv || null,
    deadline: najwczesniejszyTermin(notice['deadline-receipt-tender-date-lot']),
    publishedAt: znacznikTed(notice['publication-date']),
    url: linki.POL ?? Object.values(linki)[0] ?? null,
    source: 'ted',
    postepowanie_id: pierwszaWartosc(notice['procedure-identifier']),
    zamawiajacy_nip: wyciagnijNip(notice['buyer-identifier']),
    // Zapisujemy tylko pobrane pola (nie pełny XML) — raw służy podglądowi.
    // Pod selekcję liczy się MIEJSCE REALIZACJI (reguła „teren"), siedziba tylko gdy go brak;
    // kilka regionów / cały kraj → null, żeby reguła nie odrzucała. Radar planów (tedPlany.js)
    // zostaje przy siedzibie — tam chodzi o to, KTO planuje. Logika: lib/nuts.js.
    wojewodztwo: wojewodztwoRealizacji({ miejsca: notice['place-of-performance-subdiv-lot'], siedziba: notice['buyer-country-sub'] }),
    warunki_udzialu: warunkiZTed(notice),
    // Te same pola co z BZP — karta „Za co są punkty” i znacznik na liście działają bez rozróżniania rejestru.
    kryterium_oceny: kryteria ? (kryteria.pozacenowe ? 'cena_i_jakosc' : 'tylko_cena') : null,
    kryteria: kryteria?.lista ?? null,
    kryteria_sposob: kryteria?.sposob ?? null,
    kryteria_rozne_czesci: kryteria?.rozne_w_czesciach ?? false,
    // Opisy kryteriów (wzory, całe akapity × liczba części) zostają poza podglądem — lista wyżej ma to, co potrzebne.
    raw: bezOpisowKryteriow(notice),
  };
}

function bezOpisowKryteriow(notice) {
  const { 'award-criterion-description-lot': _opisy, ...reszta } = notice;
  return reszta;
}

/** Pierwsza wartosc pola TED, ktore bywa tablica albo skalarem. */
function pierwszaWartosc(pole) {
  const wartosc = Array.isArray(pole) ? pole[0] : pole;
  return wartosc ? String(wartosc) : null;
}

function dataOdDni(dni) {
  const d = new Date(Date.now() - dni * 24 * 60 * 60_000);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * Pobiera świeże polskie ogłoszenia konkursowe z TED, z paginacją.
 *
 * `form-type = competition` = ogłoszenia o zamówieniu (odpowiednik ContractNotice
 * w BZP) — bez wyników, sprostowań i planów.
 *
 * @throws przy niedostępności API — izolację zapewnia rejestr źródeł w jobie,
 *   żeby awaria TED nie zatrzymała pobierania z BZP.
 */
export async function pobierzOgloszeniaTed({
  lookbackDays = env.TED_LOOKBACK_DAYS,
  rozmiarStrony = 250,
  maksStron = 10,
  licznik,
} = {}) {
  /*
   * `SORT BY publication-date DESC` — KLUCZOWE dla świeżości feedu.
   * Bez sortowania TED oddaje domyślną kolejność, więc gdy wolumen przekracza
   * sufit (rozmiarStrony × maksStron), NAJNOWSZE ogłoszenia potrafią wypaść poza
   * pobrany zakres i nie trafiają do aplikacji przez wiele dni. Zmierzone na
   * produkcji 2026-07-28: TED = 0 nowych w niedzielę i poniedziałek przy 1521
   * dostępnych i dawnym sufcie 1000 — apka „stała". Sortowanie malejąco gwarantuje,
   * że strona 1 to zawsze najświeższe przetargi; przy ewentualnym ucięciu tracimy
   * najstarsze (najmniej istotne), nie najnowsze.
   * Składnia `SORT BY` (NIE `ORDER BY`) i `limit=250` zweryfikowane na żywym API.
   * 250 × 10 = 2500 — zapas nad zmierzonym ~1521 ogłoszeń / 7 dni.
   */
  const query = `(place-of-performance IN (POL)) AND (publication-date >= ${dataOdDni(lookbackDays)}) AND (form-type = competition) SORT BY publication-date DESC`;

  const zebrane = [];
  let total = Infinity;

  for (let page = 1; page <= maksStron && zebrane.length < total; page++) {
    const odpowiedz = await fetch(`${env.TED_API_BASE_URL}/v3/notices/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, fields: POLA, page, limit: rozmiarStrony }),
    });
    if (!odpowiedz.ok) {
      throw new Error(`TED API odpowiedziało ${odpowiedz.status}: ${(await odpowiedz.text()).slice(0, 300)}`);
    }

    const dane = await odpowiedz.json();
    total = dane.totalNoticeCount ?? 0;

    const strona = (dane.notices ?? []).map(mapujOgloszenieTed).filter(Boolean);
    // Akumulator pomiarów okna (lib/licznikZrodla.js) — do rekonsyliacji
    // „ile TED opublikował" vs „ile weszło do bazy".
    if (licznik) {
      licznik.zapytania += 1;
      licznik.surowe += (dane.notices ?? []).length;
      licznik.odrzucone += (dane.notices ?? []).length - strona.length;
    }
    zebrane.push(...strona);
    if ((dane.notices ?? []).length === 0) break; // pusta strona = koniec, nie pętla
  }

  if (zebrane.length < total) {
    logger.warn({ zebrane: zebrane.length, total },
      'TED: sufit stron uciął pobieranie — rozważ większy rozmiarStrony/maksStron');
  }
  return zebrane;
}

/**
 * Ogłoszenia konkursowe TED z JEDNEJ doby publikacji (2026-11-01) — uzupełnianie wstecz pól,
 * które doszły później (kryteria oceny), przez `POST /admin/kryteria-ted-wstecz`. Okno dzienne
 * pobierania patrzy tylko 7 dni wstecz, a przetarg unijny bywa otwarty ponad miesiąc.
 */
export async function pobierzOgloszeniaTedDnia(dzien, { rozmiarStrony = 250, maksStron = 8 } = {}) {
  const data = String(dzien).replaceAll('-', '');
  if (!/^\d{8}$/.test(data)) throw new Error('dzien w formacie RRRR-MM-DD');
  const query = `(place-of-performance IN (POL)) AND (publication-date = ${data}) AND (form-type = competition)`;
  const zebrane = [];
  for (let page = 1; page <= maksStron; page++) {
    const odpowiedz = await fetch(`${env.TED_API_BASE_URL}/v3/notices/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, fields: POLA, page, limit: rozmiarStrony }),
    });
    if (!odpowiedz.ok) throw new Error(`TED API odpowiedziało ${odpowiedz.status}: ${(await odpowiedz.text()).slice(0, 300)}`);
    const dane = await odpowiedz.json();
    const surowe = dane.notices ?? [];
    zebrane.push(...surowe.map(mapujOgloszenieTed).filter(Boolean));
    if (surowe.length < rozmiarStrony || zebrane.length >= (dane.totalNoticeCount ?? 0)) break;
  }
  return zebrane;
}
