import { rodzajKryterium, MAKS_KRYTERIOW } from './ogloszenieMeta.js';

/*
 * KRYTERIA OCENY Z TREŚCI SWZ (2026-11-01). Postępowania z ustawy prowadzone na platformazakupowa.pl,
 * których nie ma w naszym BZP/TED (brak bliźniaka), mają kryteria TYLKO w SWZ. Rozdział „Opis kryteriów
 * oceny ofert, wraz z podaniem wag” ma powtarzalny układ — „1) Cena (C) – waga kryterium 60%;
 * 2) Okres gwarancji (G) – waga kryterium 40%”, „cena ofertowa brutto („C”) - waga 80%”, „a) Cena (C) -
 * 60 pkt; b) Doświadczenie (D) – 30 pkt”, „a) Cena 60/100 punktów” — więc czytamy go bez AI: pozycje
 * „nazwa … N%” (albo „N pkt” na liście a)/1)/•) w oknie za nagłówkiem sekcji, jedna pozycja na nazwę,
 * stop, gdy wagi dojdą do 100. Wynik tylko przy sumie 100 — inaczej null. „Jedynym kryterium jest cena”
 * = cena 100%.
 *
 * Ten sam kształt co `parsujKryteria` (BZP). CZYSTA funkcja na liniach tekstu (`services/tekstPdf.js`).
 */

const POCZATEK = /opis\s+kryteri\w*|kryteri\w*\s+oceny\s+ofert|kierowa[łl]\w*\s+(?:si[ęe]\s+)?nast[ęe]puj[aą]c\w*\s+kryteri|ustali[łl]\w*\s+nast[ęe]puj[aą]c\w*\s+kryteri|kryteri\w*\s+wyboru\s+(?:najkorzystniejszej\s+)?oferty/gi;
const OKNO = 4000;
const NAZWA = '([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż„"][^%;:\\n]{1,90}?)';
const LICZBA = '(\\d{1,3}(?:[.,]\\d+)?)';
// „Cena (60%)”, „Cena – waga 60 %”, „Cena: 60%”.
const POZYCJA_PROC = new RegExp(`(?:^|[\\s;,.)+])(?:\\d{1,2}[.)]\\s*|[a-h]\\)\\s*|[-•]\\s*)?(?:kryterium\\s+(?:nr\\s*\\d+\\s*[:.-]?\\s*)?)?${NAZWA}\\s*`
  + `(?:\\(\\s*${LICZBA}\\s*%\\s*\\)|(?:[-–—:]\\s*)?(?:waga\\s*(?:kryterium)?\\s*[-–:]?\\s*)?${LICZBA}\\s*%)`, 'g');
// Punkty tylko na liście („a) Cena (C) - 60 pkt”, „b) Gwarancja 40/100 punktów”) — luźne „max 60 pkt” to nie pozycja.
const POZYCJA_PKT = new RegExp(`(?:^|[\\s;,.)+])(?:\\d{1,2}[.)]|[a-h]\\)|[-•])\\s*(?:kryterium\\s+)?${NAZWA}\\s*`
  + `(?:[-–—:]\\s*)?(?:waga\\s*[-–:]?\\s*)?(?:max\\.?\\s*)?${LICZBA}(?:\\s*\\/\\s*100)?\\s*(?:pkt|punkt\\w*)`, 'g');
// „Jedynym kryterium jest cena”, „wyłącznie na podstawie kryterium ceny”, „jedno kryterium – cena 100%”.
const TYLKO_CENA = /jedyn\w*\s+kryteri\w*\s+(?:oceny\s+ofert\s+)?(?:jest|b[ęe]dzie)\s+(?:najni[żz]sz\w*\s+)?cen|(?:wy[łl][ąa]cznie|tylko)\s+(?:na\s+podstawie|w\s+oparciu\s+o)\s+kryteri\w*\s+cen|jedn\w*\s+kryteri\w*[^.]{0,40}?\bcen/i;

