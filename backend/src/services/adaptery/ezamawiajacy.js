import { utworzAdapter } from './kontrakt.js';
import { logger } from '../../lib/logger.js';
import { isMainModule } from '../../lib/ids.js';
import { tekst, bezTagow, isoData, parseKwotaPL, pierwsza, absolutnyUrl, idZUrl } from './wspolne.js';

/*
 * Adapter eZamawiający (Marketplanet OnePlace / *.ezamawiajacy.pl) — zakładka
 * „Postępowania wyłączone spod stosowania ustawy Pzp". Ulepszenie „Radar zamówień
 * podprogowych — poniżej 170 tys. zł", podzadanie 4/7; wspólny kontrakt
 * `pobierz(branza, region) -> surowe[]` (./kontrakt.js).
 *
 * Te platformy renderują listy postępowań przez GRID zasilany JSON-em (typowo
 * koperta `{ Data: [...] }` / `{ d: { results: [...] } }` / `{ aaData: [...] }`),
 * więc adapter jest JSON-owy (nie scrapuje DOM). Mapowanie pól jest DEFENSYWNE —
 * akceptuje warianty nazw kluczy spotykane w tych gridach (Nazwa/Przedmiot,
 * Zamawiajacy/NazwaZamawiajacego, TerminSkladania/DataZakonczenia, …). Wartość
 * (`WartoscSzacunkowa`) bywa podana i wtedy karmi regułę progu w normalizacji;
 * pole „Tryb" (np. „wyłączone spod ustawy Pzp") trafia do `opis`, żeby wzmocnić
 * heurystykę „prosta procedura" z lib/normalizacjaPodprogowe.js.
 *
 * eZamawiający jest WIELOINSTANCYJNY (osobny host per zamawiający) i nie ma jednego
 * kanonicznego publicznego endpointu wyszukiwania — dokładny host+ścieżkę+parametry
 * gridu należy potwierdzić na żywo i podać przez env przy wpięciu w monitor
 * (podzadanie 6/7). Dlatego domyślnie, bez `EZAMAWIAJACY_SEARCH_PATH`, transport
 * świadomie POMIJA strumień (jak nieskonfigurowany typ w services/bzpWyniki.js) —
 * to nie zgadywanie zapytania. Mapowanie (rdzeń tego podzadania) jest w pełni
 * gotowe i testowane na wiernym fixture JSON, a transport jest wstrzykiwalny.
 */

const ZRODLO = 'ezamawiajacy';
const DOMYSLNY_LIMIT = 50;

const BASE = (process.env.EZAMAWIAJACY_BASE_URL
  ?? 'https://oneplace.marketplanet.pl').replace(/\/+$/, '');
// Ścieżka publicznego wyszukiwania gridu — do potwierdzenia na żywo (6/7).
const SEARCH_PATH = (process.env.EZAMAWIAJACY_SEARCH_PATH ?? '').trim();

/**
 * Wyciąga wiersze postępowań z odpowiedzi gridu — defensywnie wobec typowych
 * kopert Marketplanet/jqGrid/Kendo. Zwraca [] przy nietypowym kształcie.
 * @param {any} json sparsowany JSON odpowiedzi gridu
 * @returns {any[]}
 */
export function wyodrebnijWiersze(json) {
  const d = json?.d ?? json;
  if (Array.isArray(d)) return d;
  const src = d?.Data ?? d?.data ?? d?.results ?? d?.Results
    ?? d?.rows ?? d?.Rows ?? d?.items ?? d?.Items ?? d?.aaData;
  return Array.isArray(src) ? src : [];
}

/**
 * Mapuje pojedynczy wiersz gridu na surowe ogłoszenie (kształt dla normalizacji).
 * Czysta — testowalna bez sieci.
 * @param {any} wiersz element listy z `wyodrebnijWiersze`
 * @returns {import('./kontrakt.js').SuroweOgloszenie}
 */
