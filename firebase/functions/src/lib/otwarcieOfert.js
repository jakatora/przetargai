/*
 * INFORMACJA Z OTWARCIA OFERT (2026-11-01). Art. 222 ust. 4–5 Pzp: przed otwarciem zamawiający podaje
 * kwotę, jaką zamierza przeznaczyć na zamówienie, a po otwarciu — wykonawców i ceny ofert. Publikuje to
 * na e-Zamówieniach jako PDF (57 takich plików w 25 postępowaniach BZP z ostatniego tygodnia, 1.11),
 * a ogłoszenie o wyniku w BZP przychodzi dopiero po tygodniach. Czytamy tekst PDF-a i wyciągamy:
 *  • kwotę zamawiającego (podpowiedź do wyceny jeszcze przed terminem),
 *  • liczbę ofert i rozpiętość cen (gdzie stoi Twoja oferta, ilu jest konkurentów).
 *
 * Formatów jest wiele (zdania, tabele, części), więc parser jest ostrożny: przy częściach nie liczymy
 * cen (tylko kwoty części), kwoty netto i drobne (ceny jednostkowe, VAT) odsiewamy, a niepewny wynik
 * to brak pola, nie zgadywanie. CZYSTA funkcja na liniach tekstu (`services/tekstPdf.js`).
 */

const KWOTA = /(\d{1,3}(?:[  .]\d{3})+(?:[,.]\d{1,2})?|\d{1,9}(?:,\d{1,2})?)\s*(?:zł(?:otych|ote)?|zl\b|PLN)/gi;
/** Kwota z groszami bez waluty — w tabelach „Cena ofertowa brutto w PLN” waluta stoi tylko w nagłówku. */
const KWOTA_BEZ_WALUTY = /(?<![\d,.])(\d{1,3}(?:[  .]\d{3})+,\d{2}|\d{4,9},\d{2})(?!\d)/g;
const ZNACZNIK_KWOTY = /kwot\w*\s+(?:brutto\s+)?(?:jak[aą]\s+zamawiaj\w*\s+(?:zamierza|mo[żz]e)|przeznacz|na\s+sfinansowani|na\s+realizacj|zamawiaj\w*\s+zamierza)|zamierza\s+przeznaczy[ćc]/i;
const ZNACZNIK_OFERT = /otwarto\s+oferty|z[łl]o[żz]y[łl][aiy]?\s+(?:nast[ęe]puj[aą]ce\s+)?ofert|wykaz\s+(?:z[łl]o[żz]onych\s+)?ofert|wp[łl]yn[ęe][łl]\w*\s+(?:nast[ęe]puj[aą]ce\s+)?ofert|z[łl]o[żz]ono\s+(?:nast[ęe]puj[aą]ce\s+)?ofert|oferty\s+z[łl]o[żz]y(?:li|[łl]y)|nazwa\s+(?:\(firma\)\s+)?(?:i\s+adres\s+)?wykonawc/i;

const liczba = (s) => {
  let t = String(s).replace(/[  ]/g, '');
  // „527.143.56” — kropki tysięcy i kropka groszy; „55.536,37” — kropki tysięcy, przecinek groszy.
  if (/^\d{1,3}(?:\.\d{3})+\.\d{1,2}$/.test(t)) t = t.replace(/\.(?=\d{1,2}$)/, ',');
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** NIP, REGON, KRS, telefony i kody pocztowe sklejają się z kwotami w tabelach („NIP 997 015 97 63 451 656,00”). */
function bezNumerow(tekst) {
  return String(tekst)
    // NIP tylko w swoich formatach (3-3-2-2, 3-2-2-3, 10 cyfr) — szerszy wzorzec zjadał początek ceny obok.
    .replace(/\bNIP\s*:?\s*(?:\d{3}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}|\d{3}[ -]?\d{2}[ -]?\d{2}[ -]?\d{3})\b/gi, ' ')
    .replace(/\b(?:REGON|KRS)\s*:?\s*\d{9,14}\b/gi, ' ')
    .replace(/\b(?:tel\.?|telefon|fax|faks)\s*:?\s*\+?\d[\d ]{7,14}\d/gi, ' ')
    .replace(/\b\d{2}-\d{3}\b/g, ' ');
}

/** Punkty, procenty, miesiące gwarancji, dni — liczby z przecinkiem, które nie są cenami. */
const NIE_CENA_PO = /^\s*(?:pkt|punkt|%|mies|m-c|dni|lat|godz|h\b)/i;

