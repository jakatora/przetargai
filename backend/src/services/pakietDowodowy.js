/**
 * Detektor awarii + budowa PAKIETU DOWODOWEGO (ulepszenie „Czarna skrzynka składania
 * oferty — dowody na awarię platformy", podzadanie 3/7).
 *
 * Rejestrator lotu (krok 1/7) utrwala na bieżąco dowody, a monitor dostępności (krok 2/7)
 * dokłada do logu sesji cykliczne pomiary pingu. Tu domykamy DETEKCJĘ i PAKOWANIE:
 *
 *  • `wykryjAwarie(sesja)` — rozpoznaje trzy rodzaje awarii składania oferty:
 *      – BŁĄD WYSYŁKI            (wpis logu typu 'blad_wysylki'),
 *      – BRAK POTWIERDZENIA EPO  (wpis logu typu 'brak_epo'),
 *      – NIEDOSTĘPNOŚĆ PLATFORMY (jawny wpis 'niedostepnosc' LUB wynik pingu monitora,
 *        który utrwalił stan „NIEDOSTĘPNA" — patrz `zapiszPing` w czarnaSkrzynka.js).
 *    Funkcja CZYSTA (bez DB) — testowalna na gołym logu; wynik niesie znaczniki czasu,
 *    których potrzebuje generator pisma do zamawiającego (krok 4/7).
 *
 *  • `zbudujPakiet(userId, sesjaId)` — spina w JEDEN pakiet: zrzuty ekranu, pełny przebieg
 *    sesji (append-only log), sumę kontrolną pliku oferty (SHA-256) oraz wyniki cyklicznej
 *    dostępności, opatruje MANIFESTEM (co jest w pakiecie) i SUMĄ KONTROLNĄ CAŁOŚCI
 *    (SHA-256 kanonicznej treści) — pakiet jest tamper-evident: zmiana dowolnego dowodu
 *    zmienia sumę. Dostęp scope'owany po user_id (dowód jednego wykonawcy jest jego).
 *
 * Fabryka `createPakietDowodowy(db, { skrzynka, zegar })` na WSTRZYKNIĘTYM połączeniu
 * SQLite / usłudze czarnej skrzynki — jak pozostałe usługi tego ulepszenia; świadomie NIE
 * dopisujemy do współdzielonego `db/repos.js` (cudzy WIP w drzewie roboczym).
 */

import crypto from 'node:crypto';

import { nowIso } from '../lib/ids.js';
import { createCzarnaSkrzynka, hashPliku } from './czarnaSkrzynka.js';

// ─────────────────────────── Klasyfikacja zdarzeń → awaria ──────────────────

/** Wpisy logu, które SAME W SOBIE są dowodem awarii (mapa typ zdarzenia → typ awarii). */
const TYP_ZDARZENIA_NA_AWARIE = {
  blad_wysylki: 'blad_wysylki',
  brak_epo: 'brak_epo',
  niedostepnosc: 'niedostepnosc',
};

/**
 * Znacznik, którym `zapiszPing` (krok 2/7) utrwala niedostępność platformy w opisie wpisu
 * 'ping' (…„platforma NIEDOSTĘPNA"). Detektor rozumie wynik monitora bez osobnej kolumny.
 * UWAGA: „NIEDOSTĘPNA" zawiera podłańcuch „dostępna", więc sprawdzamy CAŁY marker, nie „dostępna".
 */
const PING_NIEDOSTEPNA = /niedostępna/i;

/** Ping utrwalony jako NIEDOSTĘPNY? (dowód niedostępności z wyników cyklicznego monitora). */
function pingNiedostepny(zdarzenie) {
  return zdarzenie.typ === 'ping' && PING_NIEDOSTEPNA.test(String(zdarzenie.opis ?? ''));
}

/** Normalizuje argument `wykryjAwarie` (bundle sesji / goły masyw) do listy zdarzeń. */
function zdarzeniaZ(sesja) {
  if (Array.isArray(sesja)) return sesja;
  if (sesja && Array.isArray(sesja.zdarzenia)) return sesja.zdarzenia;
  return [];
}

/**
 * Wykrywa awarie składania oferty na podstawie append-only logu sesji (z wpisami pingu
 * monitora włącznie). Funkcja czysta.
 * @param {{zdarzenia?: Array<object>}|Array<object>} [sesja] sesja z logiem, sam log, albo nic
 * @returns {{awaria: boolean, typy: string[],
 *   powody: Array<{typ: string, opis: string|null, czas_serwera: string, strefa_czasowa: string}>}}
 *   `typy` — unikalne, posortowane typy awarii; `powody` — każde zdarzenie-dowód w kolejności logu.
 */