export function mapujWiersz(wiersz) {
  const r = wiersz && typeof wiersz === 'object' ? wiersz : {};
  const url = pierwsza(r, 'Url', 'url', 'Link', 'link', 'Adres', 'AdresUrl');
  const idPola = pierwsza(r, 'Id', 'id', 'PrzetargId', 'iPrzetargId', 'IdPostepowania', 'Sygnatura', 'Numer');
  const tryb = tekst(pierwsza(r, 'Tryb', 'TrybPostepowania', 'RodzajZamowienia', 'RodzajProcedury'));
  const tytul = bezTagow(pierwsza(r, 'Nazwa', 'Przedmiot', 'PrzedmiotZamowienia', 'Tytul', 'Temat', 'NazwaPostepowania'));
  const opisRaw = bezTagow(pierwsza(r, 'Opis', 'Tresc', 'Szczegoly', 'OpisPrzedmiotu'));

  return {
    zrodlo: ZRODLO,
    id_zewnetrzny: idPola !== null ? String(idPola) : idZUrl(url),
    tytul,
    zamawiajacy: bezTagow(pierwsza(r, 'Zamawiajacy', 'NazwaZamawiajacego', 'Jednostka', 'Organizacja', 'Nabywca')),
    wartosc_netto: parseKwotaPL(pierwsza(r, 'WartoscSzacunkowa', 'WartoscNetto', 'Wartosc', 'SzacunkowaWartosc', 'Kwota')),
    waluta: (tekst(pierwsza(r, 'Waluta', 'currency')) || 'PLN').toUpperCase(),
    termin_skladania: isoData(pierwsza(r, 'TerminSkladaniaOfert', 'TerminSkladania', 'DataZakonczenia', 'TerminSkladaniaWnioskow', 'DataSkladania')),
    data_publikacji: isoData(pierwsza(r, 'DataPublikacji', 'DataOgloszenia', 'DataRozpoczecia', 'DataZamieszczenia', 'DataPublikacjiOgloszenia')),
    link: absolutnyUrl(BASE, url),
    region: tekst(pierwsza(r, 'Wojewodztwo', 'Region', 'Miejscowosc', 'MiejsceRealizacji')),
    branza: tekst(pierwsza(r, 'Kategoria', 'Branza', 'Cpv', 'KodCPV', 'GlownyKodCPV')),
    // „Tryb" (np. „wyłączone spod ustawy Pzp") i tytuł zasilają heurystyki flag.
    opis: [opisRaw, tryb, tytul].filter(Boolean).join(' ') || null,
  };
}

/** Skrót: JSON gridu → surowe ogłoszenia (jak `wyodrebnijListe` w innych adapterach). */
export function wyodrebnijListe(json) {
  return wyodrebnijWiersze(json).map(mapujWiersz);
}

// ── Transport HTTP (wstrzykiwalny w testach) ─────────────────────────────────

async function pobierzTrescHttp(fraza, { limit = DOMYSLNY_LIMIT } = {}) {
  if (!SEARCH_PATH) {
    throw new Error('EZAMAWIAJACY_SEARCH_PATH nieskonfigurowany — brak endpointu gridu');
  }
  const url = new URL(`${BASE}${SEARCH_PATH.startsWith('/') ? '' : '/'}${SEARCH_PATH}`);
  url.searchParams.set('query', fraza);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`eZamawiający grid odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }
  return res.json();
}

/**
 * Kontraktowe `pobierz(branza, region)`. Bez skonfigurowanego `EZAMAWIAJACY_SEARCH_PATH`
 * (i przy domyślnym transporcie) świadomie zwraca [] — patrz nagłówek modułu.
 * @param {string} [branza]
 * @param {string} [region]
 * @param {{limit?: number, pobierzTresc?: Function}} [opts]
 * @returns {Promise<import('./kontrakt.js').SuroweOgloszenie[]>}
 */
export async function pobierz(branza = '', region = '', opts = {}) {
  const { limit = DOMYSLNY_LIMIT, pobierzTresc = pobierzTrescHttp } = opts;
  const fraza = String(branza || region || '').trim();
  if (!fraza) {
    logger.warn('eZamawiający adapter: pusta branża i region — pomijam (nie zmyślam zapytania)');
    return [];
  }
  if (!SEARCH_PATH && pobierzTresc === pobierzTrescHttp) {
    logger.warn('eZamawiający adapter: brak EZAMAWIAJACY_SEARCH_PATH (wieloinstancyjny) — pomijam do konfiguracji w 6/7');
    return [];
  }
  const surowe = wyodrebnijListe(await pobierzTresc(fraza, { limit })).slice(0, limit);
  logger.info({ fraza, pobrano: surowe.length }, 'eZamawiający adapter: zebrano surowe ogłoszenia');
  return surowe;
}

/** Domyślny adapter eZamawiający (kontrakt wspólny dla monitora). */
export const adapter = utworzAdapter({ zrodlo: ZRODLO, pobierz });
export default adapter;

// Tryb diagnostyczny: `node src/services/adaptery/ezamawiajacy.js --ping "dostawa"`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  const fraza = process.argv[process.argv.indexOf('--ping') + 1] || 'dostawa';
  pobierz(fraza, '', { limit: 5 })
    .then((surowe) => {
      console.log(`OK — eZamawiający: ${surowe.length} surowych ogłoszeń dla „${fraza}" (pusto = brak EZAMAWIAJACY_SEARCH_PATH).`);
      if (surowe[0]) console.log('Przykład:', JSON.stringify(surowe[0], null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD eZamawiający adapter:', err.message);
      process.exit(1);
    });
}
