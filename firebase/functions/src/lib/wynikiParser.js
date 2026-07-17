/*
 * Parser ogłoszeń o WYNIKU postępowania (`TenderResultNotice`) z BZP.
 *
 * Po co: BZP **nie podaje kwot w polach JSON** (patrz runbooks/bzp-api.md oraz
 * pamięć „BZP API — co naprawdę zwraca"). Jedyne pole z pieniędzmi to
 * `isTenderAmountBelowEU` (bool). Wszystkie kwoty siedzą w `htmlBody` — w
 * ponumerowanych sekcjach ogłoszenia. Zmierzone na żywym API (2026-07-17,
 * 40 ogłoszeń): kwoty obecne w 8/8 sprawdzonych.
 *
 * Co z tego mamy (czego nie ma konkurencja): dla danego CPV i województwa
 * potrafimy powiedzieć małej firmie „za taką robotę płacono u Ciebie 500–750 tys.,
 * startowało 19 firm, w tym 19 MŚP, wygrał mały przedsiębiorca".
 *
 * Struktura `htmlBody` (zweryfikowana na próbkach w test/fixtures):
 *   SEKCJA IV  — przedmiot (CPV, opis, „Część N")
 *   SEKCJA V   — wynik postępowania  ← powtarza się PER CZĘŚĆ
 *   SEKCJA VI  — oferty (6.1 liczba, 6.1.3 od MŚP, 6.2/6.3 min/max, 6.4 zwycięzca)
 *   SEKCJA VII — wykonawca (7.2 wielkość przedsiębiorstwa)
 *   SEKCJA VIII— umowa (8.2 wartość)
 * Format etykiety: `6.2.) Cena lub koszt oferty z najniższą ceną lub kosztem: 722809,50 PLN`
 */

const TAGI = /<[^>]+>/g;
const BIALE = /\s+/g;

/** „SEKCJA V" bez złapania VI/VII/VIII — każdy blok to jedna część postępowania. */
const PODZIAL_CZESCI = /SEKCJA V(?!I)/;

/**
 * Kwota w polskim formacie: `722809,50 PLN`, `2 366 784,88 PLN`.
 * Wymaga przecinka i groszy — inaczej „6.2.)" wyglądałoby jak liczba.
 */
const KWOTA = /(\d[\d\s ]*,\d{1,2})\s*(?:PLN|zł)/i;

