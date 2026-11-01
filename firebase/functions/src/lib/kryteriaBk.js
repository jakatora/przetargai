import { rodzajKryterium, MAKS_KRYTERIOW } from './ogloszenieMeta.js';

/*
 * KRYTERIA OCENY Z BAZY KONKURENCYJNOŚCI (2026-11-01) — ten sam kształt co `parsujKryteria` (BZP),
 * `parsujKryteriaTed` i `parsujKryteriaPz`. API BK podaje je przy każdym zamówieniu (= części):
 * `orders[].evaluation_criteria[]` z flagą `price_criterion` i opisem w wolnym tekście — pierwsza linia
 * to nazwa („Cena netto za wynajem (W)”, „I. Cena (P) – 100 pkt (100%)”), a waga siedzi w opisie
 * („× 40 pkt”, „100 pkt (100%)”, „max 20 pkt”). Osobnego pola wagi nie ma.
 *
 * Opis bywa długi i ma kilka liczb (podkryteria „wartość poznawcza – 20 pkt”), więc wagę z opisu
 * przyjmujemy TYLKO wtedy, gdy kryteria części składają się na 100 — jedną brakującą dopełniamy
 * do 100. Inaczej wagi są nieznane (lista bez udziałów, sama „Cena” = 100%).
 *
 * CZYSTA funkcja, bez I/O.
 */

const MAKS_NAZWY = 80;

/** Pierwsze linie, które nic nie nazywają („Przy wyborze ofert Zamawiający…”, „Kryteria oceny ofert:”). */
const OGOLNIK = /^(?:przy (?:wyborze|ocenianiu|ocenie)|kryteri\w*\s+oceny|zamawiający|ocen\w*\s+(?:ofert|będą)|liczba\s+punktów|sposób\s+(?:oceny|obliczania))/i;

