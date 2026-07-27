/**
 * EKSTRAKCJA PARAMETRÓW FINANSOWYCH KONTRAKTU (ulepszenie „Symulator płynności:
 * czy udźwigniesz ten kontrakt", podzadanie 1/6).
 *
 * Zanim użytkownik zdecyduje „startować czy nie", wyciągamy z treści SWZ i wzoru umowy
 * parametry, które decydują o zapotrzebowaniu na finansowanie pomostowe:
 *   • harmonogram płatności  — jedna faktura końcowa czy płatności/faktury częściowe,
 *   • termin zapłaty (dni)   — ile firma czeka na przelew od zamawiającego,
 *   • zabezpieczenie należytego wykonania — % ceny BRUTTO + w jakiej formie,
 *   • zaliczka (%)           — czy umowa przewiduje zaliczkę (zmniejsza lukę),
 *   • wadium (kwota)         — gotówka zamrożona już na etapie oferty,
 *   • cena brutto            — baza do przeliczeń % zabezpieczenia i luki płynności.
 * Wynik to znormalizowany, ZAMROŻONY model, który zasili symulację przepływów (kroki 2–6).
 *
 * Świadome decyzje (spójnie z `services/dopasowanieSejfSWZ.js` i `czasBezpieczenstwa.js`):
 *  • CZYSTA, DETERMINISTYCZNA logika: bez UI, bez I/O, bez sieci, bez DB, bez Date.now.
 *    Parsujemy słowami kluczowymi i wzorcami — NIE przez płatne AI (koszt + denial-of-wallet).
 *    Ta sama funkcja da ten sam wynik dla tego samego wejścia (łatwo testowalna).
 *  • BEZPIECZNE DOMYŚLNE, gdy dane są niepełne: termin 30 dni, zabezpieczenie 5%,
 *    BRAK zaliczki, wadium/cena nieznane (null). Domyślne są PESYMISTYCZNE dla płynności
 *    (jedna faktura na końcu, brak zaliczki) — symulator ma nie zaniżać luki finansowej.
 *  • KWOTY tylko z jednostką (zł/PLN) — „30 dni" nie zostanie wzięte za kwotę; forma i %
 *    zabezpieczenia szukane w OKNIE wokół słowa „zabezpieczenie", żeby nie mylić ich
 *    z gwarancją jakości/rękojmią czy z procentem zaliczki.
 *
 * Moduł samowystarczalny (ZERO importów) — świadomie nie dopina się do współdzielonych
 * plików, które w drzewie roboczym mają cudzy WIP.
 */

/** Termin zapłaty przyjmowany, gdy w dokumentach go nie znaleziono. */
export const TERMIN_DOMYSLNY_DNI = 30;

/** Zabezpieczenie należytego wykonania przyjmowane domyślnie (typowe w Pzp). */
export const ZABEZPIECZENIE_DOMYSLNE_PROC = 5;

/** Górny, ustawowy limit zabezpieczenia — guard przed absurdalnym odczytem. */
export const ZABEZPIECZENIE_MAX_PROC = 10;

/** Znormalizowany model finansowy zwracany dla pustego/niepełnego wejścia. */
export const DOMYSLNE_PARAMETRY = Object.freeze({
  harmonogramPlatnosci: 'jedna_faktura',
  terminZaplatyDni: TERMIN_DOMYSLNY_DNI,
  zabezpieczenieProcent: ZABEZPIECZENIE_DOMYSLNE_PROC,
  zabezpieczenieForma: 'nieokreslona',
  zaliczkaProcent: 0,
  wadiumKwota: null,
  cenaBrutto: null,
});

// ─────────────────────────── pomocnicze: tekst i liczby ─────────────────────

/**
 * Do postaci porównywalnej: małe litery, bez polskich diakrytyków (`ł` osobno — nie
 * rozkłada się w NFD), spójne dla dopasowań słów kluczowych. Cyfry, `%`, `,`, `.`
 * i spacje (także niełamliwe) zostają — potrzebne do parsowania kwot i procentów.
 */
function normalizuj(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // znaki łączące (diakrytyki) po NFD
    .replace(/ł/g, 'l');
}

/** Wyciąga tekst ze stringa lub obiektu-dokumentu (pola tekstowe); inaczej ''. */
function naTekst(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return String(v.tekst ?? v.text ?? v.tresc ?? v.content ?? '');
  return String(v);
}

