import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';

/*
 * Kolektor BZP dla „zwiadu cenowego" (ulepszenie „Cenowy zwiad: za ile realnie
 * wygrywa się takie przetargi", podzadanie 3/15).
 *
 * ZAKRES TEGO PODZADANIA: sam transport — pobranie SUROWYCH ogłoszeń o wyniku
 * postępowania i informacji z otwarcia ofert z publicznego API BZP
 * (e-Zamówienia), z obsługą paginacji. BEZ parsowania do modelu
 * `rozstrzygniecie_historyczne` — mapowanie pól to osobne podzadanie. Zwracamy
 * ogłoszenia w postaci NIETKNIĘTEJ (w przeciwieństwie do services/bzp.js, który
 * normalizuje i obcina `htmlBody`), żeby import mógł je później sparsować bez
 * utraty danych. Czytanie ogłoszeń krajowych BZP jest DARMOWE i nie wymaga
 * uwierzytelniania — spójnie z zakazem płatnego API. Szczegóły: runbooks/bzp-api.md.
 *
 * Endpoint jest ten sam co dla ogłoszeń o zamówieniu (GET {BASE}{SEARCH_PATH});
 * różni je tylko parametr `NoticeType`. Dokładne łańcuchy typów dla „wyniku" i
 * „otwarcia ofert" trzeba POTWIERDZIĆ na żywym API (eskalacja #1 z runbooka),
 * dlatego trzymamy je jako nadpisywalne z env, a nie zaszyte na sztywno.
 */

const BASE = env.BZP_API_BASE_URL.replace(/\/+$/, '');
const SEARCH_PATH = env.BZP_SEARCH_PATH.startsWith('/')
  ? env.BZP_SEARCH_PATH
  : `/${env.BZP_SEARCH_PATH}`;

// Typy ogłoszeń dla zwiadu — nadpisywalne z env (spójnie z BZP_NOTICE_TYPE).
// Czytamy je LOKALNIE z process.env (a nie dokładamy do config/env.js), żeby to
// podzadanie nie mieszało się z niezależnym WIP-em w env.js. Pusty łańcuch =>
// strumień świadomie pominięty (nie zmyślamy zapytania). „ContractAwardNotice"
// to rozsądny default dla ogłoszenia o wyniku; typ dla informacji z otwarcia
// ofert wymaga potwierdzenia na żywym API, więc domyślnie jest pusty (skip).
const NOTICE_TYPE_WYNIK = (process.env.BZP_NOTICE_TYPE_WYNIK ?? 'ContractAwardNotice').trim();
const NOTICE_TYPE_OTWARCIE = (process.env.BZP_NOTICE_TYPE_OTWARCIE ?? '').trim();

function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Wyciąga listę ogłoszeń z odpowiedzi API — defensywnie, bo BZP bywa opakowane
 * różnie (te same warianty kształtu co w services/bzp.js). NIE normalizuje pól.
 * @param {any} data sparsowany JSON odpowiedzi
 * @returns {any[]} surowe ogłoszenia (pusta tablica przy nietypowym kształcie)
 */
export function wyodrebnijListe(data) {
  if (Array.isArray(data)) return data;
  const lista = data?.content ?? data?.items ?? data?.notices ?? data?.results ?? data?.data;
  return Array.isArray(lista) ? lista : [];
}

/**
 * Pobiera JEDNĄ stronę surowych ogłoszeń danego typu (faktyczny HTTP).
 * Wydzielone i wstrzykiwalne w `zbierzSurowe`, żeby pętlę paginacji dało się
 * przetestować bez sieci. Zwraca surową listę (bez normalizacji pól).
 * @param {{noticeType: string, from: string, to: string, page: number, size: number}} p
 *   page — numeracja od 0 (przeliczana na PageNumber API od 1).
 * @returns {Promise<any[]>}
 */
async function pobierzStroneHttp({ noticeType, from, to, page, size }) {
  const url = new URL(BASE + SEARCH_PATH);
  url.searchParams.set('NoticeType', noticeType);
  url.searchParams.set('PublicationDateFrom', from);
  url.searchParams.set('PublicationDateTo', to);
  url.searchParams.set('PageSize', String(size));
  url.searchParams.set('PageNumber', String(page + 1)); // API BZP numeruje strony od 1

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BZP API (${noticeType}) odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return wyodrebnijListe(await res.json());
}

