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
// Godzina bywa wolnym tekstem zamawiającego: „2026-11-04 r. godz. 10:00”, „do godz. 10:00”, „, godz. 10.00”, „T10:00”.
const DATA = String.raw`(\d{4}-\d{2}-\d{2}(?:(?:T|\s*r\.?)?[,\s]*(?:do\s+)?(?:godz\.?|godzina)?\s*\d{1,2}[:.]\d{2})?)`;
// „8.1. Termin składania ofert Przed zmianą: …” i „tj. Termin składania ofert: Przed zmianą: …”.
const ZMIANA_TERMINU = new RegExp(String.raw`Termin składania ofert:?[^:]{0,40}?Przed zmianą:\s*${DATA}[^]{0,80}?Po zmianie:\s*${DATA}`, 'i');

/** „2026-11-04 r. godz. 9.00” → „2026-11-04 09:00” (jak w ogłoszeniu o zamówieniu); sama data zostaje datą. */
const normDaty = (s) => {
  const m = /(\d{4}-\d{2}-\d{2})\D*?(\d{1,2})[:.](\d{2})/.exec(s);
  return m ? `${m[1]} ${m[2].padStart(2, '0')}:${m[3]}` : s.slice(0, 10);
};
const maGodzine = (s) => /\d[:.]\d{2}$/.test(s);

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
  // Sama data po zmianie przy starym terminie z godziną = godziny nie odczytaliśmy. Koniec dnia byłby terminem
  // późniejszym niż prawdziwy (oferta po czasie) — lepiej nie ruszać.
  if (!maGodzine(m[2]) && maGodzine(m[1])) return null;
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

export const terminPL = (iso) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
};

/*
 * ZMIANA OGŁOSZENIA BEZ TERMINU (2026-11-10). „Ogłoszenie o zmianie” zmienia też warunki udziału, wadium, przedmiot,
 * kryteria czy postanowienia umowy — dotąd czytaliśmy z niego tylko termin, więc kto zapisał przetarg, o takiej
 * zmianie nie wiedział. Każda zmieniona pozycja ma stały wzór:
 *   „3.4.1.) Opis zmiany, w tym tekst, który należy dodać lub zmienić: 4.2.10. Data końcowa okresu obowiązywania
 *    Przed zmianą: 2026-11-30 Po zmianie: 2026-12-15”.
 * Terminy składania, otwarcia i związania ofertą pomijamy — pierwszy ma własny alert, dwa pozostałe idą za nim.
 */
const NAZWA_ZMIENIANEGO = /Nazwa zmienianego ogłoszenia:\s*(.{3,80}?)\s*3\.2\.?\)/i;
const POZYCJA_ZMIANY = /Opis zmiany, w tym tekst, który należy dodać lub zmienić:\s*((?:\d+\.)+\d*\.?\)?\s*\S.{2,200}?)\s*Przed zmianą:/gi;
const POZYCJE_TERMINOW = /^8\.[134]\.?\s|^Termin (?:składania|otwarcia) ofert|^Termin związania/i;

/** Zmienione pozycje ogłoszenia („4.2.10. Data końcowa okresu obowiązywania”), bez powtórzeń, skrócone do ~70 znaków. */
export function pozycjeZmianyOgloszenia(tekst) {
  const wynik = [];
  for (const m of String(tekst ?? '').matchAll(POZYCJA_ZMIANY)) {
    let p = m[1].replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');
    if (p.length > 70) p = `${p.slice(0, 68).replace(/\s+\S*$/, '')}…`;
    if (!wynik.includes(p)) wynik.push(p);
  }
  return wynik;
}

/**
 * @param {object} n surowe ogłoszenie BZP typu `NoticeUpdateNotice`
 * @returns {{numerZmienianego: string, numer: string|null, opublikowano: string|null, pozycje: string[]}|null}
 *   null, gdy to nie zmiana ogłoszenia o zamówieniu (np. o wykonaniu umowy); `pozycje` bez terminów
 */
