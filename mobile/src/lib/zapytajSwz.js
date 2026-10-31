/*
 * „Zapytaj SWZ” (2026-10-31): pytania, które wykonawca zadaje najczęściej, zanim zdecyduje o starcie.
 * Jedno dotknięcie podpowiedzi = gotowe pytanie, bez pisania. Logika poza komponentem, żeby testy
 * w Node nie ładowały react-native.
 */
export const PODPOWIEDZI_PYTAN = Object.freeze([
  { pl: 'Czy jest wadium i ile wynosi?', en: 'Is there a bid bond and how much?' },
  { pl: 'Jakie doświadczenie i referencje są wymagane?', en: 'What experience and references are required?' },
  { pl: 'Jakie są kryteria oceny ofert?', en: 'What are the award criteria?' },
  { pl: 'Jaki jest termin realizacji zamówienia?', en: 'What is the completion deadline?' },
  { pl: 'Czy wymagana jest polisa OC i na jaką kwotę?', en: 'Is liability insurance required and for how much?' },
  { pl: 'Jakie są kary umowne?', en: 'What are the contractual penalties?' },
]);

/**
 * Podpowiedzi z pytaniami o kryteria TEGO przetargu (karta „Za co są punkty”, `lib/kryteriaOceny.js`)
 * na początku. Gdy są, ogólne „Jakie są kryteria oceny ofert?” znika — lista kryteriów jest już na ekranie.
 */
export function podpowiedziPytan(dodatkowe = []) {
  const extra = (Array.isArray(dodatkowe) ? dodatkowe : []).filter((p) => typeof p?.pl === 'string' && p.pl).slice(0, 2);
  const ogolne = extra.length ? PODPOWIEDZI_PYTAN.filter((p) => !/kryteria oceny/i.test(p.pl)) : PODPOWIEDZI_PYTAN;
  return [...extra, ...ogolne];
}

export const MIN_DLUGOSC_PYTANIA = 3;
export const MAKS_DLUGOSC_PYTANIA = 500;

/** Pytać można, gdy backend ma treść SWZ (wklejoną albo wersję zamawiającego). */
export function czyMoznaPytacSwz(trescSwz) {
  return trescSwz?.zrodlo === 'wklejona' || trescSwz?.zrodlo === 'wersja';
}

/** Przy przetargu: BZP (z identyfikatorem postępowania e-Zamówień) albo platformazakupowa.pl — tam są dokumenty z SWZ. */
export function czyMoznaPytacPrzetargu(tender) {
  const kod = tender?.zrodlo?.kod ?? tender?.source;
  if (!tender?.id) return false;
  return (kod === 'bzp' && Boolean(tender.postepowanie_id)) || kod === 'platformazakupowa';
}

export function poprawnePytanie(tekst) {
  const s = String(tekst ?? '').trim();
  return s.length >= MIN_DLUGOSC_PYTANIA && s.length <= MAKS_DLUGOSC_PYTANIA;
}

/**
 * Dopisek strony przy cytacie (2026-10-31): backend podaje numer strony PDF-a dla potwierdzonego
 * cytatu z SWZ pobranej jako plik. Brak numeru (tekst wklejony, starsza treść) → pusty dopisek.
 */
export function dopisekStrony(cytat, en = false) {
  const n = Number(cytat?.strona);
  if (!cytat?.potwierdzony || !Number.isInteger(n) || n < 1) return '';
  return en ? ` (p. ${n})` : ` (s. ${n})`;
}

/** Status odpowiedzi z backendu → ton karty i opis po polsku/angielsku. */
export function opisStatusuOdpowiedzi(status) {
  if (status === 'potwierdzone') return { ton: 'sukces', pl: 'Potwierdzone cytatem z SWZ', en: 'Confirmed by a quote from the documents' };
  if (status === 'brak_w_swz') return { ton: 'neutralne', pl: 'SWZ tego nie rozstrzyga', en: 'The documents do not settle this' };
  return { ton: 'ostrzezenie', pl: 'Nieudowodnione: cytatu nie znaleźliśmy w SWZ, sprawdź w dokumencie', en: 'Unproven: quote not found in the documents, check them yourself' };
}