/** Białe znaki (w tym niełamliwa/wąska spacja) — separatory tysięcy w zapisie kwot. */
const SPACJE = /\s/g;

/** Token kwoty w zapisie polskim: „1 200 000,00", „180.000", „15000". */
const TOKEN_KWOTY = '\\d{1,3}(?:[\\s.]\\d{3})*(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?';

/**
 * Parsuje polski zapis kwoty na liczbę. Przecinek = separator dziesiętny; spacje oraz
 * kropki w roli separatora tysięcy są usuwane. Zwraca NaN dla wartości niebędącej kwotą.
 */
function parsujKwote(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(SPACJE, '');
  if (t === '') return NaN;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.'); // przecinek dziesiętny, kropki = tysiące
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // „180.000" / „1.234.567" — kropki jako separatory tysięcy
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Konkatenacja okien tekstu wokół każdego wystąpienia `klucz` (dla wyszukań lokalnych). */
function oknaWokol(tekst, klucz, przed = 40, po = 160) {
  let out = '';
  let i = tekst.indexOf(klucz);
  while (i !== -1) {
    out += tekst.slice(Math.max(0, i - przed), i + klucz.length + po) + '\n';
    i = tekst.indexOf(klucz, i + klucz.length);
  }
  return out;
}

/** Pierwszy procent (0–100) znaleziony we fragmencie; NaN gdy brak. */
function pierwszyProcent(fragment) {
  const m = /(\d{1,3}(?:,\d{1,2})?)\s*%/.exec(fragment);
  return m ? parsujKwote(m[1]) : NaN;
}

/**
 * Pierwsza kwota Z JEDNOSTKĄ (zł/PLN/złotych), której poprzedzający kontekst zawiera
 * `kontekstFraza` (np. „wadi", „brutto"); NaN gdy brak. Jednostka wymagana, żeby „30 dni"
 * ani gołe liczby nie zostały wzięte za kwotę.
 */
function kwotaWKontekscie(tekst, kontekstFraza, oknoPrzed = 80) {
  const re = new RegExp(`(${TOKEN_KWOTY})\\s*(?:zl|zlotych|pln)\\b`, 'gi');
  let m;
  while ((m = re.exec(tekst)) !== null) {
    const przed = tekst.slice(Math.max(0, m.index - oknoPrzed), m.index);
    if (przed.includes(kontekstFraza)) return parsujKwote(m[1]);
  }
  return NaN;
}

// ─────────────────────────── poszczególne parametry ─────────────────────────

/** Sygnały płatności/faktur częściowych, etapowych lub cyklicznych. */
const SYGNALY_CZESCIOWE = [
  'platnosci czesciow', 'platnosc czesciow', 'faktury czesciow', 'faktur czesciow',
  'fakturowanie czesciow', 'rozliczenie czesciow', 'czesciowe rozliczeni',
  'platnosci etapow', 'platnosc etapow', 'rozliczenie etapow', 'faktury przejsciow',
  'protokol odbioru czesciow', 'platnosci miesieczn', 'fakturami miesieczn',
  'fakturowanie miesieczn', 'faktury miesieczn',
];

/** Harmonogram płatności; domyślnie (pesymistycznie) jedna faktura końcowa. */
function harmonogram(tekst) {
  return SYGNALY_CZESCIOWE.some((f) => tekst.includes(f)) ? 'czesciowe' : 'jedna_faktura';
}

/** Termin zapłaty w dniach z kontekstu płatności/faktury; domyślnie 30. */
function terminZaplaty(tekst) {
  const m = /(?:termin\w*\s+(?:platnosci|zaplaty)|platn\w*|zaplat\w*|faktur\w*)[\s\S]{0,45}?(\d{1,3})\s*dni/.exec(tekst);
  if (!m) return TERMIN_DOMYSLNY_DNI;
  const dni = Number(m[1]);
  return Number.isFinite(dni) && dni > 0 ? dni : TERMIN_DOMYSLNY_DNI;
}

/** % zabezpieczenia należytego wykonania (od ceny brutto), przycięty do [0..10]; domyślnie 5. */
function zabezpieczenieProcent(oknoZab) {
  const p = pierwszyProcent(oknoZab);
  if (!Number.isFinite(p) || p <= 0) return ZABEZPIECZENIE_DOMYSLNE_PROC;
  return p > ZABEZPIECZENIE_MAX_PROC ? ZABEZPIECZENIE_MAX_PROC : p;
}

/**
 * Forma zabezpieczenia z okna wokół „zabezpieczeni":
 *   • dopuszczona gwarancja/poręczenie → 'dowolna' (można zamiast gotówki — lepiej dla płynności),
 *   • wyłącznie w pieniądzu/gotówce    → 'pieniadz',
 *   • brak wzmianki                    → 'nieokreslona'.
 */
function zabezpieczenieForma(oknoZab) {
  if (/gwarancj|poreczeni|ubezpieczeniow/.test(oknoZab)) return 'dowolna';
  if (/pieniadz|gotowk|pieniez/.test(oknoZab)) return 'pieniadz';
  return 'nieokreslona';
}

/** % zaliczki; 0 gdy zamawiający wprost jej nie przewiduje lub brak wzmianki. */
function zaliczkaProcent(tekst) {
  const negacja = /(?:nie\s+(?:przewiduj\w*|udziel\w*|zamierza\w*|planuj\w*|bedzie)|bez)[^.]{0,25}zaliczk/;
  if (negacja.test(tekst)) return 0;
  const m = /zaliczk\w*[\s\S]{0,40}?(\d{1,3}(?:,\d{1,2})?)\s*%/.exec(tekst);
  if (!m) return 0;
  const p = parsujKwote(m[1]);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return p > 100 ? 100 : p;
}

/** Kwota wadium (zł) lub null, gdy zamawiający wadium nie żąda / nie wspomniano. */
function wadiumKwota(tekst) {
  const neg1 = /(?:nie\s+(?:zada\w*|wymaga\w*|przewiduj\w*|wnos\w*|pobiera\w*)|bez)[^.]{0,25}wadi/;
  const neg2 = /wadi\w*[^.]{0,25}nie\s+(?:jest|bedzie|zostanie)\s+(?:wymagan\w*|zadan\w*|pobieran\w*)/;
  if (neg1.test(tekst) || neg2.test(tekst)) return null;
  const kwota = kwotaWKontekscie(tekst, 'wadi');
  return Number.isFinite(kwota) ? kwota : null;
}

/** Cena/wynagrodzenie brutto kontraktu (zł) lub null, gdy nie podano liczbowo. */
function cenaBrutto(tekst) {
  const kwota = kwotaWKontekscie(tekst, 'brutto', 60);
  return Number.isFinite(kwota) ? kwota : null;
}

// ─────────────────────────── funkcja publiczna ──────────────────────────────

/**
 * Wyciąga znormalizowany model parametrów finansowych z treści SWZ i wzoru umowy.
 * Oba argumenty mogą być stringiem albo obiektem z polem tekstowym (tekst/text/tresc/content);
 * puste/niepełne wejście daje bezpieczne wartości domyślne (patrz DOMYSLNE_PARAMETRY).
 *
 * @param {string|{tekst?:string,text?:string,tresc?:string,content?:string}} [swz] treść SWZ.
 * @param {string|{tekst?:string,text?:string,tresc?:string,content?:string}} [umowa] wzór umowy.
 * @returns {Readonly<{harmonogramPlatnosci:'jedna_faktura'|'czesciowe', terminZaplatyDni:number,
 *   zabezpieczenieProcent:number, zabezpieczenieForma:'nieokreslona'|'pieniadz'|'dowolna',
 *   zaliczkaProcent:number, wadiumKwota:number|null, cenaBrutto:number|null}>} ZAMROŻONY model.
 */
export function wyciagnijParametryFinansowe(swz, umowa) {
  const tekst = normalizuj([naTekst(swz), naTekst(umowa)].join('\n\n'));
  if (!tekst.trim()) return DOMYSLNE_PARAMETRY;

  const oknoZab = oknaWokol(tekst, 'zabezpieczeni', 40, 160);

  return Object.freeze({
    harmonogramPlatnosci: harmonogram(tekst),
    terminZaplatyDni: terminZaplaty(tekst),
    zabezpieczenieProcent: zabezpieczenieProcent(oknoZab),
    zabezpieczenieForma: zabezpieczenieForma(oknoZab),
    zaliczkaProcent: zaliczkaProcent(tekst),
    wadiumKwota: wadiumKwota(tekst),
    cenaBrutto: cenaBrutto(tekst),
  });
}
