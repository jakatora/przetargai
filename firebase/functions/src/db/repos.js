import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { env } from '../config.js';
import { newId, nowIso, startOfTodayIso } from '../lib/ids.js';
import { obliczRemindAt, nastepneRemind } from '../lib/przypomnienia.js';
import {
  planZapytania, pasujeDoFiltrow, rozmiarPobrania, SKAN_STRONA, SKAN_MAKS,
} from '../lib/katalogPrzetargow.js';
import { kluczZmiany } from '../lib/zmianyOgloszenia.js';

/*
 * Warstwa dostępu do danych — Firestore (port z node:sqlite, D-024).
 *
 * Ten sam kontrakt co repos na Railway, z JEDNĄ różnicą: wszystko jest async.
 *
 * Decyzje modelu (uzasadnienie w plans/MIGRACJA-FIREBASE.md):
 *  • tenders/{docId}, gdzie docId = zsanityzowane bzp_external_id → upsert
 *    naturalny przez create() (numery BZP zawierają '/', niedozwolone w docId).
 *  • users/{uid}/matches/{tenderId} — subkolekcja: feed jednym zapytaniem,
 *    a cudzych dopasowań nie da się nawet zaadresować (IDOR-odporność).
 *    Dokument niesie ZDENORMALIZOWANE pola przetargu (title, deadline, url...)
 *    — Firestore nie ma JOIN-ów; przetarg po pobraniu jest niemutowalny.
 *  • users/{uid}/evaluations/{tenderId} — ślad każdej oceny: kandydat odrzucony
 *    poniżej progu NIE wraca do płatnego AI następnego dnia.
 *  • unikalność email/NIP: dokumenty rezerwacji unique/{klucz} tworzone
 *    create()-em w tej samej transakcji co user (create na istniejącym → błąd).
 *  • ai_usage: wpis + agregat miesięczny (FieldValue.increment) → budżet
 *    czytany JEDNYM odczytem zamiast skanu miesiąca.
 * Znaczniki czasu trzymamy jako ISO stringi (jak w SQLite) — porównania
 * zakresowe działają leksykograficznie, a port nie zmienia formatu API.
 */

const db = () => getFirestore();

/** BZP używa numerów z '/', np. "2026/BZP 00298765/01" — niedozwolone w docId. */
export function tenderDocId(externalId) {
  return String(externalId).replaceAll('/', '~').replaceAll(' ', '_');
}

// ============================ users ============================

const UNIQUE = (key) => db().collection('unique').doc(key);

function userSnap(doc) {
  if (!doc?.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export const users = {
  /**
   * Tworzy konto. Unikalność e-maila (i NIP-u, jeśli podany) egzekwują dokumenty
   * rezerwacji tworzone w tej samej transakcji — create() na istniejącym rzuca.
   * @throws {Error} err.code === 'DUPLICATE_EMAIL' | 'DUPLICATE_NIP'
   */
  async create({ companyNip = null, companyName = null, email, passwordHash, keywords = [], cpvCodes = [] }) {
    const id = newId();
    const ts = nowIso();
    const user = {
      company_nip: companyNip,
      company_name: companyName,
      email,
      password_hash: passwordHash,
      premium_tier: 'free',
      keywords,
      cpv_codes: cpvCodes,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      push_token: null,
      token_version: 0,
      created_at: ts,
      updated_at: ts,
    };
    try {
      await db().runTransaction(async (tx) => {
        tx.create(UNIQUE(`email:${email}`), { uid: id, created_at: ts });
        if (companyNip) tx.create(UNIQUE(`nip:${companyNip}`), { uid: id, created_at: ts });
        tx.create(db().collection('users').doc(id), user);
      });
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) {
        const dup = new Error('Rezerwacja unikalności nie powiodła się');
        dup.code = (await UNIQUE(`email:${email}`).get()).exists ? 'DUPLICATE_EMAIL' : 'DUPLICATE_NIP';
        throw dup;
      }
      throw err;
    }
    return { id, ...user };
  },

  async findById(id) {
    return userSnap(await db().collection('users').doc(id).get());
  },

  async findByEmail(email) {
    const q = await db().collection('users').where('email', '==', email).limit(1).get();
    return q.empty ? null : userSnap(q.docs[0]);
  },

  async findByNip(nip) {
    const q = await db().collection('users').where('company_nip', '==', nip).limit(1).get();
    return q.empty ? null : userSnap(q.docs[0]);
  },

  async findByStripeCustomer(customerId) {
    const q = await db().collection('users').where('stripe_customer_id', '==', customerId).limit(1).get();
    return q.empty ? null : userSnap(q.docs[0]);
  },

  async all() {
    const q = await db().collection('users').get();
    return q.docs.map(userSnap);
  },

  /**
   * Zapisuje profil firmy.
   *
   * `regiony` i `wartoscMax` NIE wchodzą do scoringu (silnik dopasowań liczy
   * wyłącznie słowa i CPV) — służą wyjaśnieniu dopasowania i podpowiedzi przy
   * pustym feedzie. Trzymamy je mimo to przy profilu, bo to deklaracja firmy,
   * a nie ustawienie widoku.
   */
  async updateProfile(id, { companyName, keywords, cpvCodes, regiony, wartoscMax }) {
    await db().collection('users').doc(id).update({
      company_name: companyName ?? null,
      keywords,
      cpv_codes: cpvCodes,
      regiony: regiony ?? [],
      // `null` jest tu WARTOŚCIĄ („nie deklaruję"), nie brakiem pola — dlatego ?? null.
      wartosc_max: wartoscMax ?? null,
      updated_at: nowIso(),
    });
    return this.findById(id);
  },

  /**
   * Zapamiętuje identyfikator konta pomostowego na Railway (P0-4, most).
   * Bez tego most zakładałby nowe konto przy każdym żądaniu.
   */
  async ustawMostRailway(id, idRailway) {
    await db().collection('users').doc(id).update({
      most_railway_user_id: idRailway,
      updated_at: nowIso(),
    });
  },

  async setPushToken(id, token) {
    await db().collection('users').doc(id).update({ push_token: token, updated_at: nowIso() });
  },

  async setTier(id, tier) {
    await db().collection('users').doc(id).update({ premium_tier: tier, updated_at: nowIso() });
  },

  async setStripeCustomer(id, customerId) {
    await db().collection('users').doc(id).update({ stripe_customer_id: customerId, updated_at: nowIso() });
  },

  async setStripeSubscription(id, subscriptionId) {
    await db().collection('users').doc(id).update({ stripe_subscription_id: subscriptionId, updated_at: nowIso() });
  },

  /**
   * Znacznik ostatniego obsłużonego cyklu dopasowań. Cykl sortuje po nim rosnąco,
   * więc gdy zabraknie czasu, następny przebieg zaczyna od pominiętych zamiast
   * co dzień głodzić tych samych użytkowników (audyt 2026-07-10).
   */
  async oznaczCyklObsluzony(id) {
    await db().collection('users').doc(id).update({ last_cycle_at: nowIso() });
  },

  /**
   * Trwale usuwa konto i wszystkie dane użytkownika (RODO art. 17).
   *
   * Firestore **nie kasuje podkolekcji razem z dokumentem** — bez `recursiveDelete`
   * zostałyby osierocone `matches`, `evaluations`, `ai_quota` i `meta`, niewidoczne
   * w konsoli, ale liczone i przechowywane. Osobno zwalniamy dokumenty rezerwacji
   * `unique/…`, bo inaczej ten sam e-mail (i NIP) nigdy nie mógłby się już zarejestrować.
   *
   * Operacja jest idempotentna: usunięcie nieistniejącego konta nie jest błędem.
   */
  async usunKonto(id) {
    const firestore = db();
    const uzytkownik = await this.findById(id);

    // 1. Rezerwacje unikalności — zanim zniknie dokument z e-mailem i NIP-em.
    if (uzytkownik) {
      const doZwolnienia = [UNIQUE(`email:${uzytkownik.email}`)];
      if (uzytkownik.company_nip) doZwolnienia.push(UNIQUE(`nip:${uzytkownik.company_nip}`));
      await Promise.all(doZwolnienia.map((ref) => ref.delete()));
    }

    // 2. Magic linki i tokeny resetu hasła (kolekcje główne, kluczowane tokenem).
    const linki = await firestore.collection('magic_links').where('user_id', '==', id).get();
    await Promise.all(linki.docs.map((d) => d.ref.delete()));
    const resety = await firestore.collection('password_resets').where('user_id', '==', id).get();
    await Promise.all(resety.docs.map((d) => d.ref.delete()));

    // 3. Dokument użytkownika WRAZ z podkolekcjami.
    await firestore.recursiveDelete(firestore.collection('users').doc(id));

    // Wpisy `audit_logs` i `ai_usage` celowo zostają: to dane rozliczeniowe
    // i dowody bezpieczeństwa, przechowywane na innej podstawie prawnej
    // (art. 6 ust. 1 lit. c i f RODO). Nie zawierają treści profilu.
  },
  async setPassword(id, passwordHash) {
    // `token_version++` unieważnia WSZYSTKIE wcześniej wydane tokeny JWT (patrz
    // middleware/auth.js). Na starym koncie bez tego pola increment(1) da 1.
    await db().collection('users').doc(id).update({
      password_hash: passwordHash,
      token_version: FieldValue.increment(1),
      updated_at: nowIso(),
    });
  },

  /**
   * Zmienia adres e-mail (tożsamość logowania). Unikalność egzekwuje dokument
   * rezerwacji `unique/email:*` — tak samo jak przy rejestracji. Zamiana jest
   * transakcyjna: rezerwujemy nowy e-mail, zwalniamy stary i aktualizujemy konto
   * w jednej transakcji, więc równoległa próba zajęcia tego samego adresu przegra.
   *
   * @throws {Error} err.code === 'DUPLICATE_EMAIL' gdy adres jest już zajęty
   */
  async updateEmail(id, nowyEmail, staryEmail) {
    const ts = nowIso();
    try {
      await db().runTransaction(async (tx) => {
        tx.create(UNIQUE(`email:${nowyEmail}`), { uid: id, created_at: ts });
        tx.delete(UNIQUE(`email:${staryEmail}`));
        tx.update(db().collection('users').doc(id), { email: nowyEmail, updated_at: ts });
      });
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) {
        const dup = new Error('Adres e-mail jest już zajęty');
        dup.code = 'DUPLICATE_EMAIL';
        throw dup;
      }
      throw err;
    }
    return this.findById(id);
  },
};

