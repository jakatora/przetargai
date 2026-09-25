/**
 * Dane lokalne KONTA vs preferencje URZĄDZENIA — czysta logika, zero React Native.
 *
 * Audyt 2026-09-25 (P0): wylogowanie kasowało tylko token i profil. Na wspólnym
 * firmowym telefonie kolejne konto dostawało w spadku rejestr kontraktów
 * poprzedniej firmy (bank referencji), jej checklisty ofert, ścieżki odwołań
 * i stan strażnika wezwań. To wyciek danych między firmami.
 *
 * Każdy klucz magazynu jest tu SKLASYFIKOWANY:
 *  - `KLUCZE_KONTA` / `PREFIKSY_KONTA` — dane firmy: znikają przy wylogowaniu,
 *    usunięciu konta i przy zalogowaniu INNEGO konta niż właściciel danych;
 *  - `KLUCZE_URZADZENIA` — ustawienia telefonu (motyw, język, filtry listy):
 *    zostają, bo to wybór osoby trzymającej telefon, a nie tajemnica firmy.
 * Test-strażnik (`test/kluczeStorage.test.js`) skanuje `src/` i nie przepuści
 * nowego klucza `przetargai.…`, którego nie ma na żadnej z list.
 *
 * SecureStore NIE umie wylistować kluczy, więc klucze per przetarg (z id w nazwie)
 * trafiają przy zapisie do indeksu `KLUCZ_INDEKSU_KONTA`, a czyszczenie kasuje
 * wszystko z indeksu + klucze stałe. Magazyn jest wstrzykiwany (`getItem`,
 * `setItem`, `deleteItem`) — ekrany podają `../lib/storage`, testy atrapę.
 */

/** Indeks kluczy per przetarg zapisanych na tym urządzeniu (JSON: string[]). */
export const KLUCZ_INDEKSU_KONTA = 'przetargai.klucze-konta';

/**
 * Id konta, do którego należą dane lokalne. Wygaśnięcie sesji (co 30 dni) NIE
 * kasuje danych — to ten sam człowiek, a bank referencji wpisuje się ręcznie.
 * Dopiero logowanie INNEGO konta (albo nieznany właściciel) je czyści.
 */
export const KLUCZ_WLASCICIELA = 'przetargai.wlasciciel-danych';

/** Klucze sesji — AuthContext trzyma je pod tymi nazwami. */
export const KLUCZ_TOKENU = 'przetargai_token';
export const KLUCZ_PROFILU = 'przetargai_user';

/**
 * Stałe klucze danych konta. Kolejność = kolejność kasowania: token pierwszy
 * (najważniejszy), indeks ostatni (przerwane czyszczenie da się powtórzyć).
 */
export const KLUCZE_KONTA = Object.freeze([
  KLUCZ_TOKENU,
  KLUCZ_PROFILU,
  'przetargai.bankReferencji', // rejestr kontraktów firmy (BankReferencjiScreen)
  'przetargai.wezwanie', // strażnik wezwania do uzupełnień (StraznikWezwaniaScreen)
  'przetargai.przewodnik-startu', // postęp przewodnika startu (lib/przewodnikStartu)
  'przetargai.onboarding_pominiety', // decyzja TEGO konta o pominięciu powitania
  'przetargai.feed_ostatnia_wizyta', // „nowe od ostatniej wizyty" w feedzie dopasowań konta
  KLUCZ_WLASCICIELA,
  KLUCZ_INDEKSU_KONTA,
]);

/** Prefiksy kluczy per przetarg. Zapis takiego klucza MUSI przejść przez `zarejestrujKlucz`. */
export const PREFIKSY_KONTA = Object.freeze([
  'przetargai.kontrola-oferty.', // lib/kontrolaOferty — checklista przed złożeniem
  'przetargai.sciezka.', // lib/sciezkaDoOferty — ukończone kroki ścieżki
  'przetargai.kontrola-poprzetargowa.', // lib/poprzetargowaKontrola — kontrola po przegranej
]);

/** Preferencje urządzenia — przeżywają wylogowanie. */
export const KLUCZE_URZADZENIA = Object.freeze([
  'przetargai.motyw', // ThemeContext
  'przetargai.jezyk', // JezykContext
  'przetargai.lista_tryb', // tryb listy: dopasowania / wszystkie
  'przetargai.katalog_filtry', // filtry katalogu „Wszystkie"
  'przetargai.minimalnyProcent', // próg filtra feedu
  'przetargai.sortFeedu', // sortowanie feedu
  'przetargai.feed_status_terminu', // filtr terminu feedu
]);

