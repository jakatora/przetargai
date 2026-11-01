import { doUtcIso } from '../lib/daty.js';
import { logger } from '../lib/logger.js';
import { rodzajKryterium, MAKS_KRYTERIOW } from '../lib/ogloszenieMeta.js';

/*
 * PLATFORMAZAKUPOWA.PL (Open Nexus) — czwarte źródło ogłoszeń (2026-10-25), zapas na przerwy
 * e-Zamówienia (23–25.10 BZP dawało ~0 nowych ogłoszeń) i uzupełnienie postępowań, które
 * zamawiający prowadzą tylko na platformie. Publiczne listowanie `/all?page=N&limit=100&query=`
 * nie wymaga logowania (HTML z serwera, 100 pozycji na stronę, posortowane po TERMINIE rosnąco,
 * ~4 700 aktywnych); szczegół `/transakcja/<id>` wymaga przejścia cichego SSO z ciasteczkami,
 * więc w tej wersji bierzemy TYLKO listę: tytuł, zamawiający, termin, link. Bez CPV i województwa
 * (null — reguły selekcji „brak danych nie odrzuca”), dopasowanie po słowach z tytułu.
 * Lista miesza zamówienia publiczne z zakupami firm prywatnych — tytuł i zamawiający są
 * widoczne, a klient i tak decyduje po karcie firmy.
 *
 * Uprzejmość wobec serwisu: `robots.txt` ma `Crawl-delay: 900`; okno pobiera 2 strony na
 * godzinę (48 żądań/dobę), kursor stron w checkpoincie — pełne przejście co ~dobę.
 */
export const ZRODLO = 'platformazakupowa';
export const BAZA = 'https://platformazakupowa.pl';
export const POZYCJI_NA_STRONE = 100;
export const USER_AGENT = 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)';
export const LIMIT_ODCZYTU_MS = 30_000;

export function adresListy(strona = 1) {
  return `${BAZA}/all?page=${Math.max(1, Number(strona) || 1)}&limit=${POZYCJI_NA_STRONE}&query=`;
}

export function linkOgloszenia(id) {
  return `${BAZA}/transakcja/${id}`;
}