function oczyscNazwe(linia) {
  const bezNumeru = String(linia)
    .replace(/^[\s\-‐‒–—−•*]+/, '')
    .replace(/^kryterium\s+(?:[IVX]+|\d+)\s*[.:)]?\s*/i, '')
    .replace(/^(?:[IVX]+\.|[A-Z]\.|\d+(?:\.\d+)*\.?|[a-z]\)|K\d+\s*[-–—]?)\s*/, '')
    .trim();
  // Nazwa kończy się tam, gdzie zaczyna się waga albo wzór: „Cena brutto / 80 pkt /”, „– waga punktowa 60”,
  // „Okres gwarancji: G = …”, „Cena Waga liczby punktów: 50”, „Cena netto (w PLN) A n = …”, „Cena-50%”.
  const koniec = bezNumeru.search(/\s\[?waga\b|\s[-–—/|]\s?|[:=(|]|\.\s|-\s*\d|\s\d+(?:[.,]\d+)?\s*%/i);
  return (koniec >= 3 ? bezNumeru.slice(0, koniec) : bezNumeru).replace(/[\s.:,;/|–-]+$/, '').trim();
}

function nazwaKryterium(opis) {
  const linie = String(opis ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cytat = String(opis ?? '').match(/kryteri\w*\s*[„"]([^”"]{3,60})[”"]/i)?.[1];
  const wlasciwa = linie.find((l) => !OGOLNIK.test(l));
  const nazwa = OGOLNIK.test(linie[0] ?? '') ? (cytat ?? (wlasciwa ? oczyscNazwe(wlasciwa) : '')) : oczyscNazwe(linie[0] ?? '');
  return nazwa.slice(0, MAKS_NAZWY);
}

const liczba = (s) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * Waga z opisu, od najpewniejszego wzorca: procent w pierwszej linii, „– / 80 pkt” przy nazwie, „waga … 60”,
 * „× 40 pkt” i „× 50” we wzorze, „max 20 pkt”, procent gdziekolwiek, a na końcu największa liczba punktów
 * z progów („24 mies. – 0 pkt; 36 mies. – 20 pkt”). Sprawdza to i tak suma 100 w części.
 */
function wagaZOpisu(opis) {
  const t = String(opis ?? '').replace(/\s+/g, ' ');
  const pierwsza = String(opis ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const wzorce = [
    [pierwsza, /(\d+(?:[.,]\d+)?)\s*%/],
    // „25% - waga kryterium” pod wzorem „G = Go/Gn x 100 pkt x 25%” — to procent jest wagą, nie „100 pkt”.
    [t, /(\d+(?:[.,]\d+)?)\s*%\s*[-–—]?\s*waga/i],
    [pierwsza, /[-–—:/]\s*(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i],
    [t, /waga[^0-9%]{0,30}?(\d+(?:[.,]\d+)?)/i],
    [t, /[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i],
    [t, /maks(?:ymalnie|\.)?\s*(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i],
    [t, /max(?:ymalnie|\.)?\s*(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/i],
    [t, /[x×*]\s*\[?\s*(\d+(?:[.,]\d+)?)\s*\]?(?!\s*(?:mm|cm|m\b|kg|szt|godz|dni|mies))/i],
    [t, /(\d+(?:[.,]\d+)?)\s*%/],
  ];
  for (const [tekst, re] of wzorce) {
    const m = tekst.match(re);
    if (m && liczba(m[1]) !== null && liczba(m[1]) <= 100) return liczba(m[1]);
  }
  const progi = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:pkt|punkt)/gi)].map((m) => Number(m[1].replace(',', '.'))).filter((n) => n > 0 && n <= 100);
  return progi.length ? Math.max(...progi) : null;
}

function listaCzesci(kryteria) {
  const surowe = (Array.isArray(kryteria) ? kryteria : []).filter((k) => k && String(k.description ?? '').trim()).slice(0, MAKS_KRYTERIOW);
  if (!surowe.length) return [];
  let pozycje = surowe.map((k) => {
    const nazwa = nazwaKryterium(k.description) || (k.price_criterion ? 'Cena' : 'Kryterium');
    // Flaga ceny bywa nieustawiona przy kryterium „Cena” — wtedy rozstrzyga nazwa, a gdy ona nic nie mówi, opis.
    let rodzaj = k.price_criterion ? 'cena' : rodzajKryterium(nazwa);
    if (rodzaj === 'inne') rodzaj = rodzajKryterium(String(k.description).slice(0, 300).replace(OGOLNIK, ' '));
    return { nazwa, waga: wagaZOpisu(k.description), rodzaj };
  });
  const brakujace = pozycje.filter((p) => p.waga === null);
  const znane = pozycje.reduce((s, p) => s + (p.waga ?? 0), 0);
  if (brakujace.length === 1 && znane > 0 && znane < 100) brakujace[0].waga = Math.round((100 - znane) * 10) / 10;
  const suma = pozycje.reduce((s, p) => s + (p.waga ?? 0), 0);
  const zgodne = pozycje.every((p) => p.waga !== null) && Math.abs(suma - 100) < 0.6;
  if (!zgodne) pozycje = pozycje.map((p) => ({ ...p, waga: null }));
  return pozycje.map((p) => ({ ...p, udzial: pozycje.length === 1 ? 100 : zgodne ? Math.round(p.waga * 10) / 10 : null }));
}

/**
 * @param {object[]} orders `wersja.orders` z koperty `GET /announcements/{id}`
 * @returns {{lista: object[], sposob: string|null, rozne_w_czesciach: boolean, pozacenowe: boolean}|null}
 */
export function kryteriaZBk(orders) {
  const listy = (Array.isArray(orders) ? orders : []).map((o) => listaCzesci(o?.evaluation_criteria)).filter((l) => l.length);
  if (!listy.length) return null;
  const podpis = (l) => l.map((k) => `${k.rodzaj}|${k.nazwa.toLowerCase()}|${k.waga}`).join(';');
  return {
    lista: listy[0],
    sposob: listy[0].every((k) => k.waga !== null) ? 'punktowo' : null,
    rozne_w_czesciach: listy.some((l) => podpis(l) !== podpis(listy[0])),
    pozacenowe: listy.some((l) => l.some((k) => k.rodzaj !== 'cena')),
  };
}