const KLUCZ_SECURESTORE = /^[\w.-]+$/;
const STALE_KONTA = new Set(KLUCZE_KONTA);
const URZADZENIA = new Set(KLUCZE_URZADZENIA);

/** Czy klucz należy do danych konta (stały albo per przetarg). */
export function czyKluczKonta(klucz) {
  if (typeof klucz !== 'string' || !klucz) return false;
  if (STALE_KONTA.has(klucz)) return true;
  return PREFIKSY_KONTA.some((p) => klucz.startsWith(p) && klucz.length > p.length);
}

/*
 * Jedna kolejka na wszystkie operacje na indeksie. Rejestracja to odczyt →
 * dopisanie → zapis; dwie równoległe (dwa szybkie „odhaczenia" w różnych
 * przetargach) bez kolejki zgubiłyby jedna drugą, a zgubiony wpis = dane, których
 * wylogowanie nie skasuje. Czyszczenie idzie tą samą kolejką, żeby spóźniona
 * rejestracja nie wskrzesiła indeksu w połowie kasowania.
 */
let kolejka = Promise.resolve();
function wKolejce(zadanie) {
  const wynik = kolejka.then(zadanie);
  kolejka = wynik.catch(() => {});
  return wynik;
}

/** Indeks kluczy per przetarg. Brak / uszkodzony zapis → pusta lista. */
export async function wczytajIndeks(storage) {
  try {
    const raw = await storage.getItem(KLUCZ_INDEKSU_KONTA);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista.filter((k) => typeof k === 'string' && k) : [];
  } catch {
    return [];
  }
}

/**
 * Dopisuje klucz per przetarg do indeksu konta. Wołać PRZED zapisem danych:
 * przerwany zapis zostawi co najwyżej pusty wpis w indeksie, a nigdy dane,
 * o których wylogowanie nie wie. Błąd zapisu indeksu przerywa zapis danych
 * (fail closed) — lepiej nie zapisać odhaczenia niż zostawić je następnej firmie.
 */
export function zarejestrujKlucz(storage, klucz) {
  if (typeof klucz !== 'string' || !KLUCZ_SECURESTORE.test(klucz)) {
    return Promise.reject(new Error(`Klucz „${klucz}" nie przejdzie przez SecureStore ([A-Za-z0-9._-]).`));
  }
  if (URZADZENIA.has(klucz)) {
    return Promise.reject(new Error(`„${klucz}" to preferencja urządzenia, nie dana konta — nie trafia do indeksu.`));
  }
  if (!czyKluczKonta(klucz)) {
    return Promise.reject(new Error(`Klucz „${klucz}" jest poza klasyfikacją — dopisz jego prefiks do PREFIKSY_KONTA w lib/daneLokalne.js.`));
  }
  if (STALE_KONTA.has(klucz)) return Promise.resolve(); // stałe kasujemy i bez indeksu

  return wKolejce(async () => {
    const indeks = await wczytajIndeks(storage);
    if (indeks.includes(klucz)) return;
    await storage.setItem(KLUCZ_INDEKSU_KONTA, JSON.stringify([...indeks, klucz]));
  });
}

async function wyczyscBezKolejki(storage, { zachowaj = [] } = {}) {
  const oszczedz = new Set(zachowaj);
  const indeks = await wczytajIndeks(storage);
  // Z indeksu bierzemy WYŁĄCZNIE klucze konta — uszkodzony albo podrzucony indeks
  // nie może skasować motywu, języka ani filtrów.
  const dynamiczne = indeks.filter((k) => czyKluczKonta(k) && !STALE_KONTA.has(k));
  const stale = KLUCZE_KONTA.filter((k) => k !== KLUCZ_INDEKSU_KONTA);
  const doSkasowania = [...new Set([...stale, ...dynamiczne])].filter((k) => !oszczedz.has(k));

  const usuniete = [];
  const nieudane = [];
  for (const klucz of doSkasowania) {
    try {
      await storage.deleteItem(klucz);
      usuniete.push(klucz);
    } catch {
      nieudane.push(klucz);
    }
  }

  // Indeks na końcu. Klucze per przetarg, których nie udało się skasować, zostają
  // w nim — następne czyszczenie spróbuje ponownie, zamiast o nich zapomnieć.
  const doPonowienia = nieudane.filter((k) => !STALE_KONTA.has(k));
  try {
    if (doPonowienia.length) {
      await storage.setItem(KLUCZ_INDEKSU_KONTA, JSON.stringify(doPonowienia));
    } else {
      await storage.deleteItem(KLUCZ_INDEKSU_KONTA);
      usuniete.push(KLUCZ_INDEKSU_KONTA);
    }
  } catch {
    nieudane.push(KLUCZ_INDEKSU_KONTA);
  }

  return { usuniete, nieudane };
}