export function zmianaOgloszenia(n) {
  const tekst = tekstOgloszenia(n?.htmlBody);
  const numerZmienianego = NUMER_ZMIENIANEGO.exec(tekst)?.[1] ?? null;
  if (!numerZmienianego) return null;
  const nazwa = NAZWA_ZMIENIANEGO.exec(tekst)?.[1] ?? '';
  if (nazwa && !/o zamówieniu/i.test(nazwa)) return null;
  return {
    numerZmienianego,
    numer: n?.noticeNumber ?? null,
    opublikowano: n?.publicationDate ?? null,
    pozycje: pozycjeZmianyOgloszenia(tekst).filter((p) => !POZYCJE_TERMINOW.test(p)),
  };
}

const czystyKlucz = (s) => String(s).replace(/[/\s:.]/g, '_');
const listaPozycji = (pozycje) => `${pozycje.slice(0, 4).join('; ')}${pozycje.length > 4 ? ` (i ${pozycje.length - 4} więcej)` : ''}`;

/**
 * Alert o zmianie ogłoszenia dla kont, które przetarg zapisały albo analizowały. Klucz = przetarg × ogłoszenie
 * o zmianie: powtórka okna nie budzi drugi raz, kolejna zmiana tak.
 */
export function alertZmianyOgloszenia({ tender, pozycje, numer }) {
  if (!tender?.id || !pozycje?.length) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const lista = listaPozycji(pozycje);
  const kropka = /[….]$/.test(lista) ? '' : '.';
  return {
    klucz: `ogloszenie_${czystyKlucz(tender.id)}_${czystyKlucz(numer ?? pozycje.join('|').slice(0, 40))}`,
    typ: 'zmiany',
    tender_id: tender.id,
    ton: 'ostrzezenie',
    tytul: { pl: `Zmiana ogłoszenia w zapisanym przetargu: ${tytul}`, en: `Notice changed in a saved tender: ${tytul}` },
    tresc: {
      pl: `${tender.organization ?? 'Zamawiający'} zmienił ogłoszenie w BZP: ${lista}${kropka} Sprawdź zmiany przed złożeniem oferty — oferta, która ich nie uwzględnia, może zostać odrzucona.`,
      en: `${tender.organization ?? 'The buyer'} changed the BZP notice: ${lista}${kropka} Check the changes before you bid — an offer that ignores them may be rejected.`,
    },
    pozycje: [{ tender_id: tender.id, tytul: tender.title ?? null, organizacja: tender.organization ?? null, deadline: tender.deadline ?? null, zrodlo: 'bzp' }],
  };
}

/**
 * Alert dla konta, które zapisało albo analizowało przetarg. Typ `zmiany` — push otwiera centrum alertów także
 * w wydanej apce. Klucz = przetarg × nowy termin: ten sam termin drugi raz nie budzi, kolejne przesunięcie tak.
 * `inne` (2026-11-10) — pozostałe pozycje zmienione tym samym ogłoszeniem (jeden push zamiast dwóch).
 */
export function alertZmianyTerminu({ tender, staryTermin, nowyTermin, inne = [] }) {
  if (!tender?.id || !nowyTermin) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const nowy = terminPL(nowyTermin);
  const stary = terminPL(staryTermin);
  const wczesniej = Boolean(staryTermin) && Date.parse(nowyTermin) < Date.parse(staryTermin);
  const tez = inne?.length ? { pl: ` Zmienił też: ${listaPozycji(inne)} — sprawdź przed złożeniem oferty.`, en: ` Also changed: ${listaPozycji(inne)} — check before you bid.` } : { pl: '', en: '' };
  return {
    klucz: `termin_${czystyKlucz(tender.id)}_${czystyKlucz(String(nowyTermin).slice(0, 16))}`,
    typ: 'zmiany',
    tender_id: tender.id,
    ton: wczesniej || inne?.length ? 'ostrzezenie' : 'neutral',
    tytul: { pl: `${wczesniej ? 'Termin ofert WCZEŚNIEJ' : 'Nowy termin ofert'}: ${tytul}`, en: `${wczesniej ? 'Bid deadline moved EARLIER' : 'New bid deadline'}: ${tytul}` },
    tresc: {
      pl: `${tender.organization ?? 'Zamawiający'} zmienił termin składania ofert: ${nowy}${stary ? ` (było ${stary})` : ''}. Przypomnienie ustawiliśmy na nowy termin.${tez.pl}`,
      en: `${tender.organization ?? 'The buyer'} changed the bid deadline: ${nowy}${stary ? ` (was ${stary})` : ''}. Your reminder now follows the new date.${tez.en}`,
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
