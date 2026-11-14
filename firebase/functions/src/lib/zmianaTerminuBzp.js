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

/*
 * „BYŁO → JEST” (2026-11-12): sama nazwa pozycji („5.4. Warunki udziału”) kazała otwierać BZP, żeby zobaczyć, CO się
 * zmieniło. Ogłoszenie o zmianie ma obie wartości: „… Przed zmianą: dwie roboty Po zmianie: jedna robota”, a kolejna
 * pozycja zaczyna się od „3.4.1.)” albo „3.4.)” (nowa sekcja); ostatnią kończy stopka „RRRR-MM-DD Biuletyn…”.
 */
const ZNACZNIK_ZMIANY = /Opis zmiany, w tym tekst, który należy dodać lub zmienić:/i;
const NUMER_POZYCJI = /^\s*(?:\d+\.)+\d*\.?\)?\s*\S/;
// Koniec wartości „Po zmianie”: początek następnej pozycji / sekcji albo stopka ogłoszenia. Pełne frazy, nie samo
// „3.4.1.)” — nowa treść potrafi cytować punkt SWZ („wg 3.4.1.) SWZ”) i była w tym miejscu ucinana (QA 2026-11-13).
const KONIEC_WARTOSCI = /\s*3\.4\.1\.\)\s*$|\s*3\.4\.\)\s*Identyfikator sekcji|\s*\d{4}-\d{2}-\d{2}\s+Biuletyn/i;

const skrocWartosc = (v, max = 80) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().replace(/[;,]+$/, '');
  return s.length > max ? `${s.slice(0, max - 2).replace(/\s+\S*$/, '')}…` : s;
};

/**
 * Zmiany ogłoszenia z wartościami: [{pozycja, przed, po}] (pozycja jak w `pozycjeZmianyOgloszenia`, wartości do
 * ~80 znaków; pusta = dodano/usunięto). Bez terminów składania/otwarcia/związania — mają własny alert.
 */
export function zmianyPrzedPo(tekst) {
  // Cięcie po znaczniku i indexOf zamiast jednego wyrażenia z leniwymi grupami: liniowo, także na urwanym tekście
  // (QA 2026-11-13: 30 pozycji bez „Po zmianie” po 40 tys. znaków liczyło się 2,4 s).
  const wynik = [];
  for (const kawalek of String(tekst ?? '').split(ZNACZNIK_ZMIANY).slice(1)) {
    const iPrzed = kawalek.indexOf('Przed zmianą:');
    if (iPrzed < 0 || iPrzed > 260 || !NUMER_POZYCJI.test(kawalek)) continue;
    const reszta = kawalek.slice(iPrzed + 'Przed zmianą:'.length);
    const iPo = reszta.indexOf('Po zmianie:');
    if (iPo < 0) continue;
    let pozycja = kawalek.slice(0, iPrzed).replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '');
    if (pozycja.length > 70) pozycja = `${pozycja.slice(0, 68).replace(/\s+\S*$/, '')}…`;
    if (POZYCJE_TERMINOW.test(pozycja) || wynik.some((z) => z.pozycja === pozycja)) continue;
    const po = reszta.slice(iPo + 'Po zmianie:'.length, iPo + 'Po zmianie:'.length + 4000);
    const koniec = po.search(KONIEC_WARTOSCI);
    wynik.push({ pozycja, przed: skrocWartosc(reszta.slice(0, Math.min(iPo, 4000))), po: skrocWartosc(koniec >= 0 ? po.slice(0, koniec) : po) });
  }
  return wynik;
}

/** Jedna zmiana po ludzku: „było „X”, jest „Y””, „dodano „Y””, „usunięto „X””. */
export function opisZmiany({ pozycja, przed, po }) {
  if (!przed && !po) return pozycja;
  if (!przed) return `${pozycja}: dodano „${po}”`;
  if (!po) return `${pozycja}: usunięto „${przed}”`;
  return `${pozycja}: było „${przed}”, jest „${po}”`;
}

const listaZmian = (zmiany) => `${zmiany.slice(0, 3).map(opisZmiany).join('; ')}${zmiany.length > 3 ? ` (i ${zmiany.length - 3} więcej)` : ''}`;

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
    zmiany: zmianyPrzedPo(tekst),
  };
}

const czystyKlucz = (s) => String(s).replace(/[/\s:.]/g, '_');
const listaPozycji = (pozycje) => `${pozycje.slice(0, 4).join('; ')}${pozycje.length > 4 ? ` (i ${pozycje.length - 4} więcej)` : ''}`;

/**
 * Alert o zmianie ogłoszenia dla kont, które przetarg zapisały albo analizowały. Klucz = przetarg × ogłoszenie
 * o zmianie: powtórka okna nie budzi drugi raz, kolejna zmiana tak.
 */
export function alertZmianyOgloszenia({ tender, pozycje, numer, zmiany = [] }) {
  if (!tender?.id || !pozycje?.length) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  // Z wartościami, gdy parser je znalazł (2026-11-12) — inaczej same nazwy pozycji jak dotąd.
  // Wartości tylko, gdy parser ma je dla WSZYSTKICH pozycji — częściowy odczyt gubiłby resztę zmian (QA 2026-11-13).
  const komplet = Array.isArray(zmiany) && zmiany.length > 0 && zmiany.length === pozycje.length;
  const lista = komplet ? listaZmian(zmiany) : listaPozycji(pozycje);
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
    ...(komplet ? { zmiany: zmiany.slice(0, 10) } : {}),
  };
}

/**
 * Alert dla konta, które zapisało albo analizowało przetarg. Typ `zmiany` — push otwiera centrum alertów także
 * w wydanej apce. Klucz = przetarg × nowy termin: ten sam termin drugi raz nie budzi, kolejne przesunięcie tak.
 * `inne` (2026-11-10) — pozostałe pozycje zmienione tym samym ogłoszeniem (jeden push zamiast dwóch).
 */
export function alertZmianyTerminu({ tender, staryTermin, nowyTermin, inne = [], inneZmiany = [] }) {
  if (!tender?.id || !nowyTermin) return null;
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const nowy = terminPL(nowyTermin);
  const stary = terminPL(staryTermin);
  const wczesniej = Boolean(staryTermin) && Date.parse(nowyTermin) < Date.parse(staryTermin);
  const opisInnych = inneZmiany?.length && inneZmiany.length === (inne?.length ?? 0) ? listaZmian(inneZmiany) : listaPozycji(inne ?? []);
  const tez = inne?.length ? { pl: ` Zmienił też: ${opisInnych} — sprawdź przed złożeniem oferty.`, en: ` Also changed: ${opisInnych} — check before you bid.` } : { pl: '', en: '' };
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