// ============================ password_resets ============================
// Odzyskiwanie hasła. Token trzymany WYŁĄCZNIE jako hash (docId = token_hash) — wyciek bazy
// nie pozwala przejąć konta. Jednorazowy i krótko ważny (patrz endpointy /auth/*-password).

export const passwordResets = {
  async create({ userId, tokenHash, expiresAt }) {
    await db().collection('password_resets').doc(tokenHash).set({
      user_id: userId,
      expires_at: expiresAt,
      used_at: null,
      created_at: nowIso(),
    });
    return tokenHash;
  },
  async findByHash(tokenHash) {
    const snap = await db().collection('password_resets').doc(tokenHash).get();
    return snap.exists ? { token_hash: snap.id, ...snap.data() } : null;
  },
  async deleteForUser(userId) {
    const q = await db().collection('password_resets').where('user_id', '==', userId).get();
    await Promise.all(q.docs.map((d) => d.ref.delete()));
  },
};

// ============================ tenders ============================

/**
 * Firestore odrzuca dokumenty powyżej 1 MiB. `raw_data` z ogłoszenia BZP potrafi
 * spuchnąć (pole `htmlBody` bywa 27 KB, ale zdarzają się grubsze), a razem z resztą
 * pól przekroczyć limit — wtedy zapis rzuca i (przed naprawą) wywracał całą partię.
 * Zostawiamy zapas na pozostałe pola i indeksy.
 */
const MAKS_RAW_DATA_BAJTOW = 700 * 1024;

/*
 * Cache puli otwartych przetargów w pamięci instancji.
 *
 * Audyt 2026-07-10 (CRITICAL): `PATCH /auth/me` odpalało pełny odczyt puli
 * (do 4000 dokumentów) przy KAŻDEJ zmianie kryteriów. Jedno darmowe konto,
 * przełączając słowa kluczowe, generowało setki tysięcy odczytów na minutę.
 *
 * Pula zmienia się realnie raz na dobę (po pobraniu z BZP), więc krótki cache
 * jest bezpieczny: świeżo dodany przetarg pojawi się u użytkownika najpóźniej
 * po TTL, a cron i tak jawnie unieważnia cache po zapisaniu nowych ogłoszeń.
 */
const CACHE_PULI_TTL_MS = 10 * 60_000;
let cachePuli = null; // { limit, wygasa, pula }

/**
 * Cache licznika otwartych przetargów dla `/health`.
 *
 * Monitoring zewnętrzny puka co kilka minut; bez cache każde pukniecie płaciłoby
 * za zapytanie agregujące po całej kolekcji `tenders`.
 */
const CACHE_OTWARTYCH_TTL_MS = 5 * 60_000;
let cacheOtwartych = null; // { ile, wygasa }

function pulaZCache(limit) {
  if (!cachePuli || cachePuli.limit !== limit || Date.now() > cachePuli.wygasa) return null;
  return cachePuli.pula;
}

function zapiszPuleWCache(limit, pula) {
  cachePuli = { limit, pula, wygasa: Date.now() + CACHE_PULI_TTL_MS };
}

/**
 * Pola, których potrzebuje silnik dopasowań — i TYLKO one.
 *
 * Suma trzech odbiorców: heurystyki (`title`, `cpv_main`), promptu AI
 * (+ `organization`, `budget`, `currency`) i denormalizacji feedu w `matches.create`.
 *
 * Bez projekcji pula wciąga CAŁE dokumenty, w tym `raw_data` przycinane dopiero
 * przy 700 KB. Przy dawnym sufircie 2000 nikt tego nie policzył; przy pełnym rynku
 * (7249 i rosnąco) surowe odpowiedzi BZP w pamięci to OOM w środku cyklu, który
 * ma 512 MiB. Odczyt Firestore kosztuje tyle samo — oszczędzamy pamięć i transfer.
 */
const POLA_PULI = [
  'title', 'organization', 'budget', 'currency', 'deadline', 'url', 'cpv_main',
  'source', 'wojewodztwo', 'wadium_wymagane', 'wadium_kwota', 'wadium_wiele_czesci',
  'kryterium_oceny', 'liczba_czesci',
  /*
   * Znacznik anulowania (etap 3, Baza Konkurencyjności). Odsiew robimy W PAMIĘCI,
   * a nie zapytaniem `where('anulowany','!=',true)`: nierówność na innym polu niż
   * `deadline` wymagałaby indeksu ZŁOŻONEGO, a jego brak wywrócił kiedyś całą pulę
   * i razem z nią codzienny cron (patrz komentarz przy `openPool`). Anulowanych są
   * jednostki, więc filtr po odczycie nic nie kosztuje.
   */
  'anulowany',
];

/**
 * Pola czytane przez katalog „Wszystkie przetargi". Szersze niż POLA_PULI, bo
 * karta katalogu pokazuje źródło pierwotne, link do oryginału i datę publikacji —
 * czyli dokładnie to, czego silnik dopasowań nie potrzebuje. Poza projekcją
 * zostaje `raw_data` (bywa setkami kilobajtów) i `ai_summary`.
 */
const POLA_KATALOGU = [
  ...POLA_PULI,
  'published_at', 'fetched_at', 'numer', 'zrodla_alternatywne', 'zaktualizowany_o',
];

/**
 * Statystyki ostatniego POBRANIA puli (nie odczytu z cache).
 *
 * Bez nich sufit puli był niewidoczny: audyt 2026-09-23 musiał go wyliczyć
 * z zewnątrz, zestawiając `otwarte_przetargi` z zaszytą stałą w kodzie.
 */
let statystykiOstatniejPuli = { stan: 'brak_pobrania' };

/**
 * Czyta zapytanie STRONAMI, aż wyczerpie wyniki albo dobije do sufitu.
 *
 * Firestore nie ma „daj wszystko" — jest kursor. Jedno `limit(n)` ucinało pulę
 * po n najbliższych terminach, więc reszta rynku była niewidoczna (P0-5).
 */
async function stronicuj(zapytanie, sufit, rozmiarStrony) {
  const docs = [];
  let kursor = null;
  let zapytan = 0;

  while (docs.length < sufit) {
    const ile = Math.min(rozmiarStrony, sufit - docs.length);
    const strona = kursor ? zapytanie.startAfter(kursor) : zapytanie;
    const snap = await strona.limit(ile).get();
    zapytan += 1;
    docs.push(...snap.docs);
    // Krótsza strona niż zamówiona = koniec wyników; kolejne zapytanie byłoby puste.
    if (snap.docs.length < ile) break;
    kursor = snap.docs[snap.docs.length - 1];
  }

  return { docs, zapytan, osiagnietoSufit: docs.length >= sufit };
}