export function wykryjAwarie(sesja) {
  const powody = [];
  for (const z of zdarzeniaZ(sesja)) {
    const typAwarii = TYP_ZDARZENIA_NA_AWARIE[z.typ] || (pingNiedostepny(z) ? 'niedostepnosc' : null);
    if (!typAwarii) continue;
    powody.push({
      typ: typAwarii,
      opis: z.opis ?? null,
      czas_serwera: z.czas_serwera ?? null,
      strefa_czasowa: z.strefa_czasowa ?? null,
    });
  }
  const typy = [...new Set(powody.map((p) => p.typ))].sort();
  return { awaria: powody.length > 0, typy, powody };
}

// ─────────────────────────── Budowa pakietu dowodowego ──────────────────────

const ZEGAR_DOMYSLNY = { teraz: nowIso };

/**
 * Tworzy usługę pakietu dowodowego na podanym połączeniu SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{skrzynka?: object, zegar?: {teraz: () => string}}} [opts]
 *   `skrzynka` — usługa czarnej skrzynki (domyślnie tworzona z `db`); `zegar` — znacznik
 *   czasu zbudowania pakietu (wstrzykiwalny dla determinizmu w testach).
 */
export function createPakietDowodowy(db, { skrzynka = createCzarnaSkrzynka(db), zegar = ZEGAR_DOMYSLNY } = {}) {
  /**
   * Buduje pakiet dowodowy sesji: zrzuty + pełny przebieg + hash oferty + wyniki
   * dostępności, z manifestem i sumą kontrolną całości. Rzuca, gdy sesja nie należy
   * do `userId` (izolacja — spójnie z czarnaSkrzynka).
   * @param {string} userId
   * @param {string} sesjaId
   */
  function zbudujPakiet(userId, sesjaId) {
    const sesja = skrzynka.sesja(userId, sesjaId);
    if (!sesja) throw new Error('Sesja nie istnieje albo należy do innego użytkownika');
    const zdarzenia = skrzynka.zdarzenia(userId, sesjaId) || [];

    const przebieg = zdarzenia.map((z) => ({
      pozycja: z.id,
      typ: z.typ,
      opis: z.opis ?? null,
      plik_url: z.plik_url ?? null,
      czas_serwera: z.czas_serwera,
      strefa_czasowa: z.strefa_czasowa,
    }));
    const zrzuty = przebieg
      .filter((e) => e.typ === 'zrzut')
      .map((e) => ({ pozycja: e.pozycja, opis: e.opis, plik_url: e.plik_url, czas_serwera: e.czas_serwera, strefa_czasowa: e.strefa_czasowa }));
    const dostepnosc = zdarzenia
      .filter((z) => z.typ === 'ping')
      .map((z) => ({ pozycja: z.id, opis: z.opis ?? null, czas_serwera: z.czas_serwera, dostepna: !PING_NIEDOSTEPNA.test(String(z.opis ?? '')) }));

    // Treść dowodowa pakietu (BEZ sumy kontrolnej — to ona ją domyka). Stała kolejność kluczy
    // => kanoniczna serializacja => deterministyczna suma kontrolna.
    const tresc = {
      wersja: 1,
      sesjaId: sesja.id,
      userId: sesja.user_id,
      postepowanieId: sesja.postepowanie_id ?? null,
      strefaCzasowa: sesja.strefa_czasowa,
      utworzonyPakiet: zegar.teraz(),
      oferta: {
        hash: sesja.hash_oferty ?? null,
        plikUrl: sesja.plik_oferty_url ?? null,
        zlozona: Boolean(sesja.hash_oferty),
      },
      awaria: wykryjAwarie({ zdarzenia }),
      manifest: {
        zrzuty,
        dostepnosc,
        przebieg,
        liczby: { zrzuty: zrzuty.length, pingi: dostepnosc.length, zdarzenia: przebieg.length },
      },
    };

    // Suma kontrolna CAŁOŚCI: SHA-256 kanonicznego JSON treści (reuse hashPliku — czysty SHA-256).
    const sumaKontrolna = hashPliku(JSON.stringify(tresc));
    return { ...tresc, sumaKontrolna };
  }

  return { zbudujPakiet, wykryjAwarie };
}
