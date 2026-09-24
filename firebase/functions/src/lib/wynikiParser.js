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
 *   SEKCJA IV  — przedmiot (CPV, opis, `Część N`, 4.3 i 4.5.5 = wartości szacowane)
 *   SEKCJA V   — wynik postępowania  ← powtarza się PER CZĘŚĆ, nagłówek `(dla części N)`
 *   SEKCJA VI  — oferty (6.1 liczba, 6.1.3 od MŚP, 6.2/6.3 min/max, 6.4 zwycięzca)
 *   SEKCJA VII — wykonawca (7.2 wielkość, 7.3.1 nazwa, 7.3.2 NIP, 7.3.4 miasto)
 *   SEKCJA VIII— umowa (8.2 wartość)
 * Format etykiety: `6.2.) Cena lub koszt oferty z najniższą ceną lub kosztem: 722809,50 PLN`
 *
 * ── ETAP 6: trzy rzeczy zmierzone na próbce 200 ogłoszeń z 2026-09-22 ──────────
 *
 * 1. `SEKCJA V` dzieli się na bloki, ale PIERWSZY bywa widmem (sam nagłówek przed
 *    „Część 1"). Częścią jest wyłącznie blok niosący `5.1.)` — reguła zgodna z
 *    `procedureResult` w **200/200** ogłoszeń (warianty „zawiera SEKCJA VI" 170/200
 *    i „liczba nagłówków" 164/200 gubiły części unieważnione).
 * 2. `procedureResult` i `contractors[]` są indeksowane **NUMEREM CZĘŚCI**
 *    (`procedureResult[n-1]`), a nie kolejnością bloku HTML. Przy ogłoszeniu, w
 *    którym część nie została rozstrzygnięta, wpis jest PUSTY i bloku nie ma —
 *    zipowanie po kolejności bloku przypisuje firmie cudzą część. Po indeksowaniu
 *    numerem: **545/545** bloków ma niepuste rozstrzygnięcie, **387/387** nazw
 *    zwycięzcy zgadza się z HTML, **0** unieważnionych części z wykonawcą.
 * 3. `KWOTA` wymagała przecinka, a BZP zapisuje też `9840 PLN` — **39 z 404**
 *    cen wybranych (9,6 %) wypadało ze statystyki bez żadnego śladu.
 *
 * 🚨 CZEGO TU NIE MA I BYĆ NIE MOŻE: rabatu liczonego jako `6.4 / 4.3`.
 * Wartość zamówienia (art. 28 Pzp) jest NETTO, a cena oferty zwykle BRUTTO.
 * Zmierzona mediana ilorazu na 46 jednoczęściowych ogłoszeniach = **1,0489**,
 * ze skupiskami dokładnie na 1,23 i 1,17 (stawki VAT). Taki „rabat" pokazywałby
 * firmie, że w jej branży przetargi idą DROŻEJ niż kosztorys — odwrotnie niż jest.
 * Porównywalny jest wyłącznie rozrzut WEWNĄTRZ konkursu ofert (6.2/6.3/6.4 —
 * wszystkie w tej samej bazie) → `pozycjaCeny`.
 */

const TAGI = /<[^>]+>/g;
const BIALE = /\s+/g;

/** „SEKCJA V" bez złapania VI/VII/VIII. Który blok jest częścią — patrz `czyBlokCzesci`. */
const PODZIAL_CZESCI = /SEKCJA V(?!I)/;

/** Blok SEKCJI V jest CZĘŚCIĄ tylko wtedy, gdy niesie etykietę wyniku `5.1.)`. */
const ZNACZNIK_CZESCI = '5.1.)';

/** `(dla części 7)` w nagłówku — jedyne wiarygodne źródło numeru części. */
const NUMER_CZESCI = /\(dla cz[ęe]ści\s*(\d+)\)/i;

/**
 * Kwota w polskim formacie: `722809,50 PLN`, `2 366 784,88 PLN`, `9840 PLN`.
 * Grosze są OPCJONALNE (9,6 % kwot ich nie ma), ale waluta jest WYMAGANA —
 * bez niej „6.2.)" wyglądałoby jak liczba.
 */
const KWOTA = /(\d[\d\s ]*(?:,\d{1,2})?)\s*(?:PLN|zł)/i;

const ENCJE = {
  '&amp;': '&', '&quot;': '"', '&#34;': '"', '&#39;': "'",
  '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
};

/** BZP wysyła nazwy firm z encjami (`&#34;ELEKTROS&#34;`) — bez tego nazwa nie sklei się z NIP-em. */
function dekodujEncje(tekst) {
  return String(tekst).replace(/&(?:amp|quot|apos|lt|gt|nbsp|#34|#39);/g, (m) => ENCJE[m] ?? m);
}

function czysteNazwisko(tekst) {
  if (!tekst) return null;
  const wynik = dekodujEncje(tekst).replace(BIALE, ' ').trim();
  return wynik || null;
}

export function kwotaZTekstu(tekst) {
  if (!tekst) return null;
  const trafienie = KWOTA.exec(String(tekst));
  if (!trafienie) return null;
  const liczba = Number(trafienie[1].replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(liczba) ? liczba : null;
}

function naTekst(html) {
  return String(html || '').replace(TAGI, ' ').replace(BIALE, ' ').trim();
}

/**
 * Wartość spod etykiety `N.N.)` — czyta do początku następnej etykiety.
 * `Część N` też kończy odczyt: w SEKCJI IV to granica między częściami.
 */
function poEtykiecie(tekst, numer) {
  const wzorzec = new RegExp(
    `${numer.replace(/\./g, '\\.')}\\.?\\)[^:]{0,90}:\\s*([^]{0,120}?)(?=\\s*\\d+\\.\\d|\\s*SEKCJA|\\s*Cz[ęe]ść \\d|$)`,
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

/**
 * Gdzie w widełkach konkursu leży cena zwycięzcy: 0 = najtaniej, 1 = najdrożej.
 *
 * To JEDYNE porównanie cen z BZP, które jest uczciwe — wszystkie trzy liczby
 * (6.2/6.3/6.4) pochodzą z tego samego formularza i tej samej bazy podatkowej.
 * null, gdy brakuje którejś liczby, gdy była jedna oferta (min = max) albo gdy
 * zamawiający wpisał kwoty sprzeczne.
 */
export function pozycjaCenyWKonkursie({ cenaNajnizsza, cenaNajwyzsza, cenaWybrana }, spojne) {
  if (!spojne) return null;
  if (![cenaNajnizsza, cenaNajwyzsza, cenaWybrana].every((n) => Number.isFinite(n))) return null;
  const rozpietosc = cenaNajwyzsza - cenaNajnizsza;
  if (rozpietosc <= 0) return null;
  return Math.round(((cenaWybrana - cenaNajnizsza) / rozpietosc) * 1000) / 1000;
}

/**
 * Rozstrzygnięcie części. Źródło pierwsze: `procedureResult[numer-1]` (pole JSON).
 * Źródło zapasowe: tekst spod `5.1.)` — dla ogłoszeń bez `procedureResult`.
 * Oba zgodne w 545/545 części próbki.
 */
function rozstrzygniecieCzesci(blok, wpisJson) {
  const wpis = String(wpisJson ?? '').trim();
  if (wpis === 'zawarcieUmowy') return 'umowa';
  if (wpis === 'uniewaznienie') return 'uniewaznienie';
  if (wpis) return wpis; // nieznana wartość — oddajemy bez interpretacji

  const zHtml = poEtykiecie(blok, '5.1');
  if (!zHtml) return null;
  if (/uniewa[żz]nieniem/i.test(zHtml)) return 'uniewaznienie';
  if (/zawarciem umowy/i.test(zHtml)) return 'umowa';
  return null;
}

function zwyciezcaCzesci(blok, wpisJson) {
  const nazwa = czysteNazwisko(poEtykiecie(blok, '7.3.1')) ?? czysteNazwisko(wpisJson?.contractorName);
  if (!nazwa) return null;
  return {
    nazwa,
    nip: poEtykiecie(blok, '7.3.2') ?? wpisJson?.contractorNationalId ?? null,
    miasto: czysteNazwisko(poEtykiecie(blok, '7.3.4')) ?? wpisJson?.contractorCity ?? null,
    wojewodztwo: kodWojewodztwa(wpisJson?.contractorProvince),
  };
}

/**
 * SEKCJA IV → mapa `numer części` → wartość szacowana NETTO (4.5.5).
 * Części w SEKCJI IV rozdziela nagłówek `Część N`, więc numer bierzemy stamtąd —
 * ta sama numeracja, co `(dla części N)` w SEKCJI V.
 */
function wartosciCzesciNetto(sekcjaIv) {
  const mapa = new Map();
  const segmenty = sekcjaIv.split(/Cz[ęe]ść\s+(\d+)/);
  for (let i = 1; i < segmenty.length; i += 2) {
    const kwota = kwotaSpodEtykiety(segmenty[i + 1] ?? '', '4.5.5');
    if (kwota !== null) mapa.set(Number(segmenty[i]), kwota);
  }
  return mapa;
}

function parsujCzesc(blok, indeks, kontekst) {
  const numerZNaglowka = NUMER_CZESCI.exec(blok);
  const numer = numerZNaglowka ? Number(numerZNaglowka[1]) : indeks + 1;

  const cenaNajnizsza = kwotaSpodEtykiety(blok, '6.2');
  const cenaNajwyzsza = kwotaSpodEtykiety(blok, '6.3');
  const cenaWybrana = kwotaSpodEtykiety(blok, '6.4');
  const ceny = { cenaNajnizsza, cenaNajwyzsza, cenaWybrana };
  const spojne = czyKwotySpojne(ceny);

  const rozstrzygniecie = rozstrzygniecieCzesci(blok, kontekst.procedureResult[numer - 1]);
  const uniewaznione = rozstrzygniecie === 'uniewaznienie';
  const wielkosc = poEtykiecie(blok, '7.2');

  return {
    numer,
    rozstrzygniecie,
    uniewaznione,
    ...ceny,
    pozycjaCeny: pozycjaCenyWKonkursie(ceny, spojne),
    wartoscUmowy: kwotaSpodEtykiety(blok, '8.2'),
    wartoscSzacowanaNetto: kontekst.wartosciCzesci.get(numer) ?? null,
    liczbaOfert: liczbaSpodEtykiety(blok, '6.1'),
    liczbaOfertMsp: liczbaSpodEtykiety(blok, '6.1.3'),
    liczbaOfertOdrzuconych: liczbaSpodEtykiety(blok, '6.1.6'),
    wielkoscWykonawcy: wielkosc || null,
    // „Mały przedsiębiorca" / „Mikroprzedsiębiorstwo" — sygnał dla JDG, że tam się da wygrać
    wygralMaly: wielkosc ? /mał|mikro/i.test(wielkosc) : null,
    zwyciezca: uniewaznione ? null : zwyciezcaCzesci(blok, kontekst.contractors[numer - 1]),
    dataUmowy: poEtykiecie(blok, '8.1'),
    // false = zamawiający wpisał sprzeczne kwoty; do statystyk NIE bierzemy
    spojne,
  };
}

/**
 * @param {object} surowe — ogłoszenie z BZP (`TenderResultNotice`)
 * @returns {object|null} znormalizowane rozstrzygnięcie z listą części
 */
export function parsujWynik(surowe) {
  if (!surowe || typeof surowe !== 'object') return null;

  const externalId = surowe.bzpNumber || surowe.noticeNumber || surowe.objectId;
  const tekst = naTekst(surowe.htmlBody);

  const poczatekV = tekst.search(PODZIAL_CZESCI);
  const poczatekIv = tekst.indexOf('SEKCJA IV');
  const sekcjaIv = poczatekIv >= 0
    ? tekst.slice(poczatekIv, poczatekV > poczatekIv ? poczatekV : undefined)
    : '';

  const kontekst = {
    procedureResult: String(surowe.procedureResult ?? '').split(';'),
    contractors: Array.isArray(surowe.contractors) ? surowe.contractors : [],
    wartosciCzesci: wartosciCzesciNetto(sekcjaIv),
  };

  const czesci = tekst
    .split(PODZIAL_CZESCI)
    .slice(1) // przed pierwszą SEKCJĄ V są tylko dane zamawiającego
    .filter((blok) => blok.includes(ZNACZNIK_CZESCI)) // odcina blok-widmo (nagłówek przed „Część 1")
    .map((blok, indeks) => parsujCzesc(blok, indeks, kontekst));

  return {
    externalId: externalId ? String(externalId) : null,
    // Identyfikator POSTĘPOWANIA (ocds-…) — ten sam w ogłoszeniu o zamówieniu
    // i w ogłoszeniu o wyniku. Zmierzone: obecny w 200/200 wyników i 3974/3974
    // ogłoszeń o zamówieniu. To klucz złączenia „wynik → przetarg w bazie".
    tenderId: surowe.tenderId ? String(surowe.tenderId) : null,
    zrodlo: 'bzp',
    tytul: surowe.orderObject || null,
    zamawiajacy: surowe.organizationName || null,
    zamawiajacyNip: surowe.organizationNationalId ? String(surowe.organizationNationalId) : null,
    cpv: kodyCpv(surowe.cpvCode),
    wojewodztwo: kodWojewodztwa(surowe.organizationProvince),
    miasto: surowe.organizationCity || null,
    rodzaj: surowe.orderType || null, // Works / Delivery / Services
    opublikowano: surowe.publicationDate ? String(surowe.publicationDate).slice(0, 10) : null,
    // 4.3 — wartość zamówienia z art. 28 Pzp, czyli NETTO. Nie mieszać z ceną oferty.
    wartoscSzacowanaNetto: kwotaSpodEtykiety(sekcjaIv, '4.3'),
    czesci,
  };
}