export const tenders = {
  /** Wstawia przetarg, jeśli jeszcze go nie ma. Zwraca { tender, created }. */
  async upsert(t) {
    const id = tenderDocId(t.externalId);
    const ref = db().collection('tenders').doc(id);

    let raw = JSON.stringify(t.raw ?? {});
    if (Buffer.byteLength(raw, 'utf8') > MAKS_RAW_DATA_BAJTOW) {
      // Surowa odpowiedź służy tylko podglądowi w szczegółach — nie warto przez nią
      // tracić całego ogłoszenia. Zapisujemy ślad zamiast treści.
      raw = JSON.stringify({ _obciete: true, powod: 'raw_data przekracza limit dokumentu Firestore' });
    }

    const record = {
      // Historyczna nazwa pola (pierwotnie tylko BZP) — dziś niesie identyfikatory
      // z prefiksem źródła (`ted:…`). Zmiana nazwy = migracja całej kolekcji; nie warto.
      bzp_external_id: String(t.externalId),
      // Skąd pochodzi ogłoszenie: 'bzp' | 'ted' (D-039). Aplikacja pokazuje
      // „Otwórz w BZP/TED”, a przyszłe źródła dopisują kolejne wartości.
      source: t.source ?? 'bzp',
      title: String(t.title),
      organization: t.organization ?? null,
      cpv_main: t.cpvMain ?? null,
      budget: t.budget ?? null,
      currency: t.currency ?? 'PLN',
      deadline: t.deadline ?? null,
      url: t.url ?? null,
      // Wadium (D-056) — z htmlBody przy ingestii. null = ogłoszenie o tym nie mówi.
      wadium_wymagane: t.wadium_wymagane ?? null,
      wadium_kwota: t.wadium_kwota ?? null,
      wadium_wiele_czesci: t.wadium_wiele_czesci ?? false,
      // Meta z htmlBody (rundy 5-6).
      kryterium_oceny: t.kryterium_oceny ?? null,
      liczba_czesci: t.liczba_czesci ?? null,
      // Wymiary do statystyk wyników (R17).
      rodzaj: t.rodzaj ?? null,
      wojewodztwo: t.wojewodztwo ?? null,
      /*
       * Linki do TEGO SAMEGO postępowania w innych rejestrach (etap 3). Zamawiający
       * współfinansowany z UE ogłasza je i w BZP, i w Bazie Konkurencyjności, a ofertę
       * składa się tam, gdzie wskazuje ogłoszenie — wykonawca musi widzieć oba adresy.
       * Scalanie robi lib/dedupZrodel.js jeszcze przed zapisem, więc drugi dokument
       * w ogóle nie powstaje.
       */
      zrodla_alternatywne: t.zrodla_alternatywne ?? null,
      // Numer sprawy w rejestrze źródłowym (BK: „2026-4203-292028").
      numer: t.numer ?? null,
      raw_data: raw,
      published_at: t.publishedAt ?? null,
      fetched_at: nowIso(),
    };
    try {
      await ref.create(record);
      return { tender: { id, ...record }, created: true };
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) {
        const snap = await ref.get();
        const dane = snap.data() ?? {};
        /*
         * Uzupełnienie brakującego meta (audyt R12). `upsert` jest create-only, więc
         * pola dodane później (wadium/kryterium/części) NIGDY nie trafiały na przetargi
         * zapisane wcześniej — a dzienne pobieranie re-ściąga ostatnie 7 dni z htmlBody.
         * Backfill robimy TYLKO gdy pole nigdy nie było zapisane (undefined), więc to
         * jednorazowy zapis na stary dokument, nie codzienna nadpiska.
         */
        /*
         * Powiązanie z drugim rejestrem bywa znane DOPIERO później: BZP publikuje
         * ogłoszenie w poniedziałek, BK to samo w środę. Gdyby zostało przy
         * create-only, link do rejestru pobocznego nie pojawiłby się nigdy.
         * Dopisujemy go raz — gdy dokument jeszcze go nie ma.
         */
        if (t.zrodla_alternatywne && !dane.zrodla_alternatywne) {
          await ref.update({ zrodla_alternatywne: t.zrodla_alternatywne });
          return { tender: { id, ...dane, zrodla_alternatywne: t.zrodla_alternatywne }, created: false };
        }
        if (dane.wadium_wymagane === undefined && dane.kryterium_oceny === undefined
            && dane.liczba_czesci === undefined) {
          const meta = {
            wadium_wymagane: t.wadium_wymagane ?? null,
            wadium_kwota: t.wadium_kwota ?? null,
            wadium_wiele_czesci: t.wadium_wiele_czesci ?? false,
            kryterium_oceny: t.kryterium_oceny ?? null,
            liczba_czesci: t.liczba_czesci ?? null,
            rodzaj: t.rodzaj ?? null,
            wojewodztwo: t.wojewodztwo ?? null,
          };
          await ref.update(meta);
          return { tender: { id, ...dane, ...meta }, created: false };
        }
        return { tender: userSnap(snap), created: false };
      }
      throw err;
    }
  },

  /**
   * Aktualizuje ISTNIEJĄCE ogłoszenie danymi z kolejnej wersji w rejestrze źródłowym.
   *
   * `upsert` jest create-only i to jest świadome: ogłoszenie BZP po publikacji się
   * nie zmienia. Baza Konkurencyjności działa INACZEJ — wydaje kolejne WERSJE tego
   * samego ogłoszenia, a najczęstsza zmiana to PRZESUNIĘCIE TERMINU składania ofert
   * (druga co do częstości: odpowiedzi na pytania doklejane do treści). Bez tej
   * metody pokazywalibyśmy wykonawcy termin, który już nie obowiązuje — czyli
   * dokładnie tę informację, po którą przyszedł.
   *
   * Cisza w nowej wersji NIE jest usunięciem: pola `null`/`undefined` zostawiają
   * dotychczasową wartość. Inaczej oszczędniejsza kolejna wersja BK wyczyściłaby
   * budżet i CPV, a z nimi całą zdolność heurystyki do dopasowania.
   *
   * @returns {Promise<{zmienione: boolean}>} `false`, gdy dokumentu nie ma
   *   (to normalne: zmiana mogła dotyczyć ogłoszenia, którego jeszcze nie pobraliśmy)
   */
  async zaktualizujZeZrodla(t) {
    const ref = db().collection('tenders').doc(tenderDocId(t.externalId));
    const snap = await ref.get();
    if (!snap.exists) return { zmienione: false };

    const zmiany = { zaktualizowany_o: nowIso() };
    const ustaw = (pole, wartosc) => {
      if (wartosc !== undefined && wartosc !== null && wartosc !== '') zmiany[pole] = wartosc;
    };
    ustaw('title', t.title);
    ustaw('organization', t.organization);
    ustaw('cpv_main', t.cpvMain);
    ustaw('budget', t.budget);
    ustaw('currency', t.currency);
    ustaw('deadline', t.deadline);
    ustaw('url', t.url);
    ustaw('published_at', t.publishedAt);
    ustaw('wojewodztwo', t.wojewodztwo);
    ustaw('rodzaj', t.rodzaj);
    ustaw('liczba_czesci', t.liczba_czesci);
    ustaw('numer', t.numer);

    await ref.update(zmiany);
    return { zmienione: true };
  },

  /**
   * Znakuje ogłoszenie jako anulowane przez zamawiającego.
   *
   * NIE kasujemy dokumentu: ktoś mógł je zapisać do „Zapisanych", ma je w swoich
   * dopasowaniach i w historii ocen. Usunięcie zabrałoby mu tę historię i zostawiło
   * martwe odwołania. Zamiast tego wpis wypada z PULI dopasowań (`openPool`), więc
   * przestaje kosztować płatne wywołania AI i przestaje wracać do feedu.
   *
   * @returns {Promise<boolean>} `false`, gdy ogłoszenia nie ma w bazie
   */
  async oznaczAnulowany(externalId, { powod = null } = {}) {
    const ref = db().collection('tenders').doc(tenderDocId(externalId));
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.update({ anulowany: true, anulowany_o: nowIso(), anulowany_powod: powod });
    return true;
  },

  async findById(id) {
    return userSnap(await db().collection('tenders').doc(id).get());
  },

  /**
   * Wyjaśnienie AI ogłoszenia jest CACHE'OWANE na dokumencie przetargu (D-052) —
   * przetarg jest niemutowalny co do danych źródłowych, ale wyjaśnienie to pole
   * pochodne, wspólne dla wszystkich oglądających. Pierwszy oglądający płaci za
   * generację, reszta czyta z cache za darmo. Zwraca obiekt streszczenia lub null.
   */
  async getSummary(id) {
    const snap = await db().collection('tenders').doc(id).get();
    if (!snap.exists) return null;
    const s = snap.data().ai_summary;
    return s && typeof s === 'object' ? s : null;
  },

  async saveSummary(id, summary) {
    await db().collection('tenders').doc(id).set(
      { ai_summary: summary, ai_summary_at: nowIso() },
      { merge: true },
    );
  },

  async recent(limit = 200) {
    const q = await db().collection('tenders').orderBy('fetched_at', 'desc').limit(limit).get();
    return q.docs.map(userSnap);
  },

  /**
   * Pula otwartych przetargów (naprawa P-4 w wydaniu bez JOIN-ów): dwa zapytania
   * — otwarty termin + brak terminu. Filtrowanie "user już ocenił" robi silnik
   * dopasowań punktowo przez evaluations.idsAmong na czołówce rankingu,
   * nie tutaj — anty-JOIN na całej puli kosztowałby odczyt na każdy dokument.
   *
   * OBA zapytania muszą się obyć bez indeksu ZŁOŻONEGO:
   *  • `deadline > x` + `orderBy(deadline)` — nierówność i sortowanie po TYM SAMYM
   *    polu, obsługiwane przez automatyczny indeks jednopolowy;
   *  • `deadline == null` — sama równość, bez `orderBy` na innym polu. Wcześniej
   *    było tu `orderBy('fetched_at','desc')`, co Firestore obsługuje wyłącznie
   *    przez indeks złożony (deadline, fetched_at). Indeksu nie było, więc zapytanie
   *    rzucało FAILED_PRECONDITION, a że oba idą przez Promise.all, padała CAŁA pula
   *    i razem z nią codzienny cron oraz backfill przy rejestracji. **Emulator
   *    Firestore nie egzekwuje indeksów złożonych — testy tego nie wykrywały.**
   *    Kolejność w tej gałęzi i tak nie ma znaczenia: pulę rankuje heurystyka.
   */
  async openPool({ swiezaKopia = false, limit = env.PULA_MAKS, rozmiarStrony = env.PULA_ROZMIAR_STRONY } = {}) {
    if (!swiezaKopia) {
      const zCache = pulaZCache(limit);
      if (zCache) return zCache;
    }

    const col = db().collection('tenders');
    const [zTerminem, bezTerminu] = await Promise.all([
      stronicuj(col.where('deadline', '>', nowIso()).orderBy('deadline').select(...POLA_PULI), limit, rozmiarStrony),
      /*
       * Gałąź bez terminu zostaje BEZ `orderBy` — jawne sortowanie po innym polu
       * wymagałoby indeksu złożonego, którego brak wywrócił kiedyś cały silnik
       * (patrz komentarz niżej i test/indeksyFirestore.test.js). Kursor działa
       * i tak: `startAfter(snapshot)` korzysta z domyślnego porządku po nazwie
       * dokumentu, który Firestore stosuje przy samej równości.
       */
      stronicuj(col.where('deadline', '==', null).select(...POLA_PULI), limit, rozmiarStrony),
    ]);

    const wszystkie = [...zTerminem.docs, ...bezTerminu.docs].map(userSnap);
    // Anulowane ogłoszenie ma wciąż otwarty termin, więc zapytanie je zwraca.
    // Zostawienie go w puli kosztowałoby płatne wywołanie AI i wprowadzało
    // użytkownika w błąd — postępowanie już nie istnieje.
    const pula = wszystkie.filter((t) => t.anulowany !== true);
    statystykiOstatniejPuli = {
      pobrane: pula.length,
      anulowane_odsiane: wszystkie.length - pula.length,
      zTerminem: zTerminem.docs.length,
      bezTerminu: bezTerminu.docs.length,
      zapytan: zTerminem.zapytan + bezTerminu.zapytan,
      sufit: limit,
      osiagnietoSufit: zTerminem.osiagnietoSufit || bezTerminu.osiagnietoSufit,
      pobrane_o: nowIso(),
    };
    zapiszPuleWCache(limit, pula);
    return pula;
  },

  /**
   * Jak wyglądało ostatnie pobranie puli — dla `/health` i logu cyklu.
   * `osiagnietoSufit: true` znaczy, że część rynku mogła nie wejść do dopasowań.
   */
  statystykiPuli() {
    return { ...statystykiOstatniejPuli };
  },

  /** Unieważnia cache — woła cron po pobraniu nowych ogłoszeń z BZP. */
  odswiezPule() {
    cachePuli = null;
    cacheOtwartych = null;
  },

  /**
   * Ile przetargów ma JESZCZE otwarty termin składania.
   *
   * To mianownik wszystkich pomiarów kompletności: bez niego nie da się
   * odpowiedzieć, czy pula dopasowań (`openPool`) obejmuje cały rynek, czy
   * tylko ogon przy samym terminie (audyt 2026-09-23 §3.4 — hipoteza, której
   * nie dało się zweryfikować bez tej liczby).
   *
   * Zapytanie agregujące (`count()`) nie czyta dokumentów, ale nie jest darmowe,
   * a `/health` odpytuje monitoring co kilka minut — stąd krótki cache w pamięci
   * instancji, unieważniany razem z pulą po każdym cyklu.
   */
  async policzOtwarte() {
    if (cacheOtwartych && Date.now() < cacheOtwartych.wygasa) return cacheOtwartych.ile;
    const agg = await db().collection('tenders').where('deadline', '>', nowIso()).count().get();
    const ile = agg.data().count;
    cacheOtwartych = { ile, wygasa: Date.now() + CACHE_OTWARTYCH_TTL_MS };
    return ile;
  },

  /**
   * Katalog „Wszystkie przetargi" (P1-1) — strona rynku, NIE feed użytkownika.
   *
   * Świadomie nie dotyka ani profilu, ani `matches`, ani `openPool`: pula ma
   * sufit i cache, bo służy silnikowi dopasowań, a katalog ma pokazać wszystko.
   *
   * Dlaczego skan, a nie samo `limit(n)`: większość filtrów (region, CPV, tekst,
   * kwota) nie da się spytać Firestore'a — `wojewodztwo` trzymamy w formacie
   * źródła („PL12" vs „małopolskie"), a `cpv_main` to sklejony łańcuch kodów.
   * Czytamy więc porcjami w porządku zapytania i odsiewamy w pamięci, aż strona
   * się zapełni albo skończą się dane, albo dobijemy do sufitu odczytów.
   *
   * Sufit NIE gubi rekordów: kursor wskazuje pozycję w porządku Firestore, więc
   * kolejne żądanie rusza dokładnie tam, gdzie poprzednie stanęło. Odpowiedź
   * mówi wprost (`wyczerpano`), czy to już koniec listy, czy tylko koniec budżetu.
   */
  async katalog({
    filtry,
    teraz = nowIso(),
    kursor = null,
    rozmiarStrony = SKAN_STRONA,
    skanMaks = SKAN_MAKS,
  }) {
    const plan = planZapytania(filtry, teraz);

    let zapytanie = db().collection('tenders');
    for (const [pole, wartosc] of plan.rowne) zapytanie = zapytanie.where(pole, '==', wartosc);
    for (const [pole, op, wartosc] of plan.zakres) zapytanie = zapytanie.where(pole, op, wartosc);
    /*
     * Jawny `orderBy` po identyfikatorze dokumentu jest tu rozstrzygaczem remisów.
     * Bez niego dwa ogłoszenia z tym samym `fetched_at` (a pobieranie zapisuje
     * setki naraz) mogłyby się przy stronicowaniu powtórzyć albo zniknąć.
     * Kierunek musi być ten sam co pola sortowania — inaczej indeks nie pasuje.
     */
    zapytanie = zapytanie
      .orderBy(plan.sort.pole, plan.sort.kierunek)
      .orderBy(FieldPath.documentId(), plan.sort.kierunek)
      .select(...POLA_KATALOGU);

    const wiersze = [];
    let ostatni = kursor;
    let przeskanowano = 0;
    let zapytan = 0;
    let wyczerpano = false;

    while (wiersze.length < filtry.limit && przeskanowano < skanMaks) {
      // Porcja rośnie dopiero wtedy, gdy filtr okazuje się rzadki — żądanie
      // o trzy pozycje nie ma prawa kosztować pełnej strony odczytów.
      const ile = Math.min(
        rozmiarPobrania({
          potrzeba: filtry.limit - wiersze.length,
          przeskanowano,
          znalezione: wiersze.length,
          maks: rozmiarStrony,
        }),
        skanMaks - przeskanowano,
      );
      const strona = ostatni ? zapytanie.startAfter(ostatni.wartosc, ostatni.id) : zapytanie;
      const snap = await strona.limit(ile).get();
      zapytan += 1;
      przeskanowano += snap.docs.length;

      let obejrzane = 0;
      for (const doc of snap.docs) {
        obejrzane += 1;
        const t = { id: doc.id, ...doc.data() };
        // Kursor przesuwamy na KAŻDYM obejrzanym dokumencie, także odrzuconym —
        // inaczej kolejna strona zaczynałaby od nowa na tym samym odsianym ogonie.
        ostatni = { wartosc: t[plan.sort.pole] ?? null, id: doc.id };
        if (pasujeDoFiltrow(t, filtry, teraz)) {
          wiersze.push(t);
          if (wiersze.length >= filtry.limit) break;
        }
      }

      /*
       * „Krótsza strona niż zamówiona" znaczy koniec danych WYŁĄCZNIE wtedy, gdy
       * obejrzeliśmy ją w całości. Przerwanie w połowie (bo strona wyników się
       * zapełniła) zostawia w tej samej porcji dokumenty jeszcze nieobejrzane —
       * ogłoszenie bez kursora byłoby wtedy nieosiągalne, choć leży tuż obok.
       */
      if (obejrzane === snap.docs.length && snap.docs.length < ile) { wyczerpano = true; break; }
      if (wiersze.length >= filtry.limit) break;
    }

    return {
      wiersze,
      ostatni: wyczerpano ? null : ostatni,
      przeskanowano,
      zapytan,
      wyczerpano,
    };
  },

  async count() {
    const agg = await db().collection('tenders').count().get();
    return agg.data().count;
  },

  /** Ile przetargów pobrano od `sinceIso` (dowód społeczny na ekranie logowania). */
  async countSince(sinceIso) {
    const agg = await db().collection('tenders').where('fetched_at', '>=', sinceIso).count().get();
    return agg.data().count;
  },
};

