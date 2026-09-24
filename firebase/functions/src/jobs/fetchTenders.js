import { logger } from '../lib/logger.js';
import { features } from '../config.js';
import { pobierzOgloszeniaTed } from '../services/ted.js';
import { pobierzBzpZWznowieniem } from './oknoBzp.js';
import { generateMatchesForAllUsers } from '../services/matching.js';
import { pobierzBkZWznowieniem } from './oknoBk.js';
import { tenders, cykl } from '../db/repos.js';
import { pustyLicznik, zliczDuplikaty } from '../lib/licznikZrodla.js';
import { scalMiedzyZrodlami } from '../lib/dedupZrodel.js';

/**
 * Rejestr źródeł ogłoszeń (D-039). Każde źródło zwraca ZNORMALIZOWANE przetargi
 * (kształt `tenders.upsert`); awaria jednego NIE zatrzymuje pozostałych —
 * TED bywa w konserwacji, a BZP musi wtedy dalej spływać (i odwrotnie).
 *
 * 🚨 BZP: `PageNumber` jest IGNOROWANY, sufit `PageSize` = 500, a ogłoszeń jest
 * 400–500 DZIENNIE. Do 2026-07-17 było tu JEDNO zapytanie `PageSize=500` na całe
 * okno `BZP_LOOKBACK_DAYS` (domyślnie 7 dni ≈ 3000+ ogłoszeń) — czyli po cichu
 * gubiliśmy ~85% ogłoszeń, bez błędu w logach. `pobierzOgloszeniaBzp` leci dzień
 * po dniu i docina dobę po województwach, gdy trafi sufit (szczegóły i pomiary:
 * services/bzp.js + [[reference_bzp_api_dane]]). NIE wracać do jednego zapytania.
 * TED: paginacja działa normalnie, sufit stron w adapterze.
 */
function domyslneZrodla() {
  const zrodla = [
    { nazwa: 'bzp', pobierz: (licznik, opcje) => pobierzBzpZWznowieniem(licznik, opcje) },
  ];
  if (features.ted) {
    zrodla.push({ nazwa: 'ted', pobierz: (licznik) => pobierzOgloszeniaTed({ licznik }) });
  }
  /*
   * Baza Konkurencyjności jest OSTATNIA świadomie. Budżet pobierania jest wspólny,
   * a każde źródło dostaje to, co po poprzednich zostało — więc na końcu stoi to,
   * którego niekompletność boli najmniej: BK ma własną funkcję domykającą okno
   * (`bkOknoFetch`) i checkpoint, więc dociągnie resztę bez tego cyklu. Kolejność
   * pobierania NIE decyduje o tym, który rejestr wygrywa przy duplikacie — o tym
   * mówi `PRIORYTET_ZRODEL` w lib/dedupZrodel.js.
   *
   * Nazwa wpisu = wartość pola `source` ogłoszenia, żeby statystyki cyklu, `/health`
   * i atrybucja duplikatów mówiły jednym słownikiem.
   */
  if (features.bk) {
    zrodla.push({
      nazwa: 'baza_konkurencyjnosci',
      pobierz: (licznik, opcje) => pobierzBkZWznowieniem(licznik, opcje),
    });
  }
  return zrodla;
}

/**
 * Ile ms wolno zużyć na CAŁY przebieg (pobieranie + dopasowania).
 *
 * `dailyTenderFetch` ma twardy limit 540 s — po nim platforma zabija funkcję
 * w połowie pętli. Zostawiamy 60 s zapasu na zapis śladu cyklu i raport.
 */
export const BUDZET_PRZEBIEGU_MS = 480_000;

/**
 * Ile z budżetu przebiegu wolno zużyć na POBIERANIE ze wszystkich źródeł.
 *
 * Reszta (co najmniej 180 s) zostaje dopasowaniom. Bez tego podziału pobieranie
 * potrafiło zjeść cały budżet i funkcja ginęła w połowie dopasowań — po cichu,
 * bo ślad cyklu zapisuje się dopiero na końcu (audyt 2026-09-23, P0-2).
 */
export const BUDZET_POBIERANIA_MS = 300_000;

/**
 * Ile czasu zostało dla cyklu dopasowań po pobraniu ogłoszeń.
 *
 * Po naprawie paginacji BZP pobieranie idzie DZIEŃ PO DNIU i trwa ~134 s zamiast
 * ~21 s (zmierzone na żywym API). Przy stałym budżecie dopasowań 440 s suma
 * wynosiłaby 574 s > 540 s i funkcja ginęła w połowie dopasowań — po cichu,
 * bez błędu. Dlatego budżet dopasowań liczymy z tego, co REALNIE zostało.
 */
export function pozostalyBudzetMs(zuzyteMs, calosc = BUDZET_PRZEBIEGU_MS) {
  return Math.max(0, calosc - zuzyteMs);
}