function kwotyW(tekst, { bezWaluty = false } = {}) {
  const t = bezNumerow(tekst);
  const z = (wzor) => [...t.matchAll(wzor)]
    .map((m) => ({ kwota: liczba(m[1]), at: m.index, przed: t.slice(Math.max(0, m.index - 60), m.index), po: t.slice(m.index + m[1].length, m.index + m[1].length + 10) }));
  // Bez waluty: wszystkie kwoty z groszami + te z walutą (bez groszy) — w jednej tabeli bywa „168 000,00 PLN”
  // i zaraz „158 694,93” bez waluty; jedna liczba liczona raz (po pozycji).
  const wszystkie = bezWaluty ? [...z(KWOTA_BEZ_WALUTY), ...z(KWOTA)] : z(KWOTA);
  const poPozycji = new Map();
  for (const k of wszystkie) if (!poPozycji.has(k.at)) poPozycji.set(k.at, k);
  return [...poPozycji.values()]
    .sort((a, b) => a.at - b.at)
    .filter((k) => k.kwota !== null && k.kwota > 0 && !NIE_CENA_PO.test(k.po));
}

/**
 * @param {string[]|string} linie tekst PDF-a (linie albo całość)
 * @returns {{kwota: number|null, kwoty_czesci: number[]|null, oferty: number|null, cena_min: number|null, cena_max: number|null, czesci: boolean}|null}
 */
export function parsujOtwarcie(linie) {
  // PDF-y rozrywają liczby i słowa: „215 275, 00 zł”, „z ł”, „ofert a” — skleja to, co zwykle trzeba.
  const tekst = (Array.isArray(linie) ? linie.join('\n') : String(linie ?? ''))
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*,\s+(\d{2})\b/g, '$1,$2')
    .replace(/\bz\s+ł\b/g, 'zł');
  if (!tekst.trim()) return null;
  const iKwoty = tekst.search(ZNACZNIK_KWOTY);
  const iOfert = tekst.search(ZNACZNIK_OFERT);

  let kwota = null;
  let kwotyCzesci = null;
  if (iKwoty >= 0) {
    const koniec = iOfert > iKwoty ? iOfert : Math.min(tekst.length, iKwoty + 500);
    const fragment = tekst.slice(iKwoty, koniec);
    const kwoty = kwotyW(fragment).filter((k) => !/netto\s*$/i.test(k.przed.slice(-12)));
    if (kwoty.length) {
      if (/cz[ęe][śs][ćc]/i.test(fragment) && kwoty.length > 1) {
        // Średnie ceny jednostkowe przy częściach („średnia cena brutto 53,89 zł”) to nie kwoty części.
        kwotyCzesci = kwoty.filter((k) => !/[śs]redni|jednostk/i.test(k.przed.slice(-30))).map((k) => k.kwota).slice(0, 20);
        kwota = kwotyCzesci.length ? Math.round(kwotyCzesci.reduce((s, v) => s + v, 0) * 100) / 100 : null;
        if (kwotyCzesci.length < 2) kwotyCzesci = null;
      } else {
        kwota = kwoty[0].kwota;
      }
    }
    // Kwota na całe zamówienie poniżej 1000 zł to prawie zawsze źle złapana liczba („81”), nie budżet.
    if (kwota !== null && kwota < 1000) { kwota = null; kwotyCzesci = null; }
  }

  let oferty = null;
  let cenaMin = null;
  let cenaMax = null;
  let czesci = Boolean(kwotyCzesci);
  if (iOfert >= 0) {
    const sekcja = tekst.slice(iOfert);
    if (/cz[ęe][śs][ćc]\w*\s*(?:nr\s*)?\d/i.test(sekcja)) czesci = true;
    if (!czesci) {
      const prog = kwota ? kwota * 0.05 : 100;
      // Waluta tylko w nagłówku tabeli („Cena ofertowa brutto w PLN”) — wtedy kwoty z groszami bez waluty.
      const zrodlo = kwotyW(sekcja, { bezWaluty: /brutto|PLN|zł/i.test(sekcja) });
      const ceny = zrodlo
        .filter((k) => !/netto[^b]{0,25}$/i.test(k.przed) || /brutto/i.test(k.przed.slice(-25)))
        .map((k) => k.kwota)
        .filter((v) => v >= prog && !(kwota && Math.abs(v - kwota) < 0.01));
      // Oferta ponad 5× kwoty zamawiającego (1.11: „54 443 500,00” przy kwocie 362 000) to wciąż oferta —
      // liczy się do liczby ofert, ale nie do rozpiętości cen. Rozrzut ponad 8× = sklejone numery: nic.
      const wiarygodne = kwota ? ceny.filter((v) => v <= kwota * 5) : ceny;
      const spojne = wiarygodne.length && Math.max(...wiarygodne) <= Math.min(...wiarygodne) * 8;
      if (spojne && ceny.length <= 40) {
        oferty = ceny.length;
        cenaMin = Math.min(...wiarygodne);
        cenaMax = Math.max(...wiarygodne);
      }
      // „wpłynęło 10 ofert”, „wpłynęła (1) oferta” — liczba podana wprost wygrywa z policzoną.
      const wprost = tekst.match(/wp[łl]yn[ęe][łl]\w*\s+\(?\s*(\d{1,2})\s*\)?\s+ofert/i);
      if (wprost && oferty !== null) oferty = Number(wprost[1]);
    }
  }

  if (kwota === null && oferty === null) return null;
  return { kwota, kwoty_czesci: kwotyCzesci, oferty, cena_min: cenaMin, cena_max: cenaMax, czesci };
}

