import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { newId, nowIso, startOfTodayIso } from '../lib/ids.js';
import { obliczRemindAt } from '../lib/przypomnienia.js';

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

  async updateProfile(id, { companyName, keywords, cpvCodes }) {
    await db().collection('users').doc(id).update({
      company_name: companyName ?? null,
      keywords,
      cpv_codes: cpvCodes,
      updated_at: nowIso(),
    });
    return this.findById(id);
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

    // 2. Magic linki (kolekcja główna, kluczowana tokenem — trzeba je odszukać).
    const linki = await firestore.collection('magic_links').where('user_id', '==', id).get();
    await Promise.all(linki.docs.map((d) => d.ref.delete()));

    // 3. Dokument użytkownika WRAZ z podkolekcjami.
    await firestore.recursiveDelete(firestore.collection('users').doc(id));

    // Wpisy `audit_logs` i `ai_usage` celowo zostają: to dane rozliczeniowe
    // i dowody bezpieczeństwa, przechowywane na innej podstawie prawnej
    // (art. 6 ust. 1 lit. c i f RODO). Nie zawierają treści profilu.
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

function pulaZCache(limit) {
  if (!cachePuli || cachePuli.limit !== limit || Date.now() > cachePuli.wygasa) return null;
  return cachePuli.pula;
}

function zapiszPuleWCache(limit, pula) {
  cachePuli = { limit, pula, wygasa: Date.now() + CACHE_PULI_TTL_MS };
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
      raw_data: raw,
      published_at: t.publishedAt ?? null,
      fetched_at: nowIso(),
    };
    try {
      await ref.create(record);
      return { tender: { id, ...record }, created: true };
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) {
        return { tender: userSnap(await ref.get()), created: false };
      }
      throw err;
    }
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
  async openPool(limit = 2000, { swiezaKopia = false } = {}) {
    if (!swiezaKopia) {
      const zCache = pulaZCache(limit);
      if (zCache) return zCache;
    }

    const col = db().collection('tenders');
    const [zTerminem, bezTerminu] = await Promise.all([
      col.where('deadline', '>', nowIso()).orderBy('deadline').limit(limit).get(),
      col.where('deadline', '==', null).limit(limit).get(),
    ]);
    const pula = [...zTerminem.docs, ...bezTerminu.docs].map(userSnap);
    zapiszPuleWCache(limit, pula);
    return pula;
  },

  /** Unieważnia cache — woła cron po pobraniu nowych ogłoszeń z BZP. */
  odswiezPule() {
    cachePuli = null;
  },

  async count() {
    const agg = await db().collection('tenders').count().get();
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
    const match = { id: doc.id, ...doc.data() };
    const tender = await tenders.findById(match.tender_id);
    return { ...match, tender_raw: tender?.raw_data ?? '{}' };
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

  async markNotified(userId, matchId) {
    await matchCol(userId).doc(matchId).update({ notified: 1 });
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

    const remindAt = obliczRemindAt(doc.data().tender_deadline, nowIso());
    if (!remindAt) return { reminder_enabled: false, powod: 'brak_terminu' };

    await ref.update({ reminder_enabled: true, remind_at: remindAt, reminder_notified: false });
    return { reminder_enabled: true, remind_at: remindAt };
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

  /** Oznacza przypomnienie jako wysłane — nie powtórzymy go. */
  async markReminded(userId, tenderId) {
    await savedCol(userId).doc(tenderId).update({ reminder_notified: true });
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

export const cykl = {
  async zapiszPrzebieg(wynik) {
    await CYKL_REF().set({ zakonczony_o: nowIso(), wynik }, { merge: true });
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
