/**
 * Meta ogłoszenia wyciągane z `htmlBody` przy ingestii (rundy 5-6) — czysta logika.
 * Format zmierzony na żywo (2026-07-16), nie zgadywany.
 */

function czysty(htmlBody) {
  return String(htmlBody ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Kryterium oceny: czy wygrywa TYLKO najniższa cena, czy liczy się też jakość.
 * @returns {'tylko_cena'|'cena_i_jakosc'|null} null = nie dało się ustalić.
 */
export function parsujKryterium(htmlBody) {
  const t = czysty(htmlBody);
  const i = t.search(/Kryteria oceny ofert/i);
  if (i < 0) return null;
  const okno = t.slice(i, i + 600);
  // Jakość wygrywa nad ceną: gdy pada „jakościowe/jakości", to na pewno nie sama cena.
  if (/jako[śs]ci/i.test(okno)) return 'cena_i_jakosc';
  if (/najni[żz]sz[aą]\s+cen/i.test(okno)) return 'tylko_cena';
  return null;
}

/**
 * Liczba części zamówienia. Podział = mniejsze loty = dostępniejsze dla małej firmy.
 * @returns {number|null} liczba części (≥2 = podzielone, 1 = jawnie niepodzielone), null = nieznane.
 */
export function parsujCzesci(htmlBody) {
  const t = czysty(htmlBody);
  const m = t.match(/podzielone na\s+(\d+)\s*cz[eę][śs]/i);
  if (m) return Number(m[1]);
  // `\bnie\b` z granicą słowa — inaczej „zostaNIE podzielone" łapałoby się jak
  // „NIE podzielone" (słowo „zostanie" zawiera „nie”). Regresja złapana testem.
  if (/\bnie\s+(dopuszcza|przewiduje)\s+(sk[łl]adania\s+)?ofert\s+cz[eę][śs]ciowych/i.test(t)
    || /\bnie\s+(zosta[łl]o\s+)?podzielon[eo]\s+na\s+cz[eę][śs]ci/i.test(t)) {
    return 1;
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * LISTA KRYTERIÓW Z WAGAMI (2026-10-31, z analizy konkurencji: „za co są punkty”).
 * Format zmierzony na 1258 ogłoszeniach BZP z 27–30.10.2026: sekcja „4.3.) Kryteria oceny
 * ofert” (jedna na część zamówienia), w niej nagłówki „Kryterium N”, a pod nimi
 * „4.3.4.) Rodzaj kryterium” (słownik BZP, tylko dla pozacenowych), „4.3.5.) Nazwa
 * kryterium” i „4.3.6.) Waga” (procent albo punkty; „Wg kolejności” = bez wagi).
 * Wagi „Punktowo” nie muszą sumować się do 100 (zmierzone: 40, 90, 106, 112) — udział
 * liczymy z sumy, a gdy choć jednej wagi brak, udziału nie zgadujemy.
 * ---------------------------------------------------------------------------
 */

export const MAKS_KRYTERIOW = 12;
const MAKS_NAZWY_KRYTERIUM = 200;