const zl = (n) => `${Math.round(n).toLocaleString('pl-PL')} zł`;
const pln = (n) => `PLN ${Math.round(n).toLocaleString('en-GB')}`;

/** Odmiana: 1 oferta, 2–4 oferty, 5+ ofert (12–14 jak 5). */
function oferty(n) {
  const d = n % 100;
  const j = n % 10;
  if (n === 1) return '1 oferta';
  return `${n} ${j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? 'oferty' : 'ofert'}`;
}

/**
 * Zdanie do alertu i karty: „6 ofert z ceną: od 158 695 zł do 552 964 zł; zamawiający przeznaczył 195 457 zł.”
 * Bez danych — null.
 */
export function opisOtwarcia(o) {
  if (!o) return null;
  const pl = [];
  const en = [];
  if (o.oferty) {
    const zakres = o.cena_min !== null && o.cena_max !== null && o.cena_min !== o.cena_max
      ? { pl: `od ${zl(o.cena_min)} do ${zl(o.cena_max)}`, en: `from ${pln(o.cena_min)} to ${pln(o.cena_max)}` }
      : o.cena_min !== null ? { pl: zl(o.cena_min), en: pln(o.cena_min) } : null;
    pl.push(`${oferty(o.oferty)} z ceną${zakres ? `: ${zakres.pl}` : ''}`);
    en.push(`${o.oferty} priced bid${o.oferty === 1 ? '' : 's'}${zakres ? `: ${zakres.en}` : ''}`);
  }
  if (o.kwota) {
    pl.push(`zamawiający przeznaczył ${zl(o.kwota)}`);
    en.push(`the buyer budgeted ${pln(o.kwota)}`);
  }
  if (!pl.length) return null;
  return { pl: `${pl.join('; ')}.`, en: `${en.join('; ')}.` };
}

/**
 * Scala odczyt nowego PDF-a z tym, co już wiemy o przetargu: kwota z pisma „przed otwarciem” zostaje,
 * gdy informacja z otwarcia jej nie powtarza; oferty bierzemy z najnowszego pisma, które je ma.
 */
export function scalOtwarcie(poprzednie, odczyt, dokument) {
  const p = poprzednie && typeof poprzednie === 'object' ? poprzednie : {};
  const w = odczyt ?? {};
  const maOferty = Number.isFinite(w.oferty);
  return {
    kwota: w.kwota ?? p.kwota ?? null,
    kwoty_czesci: w.kwoty_czesci ?? p.kwoty_czesci ?? null,
    oferty: maOferty ? w.oferty : p.oferty ?? null,
    cena_min: maOferty ? w.cena_min : p.cena_min ?? null,
    cena_max: maOferty ? w.cena_max : p.cena_max ?? null,
    czesci: Boolean(w.czesci || p.czesci),
    dokument: dokument ? { id: dokument.id, nazwa: dokument.nazwa ?? null, url: dokument.url ?? null, opublikowano: dokument.opublikowano ?? null } : p.dokument ?? null,
    przeczytane: [...new Set([...(p.przeczytane ?? []), ...(dokument?.id ? [dokument.id] : [])])].slice(-20),
  };
}