/**
 * Zapisuje ślad przebiegu dla `/health` i oddaje ten sam wynik wołającemu.
 *
 * Ślad musi powstać przy KAŻDYM zakończeniu cyklu, także przy pełnej awarii.
 * Do 2026-09-24 pełna awaria wracała wcześniej i śladu nie zapisywała wcale —
 * `/health` pokazywał wtedy ostatni UDANY przebieg, więc padnięte pobieranie
 * wyglądało z zewnątrz jak wczorajszy sukces i nie budziło monitoringu (P0-3).
 * Awaria samego zapisu śladu nie może wywrócić cyklu — logujemy i jedziemy dalej.
 */
async function zapiszSlad(wynik) {
  await cykl.zapiszPrzebieg(wynik).catch((err) =>
    logger.error({ err: err.message }, 'Nie udało się zapisać śladu cyklu'));
  logger.info(wynik, 'fetchTenders: zakończono');
  return wynik;
}

/**
 * Pobiera ogłoszenia ze wszystkich źródeł, zapisuje nowe i generuje dopasowania.
 * @param {{zrodla?: Array<{nazwa: string, pobierz: () => Promise<object[]>}>}} opts
 *   `zrodla` — wstrzykiwane w testach; produkcja używa rejestru domyślnego.
 *   (`pageSize` usunięty — rozmiar okna nie jest już decyzją wołającego, bo BZP
 *   wymaga cięcia dzień po dniu; patrz komentarz przy `domyslneZrodla`.)
 */