const ENCJE = Object.freeze({ nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', apos: "'" });

function tekstZHtml(fragment) {
  return String(fragment ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENCJE[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Rodzaj kryterium — po NAZWIE (słownik BZP „4.3.4” jest za ogólny: „serwis posprzedażny,
 * pomoc techniczna, warunki dostawy…” obejmuje i gwarancję, i termin dostawy). Kolejność
 * reguł ma znaczenie: „termin gwarancji” to gwarancja, „termin płatności” to płatność,
 * „termin realizacji reklamacji” to reakcja serwisu, a nie termin wykonania.
 */
const REGULY_RODZAJU = [
  ['gwarancja', /gwarancj|rękojm/i],
  ['platnosc', /płatnoś/i],
  ['cena', /^\W*(?:\d+[.)]\s*|[a-z][.)]\s*)?(?:cen[aąy]\b|koszt|prowizj|oprocentowan|wynagrodzen|stawk)|\bcen[aąy]\s+(?:jednostkow|brutto|netto|oferty|ofertow|za\b)|rabat|upust|opust|marż/i],
  ['spoleczne', /społeczn|bezrobotn|niepełnospraw|umow\w*\s+o\s+pracę|zatrudni|integracj|wykluczeni/i],
  ['umowa', /kar\w*\s+umown|\bkar[ayę](?:\s|\(|$)|ubezpieczeni|klauzul|postanowieni|zabezpieczeni|zaliczk|polis/i],
  ['reakcja', /czas\w*\s+(?:reakcji|reagowania|naprawy|skutecznej naprawy|usunięci|podjęci|dojazdu|przyjazdu|podstawieni|zapewnieni|przywróceni|wymiany|rozpatrzeni|rozpoczęci)|serwis|awari|usterk|reklamac|wsparci\w*\s+techniczn|pogotowi|interwencj|zastępcz|pilnych/i],
  ['termin', /termin|czas\w*\s+(?:dostaw|realizacj|wykonani)|skróceni|okres\w*\s+realizacj|harmonogram/i],
  ['reakcja', /\bczas\b|gotowoś/i],
  ['srodowisko', /środowisk|emisj|euro\s*\d|ekologi|elektryczn|hybryd|zeroemisyj|niskoemisyj|energ|recykl|spalin|co2|węglow/i],
  ['certyfikat', /certyfikat|\biso\b|akredytacj|atest|etykiet|autoryzacj/i],
  ['koncepcja', /koncepcj|metodyk|\bplan\b|organizacj|sposób\s+(?:realizacji|wykonania|organizacji)|\bopis/i],
  ['doswiadczenie', /doświadczeni|doswiadczeni|kwalifikacj|uprawnieni|wykształceni|kompetencj|personel|kadr|ekspert|specjalist|trener|lektor|kierownik|projektant|inspektor/i],
  ['dodatkowe', /dodatkow|bezpłatn|nieodpłatn/i],
  ['dostepnosc', /odległoś|lokalizacj|placów|stacji|siedzib|dostępnoś|otwarcia|śledzeni|monitoring/i],
  ['jakosc', /jakoś|parametr|techniczn|funkcjonaln|estetycz|ergonomi|właściwoś|wydajnoś|\bmoc\b|pojemnoś|zasięg|\bwiek\b|rok\w*\s+produkcji|ocena|próbk|walor|smak|odżywcz|wyposażeni/i],
];

/** Gdy nazwa nic nie mówi (np. „K2”), ratunkiem jest słownik BZP z „4.3.4.) Rodzaj kryterium”. */
const REGULY_RODZAJU_BZP = [
  ['doswiadczenie', /^organizacja, kwalifikacje/i],
  ['jakosc', /^jakość/i],
  ['srodowisko', /^aspekty środowiskowe/i],
  ['spoleczne', /^aspekty społeczne/i],
];

/**
 * @param {string} nazwa nazwa kryterium z ogłoszenia
 * @param {string|null} rodzajBzp słownik BZP (4.3.4) albo null
 * @returns {'cena'|'gwarancja'|'platnosc'|'umowa'|'reakcja'|'termin'|'spoleczne'|'srodowisko'|'certyfikat'|'koncepcja'|'doswiadczenie'|'dodatkowe'|'dostepnosc'|'jakosc'|'inne'}
 */
export function rodzajKryterium(nazwa, rodzajBzp = null) {
  const n = String(nazwa ?? '');
  for (const [rodzaj, re] of REGULY_RODZAJU) if (re.test(n)) return rodzaj;
  const r = String(rodzajBzp ?? '');
  for (const [rodzaj, re] of REGULY_RODZAJU_BZP) if (re.test(r)) return rodzaj;
  return 'inne';
}

function liczbaWagi(tekst) {
  const m = String(tekst ?? '').replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function kryteriaSekcji(fragment) {
  const bloki = fragment.split(/>\s*Kryterium\s+\d+\s*</).slice(1);
  const lista = [];
  for (const b of bloki) {
    const nazwa = tekstZHtml(b.match(/4\.3\.5\.\)\s*Nazwa kryterium:([\s\S]*?)<\/h3>/)?.[1]).slice(0, MAKS_NAZWY_KRYTERIUM);
    if (!nazwa) continue;
    const waga = liczbaWagi(tekstZHtml(b.match(/4\.3\.6\.\)\s*Waga:([\s\S]*?)<\/h3>/)?.[1]));
    const rodzajBzp = tekstZHtml(b.match(/4\.3\.4\.\)\s*Rodzaj kryterium:\s*<\/h3>([\s\S]*?)<h3/)?.[1]) || null;
    lista.push({ nazwa, waga, rodzaj: rodzajKryterium(nazwa, rodzajBzp) });
    if (lista.length >= MAKS_KRYTERIOW) break;
  }
  const suma = lista.reduce((s, k) => s + (k.waga ?? 0), 0);
  const pelne = lista.length > 0 && lista.every((k) => k.waga !== null) && suma > 0;
  return lista.map((k) => ({ ...k, udzial: pelne ? Math.round((k.waga / suma) * 1000) / 10 : null }));
}

/**
 * Kryteria oceny z wagami. Zamówienie w częściach ma sekcję 4.3 na KAŻDĄ część — bierzemy
 * pierwszą, a `rozne_w_czesciach` mówi, że w innej części kryteria albo wagi są inne
 * (54 na 365 wieloczęściowych w próbce) — wtedy apka odsyła do SWZ zamiast udawać pewność.
 * @returns {{lista: {nazwa: string, waga: number|null, udzial: number|null, rodzaj: string}[], sposob: 'procentowo'|'punktowo'|'kolejnosc'|null, rozne_w_czesciach: boolean, pozacenowe: boolean}|null}
 */
export function parsujKryteria(htmlBody) {
  const h = String(htmlBody ?? '');
  const starty = [...h.matchAll(/4\.3\.\)\s*Kryteria oceny ofert/g)].map((m) => m.index);
  if (!starty.length) return null;
  const sekcje = starty.map((s, i) => {
    const fragment = h.slice(s, starty[i + 1] ?? h.length);
    const koniec = fragment.search(/4\.3\.10\.\)|SEKCJA V\b/);
    return koniec > 0 ? fragment.slice(0, koniec) : fragment;
  });
  const listy = sekcje.map(kryteriaSekcji).filter((l) => l.length);
  if (!listy.length) return null;
  const sposobTekst = tekstZHtml(sekcje[0].match(/4\.3\.2\.\)\s*Sposób określania wagi kryteriów oceny ofert:([\s\S]*?)<\/h3>/)?.[1]).toLowerCase();
  const sposob = sposobTekst.startsWith('procent') ? 'procentowo'
    : sposobTekst.startsWith('punkt') ? 'punktowo'
      : sposobTekst.includes('kolejno') ? 'kolejnosc' : null;
  const podpis = (l) => l.map((k) => `${k.nazwa.toLowerCase()}|${k.waga}`).join(';');
  return {
    lista: listy[0],
    sposob,
    rozne_w_czesciach: listy.some((l) => podpis(l) !== podpis(listy[0])),
    // W KTÓREJKOLWIEK części liczy się coś poza ceną (np. 2026/BZP 00511392: części 1–2 i 4–6
    // tylko cena, część 3 cena 60 + jakość 40) — to decyduje o „tylko cena” całego przetargu.
    pozacenowe: listy.some((l) => l.some((k) => k.rodzaj !== 'cena')),
  };
}

const liczbaLubNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Odpowiedź `GET /wygrywalnosc/tender/:id/kryteria` — sama lista z ogłoszenia; wskazówki
 * „co zadeklarować” i pytania do SWZ składa aplikacja (dwujęzycznie). Bez listy (inne
 * rejestry, starsze ogłoszenia bez uzupełnienia) — `dostepne: false`, nie błąd.
 */
export function kryteriaPrzetargu(tender) {
  const lista = (Array.isArray(tender?.kryteria) ? tender.kryteria : [])
    .filter((k) => k && typeof k.nazwa === 'string' && k.nazwa.trim())
    .slice(0, MAKS_KRYTERIOW);
  if (!lista.length) return { dostepne: false, powod: 'brak_listy', kryterium_oceny: tender?.kryterium_oceny ?? null };
  return {
    dostepne: true,
    sposob: tender.kryteria_sposob ?? null,
    rozne_w_czesciach: tender.kryteria_rozne_czesci === true,
    liczba_czesci: liczbaLubNull(tender.liczba_czesci),
    kryteria: lista.map((k) => ({
      nazwa: k.nazwa.trim(),
      waga: liczbaLubNull(k.waga),
      udzial: liczbaLubNull(k.udzial),
      rodzaj: typeof k.rodzaj === 'string' ? k.rodzaj : rodzajKryterium(k.nazwa),
    })),
  };
}

/**
 * Wynik parsera kryteriów (BZP / TED / platformazakupowa) → pola przetargu. Jedno miejsce, żeby
 * każdy rejestr zapisywał to samo: lista, sposób, różne części i `kryterium_oceny` wyliczone z listy.
 */
export function polaKryteriow(k) {
  if (!k?.lista?.length) return {};
  return {
    kryteria: k.lista,
    kryteria_sposob: k.sposob ?? null,
    kryteria_rozne_czesci: k.rozne_w_czesciach ?? false,
    kryterium_oceny: k.pozacenowe ? 'cena_i_jakosc' : 'tylko_cena',
  };
}

/** Ile rodzajów pokazuje karta na liście — reszta jako „+N”. */
export const MAKS_W_SKROCIE = 3;

/**
 * Skrót kryteriów do KARTY NA LIŚCIE (2026-10-31): „Cena 60% · Gwarancja 40%” bez otwierania
 * przetargu. Rodzaje zsumowane (dwa kryteria jakości = jedna pozycja), najcięższe najpierw.
 * Feed i Zapisane czytają kopię w dopasowaniu (`tender_kryteria_skrot`), bo lista renderuje się
 * bez odczytu przetargu. Bez listy — null.
 * @returns {{kryteria: {rodzaj: string, udzial: number|null}[], reszta: number, rozne_w_czesciach: boolean}|null}
 */
export function skrotKryteriow(tender) {
  const k = kryteriaPrzetargu(tender);
  if (!k.dostepne) return null;
  const wgRodzaju = new Map();
  for (const x of k.kryteria) {
    const p = wgRodzaju.get(x.rodzaj);
    if (!p) wgRodzaju.set(x.rodzaj, { rodzaj: x.rodzaj, udzial: x.udzial });
    else p.udzial = p.udzial !== null && x.udzial !== null ? p.udzial + x.udzial : null;
  }
  const pozycje = [...wgRodzaju.values()]
    .map((p) => ({ rodzaj: p.rodzaj, udzial: p.udzial === null ? null : Math.round(p.udzial * 10) / 10 }))
    .sort((a, b) => (b.udzial ?? -1) - (a.udzial ?? -1));
  return {
    kryteria: pozycje.slice(0, MAKS_W_SKROCIE),
    reszta: Math.max(0, pozycje.length - MAKS_W_SKROCIE),
    rozne_w_czesciach: k.rozne_w_czesciach,
  };
}
