import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { doUtcIso } from '../lib/daty.js';
import { stanTempa, pobierzZPonowieniem } from '../lib/tempoZapytan.js';

/*
 * Baza Konkurencyjności — rejestr zamówień finansowanych z FUNDUSZY EUROPEJSKICH.
 *
 * DLACZEGO TO TRZECIE ŹRÓDŁO: BZP ma zamówienia publiczne wg Pzp, TED — te powyżej
 * progów unijnych. Zamówień udzielanych przez BENEFICJENTÓW dotacji (firmy, fundacje,
 * uczelnie, szpitale, samorządowe spółki) nie ma w żadnym z nich — obowiązuje je
 * „zasada konkurencyjności", a nie Pzp. Dla małego wykonawcy to często ŁATWIEJSZY
 * rynek: zamawiającym bywa firma, nie urząd, a wymagania formalne są lżejsze.
 * Pomiar 2026-09-24 (read-only, żywe API): 1 135 ogłoszeń otwartych, 636 z nich
 * opublikowano w ostatnich 7 dniach, 171 w ostatniej dobie.
 *
 * API jest PUBLICZNE, JSON, bez klucza i bez logowania. Czytamy wyłącznie ten
 * interfejs — żadnego scrapingu HTML, żadnego omijania limitów, zero płatnego AI.
 *
 * ── ZMIERZONY KSZTAŁT API (2026-09-24, wszystkie liczby z żywych zapytań) ─────
 *
 *  LISTA: GET /api/announcements/search?page=N&limit=M&sort=default&status[0]=PUBLISHED
 *    → { status, data: { advertisements: [{ id, title, content, advertiser_name,
 *        publication_date, submission_deadline, fulfillment_place }], meta: { total } } }
 *
 *    • `status[0]` jest WYMAGANY — bez niego API odpowiada HTTP 500.
 *    • `limit` przyjmuje co najmniej 2000 (1135 rekordów w jednym żądaniu, 0,76 MB
 *      na całość); zostajemy przy 500/stronę, żeby nie ciągnąć megabajta naraz.
 *    • `page` DZIAŁA (w przeciwieństwie do BZP!), ale offset ma sufit ~10 000 —
 *      page=21 przy limit=500 to HTTP 500.
 *    • Filtry dat są IGNOROWANE. Sprawdzone: publication_date_from, publicationDateFrom,
 *      date_from, publication_date[from] — `meta.total` nie drgnął. Okno czasu
 *      NIE DA SIĘ zrobić po stronie serwera; robimy je na kliencie (jobs/oknoBk.js).
 *    • 🚨 KOLEJNOŚĆ JEST NIESTABILNA. Dwa identyczne zapytania `page=1&limit=5`
 *      oddały RÓŻNE zestawy. Pełne przejście stron dało raz 921/1135, raz 1012/1135,
 *      raz 1135/1135 — czyli pojedynczy przebieg gubi do 19 % rynku BEZ ŻADNEGO BŁĘDU.
 *      Dlatego `pobierzAktywne` powtarza przebieg aż `meta.total` się domknie.
 *      UWAGA: „kolejny przebieg nic nie dodał" NIE jest warunkiem stopu — zmierzony
 *      przebieg 2/3 dołożył 0 rekordów, a przebieg 3/3 dołożył 214.
 *
 *  SZCZEGÓŁ: GET /api/announcements/{id}
 *    → { data: { advertisement: <WERSJA> } }
 *
 *    • 🚨 `data.advertisement` to WERSJA ogłoszenia, nie ogłoszenie. Ma WŁASNE `id`
 *      (np. 252193 dla ogłoszenia 191542) i WŁASNY `status`, który zawsze brzmi
 *      PUBLISHED. Identyfikator z listy, numer sprawy, `modified_at` i PRAWDZIWY
 *      status (w tym CANCELLED) siedzą w `data.advertisement.advertisement`.
 *      Wzięcie płytkiego `id` daje zły link i zły identyfikator dokumentu w bazie.
 *    • Wartość zamówienia jest WYŁĄCZNIE tutaj (`orders[].estimated_value`, format PL,
 *      często null) — lista jej nie zna. To uzasadnia N+1 i limit szczegółów na przebieg.
 */

export const ZRODLO = 'baza_konkurencyjnosci';
export const STATUS_AKTYWNY = 'PUBLISHED';
export const STATUS_ANULOWANY = 'CANCELLED';

const API_BASE = env.BK_API_BASE_URL.replace(/\/+$/, '');
const PUBLIC_BASE = env.BK_PUBLIC_BASE_URL.replace(/\/+$/, '');