/**
 * Kasuje dane konta z urządzenia: klucze stałe, wszystko z indeksu, sam indeks.
 * Preferencje urządzenia zostają. Błąd jednego klucza nie zatrzymuje reszty.
 * @param {{ zachowaj?: string[] }} [opcje] klucze do oszczędzenia (np. sesja)
 * @returns {Promise<{ usuniete: string[], nieudane: string[] }>}
 */
export function wyczyscDaneKonta(storage, opcje) {
  return wKolejce(() => wyczyscBezKolejki(storage, opcje));
}

/**
 * Wiąże dane lokalne z kontem. Wołane przy logowaniu (PRZED zapisem nowego
 * tokenu) i przy odtworzeniu sesji.
 *
 *  - ten sam właściciel → nic;
 *  - inny właściciel → dane poprzedniego konta znikają;
 *  - brak znacznika → przy logowaniu czyścimy (nie wiadomo, czyje to dane — np.
 *    wylogowanie w starszej wersji apki niczego nie kasowało), a przy odtworzeniu
 *    sesji (`przyjmijNieznane`) dane przejmuje zalogowane konto: to aktualizacja
 *    apki u użytkownika, który się nie wylogowywał, i jego dane są jego.
 *
 * @param {{ przyjmijNieznane?: boolean, zachowaj?: string[] }} [opcje]
 * @returns {Promise<{ wyczyszczono: boolean }>}
 */
export function zwiazDaneZKontem(storage, idKonta, { przyjmijNieznane = false, zachowaj = [] } = {}) {
  return wKolejce(async () => {
    const id = idKonta === null || idKonta === undefined || idKonta === '' ? null : String(idKonta);
    let wlasciciel = null;
    try {
      wlasciciel = await storage.getItem(KLUCZ_WLASCICIELA);
    } catch {
      wlasciciel = null;
    }

    if (id && wlasciciel === id) return { wyczyszczono: false };
    if (id && !wlasciciel && przyjmijNieznane) {
      await storage.setItem(KLUCZ_WLASCICIELA, id);
      return { wyczyszczono: false };
    }

    await wyczyscBezKolejki(storage, { zachowaj });
    if (id) await storage.setItem(KLUCZ_WLASCICIELA, id);
    return { wyczyszczono: true };
  });
}

/**
 * Zadanie best-effort z limitem czasu: nigdy nie odrzuca i nigdy nie wisi
 * dłużej niż `limitMs`. → 'ok' | 'blad' | 'limit'.
 */
async function bezBlokady(zadanie, limitMs) {
  let zegar;
  const limit = new Promise((resolve) => { zegar = setTimeout(() => resolve('limit'), limitMs); });
  const praca = Promise.resolve()
    .then(zadanie)
    .then(() => 'ok', () => 'blad');
  try {
    return await Promise.race([praca, limit]);
  } finally {
    clearTimeout(zegar);
  }
}

/**
 * Przebieg wylogowania (i usunięcia konta) po stronie urządzenia.
 *
 * 1. Wyrejestrowanie tokenu push — PRZED skasowaniem tokenu sesji, bo żądanie
 *    wymaga autoryzacji. Bez tego telefon dalej dostawał powiadomienia konta,
 *    z którego się wylogowano. Best-effort: 404 (starszy backend), brak sieci
 *    czy zawieszone łącze nie mogą zablokować wylogowania.
 * 2. Anulowanie lokalnych powiadomień konta (np. termin KIO) — też best-effort.
 * 3. Skasowanie danych konta z magazynu.
 *
 * Wyczyszczenie stanu w pamięci (token w kliencie API, `user`) zostaje po stronie
 * AuthContext — po tym przebiegu.
 *
 * @param {{ storage: object, usunPushToken?: Function, anulujPowiadomienia?: Function, limitMs?: number }} p
 *   `usunPushToken` pominięte = nie wyrejestrowujemy (usunięte konto — backend
 *   skasował rekord razem z tokenem).
 * @returns {Promise<{ push: 'ok'|'blad'|'limit'|'pominieto', dane: { usuniete: string[], nieudane: string[] } }>}
 */
export async function przeprowadzWylogowanie({ storage, usunPushToken, anulujPowiadomienia, limitMs = 4000 }) {
  const push = usunPushToken ? await bezBlokady(usunPushToken, limitMs) : 'pominieto';
  if (anulujPowiadomienia) await bezBlokady(anulujPowiadomienia, limitMs);
  const dane = await wyczyscDaneKonta(storage);
  return { push, dane };
}
