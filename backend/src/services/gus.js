import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { normalize } from '../lib/textNorm.js';

/*
 * Klient publicznego API GUS BDL (Bank Danych Lokalnych) — wskaźniki cen dla
 * branży kontraktu (ulepszenie „pilnowanie waloryzacji i pułapek w umowie",
 * podzadanie 11/12). Czytanie danych BDL jest DARMOWE i nie wymaga klucza —
 * spójnie z zakazem płatnego API.
 *
 * Zweryfikowany kształt odpowiedzi (2026-07, GET {BASE}/data/by-variable/{id}?format=json):
 *   { totalRecords, variableId, ..., results: [ { id, name, values: [ { year, val, attrId } ] } ] }
 * Normalizacja jest DEFENSYWNA (jak w services/bzp.js) — bierzemy najświeższą
 * pozycję z `results[].values[]` i nie wywracamy się na nietypowym kształcie.
 *
 * DOBÓR ZMIENNEJ PO BRANŻY = KONFIGURACJA, nie zaszyte ID. Które ID zmiennej BDL
 * odpowiada której branży (ceny produkcji budowlano-montażowej, ceny transportu,
 * CPI, …) trzeba potwierdzić w katalogu BDL (https://bdl.stat.gov.pl) — dlatego
 * mapowanie wstrzykujemy przez env `GUS_WSKAZNIK_MAP` (JSON: {"budownictwo": 217702}),
 * a nie zgadujemy liczb w kodzie. Branża bez mapowania => job ją pomija (nie
 * zmyślamy wskaźnika, żeby nie wygenerować fałszywego alarmu o pieniądzach).
 */

const BASE = env.GUS_BDL_API_BASE_URL.replace(/\/+$/, '');

/** Parsuje env `GUS_WSKAZNIK_MAP` (JSON) defensywnie — zły JSON nie kładzie klienta. */
function parsujMape(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    logger.warn('GUS_WSKAZNIK_MAP nie jest obiektem JSON — ignoruję mapowanie branż');
    return {};
  } catch {
    logger.warn('GUS_WSKAZNIK_MAP: niepoprawny JSON — ignoruję mapowanie branż');
    return {};
  }
}

/** Mapowanie branża → ID zmiennej BDL z konfiguracji (może być puste). */
const MAPA = parsujMape(env.GUS_WSKAZNIK_MAP);

/**
 * ID zmiennej BDL właściwej dla branży kontraktu, albo `null` gdy nieznane.
 * Dopasowanie jest odporne na odmianę/wielkość liter/diakrytyki: klucz mapy
 * pasuje, gdy jest podłańcuchem znormalizowanej branży ("budow" ⊂ "budownictwo",
 * pasuje też do "roboty budowlane"). Pierwsze trafienie wygrywa.
 * @param {string} branza branża kontraktu (z umowa_monitorowana.branza)
 * @param {Record<string, number|string>} [mapa] mapowanie (wstrzykiwalne w testach)
 * @returns {number|null}
 */
export function idZmiennejDlaBranzy(branza, mapa = MAPA) {
  const b = normalize(branza);
  if (!b) return null;
  for (const [klucz, id] of Object.entries(mapa ?? {})) {
    const k = normalize(klucz);
    const idNum = Number(id);
    if (k && b.includes(k) && Number.isFinite(idNum)) return idNum;
  }
  return null;
}

/**
 * Wyciąga najświeższy wskaźnik z odpowiedzi BDL.
 * Bierze pozycję o NAJWYŻSZYM roku (a przy remisie — najpóźniejszą na liście, bo
 * BDL zwraca wartości chronologicznie). Pozycje bez liczbowego `val` pomija.
 * @param {any} payload sparsowany JSON z {BASE}/data/by-variable/{id}
 * @returns {{wartosc: number, okres: string|null}|null}
 */
export function normalizujWskaznikGus(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  let best = null; // { wartosc, okres, rok, poz }
  let poz = 0;
  for (const grupa of results) {
    const values = Array.isArray(grupa?.values) ? grupa.values : [];
    for (const v of values) {
      // Uwaga: Number(null) === 0 (skończone!), więc pusty `val` trzeba odsiać
      // JAWNIE, zanim policzymy — inaczej brak danych udawałby wskaźnik 0.
      const raw = v?.val;
      const wartosc = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(wartosc)) {
        const rok = Number(v?.year) || 0;
        const okres = String(v?.year ?? '').trim() || null;
        if (!best || rok > best.rok || (rok === best.rok && poz > best.poz)) {
          best = { wartosc, okres, rok, poz };
        }
      }
      poz++;
    }
  }
  return best ? { wartosc: best.wartosc, okres: best.okres } : null;
}

/**
 * Pobiera AKTUALNY wskaźnik cen GUS dla branży kontraktu.
 * @param {string} branza branża kontraktu
 * @returns {Promise<{wartosc: number, okres: string|null}|null>} null, gdy branży
 *   nie da się zmapować na zmienną BDL (job wtedy ją pomija). Błąd sieci/HTTP
 *   rzuca wyjątek — obsługuje go wywołujący (job łapie per rekord).
 */
export async function pobierzAktualnyWskaznik(branza) {
  const id = idZmiennejDlaBranzy(branza);
  if (id === null) {
    logger.warn({ branza }, 'GUS: brak zmapowanej zmiennej BDL dla branży — pomijam');
    return null;
  }

  const url = new URL(`${BASE}/data/by-variable/${id}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('unit-level', '0'); // poziom kraju (POLSKA)
  url.searchParams.set('page-size', '10');

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GUS BDL odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 150)}`);
  }

  const wsk = normalizujWskaznikGus(await res.json());
  logger.info({ branza, id, wsk }, 'GUS: pobrano wskaźnik');
  return wsk;
}

// Tryb diagnostyczny: `node src/services/gus.js --ping "budownictwo"`
if (isMainModule(import.meta.url) && process.argv.includes('--ping')) {
  const branza = process.argv[process.argv.indexOf('--ping') + 1] || 'budownictwo';
  pobierzAktualnyWskaznik(branza)
    .then((wsk) => {
      console.log(wsk ? `OK — ${branza}: ${JSON.stringify(wsk)}` : `Brak mapowania zmiennej BDL dla „${branza}".`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('BŁĄD GUS:', err.message);
      process.exit(1);
    });
}
