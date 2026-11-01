import { doUtcIso } from './daty.js';

/*
 * ZMIANA TERMINU SKŁADANIA OFERT Z „OGŁOSZENIA O ZMIANIE OGŁOSZENIA” BZP (2026-11-01). Pobieramy z BZP tylko
 * ogłoszenia o zamówieniu, a termin przesuwa się osobnym ogłoszeniem (`NoticeUpdateNotice`, pole
 * `submittingOffersDate` puste). 1.11 na 30 takich ogłoszeń z jednego województwa i doby 25 przesuwało termin;
 * przetarg 2026/BZP 00500202 miał u nas 30.10, choć oferty przyjmowano do 4.11 — znikał z list i selekcji jako
 * zamknięty, a przypomnienia szły według starego terminu. Treść jest wzorcowa:
 *   „3.2.) Numer zmienianego ogłoszenia w BZP: 2026/BZP 00500202 … 8.1. Termin składania ofert
 *    Przed zmianą: 2026-10-30 10:00 Po zmianie: 2026-11-04 10:00”.
 * CZYSTA logika; job: `jobs/zmianyTerminowBzp.js`.
 */

const ENCJE = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", oacute: 'ó', Oacute: 'Ó' };

/** Tekst ogłoszenia z `htmlBody`: bez znaczników i encji, białe znaki scalone. */
export function tekstOgloszenia(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENCJE[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMER_ZMIENIANEGO = /Numer zmienianego ogłoszenia w BZP:\s*(\d{4}\/BZP \d{8})/i;
const DATA = String.raw`(\d{4}-\d{2}-\d{2}(?:\s*(?:godz\.?|godzina)?\s*\d{1,2}:\d{2})?)`;
// „8.1. Termin składania ofert Przed zmianą: …” i „tj. Termin składania ofert: Przed zmianą: …”.
const ZMIANA_TERMINU = new RegExp(String.raw`Termin składania ofert:?[^:]{0,40}?Przed zmianą:\s*${DATA}[^]{0,80}?Po zmianie:\s*${DATA}`, 'i');

/** „2026-11-04 godz. 10:00” → „2026-11-04 10:00” (jak w ogłoszeniu o zamówieniu). */
const normDaty = (s) => s.replace(/\s*(?:godz\.?|godzina)\s*/i, ' ').replace(/\s+/g, ' ').trim()
  .replace(/ (\d):/, ' 0$1:');

/**
 * @param {object} n surowe ogłoszenie BZP typu `NoticeUpdateNotice`
 * @returns {{numerZmienianego: string, postepowanieId: string|null, staryTermin: string|null, nowyTermin: string,
 *   opublikowano: string|null, numer: string|null}|null} null, gdy ogłoszenie nie przesuwa terminu składania ofert
 */
export function zmianaTerminu(n) {
  const tekst = tekstOgloszenia(n?.htmlBody);
  const numer = NUMER_ZMIENIANEGO.exec(tekst)?.[1] ?? null;
  const m = ZMIANA_TERMINU.exec(tekst);
  if (!numer || !m) return null;
  const nowyTermin = doUtcIso(normDaty(m[2]));
  if (!nowyTermin) return null;
  return {
    numerZmienianego: numer,
    postepowanieId: n?.tenderId ?? null,
    staryTermin: doUtcIso(normDaty(m[1])),
    nowyTermin,
    opublikowano: n?.publicationDate ?? null,
    numer: n?.noticeNumber ?? null,
  };
}

const terminPL = (iso) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
};

/**
 * Alert dla konta, które zapisało albo analizowało przetarg. Typ `zmiany` — push otwiera centrum alertów także
 * w wydanej apce. Klucz = przetarg × nowy termin: ten sam termin drugi raz nie budzi, kolejne przesunięcie tak.
 */
export function alertZmianyTerminu({ tender, staryTermin, nowyTermin }) {
  if (!tender?.id || !nowyTermin) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const nowy = terminPL(nowyTermin);
  const stary = terminPL(staryTermin);
  const wczesniej = Boolean(staryTermin) && Date.parse(nowyTermin) < Date.parse(staryTermin);
  const czysty = (s) => String(s).replace(/[/\s:.]/g, '_');
  return {
    klucz: `termin_${czysty(tender.id)}_${czysty(String(nowyTermin).slice(0, 16))}`,
    typ: 'zmiany',
    tender_id: tender.id,
    ton: wczesniej ? 'ostrzezenie' : 'neutral',
    tytul: { pl: `${wczesniej ? 'Termin ofert WCZEŚNIEJ' : 'Nowy termin ofert'}: ${tytul}`, en: `${wczesniej ? 'Bid deadline moved EARLIER' : 'New bid deadline'}: ${tytul}` },
    tresc: {
      pl: `${tender.organization ?? 'Zamawiający'} zmienił termin składania ofert: ${nowy}${stary ? ` (było ${stary})` : ''}. Przypomnienie ustawiliśmy na nowy termin.`,
      en: `${tender.organization ?? 'The buyer'} changed the bid deadline: ${nowy}${stary ? ` (was ${stary})` : ''}. Your reminder now follows the new date.`,
    },
    pozycje: [{ tender_id: tender.id, tytul: tender.title ?? null, organizacja: tender.organization ?? null, deadline: nowyTermin, zrodlo: 'bzp' }],
  };
}

/** Najnowsza zmiana terminu na ogłoszenie (kilka zmian tego samego dnia albo w oknie — liczy się ostatnia). */
export function najnowszeZmiany(zmiany) {
  const wynik = new Map();
  for (const z of zmiany ?? []) {
    if (!z) continue;
    const p = wynik.get(z.numerZmienianego);
    if (!p || String(z.opublikowano ?? '') > String(p.opublikowano ?? '')) wynik.set(z.numerZmienianego, z);
  }
  return [...wynik.values()];
}
