import { doUtcIso } from '../lib/daty.js';
import { logger } from '../lib/logger.js';

/*
 * E-PROPUBLICO (Datacomp) — piąte źródło ogłoszeń (2026-10-25). Platforma zakupowa szpitali
 * i gmin; lista `https://e-propublico.pl/Ogloszenia?page=N` jest renderowana po stronie serwera
 * (10 wierszy: sygnatura, temat, zamawiający, termin, status; ~30–60 stron aktywnych), a szczegół
 * `/Ogloszenia/Details/<guid>` jest publiczny (tryb, rodzaj, terminy, data publikacji). Bez CPV,
 * województwa i wartości; załączniki tylko po zalogowaniu. robots.txt: `*` Allow: / (zablokowane
 * tylko boty AI po nazwie). Okno przechodzi całą listę co 6 h z odstępem między żądaniami.
 */
export const ZRODLO = 'epropublico';
export const BAZA = 'https://e-propublico.pl';
export const USER_AGENT = 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)';
export const LIMIT_ODCZYTU_MS = 30_000;

export function adresListy(strona = 1) {
  const n = Math.max(1, Number(strona) || 1);
  return n === 1 ? `${BAZA}/Ogloszenia` : `${BAZA}/Ogloszenia?page=${n}`;
}

export function linkOgloszenia(id) {
  return `${BAZA}/Ogloszenia/Details/${id}`;
}

const odkoduj = (s) => String(s ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** „DD.MM.YYYY HH:MM:SS" (lista) albo „YYYY-MM-DD HH:MM:SS" (szczegół), czas polski → ISO UTC. */
export function terminNaUtc(tekst) {
  const t = String(tekst ?? '');
  let m = t.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return doUtcIso(`${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5] ?? '00'}`);
  m = t.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return doUtcIso(`${m[1]} ${m[2]}:${m[3] ?? '00'}`);
  m = t.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? doUtcIso(m[1]) : null;
}

/**
 * Wiersze tabeli listy. @returns {{pozycje: object[], odrzucone: number}}
 */
export function parsujListe(html) {
  const s = String(html ?? '');
  const tab = s.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tab) return { pozycje: [], odrzucone: 0 };
  const pozycje = [];
  let odrzucone = 0;
  for (const wiersz of tab[1].split(/<tr[\s>]/).slice(1)) {
    const komorki = [...wiersz.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (komorki.length < 4) { odrzucone++; continue; }
    const link = komorki[1].match(/href="\/Ogloszenia\/Details\/([0-9a-f-]{36})"/i);
    const tytul = odkoduj(komorki[1]);
    if (!link || !tytul) { odrzucone++; continue; }
    pozycje.push({
      id: link[1].toLowerCase(),
      sygnatura: odkoduj(komorki[0]) || null,
      tytul,
      zamawiajacy: odkoduj(komorki[2]) || null,
      termin: odkoduj(komorki[3]) || null,
      status: komorki[4] ? odkoduj(komorki[4]) || null : null,
    });
  }
  return { pozycje, odrzucone };
}

/** Pozycja listy → kształt `tenders.upsert`. Tytuł bywa poprzedzony sygnaturą — zostawiamy, to tytuł z rejestru. */
export function normalizujOgloszenieEpp(poz) {
  if (!poz?.id || !GUID.test(poz.id) || !poz?.tytul) return null;
  return {
    externalId: `epp:${poz.id}`,
    title: poz.tytul,
    organization: poz.zamawiajacy || null,
    cpvMain: null,
    budget: null,
    currency: null,
    deadline: terminNaUtc(poz.termin),
    publishedAt: null,
    url: linkOgloszenia(poz.id),
    source: ZRODLO,
    numer: poz.sygnatura || null,
    wojewodztwo: null,
  };
}

/** Pole „Etykieta → wartość" z karty „Informacje o zamówieniu" (label for=...). */
function pole(html, forId) {
  const m = String(html ?? '').match(new RegExp(`<label for="${forId}">[\\s\\S]*?</label>[\\s\\S]*?<div class="col">([\\s\\S]*?)</div>`, 'i'));
  return m ? odkoduj(m[1]) || null : null;
}

/** @returns {{tryb: string|null, rodzaj: string|null, termin: string|null, opublikowano: string|null, zwiazanie: string|null, status: string|null}} */
export function parsujSzczegol(html) {
  const s = String(html ?? '');
  const pub = s.match(/for="DataPublikacji">[\s\S]*?<\/label>\s*:?\s*([0-9:\- ]{10,19})/);
  const status = s.match(/Status przetargu:\s*([^<]+)</);
  return {
    tryb: pole(s, 'TrybPostepowania'),
    rodzaj: pole(s, 'RodzajZamowienia'),
    termin: terminNaUtc(pole(s, 'TerminSkladania')),
    opublikowano: pub ? terminNaUtc(pub[1]) : null,
    zwiazanie: pole(s, 'TerminZwiazaniaOferta'),
    status: status ? odkoduj(status[1]) || null : null,
  };
}

async function pobierz(url, { fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS } = {}) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  try {
    let res;
    try {
      res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: kontroler.signal });
    } catch (err) {
      // Node chowa przyczynę sieciową w `cause` („fetch failed") — bez niej ślad przebiegu nic nie mówi.
      const przyczyna = err?.cause ? ` (${err.cause.code ?? ''} ${err.cause.message ?? ''}`.trimEnd() + ')' : '';
      throw new Error(`e-ProPublico: ${err?.message ?? err}${przyczyna}`, { cause: err });
    }
    if (!res.ok) throw new Error(`e-ProPublico odpowiedziało ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(zegar);
  }
}

export async function pobierzStrone(strona, opcje) {
  const wynik = parsujListe(await pobierz(adresListy(strona), opcje));
  logger.info({ strona, pozycje: wynik.pozycje.length, odrzucone: wynik.odrzucone }, 'e-ProPublico: strona listy pobrana');
  return wynik;
}

export async function pobierzSzczegol(id, opcje) {
  return parsujSzczegol(await pobierz(linkOgloszenia(id), opcje));
}