// ============================ matches ============================

const matchCol = (userId) => db().collection('users').doc(userId).collection('matches');

export const matches = {
  /**
   * Tworzy dopasowanie. docId = tenderId → duplikat niemożliwy z konstrukcji
   * (odpowiednik ON CONFLICT DO NOTHING). `tender` = zdenormalizowane pola do feedu.
   */
  async create({ userId, tenderId, score, reasoning, scorer = 'ai', tender }) {
    const ref = matchCol(userId).doc(tenderId);
    const record = {
      user_id: userId,
      tender_id: tenderId,
      confidence_score: Math.round(score),
      match_reasoning: reasoning ?? null,
      scorer,
      notified: 0,
      created_at: nowIso(),
      tender_title: tender?.title ?? null,
      tender_organization: tender?.organization ?? null,
      tender_budget: tender?.budget ?? null,
      tender_currency: tender?.currency ?? 'PLN',
      tender_deadline: tender?.deadline ?? null,
      tender_url: tender?.url ?? null,
      tender_cpv: tender?.cpv_main ?? null,
      tender_source: tender?.source ?? 'bzp',
      tender_wojewodztwo: tender?.wojewodztwo ?? null,
      tender_wadium_wymagane: tender?.wadium_wymagane ?? null,
      tender_wadium_kwota: tender?.wadium_kwota ?? null,
      tender_wadium_wiele_czesci: tender?.wadium_wiele_czesci ?? false,
      tender_kryterium_oceny: tender?.kryterium_oceny ?? null,
      tender_liczba_czesci: tender?.liczba_czesci ?? null,
    };
    try {
      await ref.create(record);
      return { created: true, match: { id: tenderId, ...record } };
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return { created: false, match: null };
      throw err;
    }
  },

  async exists(userId, tenderId) {
    return (await matchCol(userId).doc(tenderId).get()).exists;
  },

  /**
   * Zapisuje dopasowanie RAZEM ze śladem oceny — jeden batch, jedna transakcja.
   *
   * Audyt 2026-07-10: ślad szedł do bazy PRZED dopasowaniem. Przejściowy błąd
   * zapisu `matches` zostawiał ślad „już oceniono", więc kwalifikujący się przetarg
   * przepadał bezpowrotnie. W drugą stronę też źle: udany zapis dopasowania bez
   * śladu oznaczał, że nazajutrz płacimy AI za tego samego kandydata.
   */
  async createWithEvaluation({ userId, tenderId, score, reasoning, scorer = 'ai', tender, criteriaHash = null }) {
    const matchRef = matchCol(userId).doc(tenderId);
    const record = {
      user_id: userId,
      tender_id: tenderId,
      confidence_score: Math.round(score),
      match_reasoning: reasoning ?? null,
      scorer,
      notified: 0,
      created_at: nowIso(),
      tender_title: tender?.title ?? null,
      tender_organization: tender?.organization ?? null,
      tender_budget: tender?.budget ?? null,
      tender_currency: tender?.currency ?? 'PLN',
      tender_deadline: tender?.deadline ?? null,
      tender_url: tender?.url ?? null,
      tender_cpv: tender?.cpv_main ?? null,
      tender_source: tender?.source ?? 'bzp',
      tender_wojewodztwo: tender?.wojewodztwo ?? null,
      tender_wadium_wymagane: tender?.wadium_wymagane ?? null,
      tender_wadium_kwota: tender?.wadium_kwota ?? null,
      tender_wadium_wiele_czesci: tender?.wadium_wiele_czesci ?? false,
      tender_kryterium_oceny: tender?.kryterium_oceny ?? null,
      tender_liczba_czesci: tender?.liczba_czesci ?? null,
    };
    const evalRef = evalCol(userId).doc(tenderId);
    const slad = { score: Math.round(score), scorer, criteria_hash: criteriaHash, evaluated_at: nowIso() };

    const batch = db().batch();
    batch.create(matchRef, record);
    batch.set(evalRef, slad);
    try {
      await batch.commit();
      return { created: true, match: { id: tenderId, ...record } };
    } catch (err) {
      if (err.code !== 6 /* ALREADY_EXISTS */) throw err;

      /*
       * Dopasowanie już istnieje — a `batch.create` wywraca CAŁY batch, więc ślad
       * oceny też się nie zapisał. Bez niego `idsAmong` nie odsieje kandydata i
       * nazajutrz znów zapłacimy AI za ten sam przetarg (audyt 2026-07-10; regresja
       * wprowadzona razem z samą metodą). Zapisujemy ślad osobno.
       *
       * Zdarza się, gdy zmiana kryteriów unieważniła stary ślad, ale dopasowanie
       * z poprzedniego profilu wciąż tam jest.
       */
      await evalRef.set(slad);
      return { created: false, match: null };
    }
  },

  /**
   * Strona feedu, paginowana KURSOREM.
   *
   * `przed` to znacznik ostatniego widzianego dopasowania w postaci `"<created_at>|<id>"`.
   *
   * Dlaczego kursor jest ZŁOŻONY: cykl dopasowań zapisuje wiele dokumentów w tej samej
   * milisekundzie, a `created_at` ma rozdzielczość milisekundy — 200 kolejnych wywołań
   * `nowIso()` dało 2 różne znaczniki. Kursor po samym czasie przeskakiwałby całe grupy
   * dopasowań albo pokazywał je dwa razy. Identyfikator dokumentu rozstrzyga remisy.
   *
   * Wcześniej było `offset(n)` sterowane przez klienta — Firestore nalicza odczyt za
   * KAŻDY pominięty dokument, więc `?offset=100000` kosztowałby sto tysięcy odczytów
   * na jedno żądanie (audyt 2026-07-10).
   */
  async listForUser(userId, limit = 20, przed = null) {
    // Sortowanie po identyfikatorze musi być JAWNE — inaczej Firestore odrzuca
    // dwuczłonowy kursor („Too many cursor values"). Ten sam kierunek co created_at,
    // więc obsługuje je automatyczny indeks; indeks złożony nie jest potrzebny.
    let q = matchCol(userId)
      .orderBy('created_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (przed) {
      const rozdzielacz = przed.lastIndexOf('|');
      if (rozdzielacz > 0) {
        q = q.startAfter(przed.slice(0, rozdzielacz), przed.slice(rozdzielacz + 1));
      } else {
        // Kursor w starym formacie (sam czas) — zaczynamy od pierwszego dokumentu
        // o tym znaczniku, żeby nie zgubić grupy zapisanej w tej samej milisekundzie.
        q = q.startAfter(przed, '');
      }
    }

    const snap = await q.limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /** Kursor wskazujący ostatni element strony — do przekazania jako `before`. */
  kursorZ(match) {
    return match ? `${match.created_at}|${match.id}` : null;
  },

  async detail(userId, matchId) {
    const doc = await matchCol(userId).doc(matchId).get();
    if (!doc.exists) return null;
    // Pola przetargu są ZDENORMALIZOWANE w dokumencie dopasowania (tender_title,
    // tender_deadline…), więc szczegóły nie wymagają drugiego odczytu. Dawniej
    // dociągaliśmy CAŁY tender (raw_data do ~700 KB) po pole `tender_raw`, którego
    // nikt nie konsumował — 2 odczyty Firestore zamiast 1 na 5 najgorętszych trasach
    // (GET /:id, save, feedback, streszczenie, wyniki). Trasy potrzebujące pełnego
    // przetargu (streszczenie/wyniki) czytają go u siebie (tenders.findById).
    return { id: doc.id, ...doc.data() };
  },

  async countToday(userId) {
    const agg = await matchCol(userId).where('created_at', '>=', startOfTodayIso()).count().get();
    return agg.data().count;
  },

  /** Ile dopasowań powstało od daty `sinceIso` (potencjał tygodnia — D-055). */
  async countSince(userId, sinceIso) {
    const agg = await matchCol(userId).where('created_at', '>=', sinceIso).count().get();
    return agg.data().count;
  },

  /**
   * Tytuły najświeższych dopasowań od `sinceIso` (do cotygodniowego przeglądu).
   * Filtr i sortowanie po tym samym polu `created_at` — obsługuje indeks jednopolowy.
   */
  async recentTitlesSince(userId, sinceIso, limit = 5) {
    const snap = await matchCol(userId)
      .where('created_at', '>=', sinceIso)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data().tender_title).filter(Boolean);
  },

  async markNotified(userId, matchId) {
    await matchCol(userId).doc(matchId).update({ notified: 1 });
  },

  /** Oznacza wiele dopasowań jako powiadomione JEDNYM batchem (zamiast N round-tripów). */
  async markNotifiedBatch(userId, matchIds) {
    if (!matchIds?.length) return;
    const batch = db().batch();
    for (const id of matchIds) batch.update(matchCol(userId).doc(id), { notified: 1 });
    await batch.commit();
  },
};