function czystaNazwa(surowa) {
  // Nazwa zaczyna się po ostatnim separatorze zdania: „…jedno kryterium wyboru ofert- cena ofertowa brutto”,
  // „…oceny ofert, tj. Cena”, „…przedmiotu zamówienia. 2) OKRES GWARANCJI”.
  const odcinki = String(surowa).split(/\s[-–—]\s?|-\s|,\s*tj\.\s*|\btj\.\s*|:\s|\.\s+(?=\p{Lu}|\d)|\s\d{1,2}[.)]\s|\s[a-h]\)\s/u);
  const ostatni = odcinki.filter((o) => o.trim().length >= 3).at(-1) ?? String(surowa);
  return ostatni
    // PDF rozbija słowa na polskich znakach: „os ó b”, „zam ó wienia”.
    .replace(/(\p{L}) ([ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]) (?=\p{L})/gu, '$1$2')
    .replace(/[„"”]+/g, ' ')
    .replace(/\(\s*[A-Za-z]{1,4}(?:\s+[a-ząćęłńóśźż]{2,10})?\s*\)/g, ' ')
    .replace(/\s*[-–—:]?\s*(?:waga|znaczenie)(?:\s+kryterium)?\s*$/i, '')
    .replace(/^(?:\d{1,2}[.)]|[a-h]\))\s*/, '')
    .replace(/^(?:kryterium|kryteria)\s+/i, '')
    .replace(/[\s,.;:–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Klucz do odsiewania powtórek („Cena (C)” w spisie i „Cena (C) – waga 60 %” w zasadach). */
const klucz = (nazwa) => nazwa.toLowerCase().replace(/[^a-ząćęłńóśźż]/g, '').slice(0, 14);

/** Pozycje „nazwa – waga” z okna; null, gdy wagi nie dają razem 100. */
function zbierz(okno, wzorzec) {
  const pozycje = [];
  const widziane = new Set();
  let suma = 0;
  for (const m of okno.matchAll(wzorzec)) {
    const waga = Number(String(m[2] ?? m[3]).replace(',', '.'));
    const nazwa = czystaNazwa(m[1]);
    if (!Number.isFinite(waga) || waga <= 0 || waga > 100 || nazwa.length < 3 || nazwa.length > 80) continue;
    // Zdania o podatku czy pkt-ach („23%”, „1% = 1 pkt”) to nie kryteria.
    if (/\bvat\b|podat|=|\bpkt\b|punkt|procent|dokładno|wynagrodzeni\w*\s+netto|razem|łącznie/i.test(nazwa)) continue;
    // Progi podkryteriów („Do 15 minut – 10%”, „16-25 minut – 0%”) to nie osobne kryteria.
    // Granice słów przez \p{L}: zwykłe \b uznaje „ś” za nie-literę, więc „Doświadczenie” zaczynałoby się od „do”.
    if (/^(?:do|od|powy[żz]ej|poni[żz]ej|w\s+porze)(?!\p{L})|\d+\s*[-–]\s*\d+|(?<!\p{L})(?:minut|godzin|dni|miesi[ęe]cy|lat)(?!\p{L})|podkryteri/iu.test(nazwa)) continue;
    const k = klucz(nazwa);
    if (!k || widziane.has(k)) continue;
    widziane.add(k);
    pozycje.push({ nazwa, waga });
    suma += waga;
    if (Math.abs(suma - 100) < 0.01 || pozycje.length >= MAKS_KRYTERIOW || suma > 100) break;
  }
  return pozycje.length && Math.abs(suma - 100) < 0.01 ? pozycje : null;
}

const wynik = (pozycje) => {
  const lista = pozycje.map((p) => ({ ...p, udzial: Math.round(p.waga * 10) / 10, rodzaj: rodzajKryterium(p.nazwa) }));
  return { lista, sposob: 'procentowo', rozne_w_czesciach: false, pozacenowe: lista.some((k) => k.rodzaj !== 'cena') };
};

/**
 * @param {string[]|string} linie tekst SWZ
 * @returns {{lista: {nazwa: string, waga: number, udzial: number, rodzaj: string}[], sposob: 'procentowo', rozne_w_czesciach: false, pozacenowe: boolean}|null}
 */
export function parsujKryteriaSwz(linie) {
  const tekst = (Array.isArray(linie) ? linie.join('\n') : String(linie ?? ''))
    .replace(/\s+/g, ' ')
    // „1 0 %” z PDF-a = „10 %”.
    .replace(/(?<![\d,.])(\d) (\d)(?=\s*%)/g, '$1$2');
  for (const start of tekst.matchAll(POCZATEK)) {
    const okno = tekst.slice(start.index, start.index + OKNO);
    const pozycje = zbierz(okno, POZYCJA_PROC) ?? zbierz(okno, POZYCJA_PKT);
    if (pozycje) return wynik(pozycje);
    if (TYLKO_CENA.test(okno.slice(0, 600))) return wynik([{ nazwa: 'Cena', waga: 100 }]);
  }
  return null;
}