const NAGLOWKI = { Accept: 'application/json', 'User-Agent': 'PrzetargAI/0.1' };

/**
 * Tempo ruchu do BK.
 *
 * Zmierzone czasy: strona listy 500 pozycji ≈ 0,3–0,8 s, szczegół ≈ 0,12 s. BK nie
 * dławiło ruchu przy odstępie 0,8–1,2 s w całym pomiarze, ale jedziemy z zapasem —
 * to cudzy serwer publiczny, a nie nasz zasób. Backoff po ewentualnym 403/429
 * pochodzi z lib/tempoZapytan.js (ta sama wiedza co przy BZP).
 */
export const TEMPO_BK = { odstepMs: 400, backoff403Ms: 15_000 };

/* ============================ czyste mapowanie ============================ */

/** Trim + zwinięcie białych znaków; null dla pustych. */
function tekst(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Zdejmuje tagi HTML (m.in. `<mark>` z podświetleń wyszukiwarki). */
function bezTagow(v) {
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v.join(' ') : String(v);
  return tekst(s.replace(/<[^>]*>/g, ' '));
}

/** Kwota w formacie PL („92 228,84" / „92228.84" / liczba) → number|null. */
function kwotaPl(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Suma szacowanych wartości po WSZYSTKICH zamówieniach ogłoszenia.
 *
 * `null` (a nie 0), gdy żadne zamówienie wartości nie podaje — BK nie musi jej
 * ujawniać, a zero skłamałoby, że zamówienie jest za darmo, i wpuściłoby ogłoszenie
 * do każdego filtra budżetowego.
 */
function sumaWartosci(orders) {
  let suma = 0;
  let jest = false;
  for (const o of orders) {
    const v = kwotaPl(o?.estimated_value);
    if (v !== null) { suma += v; jest = true; }
  }
  return jest ? Math.round(suma * 100) / 100 : null;
}

const pierwszy = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

/** Lista ogłoszeń z odpowiedzi wyszukiwarki (defensywnie, jak w services/bzp.js). */
export function wyodrebnijListe(json) {
  const d = json?.data ?? json;
  if (Array.isArray(d)) return d;
  const lista = d?.advertisements ?? d?.results ?? d?.items ?? d?.content;
  return Array.isArray(lista) ? lista : [];
}

/**
 * NAGŁÓWEK ogłoszenia z odpowiedzi szczegółu — czyli `data.advertisement.advertisement`.
 * Patrz pułapka na górze pliku: poziom wyżej to wersja, nie ogłoszenie.
 */
export function wyodrebnijOgloszenie(json) {
  const wersja = json?.data?.advertisement ?? json?.advertisement ?? json;
  return wersja?.advertisement ?? null;
}

/** Wersja ogłoszenia (tam mieszkają `orders`, `title`, terminy). */
function wyodrebnijWersje(json) {
  return json?.data?.advertisement ?? json?.advertisement ?? json ?? {};
}

/**
 * Status ogłoszenia: PUBLISHED / CANCELLED / … — z NAGŁÓWKA, nie z wersji.
 * @returns {string|null} null, gdy odpowiedź nie niesie statusu (traktujemy jak nieznany)
 */
export function statusOgloszenia(json) {
  return tekst(wyodrebnijOgloszenie(json)?.status?.label);
}

/** Publiczny link do ogłoszenia — ten sam adres, który widzi człowiek w portalu. */
export function linkOgloszenia(id) {
  return `${PUBLIC_BASE}/ogloszenia/${id}`;
}

/**
 * Szczegół BK → znormalizowany przetarg w kształcie `tenders.upsert`.
 *
 * @param {any} json pełna koperta `GET /announcements/{id}`
 * @returns {object|null} null, gdy brakuje danych, bez których wpis jest bezużyteczny
 */
export function normalizujOgloszenieBk(json) {
  const naglowek = wyodrebnijOgloszenie(json);
  const wersja = wyodrebnijWersje(json);
  const id = naglowek?.id;
  if (id === undefined || id === null || id === '') return null;

  const title = bezTagow(wersja.title) ?? bezTagow(naglowek.title);
  if (!title) return null;

  const orders = Array.isArray(wersja.orders) ? wersja.orders : [];
  const pozycje = orders.flatMap((o) => (Array.isArray(o?.order_items) ? o.order_items : []));
  const cpv = [...new Set(pozycje.flatMap(
    (it) => (Array.isArray(it?.cpv_items) ? it.cpv_items.map((c) => tekst(c?.code)) : []),
  ).filter(Boolean))];
  const adres = wersja.advertiser_address_details ?? {};
  const miejsce = pierwszy(pierwszy(pozycje)?.fulfillment_places) ?? {};

  return {
    // Prefiks źródła w identyfikatorze — tak samo jak `ted:` (D-039). Dzięki niemu
    // docId w Firestore jest globalnie unikalny między rejestrami.
    externalId: `bk:${id}`,
    title,
    organization: tekst(adres.name) ?? tekst(naglowek.created_by?.name),
    cpvMain: cpv.length ? cpv.join(', ') : null,
    budget: sumaWartosci(orders),
    currency: 'PLN',
    // BK podaje czas POLSKI bez strefy — normalizacja do UTC jest obowiązkowa,
    // bo cała baza porównuje terminy leksykograficznie (lib/daty.js).
    deadline: doUtcIso(tekst(wersja.submission_deadline) ?? tekst(naglowek.submission_deadline)),
    publishedAt: doUtcIso(tekst(naglowek.publication_date) ?? tekst(wersja.publication_date)),
    url: linkOgloszenia(id),
    source: ZRODLO,
    // Numer sprawy BK („2026-4203-292028") — po nim wykonawca szuka w portalu
    // i nim posługuje się w korespondencji z zamawiającym.
    numer: tekst(naglowek.number),
    wojewodztwo: tekst(miejsce.voivodeship) ?? tekst(adres.address?.voivodeship),
    // BK rozbija zamówienie na `orders` — to dokładnie części zamówienia.
    liczba_czesci: orders.length || null,
    rodzaj: tekst(pierwszy(pozycje)?.category?.name),
    /*
     * `raw` to NAGŁÓWEK, a nie cały ekran szczegółów: `terms_of_contract_change`
     * i opisy pozycji bywają kilkukilobajtową prozą, a dokument Firestore ma limit
     * 1 MiB (audyt 2026-07-10: pojedyncze ogłoszenie potrafiło przerwać zapis
     * całej partii). `modified_at` zostaje, bo decyduje o wykryciu zmiany.
     */
    raw: {
      id,
      number: tekst(naglowek.number),
      status: tekst(naglowek.status?.label),
      publication_date: tekst(naglowek.publication_date),
      created_at: tekst(naglowek.created_at),
      modified_at: tekst(naglowek.modified_at),
      wersja_id: wersja.id ?? null,
    },
  };
}

/* ============================ transport HTTP ============================ */

function urlListy({ strona, limit }) {
  const url = new URL(`${API_BASE}/announcements/search`);
  url.searchParams.set('page', String(strona));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'default');
  // Wymagany — bez niego BK odpowiada HTTP 500 (zmierzone).
  url.searchParams.set('status[0]', STATUS_AKTYWNY);
  return url;
}

async function jsonLubBlad(res, opis) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Baza Konkurencyjności: ${opis} odpowiedziało ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Pobiera pełen zestaw AKTYWNYCH ogłoszeń BK (status PUBLISHED).
 *
 * Strategia wymuszona pomiarem (patrz nagłówek pliku): paginacja działa, ale
 * kolejność jest niestabilna, więc pojedyncze przejście stron gubi część rynku.
 * Powtarzamy całe przejście, aż liczba UNIKALNYCH ogłoszeń dogoni `meta.total`,
 * z twardymi limitami: `maksStron`, `maksPrzebiegow` i `budzetMs`.
 *
 * Niepełne pokrycie NIE jest błędem — jest RAPORTOWANE (`pokrycieKompletne`),
 * bo tylko wtedy da się odróżnić „BK ma dziś 800 ogłoszeń" od „zgubiliśmy 300".
 *
 * @returns {Promise<{aktywne: Map<string, object>, total: number, przebiegi: number,
 *   zapytania: number, pokrycieKompletne: boolean}>}
 */
export async function pobierzAktywne({
  licznik,
  limitStrony = env.BK_LIMIT_STRONY,
  maksStron = env.BK_MAKS_STRON,
  maksPrzebiegow = env.BK_MAKS_PRZEBIEGOW,
  budzetMs = Infinity,
  tempo: tempoWejscie,
} = {}) {
  const tempo = tempoWejscie ?? stanTempa(TEMPO_BK);
  const start = tempo.teraz();
  const aktywne = new Map();
  let total = 0;
  let zapytania = 0;
  let surowe = 0;
  let przebiegi = 0;
  let budzetWyczerpany = false;
  let bladStrony = null;

  for (let przebieg = 1; przebieg <= maksPrzebiegow; przebieg++) {
    przebiegi = przebieg;
    for (let strona = 1; strona <= maksStron; strona++) {
      if (tempo.teraz() - start >= budzetMs) {
        budzetWyczerpany = true;
        logger.warn({ zapytania, zebrane: aktywne.size, total },
          'BK: budżet czasu wyczerpany — resztę domknie następny przebieg (checkpoint)');
        break;
      }

      await tempo.przedZapytaniem();
      let json;
      try {
        json = await jsonLubBlad(
          await pobierzZPonowieniem(urlListy({ strona, limit: limitStrony }), tempo, {
            zrodlo: 'BK', naglowki: NAGLOWKI,
          }),
          'lista',
        );
      } catch (err) {
        /*
         * 🚨 ZMIERZONE NA PRODUKCJI 2026-09-24: przy siedmiu przebiegach pod rząd
         * trzy padły w całości, każdy po ~80 s — czyli 3 × 25 s limitu czasu plus
         * odstępy ponowień. BK spowolniło pod naszym ruchem i jedna strona przestała
         * odpowiadać. Skutek był nieproporcjonalny: przebieg miał już zebrane setki
         * pozycji z wcześniejszych stron i wyrzucał je razem z wyjątkiem.
         *
         * Gdy COKOLWIEK mamy — kończymy listowanie z jawnie niepełnym pokryciem,
         * a checkpoint dopobierze resztę w kolejnym przebiegu. Gdy nie mamy NICZEGO,
         * rzucamy dalej: źródło jest realnie niedostępne i `/health` musi to pokazać
         * jako błąd, a nie jako „dziś BK miało zero ogłoszeń".
         */
        if (aktywne.size === 0) throw err;
        bladStrony = err;
        logger.warn({ err: err.message, strona, zebrane: aktywne.size },
          'BK: strona listy padła — zostawiam to, co zebrane, z niepełnym pokryciem');
        break;
      }
      zapytania += 1;

      const lista = wyodrebnijListe(json);
      surowe += lista.length;
      total = Math.max(total, Number(json?.data?.meta?.total ?? json?.meta?.total ?? 0) || 0);
      for (const poz of lista) {
        if (poz?.id !== undefined && poz?.id !== null) aktywne.set(String(poz.id), poz);
      }

      // Pusta strona = koniec zestawu. Nie ufamy samemu `total` — on bywa większy
      // niż to, co API realnie odda (sufit offsetu ~10 000).
      if (lista.length === 0 || aktywne.size >= total) break;
    }

    if (budzetWyczerpany || bladStrony || aktywne.size >= total) break;
    logger.warn({ przebieg, zebrane: aktywne.size, total },
      'BK: przebieg nie domknął zestawu (niestabilna kolejność) — powtarzam');
  }

  const pokrycieKompletne = !budzetWyczerpany && !bladStrony && total > 0 && aktywne.size >= total;
  if (licznik) {
    licznik.zapytania += zapytania;
    licznik.surowe += surowe;
    // Nakładka MIĘDZY PRZEBIEGAMI: koszt strategii domykania pokrycia. Liczona
    // osobno od `zliczDuplikaty`, która mierzy deduplikację całego okna.
    licznik.zduplikowaneZrodla = (licznik.zduplikowaneZrodla ?? 0) + Math.max(0, surowe - aktywne.size);
    licznik.pokrycieKompletne = pokrycieKompletne;
    licznik.aktywneWZrodle = total;
  }

  logger.info({ zebrane: aktywne.size, total, przebiegi, zapytania, pokrycieKompletne,
    bladStrony: bladStrony?.message ?? null }, 'BK: zakończono listowanie aktywnych ogłoszeń');
  return { aktywne, total, przebiegi, zapytania, pokrycieKompletne };
}

/**
 * Szczegół jednego ogłoszenia — surowa koperta API.
 * Mapowanie jest osobną decyzją (`normalizujOgloszenieBk`), bo ta sama odpowiedź
 * służy też do sprawdzenia statusu anulowania bez zapisywania czegokolwiek.
 */
export async function pobierzSzczegolBk(id, { tempo: tempoWejscie } = {}) {
  const tempo = tempoWejscie ?? stanTempa(TEMPO_BK);
  await tempo.przedZapytaniem();
  const res = await pobierzZPonowieniem(`${API_BASE}/announcements/${id}`, tempo, {
    zrodlo: 'BK', naglowki: NAGLOWKI, timeoutMs: 20_000,
  });
  return jsonLubBlad(res, `szczegół ${id}`);
}