// ============================ zapisane (zakładki) ============================

const savedCol = (userId) => db().collection('users').doc(userId).collection('saved');

export const saved = {
  /**
   * Zapisuje przetarg do „Zapisanych" — kopiuje zdenormalizowane pola z dopasowania,
   * żeby lista renderowała się bez JOIN-a (tak jak feed). docId = tenderId, więc
   * powtórny zapis tego samego przetargu jest bezpieczny.
   * @returns {Promise<boolean>} true = powstał NOWY wpis; false = już był zapisany
   */
  async add(userId, match) {
    const tenderId = match.tender_id ?? match.id;
    const rekord = {
      tender_id: tenderId,
      confidence_score: match.confidence_score ?? null,
      scorer: match.scorer ?? null,
      match_reasoning: match.match_reasoning ?? null,
      tender_title: match.tender_title ?? null,
      tender_organization: match.tender_organization ?? null,
      tender_budget: match.tender_budget ?? null,
      tender_currency: match.tender_currency ?? 'PLN',
      tender_deadline: match.tender_deadline ?? null,
      tender_url: match.tender_url ?? null,
      tender_cpv: match.tender_cpv ?? null,
      tender_source: match.tender_source ?? 'bzp',
      tender_wadium_wymagane: match.tender_wadium_wymagane ?? null,
      tender_wadium_kwota: match.tender_wadium_kwota ?? null,
      tender_wadium_wiele_czesci: match.tender_wadium_wiele_czesci ?? false,
      tender_kryterium_oceny: match.tender_kryterium_oceny ?? null,
      tender_liczba_czesci: match.tender_liczba_czesci ?? null,
      saved_at: nowIso(),
    };
    // create() (nie set()) — chcemy odróżnić nowy zapis od powtórnego i NIE nadpisywać saved_at.
    try {
      await savedCol(userId).doc(tenderId).create(rekord);
      return true;
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return false;
      throw err;
    }
  },

  async remove(userId, tenderId) {
    await savedCol(userId).doc(tenderId).delete();
  },

  /**
   * Ustawia etap pracy nad zapisanym przetargiem (D-054 — warsztat przetargu).
   * Status jest już znormalizowany przez wołającego. Zwraca null, gdy przetarg
   * nie jest zapisany (nie ma czego etapować).
   */
  async setStatus(userId, tenderId, status) {
    const ref = savedCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({ status, status_at: nowIso() });
    return { status };
  },

  /** Zapisuje prywatną notatkę do zapisanego przetargu. Notatka już oczyszczona. */
  async setNote(userId, tenderId, notatka) {
    const ref = savedCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({ notatka, notatka_at: nowIso() });
    return { notatka };
  },

  /** Lista zapisanych, najnowszy zapis pierwszy. Bez paginacji — zapisanych jest mało. */
  async list(userId, limit = 100) {
    const snap = await savedCol(userId).orderBy('saved_at', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /** Same identyfikatory zapisanych (do zaznaczania ikony w feedzie) — bez pobierania treści. */
  async ids(userId) {
    const snap = await savedCol(userId).select().get();
    return snap.docs.map((d) => d.id);
  },

  /**
   * Włącza/wyłącza przypomnienie o terminie dla zapisanego przetargu (D-050).
   * remind_at liczone z `tender_deadline` (48 h przed). Przetarg bez terminu
   * albo po terminie nie może mieć przypomnienia — zwracamy `powod`.
   * @returns {Promise<{reminder_enabled:boolean, remind_at?:string, powod?:string}>}
   */
  async setReminder(userId, tenderId, enabled) {
    const ref = savedCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists) return { reminder_enabled: false, powod: 'nie_zapisany' };

    if (!enabled) {
      await ref.update({ reminder_enabled: false });
      return { reminder_enabled: false };
    }

    // Etapy 7/3/1 (runda 11): pierwszy przyszły etap. Minione przy włączeniu pomijamy.
    const nast = nastepneRemind(doc.data().tender_deadline, nowIso(), []);
    if (!nast) return { reminder_enabled: false, powod: 'brak_terminu' };

    await ref.update({
      reminder_enabled: true,
      remind_at: nast.at,
      remind_etap: nast.etap,
      reminded_stages: [],
      reminder_notified: false,
    });
    return { reminder_enabled: true, remind_at: nast.at, remind_etap: nast.etap };
  },

  /**
   * Wpisy wymagalne do wysyłki: włączone, jeszcze niepowiadomione, remind_at ≤ teraz.
   * collectionGroup — indeks zadeklarowany w firestore.indexes.json (reminder_enabled + remind_at).
   * `reminder_notified` filtrujemy w kodzie, żeby uniknąć trzeciego pola w indeksie.
   * @returns {Promise<Array<{userId:string, tenderId:string, ...pola}>>}
   */
  async dueReminders(teraz = nowIso()) {
    const snap = await db().collectionGroup('saved')
      .where('reminder_enabled', '==', true)
      .where('remind_at', '<=', teraz)
      .get();
    return snap.docs
      .filter((d) => d.data().reminder_notified !== true)
      .map((d) => ({ userId: d.ref.parent.parent.id, tenderId: d.id, ...d.data() }));
  },

  /**
   * Po wysłaniu etapu przesuwa przypomnienie na następny (7→3→1→koniec). Gdy nie ma
   * kolejnego etapu, ustawia `reminder_notified` (nie wróci w zapytaniu wymagalnych).
   * Zwraca etap, który właśnie przesunięto (do logu), lub null gdy nic do zrobienia.
   */
  async advanceReminder(userId, tenderId) {
    const ref = savedCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const d = doc.data();

    const wyslane = [...(d.reminded_stages ?? []), d.remind_etap].filter((x) => typeof x === 'number');
    const nast = nastepneRemind(d.tender_deadline, nowIso(), wyslane);

    if (nast) {
      await ref.update({ remind_at: nast.at, remind_etap: nast.etap, reminded_stages: wyslane });
    } else {
      await ref.update({ reminder_notified: true, reminded_stages: wyslane });
    }
    return d.remind_etap ?? null;
  },
};

// ============================ evaluations ============================

const evalCol = (userId) => db().collection('users').doc(userId).collection('evaluations');

export const evaluations = {
  /**
   * Zapisuje ślad oceny — kandydat poniżej progu nie wraca do płatnego AI.
   * `criteriaHash` przypina ocenę do WERSJI PROFILU: po zmianie słów kluczowych
   * ten sam przetarg zostanie oceniony ponownie (§6.14 planu), ale powrót do
   * poprzedniego profilu trafia w istniejący ślad i nie kosztuje ani grosza.
   */
  async record(userId, tenderId, { score, scorer, criteriaHash = null }) {
    await evalCol(userId).doc(tenderId).set({
      score: Math.round(score),
      scorer,
      // Firestore odrzuca `undefined` — brak odcisku zapisujemy jawnie jako null.
      criteria_hash: criteriaHash,
      evaluated_at: nowIso(),
    });
  },

  /** Zbiór tenderId ocenionych PRZY TYCH SAMYCH kryteriach — punktowo dla czołówki. */
  async idsAmong(userId, tenderIds, criteriaHash) {
    if (!tenderIds.length) return new Set();
    const refs = tenderIds.map((id) => evalCol(userId).doc(id));
    const snaps = await db().getAll(...refs);
    return new Set(
      snaps
        .filter((s) => s.exists && (criteriaHash === undefined || s.data().criteria_hash === criteriaHash))
        .map((s) => s.id),
    );
  },
};

// ============================ hamulec ponownego dopasowania ============================

/**
 * Minimalny odstęp między pełnymi przebiegami dopasowań dla jednego użytkownika.
 *
 * Audyt 2026-07-10 (CRITICAL): `PATCH /auth/me` odpalało `backfillUser` przy każdej
 * zmianie kryteriów, a ten czyta CAŁĄ pulę otwartych przetargów (do 4000 odczytów
 * Firestore). Limiter dopuszcza 120 żądań/min, więc jedno darmowe konto, przełączając
 * słowa kluczowe tam i z powrotem, generowało ~480 000 odczytów na minutę. `aiQuota`
 * tego nie broniła — pilnuje wyłącznie wydatków na AI, a odczyty puli są PRZED nią.
 */
const ODSTEP_BACKFILL_MS = 10 * 60_000;

export const backfillCooldown = {
  /**
   * Rezerwuje prawo do pełnego przebiegu dopasowań.
   * @returns {Promise<boolean>} false, gdy użytkownik odpalał backfill niedawno.
   */
  async reserve(userId, odstepMs = ODSTEP_BACKFILL_MS) {
    const ref = db().collection('users').doc(userId).collection('meta').doc('backfill');
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const ostatni = doc.exists ? new Date(doc.data().last_run_at ?? 0).getTime() : 0;
      if (Date.now() - ostatni < odstepMs) return false;
      tx.set(ref, { last_run_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

// ============================ dzienny limit wywołań AI ============================

/**
 * Twardy dzienny limit PŁATNYCH wywołań AI na użytkownika.
 *
 * Audyt 2026-07-09 (HIGH, denial-of-wallet): dzienny limit dopasowań planu Free
 * nie ograniczał wywołań AI — malał dopiero przy UTWORZENIU dopasowania, a kandydat
 * odrzucony poniżej progu nie zostawiał śladu. Jedno darmowe konto, przełączając
 * kryteria przez PATCH /auth/me, mogło wypompować wspólny budżet i wyłączyć
 * matching AI wszystkim płacącym.
 */
const quotaDoc = (userId, day) => db().collection('users').doc(userId).collection('ai_quota').doc(day);

export const aiQuota = {
  today() {
    return nowIso().slice(0, 10); // YYYY-MM-DD (UTC)
  },

  async used(userId) {
    const doc = await quotaDoc(userId, this.today()).get();
    return doc.exists ? (doc.data().calls ?? 0) : 0;
  },

  /** Rezerwuje jedno wywołanie AI. Zwraca false, gdy dzienny limit wyczerpany. */
  async reserve(userId, limit) {
    const ref = quotaDoc(userId, this.today());
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const calls = doc.exists ? (doc.data().calls ?? 0) : 0;
      if (calls >= limit) return false;
      tx.set(ref, { calls: calls + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

/**
 * Dobowy limit GENERACJI wyjaśnień AI na użytkownika (D-052, denial-of-wallet).
 * Osobny licznik niż aiQuota — wyjaśnienie i ocena dopasowania to różne operacje
 * o różnych limitach, a wspólny licznik mieszałby ich rozliczenie. Liczy się tylko
 * CACHE MISS: otwarcie przetargu z gotowym wyjaśnieniem nic nie kosztuje i nie
 * dotyka tego licznika (wołający pyta o rezerwację dopiero przy braku cache).
 */
const summaryQuotaDoc = (userId, day) =>
  db().collection('users').doc(userId).collection('summary_quota').doc(day);

export const streszczenieQuota = {
  today() {
    return nowIso().slice(0, 10);
  },

  /** Rezerwuje jedną generację. Zwraca false, gdy dobowy limit wyczerpany. */
  async reserve(userId, limit) {
    const ref = summaryQuotaDoc(userId, this.today());
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const calls = doc.exists ? (doc.data().calls ?? 0) : 0;
      if (calls >= limit) return false;
      tx.set(ref, { calls: calls + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

/** Dobowy limit sugestii profilu AI (onboarding, rundy 9-10) — osobny licznik. */
const profilQuotaDoc = (userId, day) =>
  db().collection('users').doc(userId).collection('profil_quota').doc(day);

export const profilQuota = {
  today() { return nowIso().slice(0, 10); },
  async reserve(userId, limit) {
    const ref = profilQuotaDoc(userId, this.today());
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const calls = doc.exists ? (doc.data().calls ?? 0) : 0;
      if (calls >= limit) return false;
      tx.set(ref, { calls: calls + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

// ============================ statystyki wyników (R16) ============================

/** Klucz bucketa `45|Works|PL14` bywa docId — `|` jest dozwolone, ale utwardzamy. */
const statDocId = (klucz) => String(klucz).replace(/[/\\]/g, '_');

export const wynikiStats = {
  /** Zapisuje wszystkie buckety agregacji (nadpisuje — statystyki liczymy od nowa). */
  async zapisz(buckety) {
    const wpisy = Object.entries(buckety);
    // Batch po 400 (limit 500 operacji na batch, zapas na bezpieczeństwo).
    for (let i = 0; i < wpisy.length; i += 400) {
      const batch = db().batch();
      for (const [klucz, stat] of wpisy.slice(i, i + 400)) {
        batch.set(db().collection('wyniki_stats').doc(statDocId(klucz)),
          { ...stat, klucz, updated_at: nowIso() });
      }
      await batch.commit();
    }
    return wpisy.length;
  },

  /** Statystyka dla klucza `dział|rodzaj|województwo` albo null. */
  async pobierz(klucz) {
    const doc = await db().collection('wyniki_stats').doc(statDocId(klucz)).get();
    return doc.exists ? doc.data() : null;
  },
};

// ============================ feedback ============================

export const feedback = {
  async upsert({ userId, matchId, helpful }) {
    await db().collection('users').doc(userId).collection('feedback').doc(matchId).set({
      helpful: helpful ? 1 : 0,
      created_at: nowIso(),
    });
    return { id: matchId, helpful: helpful ? 1 : 0 };
  },
};

// ============================ audit ============================

/**
 * Ile trzymamy dziennik audytu.
 *
 * Zawiera adresy IP i identyfikatory użytkowników, więc rośnie bez końca i przeżywa
 * usunięcie konta (audyt 2026-07-10). Podstawa przetwarzania to prawnie uzasadniony
 * interes — bezpieczeństwo — a ten nie usprawiedliwia trzymania danych wiecznie.
 * 90 dni wystarcza na wyjaśnienie incydentu; Firestore kasuje resztę sam.
 */
const AUDYT_DNI = 90;

export const auditLogs = {
  async record({ userId = null, action, detail = null, ip = null }) {
    await db().collection('audit_logs').add({
      user_id: userId,
      action,
      detail,
      ip_address: ip,
      created_at: nowIso(),
      // Pole typu Timestamp — TYLKO takie honoruje polityka TTL Firestore.
      ttl: new Date(Date.now() + AUDYT_DNI * 86_400_000),
    });
  },
};

// ============================ ai_usage ============================

export const aiUsage = {
  /**
   * Wpis + agregat miesięczny w jednym batchu — budżet czyta się 1 odczytem.
   *
   * `userId` jest kluczowy przy nadużyciu: bez niego widać tylko, że budżet się pali,
   * ale nie wiadomo, czyje konto go pali (audyt 2026-07-10). Bywa `null` dla operacji
   * bez kontekstu użytkownika.
   */
  async record({ operation, model, inputTokens = 0, outputTokens = 0, costUsd = 0, userId = null }) {
    const month = nowIso().slice(0, 7); // YYYY-MM
    const batch = db().batch();
    batch.create(db().collection('ai_usage').doc(newId()), {
      operation, model, input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: costUsd, user_id: userId, created_at: nowIso(),
    });
    batch.set(db().collection('ai_usage_monthly').doc(month), {
      cost_usd: FieldValue.increment(costUsd),
      calls: FieldValue.increment(1),
      input_tokens: FieldValue.increment(inputTokens),
      output_tokens: FieldValue.increment(outputTokens),
    }, { merge: true });
    await batch.commit();
  },

  async monthCostUsd() {
    const doc = await db().collection('ai_usage_monthly').doc(nowIso().slice(0, 7)).get();
    return doc.exists ? (doc.data().cost_usd ?? 0) : 0;
  },

  async monthCalls() {
    const doc = await db().collection('ai_usage_monthly').doc(nowIso().slice(0, 7)).get();
    return doc.exists ? (doc.data().calls ?? 0) : 0;
  },
};

// ============================ ślad dziennego cyklu ============================

/**
 * Kiedy ostatnio cykl dopasowań doszedł do końca.
 *
 * Bez tego „martwy cron" jest niewykrywalny: API odpowiada, baza żyje, a użytkownicy
 * po prostu przestają dostawać przetargi. `/health` porównuje ten znacznik z zegarem
 * i zwraca 503, gdy cykl milczy dłużej niż dobę z okładem (audyt 2026-07-10).
 */
const CYKL_REF = () => db().collection('_health').doc('daily_cycle');

/**
 * Checkpoint okna pobierania BZP (P0-2).
 *
 * Trzyma stan per doba (`kompletny`, `pobrano`, `blad`), żeby kolejny przebieg
 * wznowił pobieranie od tego, czego jeszcze nie domknął, zamiast zaczynać od
 * najstarszej doby i ginąć zawsze na tych samych dniach. Logika wyboru dób jest
 * CZYSTA i mieszka w jobs/oknoBzp.js — tutaj wyłącznie odczyt i zapis.
 */
const OKNO_BZP_REF = () => db().collection('_health').doc('bzp_okno');

export const oknoBzp = {
  async wczytaj() {
    const doc = await OKNO_BZP_REF().get();
    return doc.exists ? doc.data() : null;
  },

  /** Zapis stanu dób (bez merge) — doby poza oknem mają znikać, nie zalegać. */
  async zapisz(stan) {
    await OKNO_BZP_REF().set({ dni: stan.dni ?? {} }, { mergeFields: ['dni'] });
  },

  /**
   * Ślad ostatniego przebiegu domykania okna.
   *
   * `mergeFields` podmienia WSKAZANE pole w całości — w przeciwieństwie do
   * `set(..., { merge: true })`, które scala mapy głęboko i zostawiało błędy
   * sprzed tygodni (ta sama pułapka co w `cykl.zapiszPrzebieg`).
   */
  async zapiszPrzebieg(wynik) {
    await OKNO_BZP_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

/**
 * Checkpoint okna Bazy Konkurencyjności (etap 3).
 *
 * Trzyma ODCISK każdego widzianego ogłoszenia (`{ odcisk, publication_date,
 * pobrane_o }`), żeby kolejny przebieg pobierał SZCZEGÓŁY wyłącznie dla ogłoszeń
 * nowych i zmienionych. Bez niego każdy przebieg ciągnąłby 1 135 szczegółów —
 * ponad 1 100 zapytań po dane, które się nie ruszyły.
 *
 * Logika wyboru i przycinania jest CZYSTA i mieszka w jobs/oknoBk.js — tutaj
 * wyłącznie odczyt i zapis.
 */
const OKNO_BK_REF = () => db().collection('_health').doc('bk_okno');

export const oknoBk = {
  async wczytaj() {
    const doc = await OKNO_BK_REF().get();
    return doc.exists ? doc.data() : null;
  },

  /**
   * Zapis mapy ogłoszeń — `mergeFields` PODMIENIA wskazane pole w całości.
   *
   * 🚨 NIE WOLNO tu `{ merge: true }`: Firestore scala mapy GŁĘBOKO, więc ogłoszenia
   * usunięte z okna zostawałyby w checkpoincie na zawsze, a dokument rósłby aż do
   * limitu 1 MiB (ta sama pułapka co w `cykl.zapiszPrzebieg` i `oknoBzp.zapisz`).
   */
  async zapisz(stan) {
    await OKNO_BK_REF().set({ ogloszenia: stan.ogloszenia ?? {} }, { mergeFields: ['ogloszenia'] });
  },

  /** Ślad ostatniego przebiegu — osobne pole, nie dotyka mapy ogłoszeń. */
  async zapiszPrzebieg(wynik) {
    await OKNO_BK_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

export const cykl = {
  /**
   * Zapisuje ślad JEDNEGO przebiegu — nadpisując poprzedni wynik w całości.
   *
   * 🚨 NIE WOLNO tu wrócić do `{ merge: true }`. Firestore scala mapy GŁĘBOKO,
   * więc pole `zrodla.bzp.error` z przebiegu sprzed tygodni PRZEŻYWAŁO każdy
   * kolejny, w pełni udany przebieg: nadpisywały się tylko `fetched`
   * i `newTenders`, a błąd zostawał przyklejony na zawsze. Produkcja pokazywała
   * przez to `ok: true` RAZEM z błędem obu źródeł, a audyt 2026-09-23 uznał ten
   * kształt za dowód, że wdrożony kod nie pochodzi z tego repozytorium (P0-1).
   * Regresja: test/sladCyklu.test.js.
   *
   * Historia per źródło (kiedy ostatnio działało, kiedy ostatnio padło) jest
   * świadomie TRWAŁA i trzymana osobno, w polu `zrodla` — bieżący wynik opisuje
   * wyłącznie ostatni przebieg, historia przeżywa dzień, w którym źródło było
   * wyłączone (np. `TED_ENABLED=false`).
   */
  async zapiszPrzebieg(wynik) {
    const teraz = nowIso();
    const poprzedni = await CYKL_REF().get();
    const zrodla = poprzedni.exists ? { ...(poprzedni.data().zrodla ?? {}) } : {};

    for (const [nazwa, stat] of Object.entries(wynik?.zrodla ?? {})) {
      const bylo = zrodla[nazwa] ?? {};
      // Sukces nie kasuje historii błędu (i odwrotnie) — operator musi widzieć
      // OBA znaczniki, żeby odróżnić „padło dziś" od „padło raz w lipcu".
      zrodla[nazwa] = {
        ostatni_sukces_o: stat?.error ? (bylo.ostatni_sukces_o ?? null) : teraz,
        ostatni_blad_o: stat?.error ? teraz : (bylo.ostatni_blad_o ?? null),
        ostatni_blad: stat?.error ? String(stat.error) : (bylo.ostatni_blad ?? null),
      };
    }

    await CYKL_REF().set({ zakonczony_o: teraz, wynik, zrodla });
  },

  async ostatniPrzebieg() {
    const doc = await CYKL_REF().get();
    return doc.exists ? doc.data() : null;
  },
};

// ============================ zdarzenia Stripe (idempotencja) ============================

/**
 * Rejestr obsłużonych zdarzeń Stripe.
 *
 * Audyt 2026-07-09: `checkout.session.completed` nie miało żadnego zabezpieczenia
 * przed powtórną dostawą — Stripe ponawia webhooki, więc klient dostawał drugi
 * e-mail i DRUGĄ FAKTURĘ. docID = event.id, a `create()` na istniejącym rzuca.
 */
/**
 * Po tylu minutach porzucona rezerwacja („w trakcie obsługi") wygasa i kolejna
 * dostawa może ją przejąć. Chroni przed sytuacją, w której instancja funkcji
 * padła po zarezerwowaniu zdarzenia — bez wygaśnięcia ponowienie Stripe widziało
 * duplikat i opłacony klient NIGDY nie dostawał planu (audyt 2026-07-10).
 */
const REZERWACJA_WYGASA_PO_MS = 5 * 60_000;

export const stripeEvents = {
  /**
   * Rezerwuje zdarzenie do obsługi.
   * @returns {Promise<boolean>} true = wolno obsłużyć; false = już obsłużone
   *   albo obsługiwane właśnie przez inną instancję.
   */
  async claim(eventId, type) {
    const ref = db().collection('stripe_events').doc(eventId);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists) {
        const d = doc.data();
        if (d.status === 'done') return false;
        // Rezerwacja w toku: przejmujemy dopiero, gdy jest stara (poprzednia
        // instancja najpewniej padła w połowie obsługi).
        const wiek = Date.now() - new Date(d.claimed_at ?? 0).getTime();
        if (wiek < REZERWACJA_WYGASA_PO_MS) return false;
      }
      tx.set(ref, { type, status: 'processing', claimed_at: nowIso() });
      return true;
    });
  },

  /**
   * Oznacza zdarzenie jako trwale obsłużone — kolejne dostawy będą pomijane.
   *
   * `ttl` sprząta rejestr po 30 dniach: Stripe ponawia dostawę najwyżej przez 3 dni,
   * więc dłuższe trzymanie wpisów tylko rośnie w bazie (audyt 2026-07-10).
   */
  async markDone(eventId) {
    await db().collection('stripe_events').doc(eventId).set({
      status: 'done',
      processed_at: nowIso(),
      ttl: new Date(Date.now() + 30 * 86_400_000),
    }, { merge: true });
  },

  /** Zwalnia rezerwację, gdy obsługa się nie powiodła — Stripe ponowi dostawę. */
  async release(eventId) {
    await db().collection('stripe_events').doc(eventId).delete();
  },
};

// ============================ faktury (idempotencja) ============================

/**
 * Rejestr wystawionych faktur, kluczowany identyfikatorem sesji Stripe.
 *
 * Audyt 2026-07-10: rejestr zdarzeń nie wystarcza. Gdy `markDone` padnie już PO udanej
 * obsłudze, rezerwacja wygasa po 5 minutach, a ponowna dostawa tego samego zdarzenia
 * (Stripe dostarcza „co najmniej raz") przetwarza je od nowa — i wystawia klientowi
 * DRUGĄ FAKTURĘ VAT. Fakturownia nie ma klucza idempotencji, więc trzymamy własny.
 */
export const faktury = {
  /** @returns {Promise<boolean>} true = fakturę wolno wystawić (jeszcze jej nie było) */
  async zarezerwuj(kluczSesji) {
    if (!kluczSesji) return true; // brak klucza — nie mamy jak deduplikować
    try {
      await db().collection('invoices').doc(kluczSesji).create({
        wystawiona_o: nowIso(),
        // Rejestr chroni przed dublem, a nie jest dokumentacją księgową (tę ma
        // Fakturownia). Trzymamy rok — dużo dłużej niż Stripe ponawia dostawy.
        ttl: new Date(Date.now() + 365 * 86_400_000),
      });
      return true;
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return false;
      throw err;
    }
  },

  /** Zwalnia rezerwację, gdy wystawienie faktury się nie powiodło. */
  async zwolnij(kluczSesji) {
    if (!kluczSesji) return;
    await db().collection('invoices').doc(kluczSesji).delete();
  },
};

// ============================ magic links ============================

export const magicLinks = {
  async create({ userId, purpose, ttlMinutes }) {
    const token = (await import('../lib/ids.js')).newToken();
    const wygasa = new Date(Date.now() + ttlMinutes * 60_000);
    await db().collection('magic_links').doc(token).create({
      user_id: userId,
      purpose,
      // Porównania w kodzie robimy na tekście ISO (spójnie z resztą bazy)…
      expires_at: wygasa.toISOString(),
      // …ale automatyczne sprzątanie Firestore usuwa dokumenty WYŁĄCZNIE po polu
      // typu Timestamp. Zadeklarowany TTL na `expires_at` (tekst) nie robił NIC,
      // więc zużyte i przeterminowane linki zostawały w bazie na zawsze
      // (audyt 2026-07-10). Osobne pole `ttl` jest celem polityki TTL.
      ttl: wygasa,
      used_at: null,
      created_at: nowIso(),
    });
    return { token, expiresAt: wygasa.toISOString() };
  },

  /**
   * Sprawdza link BEZ zużywania — walidacyjny odczyt przed operacją, która może
   * się nie powieść (np. utworzenie sesji Stripe). Zwraca user_id albo null
   * (nieistniejący / zużyty / przeterminowany / niewłaściwy cel). Zużycie
   * następuje osobnym consume() dopiero PO sukcesie tej operacji — inaczej
   * przejściowy błąd Stripe bezpowrotnie paliłby jednorazowy token (audyt 2026-07-09).
   */
  async peek(token, purpose) {
    const doc = await db().collection('magic_links').doc(token).get();
    if (!doc.exists) return null;
    const link = doc.data();
    if (link.purpose !== purpose || link.used_at || link.expires_at < nowIso()) return null;
    return link.user_id;
  },

  /**
   * Zużywa link JEDNORAZOWO — transakcja: odczyt + oznaczenie used_at.
   * Gdy podano expectedUserId, niedopasowany właściciel NIE zużywa linku
   * (inaczej dałoby się spalić cudzy token, podając złe user_id).
   * Zwraca user_id albo null (nieistniejący / zużyty / przeterminowany / cudzy).
   */
  async consume(token, purpose, { expectedUserId } = {}) {
    return db().runTransaction(async (tx) => {
      const ref = db().collection('magic_links').doc(token);
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const link = doc.data();
      if (link.purpose !== purpose || link.used_at || link.expires_at < nowIso()) return null;
      if (expectedUserId !== undefined && link.user_id !== expectedUserId) return null;
      tx.update(ref, { used_at: nowIso() });
      return link.user_id;
    });
  },
};

// ============================ zapisane wyszukiwania ============================

/**
 * Zapisane wyszukiwania trybu „Wszystkie" (etap 5).
 *
 * Subkolekcja użytkownika — tak samo jak `saved` i `matches`. Powód jest ten sam:
 * cudzego wyszukiwania nie da się nawet ZAADRESOWAĆ, więc pomyłka w kontroli
 * dostępu na trasie nie może odsłonić czyichś kryteriów (a kryteria wyszukiwania
 * to informacja handlowa — mówią, o jakie kontrakty firma się stara).
 *
 * Normalizacja i limity są CZYSTE i mieszkają w lib/zapisaneWyszukiwania.js —
 * tutaj wyłącznie odczyt i zapis.
 */
const wyszukiwaniaCol = (userId) => db().collection('users').doc(userId).collection('wyszukiwania');

export const wyszukiwania = {
  async create(userId, { nazwa, filtry, alert_wlaczony = true, czestotliwosc = 'dzienna', odcisk }) {
    const id = newId();
    const rekord = {
      nazwa,
      filtry: filtry ?? {},
      alert_wlaczony,
      czestotliwosc,
      odcisk,
      /*
       * Świeże wyszukiwanie NIE było sprawdzane. `null` (a nie „teraz") jest tu
       * istotny: pierwszy przebieg ma je od razu objąć, a nie odczekać pełny odstęp.
       */
      ostatnio_sprawdzone_o: null,
      ostatnio_trafien: null,
      // Kursor z ostatniego przebiegu: od którego miejsca strumienia ruszyć dalej.
      kursor: null,
      utworzone_o: nowIso(),
      zaktualizowane_o: nowIso(),
    };
    await wyszukiwaniaCol(userId).doc(id).create(rekord);
    return { id, ...rekord };
  },

  async get(userId, id) {
    return userSnap(await wyszukiwaniaCol(userId).doc(id).get());
  },

  /** Lista właściciela, najnowsze pierwsze. Bez paginacji — limit to 20 wpisów. */
  async list(userId) {
    const snap = await wyszukiwaniaCol(userId).orderBy('utworzone_o', 'desc').get();
    return snap.docs.map(userSnap);
  },

  /** @returns {Promise<object|null>} null = nie ma takiego wpisu u TEGO użytkownika */
  async update(userId, id, zmiany) {
    const ref = wyszukiwaniaCol(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({ ...zmiany, zaktualizowane_o: nowIso() });
    return userSnap(await ref.get());
  },

  /** @returns {Promise<boolean>} false = nie było czego usuwać (powtórka nie jest błędem) */
  async remove(userId, id) {
    const ref = wyszukiwaniaCol(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  /**
   * Zamyka przebieg: czas sprawdzenia + kursor, od którego ruszy następny.
   *
   * Zapis JEST osobną operacją od wysyłki powiadomienia i następuje PO niej —
   * gdyby przebieg padł między jednym a drugim, powtórka wyśle ten sam alert,
   * a ten zostanie odsiany po kluczu idempotencji w `alerty.dodaj`. Odwrotna
   * kolejność gubiłaby trafienia bez śladu.
   */
  async oznaczSprawdzone(userId, id, { teraz, kursor = null, trafien = 0 }) {
    const ref = wyszukiwaniaCol(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    await ref.update({
      ostatnio_sprawdzone_o: teraz,
      kursor,
      ostatnio_trafien: trafien,
    });
    return true;
  },

  /**
   * Wszystkie WŁĄCZONE wyszukiwania, ze wszystkich kont — wejście harmonogramu.
   *
   * Filtr `alert_wlaczony == true` jest po stronie bazy celowo: wyłączona
   * obserwacja nie może kosztować odczytu w każdym przebiegu. Hamulec
   * częstotliwości działa DOPIERO na wyniku, bo zależy od czasu i jest czysty.
   *
   * Bez `orderBy` — collectionGroup z sortowaniem wymagałby indeksu złożonego,
   * a kolejność sprawdzania nie ma tu znaczenia.
   */
  async zAlertem() {
    const snap = await db().collectionGroup('wyszukiwania').where('alert_wlaczony', '==', true).get();
    return snap.docs.map((d) => ({ userId: d.ref.parent.parent.id, id: d.id, ...d.data() }));
  },
};

// ============================ historia zmian ogłoszeń ============================

/**
 * Historia zmian pojedynczego ogłoszenia: tenders/{tenderId}/zmiany/{kluczZmiany}.
 *
 * docId = deterministyczny klucz przejścia (lib/zmianyOgloszenia.kluczZmiany), więc
 * IDEMPOTENCJA jest własnością modelu, a nie ostrożności wołającego: ten sam przebieg
 * powtórzony po awarii nie dokłada ani jednego wpisu. To jest ważne, bo okna
 * pobierania wznawiają się po przerwaniu i rutynowo widzą te same ogłoszenia
 * drugi raz.
 */
const zmianyCol = (tenderId) => db().collection('tenders').doc(tenderId).collection('zmiany');

export const historiaZmian = {
  /**
   * Zapisuje partię zmian. Wpis, który już istnieje, NIE jest nadpisywany — chcemy
   * czas PIERWSZEGO wykrycia, bo to on mówi, ile czasu wykonawca realnie miał.
   * @returns {Promise<{zapisane: number, pominiete: number}>}
   */
  async zapisz(tenderId, zmiany, { wykryto_o = nowIso() } = {}) {
    let zapisane = 0;
    let pominiete = 0;

    for (const zmiana of zmiany ?? []) {
      const id = kluczZmiany(tenderId, zmiana);
      try {
        await zmianyCol(tenderId).doc(id).create({ ...zmiana, tender_id: tenderId, wykryto_o });
        zapisane += 1;
      } catch (err) {
        if (err.code === 6 /* ALREADY_EXISTS */) { pominiete += 1; continue; }
        throw err;
      }
    }
    return { zapisane, pominiete };
  },

  /** Historia jednego ogłoszenia, od najnowszej zmiany. */
  async lista(tenderId, limit = 50) {
    const snap = await zmianyCol(tenderId).orderBy('wykryto_o', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, tenderId, ...d.data() }));
  },

  /**
   * Zmiany wykryte OD podanej chwili, ze wszystkich ogłoszeń — wejście harmonogramu
   * alertów. Nierówność i `orderBy` są na TYM SAMYM polu, więc zapytanie mieści się
   * w indeksie grupy zadeklarowanym w firestore.indexes.json.
   */
  async odCzasu(od, limit = 500) {
    const snap = await db().collectionGroup('zmiany')
      .where('wykryto_o', '>=', od)
      .orderBy('wykryto_o', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, tenderId: d.ref.parent.parent.id, ...d.data() }));
  },
};

// ============================ centrum alertów ============================

/** Ile dni trzymamy alert w centrum — potem kasuje go polityka TTL Firestore. */
const ALERTY_DNI = 90;

const alertyCol = (userId) => db().collection('users').doc(userId).collection('alerty');

export const alerty = {
  /**
   * Dokłada alert. docId = `klucz` wyliczony przez wołającego, więc ten sam alert
   * wysłany dwa razy zostaje JEDNYM wpisem — to jest cała idempotencja powiadomień.
   * @returns {Promise<{id: string, nowy: boolean}>}
   */
  async dodaj(userId, alert, teraz = nowIso()) {
    const id = String(alert.klucz);
    const rekord = {
      typ: alert.typ,
      wyszukiwanie_id: alert.wyszukiwanie_id ?? null,
      tender_id: alert.tender_id ?? null,
      tytul: alert.tytul ?? null,
      tresc: alert.tresc ?? null,
      pozycje: alert.pozycje ?? [],
      ton: alert.ton ?? 'neutral',
      przeczytany: false,
      utworzone_o: teraz,
      // Pole typu Timestamp — TYLKO takie honoruje polityka TTL Firestore.
      ttl: new Date(Date.parse(teraz) + ALERTY_DNI * 86_400_000),
    };
    try {
      await alertyCol(userId).doc(id).create(rekord);
      return { id, nowy: true };
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return { id, nowy: false };
      throw err;
    }
  },

  /** Centrum alertów: od najnowszego. */
  async lista(userId, limit = 100) {
    const snap = await alertyCol(userId).orderBy('utworzone_o', 'desc').limit(limit).get();
    return snap.docs.map(userSnap);
  },

  /** Licznik na plakietce. Zapytanie równościowe — mieści się w indeksie automatycznym. */
  async nieprzeczytane(userId) {
    const wynik = await alertyCol(userId).where('przeczytany', '==', false).count().get();
    return wynik.data().count;
  },

  async oznaczPrzeczytany(userId, id) {
    const ref = alertyCol(userId).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.update({ przeczytany: true, przeczytany_o: nowIso() });
    return true;
  },

  async oznaczWszystkiePrzeczytane(userId) {
    const snap = await alertyCol(userId).where('przeczytany', '==', false).get();
    if (snap.empty) return 0;
    const batch = db().batch();
    for (const d of snap.docs) batch.update(d.ref, { przeczytany: true, przeczytany_o: nowIso() });
    await batch.commit();
    return snap.size;
  },
};