export function kwotaZTekstu(tekst) {
  if (!tekst) return null;
  const trafienie = KWOTA.exec(String(tekst));
  if (!trafienie) return null;
  const liczba = Number(trafienie[1].replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(liczba) ? liczba : null;
}

function naTekst(html) {
  return String(html || '').replace(TAGI, ' ').replace(BIALE, ' ').trim();
}

/** Wartość spod etykiety `N.N.)` — czyta do początku następnej etykiety. */
function poEtykiecie(tekst, numer) {
  const wzorzec = new RegExp(
    `${numer.replace(/\./g, '\\.')}\\.\\)[^:]{0,90}:\\s*([^]{0,60}?)(?=\\s*\\d+\\.\\d|\\s*SEKCJA|$)`,
  );
  const trafienie = wzorzec.exec(tekst);
  return trafienie ? trafienie[1].trim() : null;
}

function kwotaSpodEtykiety(tekst, numer) {
  return kwotaZTekstu(poEtykiecie(tekst, numer));
}

function liczbaSpodEtykiety(tekst, numer) {
  const surowa = poEtykiecie(tekst, numer);
  if (!surowa) return null;
  const trafienie = /^\d+/.exec(surowa.trim());
  return trafienie ? Number(trafienie[0]) : null;
}

/** `45233140-2 (Roboty drogowe),45233200-1 (…)` → ['45233140-2', '45233200-1'] */
export function kodyCpv(cpvCode) {
  if (!cpvCode) return [];
  return [...String(cpvCode).matchAll(/(\d{8}-\d)/g)].map((m) => m[1]);
}

/** `PL28` → `28`; TERYT, NIE NUTS (patrz pamięć „BZP API — co naprawdę zwraca"). */
export function kodWojewodztwa(province) {
  if (!province) return null;
  const czysty = String(province).trim().toUpperCase().replace(/^PL/, '');
  return /^\d{2}$/.test(czysty) ? czysty : null;
}

/**
 * Czy kwoty w części trzymają się arytmetyki?
 *
 * Zamawiający wypełniają BZP ręcznie i mylą się. Zmierzone na 200 ogłoszeniach:
 * 1/95 części miało cenę zwycięzcy PONIŻEJ najniższej oferty (2026/BZP 00309687:
 * widełki 47 970–68 900, zwycięzca 24 900) — arytmetycznie niemożliwe.
 * Takich danych NIE WOLNO wpuścić do statystyki cen: zaniżony orientacyjny koszt
 * to firma, która przegrywa przetarg przez naszą podpowiedź.
 */
function czyKwotySpojne({ cenaNajnizsza, cenaNajwyzsza, cenaWybrana }) {
  const TOLERANCJA = 1; // grosze/zaokrąglenia
  if (cenaNajnizsza !== null && cenaNajwyzsza !== null && cenaNajnizsza > cenaNajwyzsza + TOLERANCJA) {
    return false;
  }
  if (cenaWybrana === null) return true;
  if (cenaNajnizsza !== null && cenaWybrana < cenaNajnizsza - TOLERANCJA) return false;
  if (cenaNajwyzsza !== null && cenaWybrana > cenaNajwyzsza + TOLERANCJA) return false;
  return true;
}

function parsujCzesc(blok, indeks) {
  const cenaNajnizsza = kwotaSpodEtykiety(blok, '6.2');
  const cenaNajwyzsza = kwotaSpodEtykiety(blok, '6.3');
  const cenaWybrana = kwotaSpodEtykiety(blok, '6.4');
  const wartoscUmowy = kwotaSpodEtykiety(blok, '8.2');

  // Bez żadnej kwoty i bez ofert blok nie niesie informacji (np. część unieważniona).
  const liczbaOfert = liczbaSpodEtykiety(blok, '6.1');
  if (cenaNajnizsza === null && cenaWybrana === null && liczbaOfert === null) return null;

  const wielkosc = poEtykiecie(blok, '7.2');
  const ceny = { cenaNajnizsza, cenaNajwyzsza, cenaWybrana };
  return {
    numer: indeks + 1, // numer bloku SEKCJA V, nie „Część N" z ogłoszenia
    ...ceny,
    wartoscUmowy,
    liczbaOfert,
    liczbaOfertMsp: liczbaSpodEtykiety(blok, '6.1.3'),
    liczbaOfertOdrzuconych: liczbaSpodEtykiety(blok, '6.1.6'),
    wielkoscWykonawcy: wielkosc || null,
    // „Mały przedsiębiorca" / „Mikroprzedsiębiorstwo" — sygnał dla JDG, że tam się da wygrać
    wygralMaly: wielkosc ? /mał|mikro/i.test(wielkosc) : null,
    // false = zamawiający wpisał sprzeczne kwoty; do statystyk NIE bierzemy
    spojne: czyKwotySpojne(ceny),
  };
}

/**
 * @param {object} surowe — ogłoszenie z BZP (`TenderResultNotice`)
 * @returns {{externalId: string, czesci: object[], cpv: string[], wojewodztwo: string|null}|null}
 */
export function parsujWynik(surowe) {
  if (!surowe || typeof surowe !== 'object') return null;

  const externalId = surowe.bzpNumber || surowe.noticeNumber || surowe.objectId;
  const tekst = naTekst(surowe.htmlBody);

  const czesci = tekst
    .split(PODZIAL_CZESCI)
    .slice(1) // przed pierwszą SEKCJĄ V są tylko dane zamawiającego
    .map(parsujCzesc)
    .filter(Boolean);

  return {
    externalId: externalId ? String(externalId) : null,
    tytul: surowe.orderObject || null,
    zamawiajacy: surowe.organizationName || null,
    cpv: kodyCpv(surowe.cpvCode),
    wojewodztwo: kodWojewodztwa(surowe.organizationProvince),
    miasto: surowe.organizationCity || null,
    rodzaj: surowe.orderType || null, // Works / Delivery / Services
    opublikowano: surowe.publicationDate ? String(surowe.publicationDate).slice(0, 10) : null,
    czesci,
  };
}
