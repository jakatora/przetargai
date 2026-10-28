import { logger } from '../lib/logger.js';

/*
 * DOKUMENTY POSTĘPOWANIA Z E-ZAMÓWIEŃ (sonda 2026-10-26). Ogłoszenie BZP niesie `postepowanie_id`
 * (ocds-148610-<guid>); portal ma publiczne, bezlogowaniowe API read-modeli, z którego korzysta
 * jego własny front (mp-client):
 *   GET /mp-readmodels/api/Search/GetTenderDocuments?tenderId=<id>  → lista plików (SWZ, załączniki)
 *   GET /mp-readmodels/api/Tender/DownloadDocument/<tenderId>/<docId> → plik (Content-Disposition)
 * Postępowania prowadzone POZA platformą (SWZ na stronie zamawiającego) zwracają pustą listę.
 * Dzięki temu Radar SWZ może dociągnąć specyfikację sam — bez wgrywania pliku przez użytkownika.
 */
export const BAZA_API = 'https://ezamowienia.gov.pl/mp-readmodels/api';
export const USER_AGENT = 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)';
/*
 * Limit i ponowienie (2026-10-28): z tego komputera portal odpowiada w ~0,2 s, a z Cloud Functions
 * ~29% żądań wisiało do 20 s i kończyło się „This operation was aborted” (21 z 72 w dobę po wdrożeniu).
 * Objaw zawieszonego połączenia, nie wolnego serwera — krótszy limit i JEDNO ponowienie po zerwaniu
 * (abort / błąd sieci) dają wynik szybciej niż czekanie 20 s. Błędów HTTP nie ponawiamy.
 */
export const LIMIT_ODCZYTU_MS = 8_000;
export const PROB = 2;
export const ODSTEP_PONOWIENIA_MS = 500;
const czyZerwanie = (err) => err?.name === 'AbortError' || /aborted|fetch failed|socket|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(`${err?.message ?? ''} ${err?.cause?.code ?? ''}`);
const ID_POSTEPOWANIA = /^ocds-148610-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_DOKUMENTU = /^ocds-148610-[0-9a-f-]{36}_\d{1,4}$/i;

export function czyIdPostepowania(id) {
  return ID_POSTEPOWANIA.test(String(id ?? ''));
}

export function linkPobrania(postepowanieId, dokumentId) {
  if (!czyIdPostepowania(postepowanieId) || !ID_DOKUMENTU.test(String(dokumentId ?? ''))) return null;
  return `${BAZA_API}/Tender/DownloadDocument/${postepowanieId}/${dokumentId}`;
}

const rozszerzenie = (nazwaPliku) => {
  const m = String(nazwaPliku ?? '').match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Surowa lista z API → kształt jak załączniki platformazakupowa (`nazwa`, `rozszerzenie`, `url`, …),
 * żeby mobile użył tej samej logiki wyboru SWZ. Tylko opublikowane i nieusunięte; posortowane
 * jak na portalu (od najstarszego numeru dokumentu — SWZ zwykle jako pierwszy).
 */
export function normalizujDokumenty(postepowanieId, lista) {
  if (!Array.isArray(lista)) return [];
  const wynik = [];
  for (const d of lista) {
    if (!d || typeof d !== 'object') continue;
    if (d.tenderDocumentState && d.tenderDocumentState !== 'Published') continue;
    if (d.deleteDate) continue;
    const url = linkPobrania(postepowanieId, d.objectId);
    if (!url) continue;
    const plik = typeof d.fileName === 'string' && d.fileName.trim() ? d.fileName.trim() : null;
    const nazwa = (typeof d.name === 'string' && d.name.trim()) || plik || String(d.objectId);
    wynik.push({
      id: String(d.objectId),
      nazwa: nazwa.slice(0, 300),
      plik,
      rozszerzenie: rozszerzenie(plik),
      url,
      opublikowano: typeof d.publishedDate === 'string' ? d.publishedDate : null,
    });
  }
  const numer = (x) => Number((x.id.match(/_(\d+)$/) || [])[1] || 0);
  return wynik.sort((a, b) => numer(a) - numer(b));
}

/** Czy dokument wygląda na specyfikację (SWZ/SIWZ, „specyfikacja warunków”), PDF. */
export function czySwz(dok) {
  const tekst = `${dok?.nazwa ?? ''} ${dok?.plik ?? ''}`;
  return (dok?.rozszerzenie === 'pdf') && /(^|[^a-z])(swz|siwz)([^a-z]|$)|specyfikacj[a-ząę]* warunk/i.test(tekst);
}

export async function pobierzDokumenty(postepowanieId, {
  fetchFn = fetch, limitMs = LIMIT_ODCZYTU_MS, prob = PROB, czekaj = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!czyIdPostepowania(postepowanieId)) throw new Error('Nieprawidłowy identyfikator postępowania e-Zamówień');
  for (let proba = 1; ; proba++) {
    try {
      return await pobierzRaz(postepowanieId, { fetchFn, limitMs });
    } catch (err) {
      if (proba >= prob || !czyZerwanie(err)) throw err;
      logger.info({ postepowanieId, proba, err: err.message }, 'e-Zamówienia: zerwane żądanie dokumentów — ponawiam');
      await czekaj(ODSTEP_PONOWIENIA_MS);
    }
  }
}

async function pobierzRaz(postepowanieId, { fetchFn, limitMs }) {
  const kontroler = new AbortController();
  const zegar = setTimeout(() => kontroler.abort(), limitMs);
  try {
    const res = await fetchFn(`${BAZA_API}/Search/GetTenderDocuments?tenderId=${encodeURIComponent(postepowanieId)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: kontroler.signal,
    });
    // 400 „Brak postępowania o identyfikatorze…” / 404: read-model portalu nie zna tego postępowania
    // (np. ogłoszenie z BZP sprzed indeksacji albo spoza platformy) — dla klienta to „brak dokumentów
    // na platformie”, nie awaria (produkcja 27.10: 2026~BZP_00505033).
    if (res.status === 400 || res.status === 404) {
      logger.info({ postepowanieId, status: res.status }, 'e-Zamówienia: postępowanie nieznane portalowi — brak dokumentów');
      return [];
    }
    if (!res.ok) throw new Error(`e-Zamówienia odpowiedziały ${res.status}`);
    const lista = await res.json();
    const dokumenty = normalizujDokumenty(postepowanieId, lista);
    logger.info({ postepowanieId, dokumenty: dokumenty.length, swz: dokumenty.filter(czySwz).length }, 'e-Zamówienia: dokumenty postępowania pobrane');
    return dokumenty;
  } finally {
    clearTimeout(zegar);
  }
}