export async function runTenderFetch({ zrodla = domyslneZrodla() } = {}) {
  const startedAt = Date.now();
  const statystyki = {};
  const zebrane = [];
  let fetched = 0;
  let noweTenders = 0;
  let pominiete = 0;

  /* ── FAZA 1: pobranie ze wszystkich źródeł ──────────────────────────────── */

  for (const zrodlo of zrodla) {
    /*
     * Akumulator pomiarów okna (lib/licznikZrodla.js). Adapter dopisuje do niego
     * surowe fakty, więc licznik niesie sensowne liczby TAKŻE wtedy, gdy źródło
     * padnie w połowie — bez tego awaria kasowała całą wiedzę o tym, jak daleko
     * doszło pobieranie (audyt 2026-09-23 §4.5).
     */
    const licznik = pustyLicznik();
    let notices;
    try {
      // Każde źródło dostaje to, co ZOSTAŁO z budżetu pobierania — pierwsze
      // źródło nie może zagłodzić kolejnych.
      const budzetZrodlaMs = Math.max(0, BUDZET_POBIERANIA_MS - (Date.now() - startedAt));
      notices = await zrodlo.pobierz(licznik, { budzetMs: budzetZrodlaMs });
    } catch (err) {
      logger.error({ err: err.message, zrodlo: zrodlo.nazwa, ...licznik },
        'fetchTenders: pobieranie ze źródła nie powiodło się');
      statystyki[zrodlo.nazwa] = {
        fetched: 0, newTenders: 0, zduplikowane: 0, zduplikowane_miedzy_zrodlami: 0, pominiete: 0,
        surowe: licznik.surowe, odrzucone: licznik.odrzucone, zapytania: licznik.zapytania,
        error: err.message,
      };
      continue;
    }

    zebrane.push({ nazwa: zrodlo.nazwa, notices, licznik });
    statystyki[zrodlo.nazwa] = {
      // `fetched` = ile ogłoszeń oddało ŹRÓDŁO (po jego własnej deduplikacji).
      // Świadomie liczone PRZED scalaniem międzyźródłowym: inaczej nie dałoby się
      // odróżnić „BK nic nie ma" od „BK przyniosło same kopie z BZP".
      fetched: notices.length,
      newTenders: 0,
      surowe: licznik.surowe,
      odrzucone: licznik.odrzucone,
      zduplikowane: zliczDuplikaty(licznik, notices.length),
      zduplikowane_miedzy_zrodlami: 0,
      zapytania: licznik.zapytania,
      pominiete: 0,
      // Stan okna (BZP): ile dób zostało do domknięcia. 0 = okno kompletne.
      ...(licznik.dobyOkna === undefined ? {} : {
        doby_okna: licznik.dobyOkna,
        doby_niedomkniete: licznik.dobyNiedomkniete ?? 0,
        doby: licznik.dni ?? [],
      }),
      /*
       * Stan pokrycia (Baza Konkurencyjności). BK nie zgłasza niekompletności
       * błędem — listuje w niestabilnej kolejności i po prostu oddaje mniej.
       * `pokrycie_kompletne: false` to JEDYNY zewnętrzny sygnał, że część rynku
       * nie weszła do tego przebiegu. Pola pojawiają się wyłącznie dla źródeł,
       * które je mierzą — BZP i TED nie mają udawać, że mają pokrycie.
       */
      ...(licznik.pokrycieKompletne === undefined ? {} : {
        pokrycie_kompletne: licznik.pokrycieKompletne,
        aktywne_w_zrodle: licznik.bkTotal ?? null,
        nowe_ogloszenia: licznik.bkNowe ?? null,
        zmienione_ogloszenia: licznik.bkZmienione ?? null,
        zaktualizowane: licznik.bkZaktualizowane ?? 0,
        anulowane: licznik.bkAnulowane ?? 0,
        zaleglosc: licznik.bkZaleglosc ?? null,
      }),
    };
    fetched += notices.length;
  }

  /* ── FAZA 2: scalenie MIĘDZY źródłami ───────────────────────────────────── */

  /*
   * Ten sam przetarg potrafi być w BZP i w Bazie Konkurencyjności naraz (postępowanie
   * współfinansowane z UE), a identyfikatory są wtedy zupełnie różne. Bez scalania
   * użytkownik dostaje go dwa razy, a konto Free zużywa na to dwa z pięciu dziennych
   * dopasowań. Scalanie idzie PRZED zapisem — drugi dokument w ogóle nie powstaje.
   */
  const pochodzenie = new Map();
  for (const { nazwa, notices } of zebrane) {
    for (const n of notices) if (n?.externalId) pochodzenie.set(String(n.externalId), nazwa);
  }
  const scalone = scalMiedzyZrodlami(zebrane.map(({ nazwa, notices }) => ({ zrodlo: nazwa, ogloszenia: notices })));
  for (const [nazwa, ile] of Object.entries(scalone.wgZrodla)) {
    if (statystyki[nazwa]) statystyki[nazwa].zduplikowane_miedzy_zrodlami = ile;
  }

  /* ── FAZA 3: zapis ──────────────────────────────────────────────────────── */

  /*
   * Zapis ogłoszenie po ogłoszeniu, każde w osobnym try. Audyt 2026-07-10:
   * pojedyncze ogłoszenie potrafi przekroczyć limit 1 MiB na dokument Firestore
   * (`raw_data` z `htmlBody` bywa ogromne) — bez izolacji jeden taki rekord
   * przerywał zapis CAŁEJ partii i pozostałe 499 przetargów nie trafiało do bazy.
   */
  for (const notice of scalone.ogloszenia) {
    // Atrybucja po ŹRÓDLE POBRANIA, nie po polu `source`: ogłoszenie bez `source`
    // jest zapisywane jako `bzp` (zgodność wsteczna), ale policzyć je trzeba temu,
    // kto je realnie przyniósł.
    const nazwa = pochodzenie.get(String(notice?.externalId)) ?? notice?.source ?? 'bzp';
    try {
      const { created } = await tenders.upsert(notice);
      if (created) {
        noweTenders += 1;
        if (statystyki[nazwa]) statystyki[nazwa].newTenders += 1;
      }
    } catch (err) {
      pominiete += 1;
      if (statystyki[nazwa]) statystyki[nazwa].pominiete += 1;
      logger.error({ err: err.message, externalId: notice?.externalId, zrodlo: nazwa },
        'fetchTenders: pominięto ogłoszenie, którego nie dało się zapisać');
    }
  }

  // Cykl ma sens, jeśli COKOLWIEK się pobrało; ok:false = padły wszystkie źródła.
  const wszystkiePadly = zrodla.length > 0
    && Object.values(statystyki).every((s) => s.error);
  if (wszystkiePadly) {
    const bledy = Object.entries(statystyki).map(([n, s]) => `${n}: ${s.error}`).join('; ');
    return zapiszSlad({
      ok: false, error: bledy, fetched: 0, newTenders: 0, skipped: pominiete,
      matchesCreated: 0, durationMs: Date.now() - startedAt, zrodla: statystyki,
    });
  }

  // Nowe ogłoszenia są w bazie — cache puli w tej instancji jest już nieaktualny.
  tenders.odswiezPule();

  // Dopasowania liczymy nawet po częściowym zapisie — konto Free odbiera wtedy
  // przetargi odroczone wczoraj przez dzienny limit.
  let matchesCreated = 0;
  try {
    // Budżet z tego, co ZOSTAŁO po pobieraniu — patrz `pozostalyBudzetMs`.
    const budzetCzasuMs = pozostalyBudzetMs(Date.now() - startedAt);
    logger.info({ pobieranieMs: Date.now() - startedAt, budzetDopasowanMs: budzetCzasuMs },
      'fetchTenders: przechodzę do dopasowań z budżetem resztkowym');
    matchesCreated = await generateMatchesForAllUsers({ budzetCzasuMs });
  } catch (err) {
    logger.error({ err: err.message }, 'fetchTenders: cykl dopasowań nie powiódł się');
    return zapiszSlad({
      ok: false, error: err.message, fetched, newTenders: noweTenders,
      skipped: pominiete, zduplikowane_miedzy_zrodlami: scalone.duplikaty,
      matchesCreated: 0, durationMs: Date.now() - startedAt,
      zrodla: statystyki,
    });
  }

  return zapiszSlad({
    ok: true, fetched, newTenders: noweTenders, skipped: pominiete,
    // Rekonsyliacja: ile ogłoszeń scaliło się MIĘDZY rejestrami. Bez tej liczby
    // różnica `fetched` − `newTenders` wygląda jak zgubione dane, a jest kopią.
    zduplikowane_miedzy_zrodlami: scalone.duplikaty,
    matchesCreated, durationMs: Date.now() - startedAt, zrodla: statystyki,
  });
}
