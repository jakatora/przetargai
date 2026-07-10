import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';

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
  'title-proc',
  'buyer-name',
  'classification-cpv',
  'publication-date',
  'deadline-receipt-tender-date-lot',
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

  return {
    externalId: `ted:${numer}`,
    title,
    organization: poPolsku(notice['buyer-name']),
    cpvMain: cpv || null,
    deadline: najwczesniejszyTermin(notice['deadline-receipt-tender-date-lot']),
    publishedAt: znacznikTed(notice['publication-date']),
    url: linki.POL ?? Object.values(linki)[0] ?? null,
    source: 'ted',
    // Zapisujemy tylko pobrane pola (nie pełny XML) — raw służy podglądowi.
    raw: notice,
  };
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
  rozmiarStrony = 100,
  maksStron = 10,
} = {}) {
  const query = `(place-of-performance IN (POL)) AND (publication-date >= ${dataOdDni(lookbackDays)}) AND (form-type = competition)`;

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
    zebrane.push(...strona);
    if ((dane.notices ?? []).length === 0) break; // pusta strona = koniec, nie pętla
  }

  if (zebrane.length < total) {
    logger.warn({ zebrane: zebrane.length, total },
      'TED: sufit stron uciął pobieranie — rozważ większy rozmiarStrony/maksStron');
  }
  return zebrane;
}