/**
 * Pobiera SUROWE ogłoszenia danego typu z BZP, z paginacją. Nie parsuje ich —
 * zwraca dokładnie to, co przysłało API (do późniejszego importu/parsowania).
 *
 * UWAGA (jak w jobs/fetchTenders.js): endpoint BZP ma sklejoną paginację —
 * `PageNumber` bywa ignorowany i każda strona zwraca te same najnowsze N
 * ogłoszeń. Dlatego w praktyce robimy jedno zapytanie z dużym `size`, a pętla
 * `pages` (z fail-safe „strona < size => koniec") jest tylko na wypadek
 * naprawy API. Wołający, który chce dłuższe okno historyczne, podaje jawnie
 * `publishedFrom`/`publishedTo`.
 *
 * @param {{noticeType?: string, publishedFrom?: string, publishedTo?: string,
 *          pages?: number, size?: number,
 *          pobierzStrone?: (p: object) => Promise<any[]>}} opts
 *   pobierzStrone — wstrzykiwalny pobieracz strony (test bez sieci).
 * @returns {Promise<{noticeType: string|null, from: string|null, to: string|null,
 *          strony: number, items: any[], pominieto?: boolean}>}
 */
export async function zbierzSurowe({
  noticeType,
  publishedFrom,
  publishedTo,
  pages = 1,
  size = 500,
  pobierzStrone = pobierzStroneHttp,
} = {}) {
  const typ = (noticeType ?? '').trim();
  if (!typ) {
    // Typ nieskonfigurowany — nie zgadujemy zapytania (spójnie z „nie zmyślamy"
    // z services/gus.js). Strumień po prostu pomijamy do czasu ustawienia env.
    logger.warn('BZP zwiad: typ ogłoszenia nieskonfigurowany — pomijam strumień (nie zmyślam zapytania)');
    return { noticeType: null, from: null, to: null, strony: 0, items: [], pominieto: true };
  }

  const to = publishedTo ?? dateOnly(Date.now());
  const from = publishedFrom ?? dateOnly(Date.now() - env.BZP_LOOKBACK_DAYS * 86_400_000);

  const items = [];
  let strony = 0;
  for (let page = 0; page < pages; page++) {
    const strona = await pobierzStrone({ noticeType: typ, from, to, page, size });
    strony++;
    const lista = Array.isArray(strona) ? strona : [];
    items.push(...lista);
    if (lista.length < size) break; // ostatnia strona wyników (patrz uwaga o paginacji)
  }

  logger.info(
    { noticeType: typ, from, to, strony, items: items.length },
    'BZP zwiad: pobrano surowe ogłoszenia',
  );
  return { noticeType: typ, from, to, strony, items };
}

/**
 * Surowe ogłoszenia o WYNIKU postępowania (za ile wygrano, kto wygrał, ceny).
 * @param {object} [opts] jak w `zbierzSurowe` (bez `noticeType`).
 */
export function zbierzOgloszeniaOWyniku(opts = {}) {
  return zbierzSurowe({ noticeType: NOTICE_TYPE_WYNIK, ...opts });
}

/**
 * Surowe informacje z OTWARCIA ofert (ceny wszystkich ofert — rozrzut).
 * Domyślnie pominięte, dopóki `BZP_NOTICE_TYPE_OTWARCIE` nie zostanie
 * potwierdzone na żywym API (runbooks/bzp-api.md, eskalacja #1).
 * @param {object} [opts] jak w `zbierzSurowe` (bez `noticeType`).
 */
export function zbierzInformacjeZOtwarcia(opts = {}) {
  return zbierzSurowe({ noticeType: NOTICE_TYPE_OTWARCIE, ...opts });
}

// Tryb diagnostyczny: `node src/services/bzpWyniki.js --ping`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  zbierzOgloszeniaOWyniku({ size: 3, pages: 1 })
    .then((wynik) => {
      console.log(`OK — pobrano ${wynik.items.length} surowych ogłoszeń o wyniku (typ=${wynik.noticeType}).`);
      if (wynik.items[0]) {
        console.log('Przykład (surowy):', JSON.stringify(wynik.items[0], null, 2).slice(0, 800));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD BZP zwiad:', err.message);
      process.exit(1);
    });
}