const odkoduj = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** „DD-MM-YYYY HH:MM:SS" (czas polski, tak pokazuje lista) → ISO UTC albo null. */
export function terminZListy(tekst) {
  const m = String(tekst ?? '').match(/(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return doUtcIso(`${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`);
}

/**
 * Pozycje z HTML listy. Każda to `div.auction-row` z `a.auction-title` (tytuł z sufiksem
 * „(ID <id>)"), nazwą zamawiającego w kolejnej linii i terminem w `b[title="… Europe/Warsaw"]`.
 * Parser jest tolerancyjny: brak id albo tytułu = pozycja odrzucona (liczona w `odrzucone`).
 * @returns {{pozycje: object[], odrzucone: number, stron: number|null}}
 */
export function parsujListe(html) {
  const tekst = String(html ?? '');
  const bloki = tekst.split(/<div class="col-md-12 auction-row/).slice(1);
  const pozycje = [];
  let odrzucone = 0;
  for (const blok of bloki) {
    const tytulM = blok.match(/<a[^>]*href="\/transakcja\/(\d+)"[^>]*class="[^"]*auction-title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!tytulM) { odrzucone++; continue; }
    const id = tytulM[1];
    const tytul = odkoduj(tytulM[2]).replace(/\s*\(ID \d+\)\s*$/, '').trim();
    if (!tytul) { odrzucone++; continue; }
    const poTytule = blok.slice(blok.indexOf(tytulM[0]) + tytulM[0].length);
    const zamawiajacyM = poTytule.match(/<\/b>\s*<br\s*\/?>\s*([\s\S]*?)<br\s*\/?>/);
    const zamawiajacy = zamawiajacyM ? odkoduj(zamawiajacyM[1]) : '';
    const terminM = blok.match(/title="(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}) Europe\/Warsaw"/);
    pozycje.push({ id, tytul, zamawiajacy, termin: terminM ? terminM[1] : null });
  }
  const strony = [...tekst.matchAll(/[?&]page=(\d+)&/g)].map((m) => Number(m[1]));
  return { pozycje, odrzucone, stron: strony.length ? Math.max(...strony) : null };
}

/** Pozycja listy → kształt `tenders.upsert` (bez CPV, województwa i wartości — lista ich nie ma). */
export function normalizujOgloszeniePz(poz) {
  if (!poz?.id || !poz?.tytul) return null;
  return {
    externalId: `pz:${poz.id}`,
    title: poz.tytul,
    organization: poz.zamawiajacy || null,
    cpvMain: null,
    budget: null,
    currency: null,
    deadline: terminZListy(poz.termin),
    publishedAt: null,
    url: linkOgloszenia(poz.id),
    source: ZRODLO,
    numer: `ID ${poz.id}`,
    wojewodztwo: null,
  };
}

/**
 * Jedna strona listy. 403/5xx → wyjątek z kodem (okno zalicza błąd i próbuje za godzinę).
 * @param {number} strona
 * @param {{fetchFn?: Function, limitMs?: number}} [opcje]
 */
export async function pobierzStrone(strona, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  try {
    const res = await fetchFn(adresListy(strona), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: kontroler.signal });
    if (!res.ok) throw new Error(`platformazakupowa odpowiedziała ${res.status}`);
    const html = await res.text();
    const wynik = parsujListe(html);
    logger.info({ strona, pozycje: wynik.pozycje.length, odrzucone: wynik.odrzucone }, 'platformazakupowa: strona listy pobrana');
    return wynik;
  } finally {
    clearTimeout(zegar);
  }
}

/*
 * SZCZEGÓŁ POSTĘPOWANIA `/transakcja/<id>` — NA ŻĄDANIE (2026-10-25). Strona bez ciasteczek
 * zwraca meta refresh do cichego SSO Open Nexus; po przejściu łańcucha (refresh → 302
 * `login_required` → 302 z powrotem) ten sam słoik ciasteczek dostaje pełną stronę. Pobieramy
 * tylko to, czego lista nie ma: tryb (odsiewa prywatne „zapytania ofertowe” od Pzp), rodzaj,
 * datę publikacji, wymagania (skrót) i LISTĘ załączników z linkami — plików nie ściągamy
 * (robots: `Disallow: /file/get_new/*`), użytkownik otwiera je sam. Wołane z trasy, nie z crona,
 * więc liczba żądań = liczba zainteresowanych użytkowników, a wynik jest cache'owany na ogłoszeniu.
 */
export const MAKS_DL_WYMAGAN = 3000;
export const MAKS_ZALACZNIKOW = 40;

const tekstBezTagow = (html) => odkoduj(String(html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/ *\n */g, '\n');

/** Wartość pozycji „<div>Etykieta</div><div>wartość</div>" z listy informacji o postępowaniu. */
function polePostepowania(html, etykieta) {
  const re = new RegExp(`<li class="proceeding-info-list-item">\\s*<div>\\s*${etykieta}[\\s\\S]*?</div>\\s*<div[^>]*>([\\s\\S]*?)</div>\\s*</li>`, 'i');
  const m = String(html ?? '').match(re);
  return m ? odkoduj(m[1].replace(/<[^>]+>/g, ' ')) : null;
}

/** Data + czas z pozycji listy („2026-10-20 21:33:00" w <span>ach) → ISO UTC albo null. */
function dataZPozycji(tekst) {
  const m = String(tekst ?? '').match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  return m ? doUtcIso(`${m[1]} ${m[2]}`) : null;
}

/**
 * @returns {{tryb: string|null, rodzaj: string|null, opublikowano: string|null, termin: string|null,
 *   wymagania: string|null, zalaczniki: {nazwa: string, rozszerzenie: string|null, rozmiar_kb: number|null, opublikowano: string|null, url: string|null}[]}}
 */
/**
 * Kryteria oceny z tabeli „Kryteria i warunki formalne” (2026-11-01) — ten sam kształt co
 * `parsujKryteria` (BZP) i `parsujKryteriaTed`, żeby karta „Za co są punkty” i znacznik na liście
 * działały też dla platformazakupowa.pl. Wiersz z wagą („100%”) to kryterium oceny; wiersz z „-”
 * to warunek formalny („Warunki płatności”, „Termin realizacji”) i do punktów się nie liczy.
 * Sama „Cena” bez wagi przy samych warunkach formalnych = jedyne kryterium (zapytania spółek).
 * Kilka części = kilka tabel; różne → `rozne_w_czesciach`.
 */
export function parsujKryteriaPz(html) {
  const tabele = [...String(html ?? '').matchAll(/<table[^>]*table-criterium[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1]);
  const listy = tabele.map((tbody) => {
    const wiersze = [];
    for (const wiersz of tbody.split(/<tr[\s>]/).slice(1)) {
      const komorki = [...wiersz.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => odkoduj(m[1].replace(/<[^>]+>/g, ' ')));
      if (komorki.length < 3 || !komorki[1]) continue;
      const m = komorki[2].match(/^(\d+(?:[.,]\d+)?)\s*(%|pkt)?$/i);
      wiersze.push({ nazwa: komorki[1].slice(0, 200), waga: m ? Number(m[1].replace(',', '.')) : null, procent: m?.[2] === '%', rodzaj: rodzajKryterium(komorki[1]) });
    }
    let punktowane = wiersze.filter((w) => w.waga !== null);
    if (!punktowane.length) punktowane = wiersze.filter((w) => w.rodzaj === 'cena').slice(0, 1);
    const lista = punktowane.slice(0, MAKS_KRYTERIOW);
    const suma = lista.reduce((a, k) => a + (k.waga ?? 0), 0);
    const pelne = lista.every((k) => k.waga !== null) && suma > 0;
    return lista.map((k) => ({
      nazwa: k.nazwa, waga: k.waga, rodzaj: k.rodzaj, procent: k.procent,
      udzial: lista.length === 1 ? 100 : pelne ? Math.round((k.waga / suma) * 1000) / 10 : null,
    }));
  }).filter((l) => l.length);
  if (!listy.length) return null;
  const podpis = (l) => l.map((k) => `${k.nazwa.toLowerCase()}|${k.waga}`).join(';');
  return {
    lista: listy[0].map(({ procent: _p, ...k }) => k),
    sposob: listy[0].some((k) => k.waga !== null) ? (listy[0].some((k) => k.procent) ? 'procentowo' : 'punktowo') : null,
    rozne_w_czesciach: listy.some((l) => podpis(l) !== podpis(listy[0])),
    pozacenowe: listy.some((l) => l.some((k) => k.rodzaj !== 'cena')),
  };
}

export function parsujSzczegol(html) {
  const s = String(html ?? '');
  const tryb = polePostepowania(s, 'Tryb');
  const rodzaj = polePostepowania(s, 'Rodzaj');
  const opublikowano = dataZPozycji(polePostepowania(s, 'Zamieszczenia'));
  const termin = dataZPozycji(polePostepowania(s, 'Składania'));
  const wymM = s.match(/<!-- REQUIREMENTS & SPECIFICATION -->([\s\S]*?)(?:<!-- ATTACHMENTS TABLE -->|$)/);
  const wymagania = wymM ? tekstBezTagow(wymM[1]).replace(/^\s*Wymagania i specyfikacja\s*/i, '').trim().slice(0, MAKS_DL_WYMAGAN) || null : null;
  const zalaczniki = [];
  const tabM = s.match(/id="allAttachmentsTable"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  if (tabM) {
    for (const wiersz of tabM[1].split(/<tr[\s>]/).slice(1)) {
      const komorki = [...wiersz.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (komorki.length < 3) continue;
      const nazwa = odkoduj(komorki[0].replace(/<[^>]+>/g, ' '));
      if (!nazwa) continue;
      const linkM = wiersz.match(/href="(\/\/[^"]+|https?:\/\/[^"]+|\/file\/[^"]+)"/);
      const url = linkM ? (linkM[1].startsWith('//') ? `https:${linkM[1]}` : linkM[1].startsWith('/') ? `${BAZA}${linkM[1]}` : linkM[1]) : null;
      const rozmiar = Number.parseFloat(odkoduj(komorki[2].replace(/<[^>]+>/g, ' ')).replace(',', '.'));
      zalaczniki.push({
        nazwa,
        rozszerzenie: odkoduj(komorki[1].replace(/<[^>]+>/g, ' ')).toLowerCase() || null,
        rozmiar_kb: Number.isFinite(rozmiar) ? Math.round(rozmiar) : null,
        opublikowano: komorki[3] ? dataZPozycji(odkoduj(komorki[3].replace(/<[^>]+>/g, ' '))) : null,
        url,
      });
      if (zalaczniki.length >= MAKS_ZALACZNIKOW) break;
    }
  }
  return { tryb, rodzaj, opublikowano, termin, wymagania, zalaczniki, kryteria: parsujKryteriaPz(s) };
}

/** Słoik ciasteczek do łańcucha SSO: zbiera `Set-Cookie` z odpowiedzi, oddaje nagłówek `Cookie`. */
export function sloikCiasteczek() {
  const mapa = new Map();
  return {
    zbierz(res) {
      const lista = typeof res?.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const c of lista) {
        const [para] = String(c).split(';');
        const i = para.indexOf('=');
        if (i > 0) mapa.set(para.slice(0, i).trim(), para.slice(i + 1).trim());
      }
    },
    naglowek() {
      return [...mapa].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    rozmiar() { return mapa.size; },
  };
}

const MAKS_PRZEKIEROWAN = 8;

async function pobierzZCiasteczkami(url, sloik, fetchFn, signal) {
  let adres = url;
  for (let i = 0; i <= MAKS_PRZEKIEROWAN; i++) {
    const res = await fetchFn(adres, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', ...(sloik.rozmiar() ? { Cookie: sloik.naglowek() } : {}) }, redirect: 'manual', signal });
    sloik.zbierz(res);
    if (res.status >= 300 && res.status < 400) {
      const dokad = res.headers.get('location');
      if (!dokad) return res;
      adres = new URL(dokad, adres).toString();
      continue;
    }
    return res;
  }
  throw new Error('platformazakupowa: za dużo przekierowań w łańcuchu SSO');
}

/**
 * Pełna strona szczegółu po cichym SSO. Zwraca HTML albo rzuca (403/5xx/za dużo przekierowań).
 * @param {string} id
 * @param {{fetchFn?: Function, limitMs?: number}} [opcje]
 */
export async function pobierzSzczegolHtml(id, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  const sloik = sloikCiasteczek();
  try {
    const adres = linkOgloszenia(id);
    let res = await pobierzZCiasteczkami(adres, sloik, fetchFn, kontroler.signal);
    let html = res.ok ? await res.text() : '';
    const refresh = html.match(/http-equiv="refresh"[^>]*url='([^']+)'/i) ?? html.match(/http-equiv="refresh"[^>]*url=([^"'>\s]+)/i);
    if (refresh) {
      const sso = refresh[1].replace(/&amp;/g, '&');
      await pobierzZCiasteczkami(sso, sloik, fetchFn, kontroler.signal); // 302 login_required → 302 z powrotem
      res = await pobierzZCiasteczkami(adres, sloik, fetchFn, kontroler.signal);
      html = res.ok ? await res.text() : '';
    }
    if (!res.ok) throw new Error(`platformazakupowa odpowiedziała ${res.status} na szczegół`);
    if (/http-equiv="refresh"/i.test(html)) throw new Error('platformazakupowa: szczegół nadal za przekierowaniem SSO');
    return html;
  } finally {
    clearTimeout(zegar);
  }
}

export async function pobierzSzczegol(id, opcje) {
  return parsujSzczegol(await pobierzSzczegolHtml(id, opcje));
}
