import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { env } from '../config.js';
import { newId, nowIso, startOfTodayIso } from '../lib/ids.js';
import { ocenaAktualna } from '../lib/swiezoscOceny.js';
import { probaDo } from '../lib/plan.js';
import { dodajSygnal as dolozSygnal } from '../lib/sygnaly.js';
import { obliczRemindAt, nastepneRemind } from '../lib/przypomnienia.js';
import {
  planZapytania, pasujeDoFiltrow, rozmiarPobrania, SKAN_STRONA, SKAN_MAKS,
} from '../lib/katalogPrzetargow.js';
import { kluczZmiany, wykryjZmiany } from '../lib/zmianyOgloszenia.js';
import { kluczOgloszenia } from '../lib/dedupZrodel.js';
import { kluczeZwyciezcow, normNip } from '../lib/profilKonkurenta.js';
import { koniecUmowyWyniku } from '../lib/umowyWygasajace.js';
import { skrotKryteriow, polaKryteriow } from '../lib/ogloszenieMeta.js';
import { kryteriaBlizniaka } from '../lib/blizniakKryteriow.js';
import { doUtcIso } from '../lib/daty.js';
import { normNazwa } from '../lib/ktoWygrywa.js';
import { wygasaO, wpisIndeksu, podzielNaCzesci } from '../lib/indeksPlanow.js';

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
  async create({ companyNip = null, companyName = null, email, passwordHash, keywords = [], cpvCodes = [], probaDni = 0 }) {
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
      // Próba Standard (spec §15): tylko rejestracja ją przyznaje; konta testowe i skrypty — nie.
      proba_do: probaDni > 0 ? probaDo(ts, probaDni) : null,
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

  /**
   * NIP firmy po rejestracji (2026-11-01) — Karta firmy wypełnia się z Białej listy VAT, ale NIP
   * zostawał tylko w telefonie, więc żadne konto na produkcji go nie miało, a funkcje serwera
   * oparte na NIP-ie (własne umowy w radarze, „Twoi konkurenci” bez siebie) nie działały.
   * Ta sama rezerwacja unikalności co przy rejestracji: zajęcie nowego i zwolnienie starego
   * w JEDNEJ transakcji. `null` = usuń NIP z konta.
   * @throws {Error} err.code === 'DUPLICATE_NIP', gdy NIP ma inne konto
   */
  async ustawNip(id, nip) {
    const ts = nowIso();
    await db().runTransaction(async (tx) => {
      const ref = db().collection('users').doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('Nie ma takiego konta'), { code: 'NOT_FOUND' });
      const stary = snap.data().company_nip ?? null;
      if (stary === nip) return;
      if (nip) {
        const rezerwacja = await tx.get(UNIQUE(`nip:${nip}`));
        if (rezerwacja.exists && rezerwacja.data()?.uid !== id) {
          throw Object.assign(new Error('NIP przypisany do innego konta'), { code: 'DUPLICATE_NIP' });
        }
        if (!rezerwacja.exists) tx.create(UNIQUE(`nip:${nip}`), { uid: id, created_at: ts });
      }
      if (stary) tx.delete(UNIQUE(`nip:${stary}`));
      tx.update(ref, { company_nip: nip ?? null, updated_at: ts });
    });
    return this.findById(id);
  },

  /** Konta z NIP-em firmy (alert o własnych kończących się umowach). Nierówność — indeks automatyczny. */
  async zNipem() {
    const snap = await db().collection('users').where('company_nip', '!=', null)
      .select('company_nip', 'company_name', 'email', 'push_token').get();
    return snap.docs.map(userSnap);
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

  /** Zapis karty firmy (spec §3) — profil + mapa `karta` jednym zapisem. */
  async zapiszKarte(id, { companyName, keywords, cpvCodes, regiony, wartoscMax, karta }) {
    await db().collection('users').doc(id).update({
      company_name: companyName ?? null,
      keywords: keywords ?? [],
      cpv_codes: cpvCodes ?? [],
      regiony: regiony ?? [],
      wartosc_max: wartoscMax ?? null,
      karta: {
        opis: karta.opis ?? null,
        wykluczenia: karta.wykluczenia ?? [],
        wartosc_min: karta.wartosc_min ?? null,
        min_dni_oferta: karta.min_dni_oferta,
        formalne: karta.formalne,
        zaktualizowano: nowIso(),
      },
      updated_at: nowIso(),
    });
    return this.findById(id);
  },

  /** Sygnał klienta (zapis / odrzucenie / przywrócenie) — transakcja, bo tablica jest współdzielona. */
  async dodajSygnal(id, sygnal) {
    const ref = db().collection('users').doc(id);
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      tx.update(ref, { pracownik_sygnaly: dolozSygnal(doc.data().pracownik_sygnaly, sygnal) });
    });
  },

  /** „Nie teraz” dla propozycji zmiany karty; przy okazji sprząta wygasłe odłożenia. */
  async odlozPropozycje(id, klucz, doIso, teraz = nowIso()) {
    const ref = db().collection('users').doc(id);
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const lista = (doc.data().pracownik_odlozone ?? []).filter((o) => o.do > teraz && o.klucz !== klucz);
      tx.update(ref, { pracownik_odlozone: [...lista, { klucz, do: doIso }] });
    });
  },

  async ustawPowiadomieniaEmail(id, wlaczone) {
    await db().collection('users').doc(id).update({ powiadomienia_pracownik_email: Boolean(wlaczone), updated_at: nowIso() });
  },

  /** Znacznik przebiegu selekcji: od kiedy liczyć „nowe” i przy jakiej wersji karty. */
  async oznaczPrzebiegSelekcji(id, { o, wersja }) {
    await db().collection('users').doc(id).update({ pracownik_ostatni_przebieg: o, pracownik_wersja: wersja });
  },

  /** Maile próby (spec §15): rezerwacja PRZED wysyłką — każdy rodzaj najwyżej raz. */
  async zarezerwujMailProby(id, rodzaj, teraz = nowIso()) {
    const ref = db().collection('users').doc(id);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.data().proba_maile?.[rodzaj]) return false;
      tx.update(ref, { [`proba_maile.${rodzaj}`]: { stan: 'wysylanie', o: teraz } });
      return true;
    });
  },

  async potwierdzMailProby(id, rodzaj, teraz = nowIso()) {
    await db().collection('users').doc(id).update({ [`proba_maile.${rodzaj}`]: { stan: 'wyslany', o: teraz } });
  },

  async zwolnijMailProby(id, rodzaj) {
    await db().collection('users').doc(id).update({ [`proba_maile.${rodzaj}`]: FieldValue.delete() });
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

  /**
   * Przypisuje token push do konta — i ZDEJMUJE go z każdego innego konta.
   *
   * Token Expo należy do TELEFONU, nie do konta (P0, 2026-09-25). Gdy na tym samym
   * telefonie loguje się konto B, rejestruje ono ten sam token; bez zdjęcia go
   * z konta A właściciel A dostawałby alerty (tytuły przetargów, terminy) na
   * telefon B. Transakcja, żeby dwie równoległe rejestracje nie zostawiły tokenu
   * na dwóch kontach naraz. Zapytanie po jednym polu obsługuje indeks automatyczny.
   */
  async setPushToken(id, token, platform = null) {
    const firestore = db();
    const ts = nowIso();
    await firestore.runTransaction(async (tx) => {
      const zTymTokenem = await tx.get(
        firestore.collection('users').where('push_token', '==', token),
      );
      for (const d of zTymTokenem.docs) {
        if (d.id !== id) tx.update(d.ref, { push_token: null, push_platform: null, updated_at: ts });
      }
      // Platforma tylko gdy apka ją podała — starsza wersja bez pola nie kasuje znanej wartości.
      tx.update(firestore.collection('users').doc(id), { push_token: token, ...(platform ? { push_platform: platform } : {}), updated_at: ts });
    });
  },

  /** Urządzenia z tokenem push według platformy (2026-10-29, `/health.push.urzadzenia`). */
  async urzadzeniaPush() {
    const col = db().collection('users');
    const ile = async (q) => (await q.count().get()).data().count;
    const [wszystkie, ios, android, web] = await Promise.all([
      ile(col.where('push_token', '>', '')),
      ile(col.where('push_platform', '==', 'ios')),
      ile(col.where('push_platform', '==', 'android')),
      ile(col.where('push_platform', '==', 'web')),
    ]);
    return { wszystkie, ios, android, web, nieznana: Math.max(0, wszystkie - ios - android - web) };
  },

  /**
   * Zeruje token push konta (wylogowanie z telefonu). Idempotentne — konto bez
   * tokenu to nie błąd, bo mobile woła to przy KAŻDYM wylogowaniu.
   */
  async usunPushToken(id) {
    await db().collection('users').doc(id).update({ push_token: null, push_platform: null, updated_at: nowIso() });
  },

  /**
   * Zdejmuje MARTWE tokeny push (Expo: DeviceNotRegistered) z każdego konta, które
   * je ma (2026-09-25). Bez tego odinstalowana aplikacja zostawiała token na zawsze:
   * każdy cykl wysyłał w próżnię. Operator `in` przyjmuje najwyżej 30 wartości.
   * @param {string[]} tokeny
   * @returns {Promise<number>} ile kont wyczyszczono
   */
  async zdejmijPushTokeny(tokeny) {
    const unikalne = [...new Set((tokeny ?? []).filter((t) => typeof t === 'string' && t))];
    let wyczyszczone = 0;
    for (let i = 0; i < unikalne.length; i += 30) {
      const snap = await db().collection('users')
        .where('push_token', 'in', unikalne.slice(i, i + 30)).get();
      if (snap.empty) continue;
      const batch = db().batch();
      const ts = nowIso();
      for (const d of snap.docs) batch.update(d.ref, { push_token: null, push_platform: null, updated_at: ts });
      await batch.commit();
      wyczyszczone += snap.size;
    }
    return wyczyszczone;
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
   * Zapisuje klienta Stripe TYLKO, gdy konto jeszcze go nie ma (2026-09-25, P2
   * „osierocona druga subskrypcja"). Transakcja: dwa równoległe checkouty nie mogą
   * nadpisać sobie nawzajem klienta — przegrany dostaje identyfikator zwycięzcy,
   * więc obie sesje trafiają do jednego klienta, a sprawdzenie „czy już płaci"
   * widzi wszystkie jego subskrypcje.
   *
   * @returns {Promise<string>} identyfikator klienta, który OBOWIĄZUJE dla konta
   */
  async ustawStripeCustomerJesliBrak(id, customerId) {
    const ref = db().collection('users').doc(id);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error(`Użytkownik ${id} nie istnieje`);
      const zapisany = doc.data().stripe_customer_id;
      if (zapisany) return zapisany;
      tx.update(ref, { stripe_customer_id: customerId, updated_at: nowIso() });
      return customerId;
    });
  },

  /**
   * Odnotowuje przy koncie DRUGĄ żywą subskrypcję, która przestała być bieżącą
   * (2026-09-25). Wcześniej jej identyfikator był po prostu nadpisywany — subskrypcja
   * obciążała kartę co miesiąc, a konto nie zostawiało po niej żadnego śladu.
   * O zwrocie/anulowaniu decyduje właściciel; lista mówi mu, czego szukać.
   */
  async dopiszDuplikatSubskrypcji(id, subscriptionId) {
    await db().collection('users').doc(id).update({
      stripe_subscription_duplikaty: FieldValue.arrayUnion(subscriptionId),
      updated_at: nowIso(),
    });
  },

  /** Zdejmuje subskrypcję z listy duplikatów (została zamknięta albo stała się bieżącą). */
  async usunDuplikatSubskrypcji(id, subscriptionId) {
    await db().collection('users').doc(id).update({
      stripe_subscription_duplikaty: FieldValue.arrayRemove(subscriptionId),
      updated_at: nowIso(),
    });
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
    // (art. 6 ust. 1 lit. c i f RODO). Nie zawierają treści profilu i obie
    // kolekcje mają TTL 90 dni — nie żyją dłużej, niż wymaga ich cel.
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
  'kryterium_oceny', 'liczba_czesci', 'pz_szczegol', 'bzp_external_id', 'zastapiony_przez',
  // e-Zamówienia (2026-10-27): bez `postepowanie_id` w puli selekcja NIGDY nie dociągała dokumentów po wyborze
  // (warunek cicho fałszywy — bug znaleziony na produkcji 27.10). `ez_dokumenty` chroni przed powtórnym żądaniem.
  'postepowanie_id', 'ez_dokumenty',
  /*
   * Znacznik anulowania (etap 3, Baza Konkurencyjności). Odsiew robimy W PAMIĘCI,
   * a nie zapytaniem `where('anulowany','!=',true)`: nierówność na innym polu niż
   * `deadline` wymagałaby indeksu ZŁOŻONEGO, a jego brak wywrócił kiedyś całą pulę
   * i razem z nią codzienny cron (patrz komentarz przy `openPool`). Anulowanych są
   * jednostki, więc filtr po odczycie nic nie kosztuje.
   */
  'anulowany',
  // Lejek selekcji: „nowe od ostatniego przebiegu” i rodzaj zamówienia dla AI (spec §4.2).
  'fetched_at', 'rodzaj',
  // Skrót kryteriów na karcie feedu (2026-10-31) — lista ma najwyżej 12 krótkich pozycji.
  'kryteria', 'kryteria_rozne_czesci',
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

/**
 * Dopisuje wykryte zmiany do historii ogłoszenia — NAJWYŻEJ best-effort.
 *
 * Nieudany zapis historii NIE MOŻE wywrócić aktualizacji ogłoszenia: świeży termin
 * w bazie jest ważniejszy od wpisu w dzienniku zmian, a okno pobierania i tak
 * zobaczy to ogłoszenie ponownie. Zapis jest idempotentny (docId = klucz przejścia),
 * więc powtórka niczego nie zdubluje.
 */
/**
 * Uzgadnia ZDENORMALIZOWANE kopie przetargu (users/{uid}/saved i users/{uid}/matches)
 * ze zmianą w źródle (naprawa 2026-09-25).
 *
 * `saved.add` i `matches.create` kopiują `tender_deadline`, bo lista renderuje się
 * bez JOIN-a, a przypomnienia liczą `remind_at` z tej kopii. Dopóki ogłoszenie było
 * niemutowalne, kopia nie mogła się zestarzeć; Baza Konkurencyjności wydaje jednak
 * kolejne wersje (najczęściej z NOWYM terminem) i anuluje postępowania. Bez tego
 * zamawiający skracał termin z +20 do +4 dni, a Zapisane dalej pokazywały +20,
 * przypomnienie „7 dni przed" wypadało PO nowym terminie.
 *
 *  • nowy termin: nadpisujemy kopię; włączone, jeszcze niedokończone przypomnienie
 *    przeliczamy tą samą regułą etapów co przy włączeniu (`nastepneRemind`),
 *    z pominięciem etapów już wysłanych,
 *  • anulowanie: znacznik na kopiach i WYŁĄCZENIE przypomnienia.
 *
 * Aktualizujemy tylko kopie, które się różnią — powtórka nic nie zapisuje.
 * Zapytania `collectionGroup` po `tender_id` mają indeksy w firestore.indexes.json
 * (fieldOverrides, COLLECTION_GROUP).
 *
 * @returns {Promise<number>} ile kopii zaktualizowano
 */
async function uzgodnijKopiePrzetargu(tenderId, { deadline = null, anulowany = false }, teraz = nowIso()) {
  const [zapisane, dopasowania] = await Promise.all([
    db().collectionGroup('saved').where('tender_id', '==', tenderId).get(),
    db().collectionGroup('matches').where('tender_id', '==', tenderId).get(),
  ]);

  const zmiany = [];
  for (const d of zapisane.docs) {
    const s = d.data();
    const pola = {};
    if (deadline && s.tender_deadline !== deadline) {
      pola.tender_deadline = deadline;
      if (s.reminder_enabled === true && s.reminder_notified !== true) {
        // Wysłane = etapy już doręczone; bieżący `remind_etap` dopiero czekał.
        const nast = nastepneRemind(deadline, teraz, s.reminded_stages ?? []);
        if (nast) Object.assign(pola, { remind_at: nast.at, remind_etap: nast.etap });
        else pola.reminder_notified = true; // nowy termin już minął — nie ma o czym przypominać
      }
    }
    if (anulowany) {
      if (s.tender_anulowany !== true) pola.tender_anulowany = true;
      if (s.reminder_enabled === true) pola.reminder_enabled = false;
    }
    if (Object.keys(pola).length) zmiany.push([d.ref, pola]);
  }
  for (const d of dopasowania.docs) {
    const m = d.data();
    const pola = {};
    if (deadline && m.tender_deadline !== deadline) pola.tender_deadline = deadline;
    if (anulowany && m.tender_anulowany !== true) pola.tender_anulowany = true;
    if (Object.keys(pola).length) zmiany.push([d.ref, pola]);
  }

  // Batch Firestore mieści 500 operacji — popularny przetarg bywa zapisany u wielu kont.
  for (let i = 0; i < zmiany.length; i += 400) {
    const batch = db().batch();
    for (const [ref, pola] of zmiany.slice(i, i + 400)) batch.update(ref, pola);
    await batch.commit();
  }
  return zmiany.length;
}

async function zapiszHistorieBezpiecznie(tenderId, zmiany) {
  if (!zmiany?.length) return;
  try {
    await historiaZmian.zapisz(tenderId, zmiany);
  } catch (err) {
    console.error(JSON.stringify({
      severity: 'ERROR', message: 'Nie udało się zapisać historii zmian ogłoszenia', tenderId, err: err.message,
    }));
  }
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
      // Klucz tożsamości postępowania między rejestrami (lib/dedupZrodel) — do łączenia ogłoszeń
      // zapisywanych przez RÓŻNE joby (platformazakupowa co godzinę vs cykl dobowy BZP/TED/BK).
      klucz_dedup: kluczOgloszenia(t),
      // Meta z htmlBody (rundy 5-6).
      kryterium_oceny: t.kryterium_oceny ?? null,
      liczba_czesci: t.liczba_czesci ?? null,
      // Za co są punkty (2026-10-31): lista kryteriów z wagami z BZP (lib/ogloszenieMeta.js).
      kryteria: t.kryteria ?? null,
      kryteria_sposob: t.kryteria_sposob ?? null,
      kryteria_rozne_czesci: t.kryteria_rozne_czesci ?? false,
      // Wymiary do statystyk wyników (R17).
      rodzaj: t.rodzaj ?? null,
      wojewodztwo: t.wojewodztwo ?? null,
      // Warunki udziału (spec §6.1) — wycinek ≤3000 znaków albo {tekst:null, zrodlo:'swz'}.
      warunki_udzialu: t.warunki_udzialu ?? null,
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
      /*
       * Identyfikator POSTĘPOWANIA — klucz złączenia z ogłoszeniem o WYNIKU (etap 6).
       * BZP: `tenderId` (ocds-…). TED: `procedure-identifier` (BT-04).
       * Ogłoszenie o wyniku ma INNY numer publikacji niż ogłoszenie o zamówieniu,
       * więc bez tego pola rozstrzygnięcie nie ma po czym trafić do przetargu.
       */
      postepowanie_id: t.postepowanie_id ?? null,
      // NIP zamawiającego — klucz benchmarku per zamawiający (etap 6).
      zamawiajacy_nip: t.zamawiajacy_nip ? String(t.zamawiajacy_nip) : null,
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
         * Selekcja pod klienta (spec §6.1): warunki udziału i województwo TED pojawiły się
         * po wdrożeniu — dopisujemy je raz, gdy dokument ich nie ma. Dalsze uzupełnienia
         * poniżej działają jak dotąd (każde zwraca dokument już z tymi polami).
         */
        const doUzupelnienia = {};
        if (t.warunki_udzialu && dane.warunki_udzialu == null) doUzupelnienia.warunki_udzialu = t.warunki_udzialu;
        if (t.wojewodztwo && !dane.wojewodztwo) doUzupelnienia.wojewodztwo = t.wojewodztwo;
        /*
         * Lista kryteriów (2026-10-31) — raz, gdy dokument jej nie ma. Razem z nią poprawiamy
         * `kryterium_oceny`: z listy wynika pewniej niż ze starego okna tekstu (48 pomyłek na 1258).
         */
        if (Array.isArray(t.kryteria) && dane.kryteria == null) {
          doUzupelnienia.kryteria = t.kryteria;
          doUzupelnienia.kryteria_sposob = t.kryteria_sposob ?? null;
          doUzupelnienia.kryteria_rozne_czesci = t.kryteria_rozne_czesci ?? false;
          if (t.kryterium_oceny) doUzupelnienia.kryterium_oceny = t.kryterium_oceny;
        }
        if (Object.keys(doUzupelnienia).length) {
          await ref.update(doUzupelnienia);
          Object.assign(dane, doUzupelnienia);
        }
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
        /*
         * Przetargi zapisane PRZED etapem 6 nie mają identyfikatora postępowania,
         * a dzienne pobieranie re-ściąga ostatnie dni — dopisujemy go raz, gdy
         * dokument jeszcze go nie ma. Bez tego rozstrzygnięcia tych postępowań
         * nigdy by się z nimi nie spięły.
         */
        if ((t.postepowanie_id && !dane.postepowanie_id)
            || (t.zamawiajacy_nip && !dane.zamawiajacy_nip)) {
          const klucze = {};
          if (t.postepowanie_id && !dane.postepowanie_id) klucze.postepowanie_id = t.postepowanie_id;
          if (t.zamawiajacy_nip && !dane.zamawiajacy_nip) klucze.zamawiajacy_nip = String(t.zamawiajacy_nip);
          await ref.update(klucze);
          return { tender: { id, ...dane, ...klucze }, created: false };
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
        return { tender: { id, ...dane }, created: false };
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
    const id = tenderDocId(t.externalId);
    const ref = db().collection('tenders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { zmienione: false, zmiany: [] };

    const przed = snap.data();

    const pola = { zaktualizowany_o: nowIso() };
    const ustaw = (pole, wartosc) => {
      if (wartosc !== undefined && wartosc !== null && wartosc !== '') pola[pole] = wartosc;
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
    /*
     * Sygnały ZMIANY, nie dane ogłoszenia (etap 5):
     *  • `zrodlo_odcisk` — odcisk pozycji z listy rejestru (termin + tytuł + treść).
     *    Jego zmiana znaczy „zamawiający ruszył treść", co w Bazie Konkurencyjności
     *    najczęściej oznacza doklejone odpowiedzi na pytania albo nowy załącznik.
     *  • `status_zrodla` — etykieta statusu w rejestrze źródłowym.
     *  • `umowa_zmieniona_o` — odnotowana przez rejestr zmiana umowy (o ile ją podaje).
     */
    ustaw('zrodlo_odcisk', t.zrodlo_odcisk);
    ustaw('status_zrodla', t.status_zrodla);
    ustaw('umowa_zmieniona_o', t.umowa_zmieniona_o);
    ustaw('umowa_zmiana_opis', t.umowa_zmiana_opis);

    /*
     * Porównujemy stan PRZED z tym, co realnie zapiszemy — nie z surowym wejściem.
     * Różnica jest istotna: `ustaw` pomija pola puste (cisza rejestru nie kasuje
     * danych), więc porównanie z wejściem widziałoby „budżet zniknął" przy każdej
     * oszczędniejszej wersji ogłoszenia i zalewało historię fałszywymi zmianami.
     */
    const zmiany = wykryjZmiany(przed, { ...przed, ...pola });

    await ref.update(pola);
    await zapiszHistorieBezpiecznie(id, zmiany);
    /*
     * Termin z tej wersji ogłoszenia musi dotrzeć też do KOPII w „Zapisanych"
     * i dopasowaniach (2026-09-25) — patrz `uzgodnijKopiePrzetargu`. Uzgadniamy przy
     * KAŻDEJ wersji niosącej termin, nie tylko przy wykrytej zmianie: gdy uzgodnienie
     * padnie, okno BK ponowi aktualizację, a wtedy dokument ma już nowy termin i sama
     * „wykryta zmiana" nie powtórzyłaby się. Błąd leci do wołającego właśnie po to.
     */
    if (pola.deadline) await uzgodnijKopiePrzetargu(id, { deadline: pola.deadline });

    return { zmienione: true, zmiany };
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
    const id = tenderDocId(externalId);
    const ref = db().collection('tenders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;

    const przed = snap.data();
    const pola = { anulowany: true, anulowany_o: nowIso(), anulowany_powod: powod };

    /*
     * Anulowanie bywa potwierdzane w kolejnych przebiegach (ogłoszenie znika z listy,
     * weryfikacja szczegółem powtarza się). Porównanie stanów daje pustą listę przy
     * powtórce, więc historia dostaje JEDEN wpis — ten z chwili pierwszego wykrycia.
     */
    const zmiany = wykryjZmiany(przed, { ...przed, ...pola });

    await ref.update(pola);
    await zapiszHistorieBezpiecznie(id, zmiany);
    // Przypomnienie o terminie postępowania, którego już nie ma, to fałszywy alarm
    // z kalendarza — wyłączamy je na kopiach (2026-09-25).
    await uzgodnijKopiePrzetargu(id, { anulowany: true });
    return true;
  },

  /**
   * Lista kryteriów oceny dla JUŻ zapisanych przetargów BZP (uzupełnienie wstecz, 2026-10-31):
   * tylko tam, gdzie jej jeszcze nie ma, razem z poprawionym `kryterium_oceny`. Nie tworzy
   * dokumentów — ogłoszenie, którego nie mamy (albo scalone pod innym rejestrem), pomija.
   * @param {object[]} ogloszenia znormalizowane ogłoszenia BZP (`services/bzp.js`)
   */
  async uzupelnijKryteria(ogloszenia) {
    const zLista = (ogloszenia ?? []).filter((o) => Array.isArray(o?.kryteria) && o.kryteria.length);
    let istniejace = 0;
    let uzupelnione = 0;
    for (let i = 0; i < zLista.length; i += 300) {
      const czesc = zLista.slice(i, i + 300);
      const snapy = await db().getAll(
        ...czesc.map((o) => db().collection('tenders').doc(tenderDocId(o.externalId))),
        { fieldMask: ['kryteria'] },
      );
      const batch = db().batch();
      let wPartii = 0;
      snapy.forEach((snap, j) => {
        if (!snap.exists) return;
        istniejace += 1;
        if (snap.get('kryteria') != null) return;
        const o = czesc[j];
        batch.update(snap.ref, {
          kryteria: o.kryteria,
          kryteria_sposob: o.kryteria_sposob ?? null,
          kryteria_rozne_czesci: o.kryteria_rozne_czesci ?? false,
          ...(o.kryterium_oceny ? { kryterium_oceny: o.kryterium_oceny } : {}),
        });
        wPartii += 1;
      });
      if (wPartii) await batch.commit();
      uzupelnione += wPartii;
    }
    return { z_kryteriami: zLista.length, istniejace, uzupelnione };
  },

  async findById(id) {
    return userSnap(await db().collection('tenders').doc(id).get());
  },

  /**
   * Ogłoszenia o podanych kluczach tożsamości (`klucz_dedup`), w porcjach po 30 (limit `in`).
   * @returns {Promise<Map<string, {id: string, source: string, url: string|null, bzp_external_id: string|null, zrodla_alternatywne: object[]|null}[]>>}
   */
  async poKluczuDedup(klucze) {
    const unikalne = [...new Set((klucze ?? []).filter((k) => typeof k === 'string' && k))];
    const wynik = new Map();
    for (let i = 0; i < unikalne.length; i += 30) {
      const porcja = unikalne.slice(i, i + 30);
      const snap = await db().collection('tenders').where('klucz_dedup', 'in', porcja)
        .select('source', 'url', 'bzp_external_id', 'zrodla_alternatywne', 'klucz_dedup', 'zastapiony_przez').get();
      for (const d of snap.docs) {
        const dane = d.data();
        const lista = wynik.get(dane.klucz_dedup) ?? [];
        lista.push({ id: d.id, source: dane.source ?? 'bzp', url: dane.url ?? null, bzp_external_id: dane.bzp_external_id ?? null, zrodla_alternatywne: dane.zrodla_alternatywne ?? null, zastapiony_przez: dane.zastapiony_przez ?? null });
        wynik.set(dane.klucz_dedup, lista);
      }
    }
    return wynik;
  },

  /** Kopia z rejestru pobocznego ustępuje wpisowi wiodącemu — znika z puli dopasowań, dokument zostaje. */
  async oznaczZastapiony(id, przezId, teraz = nowIso()) {
    await db().collection('tenders').doc(id).update({ zastapiony_przez: przezId, zastapiony_o: teraz });
  },

  /** Dopisuje link do rejestru pobocznego, jeśli jeszcze go nie ma (po źródle + externalId). */
  async dodajZrodloAlternatywne(id, wpis) {
    const ref = db().collection('tenders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return false;
    const lista = Array.isArray(snap.data().zrodla_alternatywne) ? snap.data().zrodla_alternatywne : [];
    if (lista.some((z) => z?.source === wpis.source && (z?.externalId ?? null) === (wpis.externalId ?? null))) return false;
    await ref.update({ zrodla_alternatywne: [...lista, { source: wpis.source, externalId: wpis.externalId ?? null, url: wpis.url ?? null }] });
    return true;
  },

  /** Pola ze strony szczegółu rejestru (e-ProPublico): tylko to, co podano; puste nie kasują. */
  async uzupelnijZeSzczegolu(id, { rodzaj, publishedAt, tryb_postepowania, deadline } = {}) {
    const pola = {};
    if (rodzaj) pola.rodzaj = rodzaj;
    if (publishedAt) pola.published_at = publishedAt;
    if (tryb_postepowania) pola.tryb_postepowania = tryb_postepowania;
    if (deadline) pola.deadline = deadline;
    if (!Object.keys(pola).length) return false;
    await db().collection('tenders').doc(id).update(pola);
    return true;
  },

  /**
   * Dzień terminu z listy Logintrade (lista nie podaje godziny, 2026-10-31). Okno porównuje z nim dzień
   * z kolejnej listy i pobiera kartę tylko po zmianie — bez tego rozjazd dnia listy i karty kosztowałby
   * pobranie karty w każdym przebiegu.
   */
  async ustawDzienListyLt(id, dzien) {
    if (!dzien) return;
    await db().collection('tenders').doc(id).update({ lt_dzien_listy: String(dzien) });
  },

  /**
   * Szczegół z platformazakupowa.pl pobrany na żądanie (tryb, załączniki…) — cache przy ogłoszeniu.
   * Od 2026-11-01 także kryteria oceny z tabeli platformy → te same pola co z BZP; zwraca je,
   * żeby wołający (selekcja) dopisał je do przetargu w pamięci, zanim zapisze dopasowanie.
   */
  async zapiszSzczegolPz(id, szczegol, teraz = nowIso()) {
    let pola = polaKryteriow(szczegol?.kryteria);
    // Postępowanie z ustawy: w tabeli platformy same dokumenty — kryteria bierzemy od bliźniaka z BZP/TED.
    if (!pola.kryteria) pola = await this.kryteriaOdBlizniaka(id).catch(() => ({}));
    await db().collection('tenders').doc(id).update({ pz_szczegol: szczegol, pz_szczegol_o: teraz, ...pola });
    return pola;
  },

  /**
   * Kryteria od bliźniaka (2026-11-01, `lib/blizniakKryteriow.js`): ogłoszenia z TYM SAMYM terminem (BZP
   * podaje godzinę jak platforma) albo z końcem tego samego dnia w Polsce (TED podaje sam dzień — u nas
   * `doUtcIso` robi z niego 23:59:59 czasu polskiego). Dwie wartości w `in` = jedno zapytanie po jednym
   * polu (indeks automatyczny); okno ±30 h miało 2300–3600 kandydatów, a limit je ucinał (1.11).
   * Z kandydatów BZP/TED z listą i tytułem podobnym ≥ 0,6.
   */
  async kryteriaOdBlizniaka(id) {
    const snap = await db().collection('tenders').doc(id).get();
    const t = snap.exists ? snap.data() : null;
    const termin = Date.parse(t?.deadline ?? '');
    if (!Number.isFinite(termin) || !t.title) return {};
    const dzienPL = new Date(termin).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
    const terminy = [...new Set([t.deadline, doUtcIso(dzienPL)].filter(Boolean))];
    const kand = await db().collection('tenders').where('deadline', 'in', terminy)
      .select('title', 'source', 'kryteria', 'kryteria_sposob', 'kryteria_rozne_czesci').limit(500).get();
    return kryteriaBlizniaka(t, kand.docs.filter((d) => d.id !== id).map((d) => ({ id: d.id, ...d.data() })));
  },

  /** Stan monitoringu dokumentów e-Zamówień (2026-11-01) dla wielu przetargów — jeden `getAll` po 300. */
  async stanMonitoraDokumentow(ids) {
    const unikalne = [...new Set((ids ?? []).filter(Boolean).map(String))];
    const wynik = [];
    for (let i = 0; i < unikalne.length; i += 300) {
      const snapy = await db().getAll(...unikalne.slice(i, i + 300).map((id) => db().collection('tenders').doc(id)),
        { fieldMask: ['postepowanie_id', 'source', 'title', 'organization', 'deadline', 'ez_monitor', 'ez_zmiany', 'otwarcie_ofert'] });
      for (const snap of snapy) if (snap.exists) wynik.push({ id: snap.id, ...snap.data() });
    }
    return wynik;
  },

  /**
   * Po sprawdzeniu: znane id plików + świeża lista dokumentów jako cache ekranu (jak `zapiszDokumentyEz`).
   * `zmiany` (podsumowanie wyjaśnień/zmian/terminu, `lib/noweDokumenty.js`) — gdy inne niż było, idzie też
   * do kopii w feedach i Zapisanych (`tender_ez_zmiany`), bo lista renderuje się bez odczytu przetargu.
   */
  async zapiszMonitorDokumentow(id, dokumenty, teraz = nowIso(), { zmiany = null, poprzednie = null, otwarcie = null, poprzednieOtwarcie = null } = {}) {
    const lista = Array.isArray(dokumenty) ? dokumenty : [];
    await db().collection('tenders').doc(id).update({
      ez_monitor: { ids: lista.map((d) => d.id).slice(0, 300), sprawdzone_o: teraz },
      ez_dokumenty: lista,
      ez_dokumenty_o: teraz,
      ez_zmiany: zmiany,
      otwarcie_ofert: otwarcie,
    });
    // Informacja z otwarcia ofert (2026-11-01) — do kopii bez listy przeczytanych plików.
    // Nieczytelny PDF (skan) zostawia sam ślad przeczytania — na kartę idzie wtedy null, nie puste pola.
    const naKarte = (o) => (o && (Number.isFinite(o.kwota) || Number.isFinite(o.oferty))
      ? { kwota: o.kwota ?? null, oferty: o.oferty ?? null, cena_min: o.cena_min ?? null, cena_max: o.cena_max ?? null, czesci: o.czesci === true }
      : null);
    const zmianaZmian = JSON.stringify(zmiany) !== JSON.stringify(poprzednie ?? null);
    const zmianaOtwarcia = JSON.stringify(naKarte(otwarcie)) !== JSON.stringify(naKarte(poprzednieOtwarcie));
    if (!zmianaZmian && !zmianaOtwarcia) return 0;
    const [zapisane, dopasowania] = await Promise.all([
      db().collectionGroup('saved').where('tender_id', '==', id).get(),
      db().collectionGroup('matches').where('tender_id', '==', id).get(),
    ]);
    const refy = [...zapisane.docs, ...dopasowania.docs].map((d) => d.ref);
    for (let i = 0; i < refy.length; i += 400) {
      const batch = db().batch();
      for (const ref of refy.slice(i, i + 400)) batch.update(ref, { tender_ez_zmiany: zmiany, tender_otwarcie_ofert: naKarte(otwarcie) });
      await batch.commit();
    }
    return refy.length;
  },

  /** Dokumenty postępowania z e-Zamówień (SWZ, załączniki z linkami) — cache 24 h przy ogłoszeniu (2026-10-26). */
  async zapiszDokumentyEz(id, dokumenty, teraz = nowIso()) {
    await db().collection('tenders').doc(id).update({ ez_dokumenty: Array.isArray(dokumenty) ? dokumenty : [], ez_dokumenty_o: teraz });
  },

  /**
   * Ogłoszenia jednego zamawiającego (po NIP-ie) — Radar planów sprawdza, czy plan
   * zamienił się już w przetarg. Samo porównanie równościowe, BEZ orderBy: mieści
   * się w indeksie automatycznym (sortowanie po stronie wołającego — kandydatów
   * jednego zamawiającego jest kilkadziesiąt, nie tysiące).
   */
  async poNipieZamawiajacego(nip, { limit = 50 } = {}) {
    if (!nip) return [];
    const snap = await db().collection('tenders')
      .where('zamawiajacy_nip', '==', String(nip))
      // anulowany/zastapiony_przez/postepowanie_id: „Twoje umowy” (2026-11-01) odsiewają nimi następców.
      .select('title', 'cpv_main', 'budget', 'published_at', 'deadline', 'url', 'source', 'anulowany', 'zastapiony_przez', 'postepowanie_id')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Otwarte przetargi z NIP-em zamawiającego (2026-11-01) — radar wygasających umów szuka wśród
   * nich nowych edycji kończących się umów. Jak `openPool`: nierówność i sortowanie po tym samym
   * polu (indeks automatyczny), ale bez cache puli — potrzebne są inne pola. Bez anulowanych
   * i bez kopii z platform zastąpionych ogłoszeniem z rejestru wiodącego.
   */
  async otwarteZNipem({ sufit = 60_000, rozmiarStrony = 2000, teraz = nowIso() } = {}) {
    const zapytanie = db().collection('tenders')
      .where('deadline', '>', teraz)
      .orderBy('deadline')
      .select('title', 'organization', 'cpv_main', 'published_at', 'deadline', 'url', 'source',
        'zamawiajacy_nip', 'postepowanie_id', 'anulowany', 'zastapiony_przez');
    const { docs } = await stronicuj(zapytanie, sufit, rozmiarStrony);
    return docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.zamawiajacy_nip && t.anulowany !== true && !t.zastapiony_przez);
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
    // Zastąpione = ten sam przetarg wszedł z rejestru wiodącego (BZP/TED/BK) — kopia z platformy schodzi z puli.
    const pula = wszystkie.filter((t) => t.anulowany !== true && !t.zastapiony_przez);
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

  /**
   * Strumień NOWYCH ogłoszeń dla monitoringu zapisanych wyszukiwań (naprawa 2026-09-25).
   *
   * Monitoring czytał dawniej `katalog` z `limit: 50` osobno dla każdego wyszukiwania,
   * a skan katalogu kończy się po `SKAN_MAKS` (1200) dokumentach. Trafienie przykryte
   * większą liczbą nowszych ogłoszeń (doba ~950, tydzień ~5700) nie było widziane nigdy.
   * Tu czytamy RAZ na przebieg wszystko, co nowsze od najstarszego kursora, stronami
   * aż do wyczerpania — z budżetem odczytów i czasu jako bezpiecznikiem kosztu.
   *
   * Porządek ROSNĄCY jest istotą naprawy: przerwany strumień to zawsze CIĄGŁY odcinek
   * `(od, przejrzanoDo]`, więc każda obserwacja może przesunąć kursor dokładnie do
   * miejsca przejrzanego i niczego nie przeskoczyć.
   *
   * Indeks: nierówność i oba sortowania po `fetched_at` + `__name__` w tym samym
   * kierunku — obsługuje je AUTOMATYCZNY indeks jednopolowy (strażnik w
   * test/indeksyFirestore.test.js pilnuje, żeby nic go nie wyłączyło).
   *
   * @param {{od: string, doMaks?: string|null, budzetOdczytow?: number,
   *   rozmiarStrony?: number, czyPrzerwac?: () => boolean}} opts
   * @returns {Promise<{wiersze: object[], wyczerpano: boolean, przejrzanoDo: string|null,
   *   przeczytano: number, zapytan: number}>}
   *   `przejrzanoDo` — największy `fetched_at`, do którego WSZYSTKO zostało przeczytane
   */
  async noweOd({
    od, doMaks = null, budzetOdczytow = 20_000, rozmiarStrony = 500, czyPrzerwac = () => false,
  }) {
    let zapytanie = db().collection('tenders').where('fetched_at', '>', od);
    if (doMaks) zapytanie = zapytanie.where('fetched_at', '<=', doMaks);
    zapytanie = zapytanie
      .orderBy('fetched_at', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .select(...POLA_KATALOGU);

    const wiersze = [];
    let zapytan = 0;
    let wyczerpano = false;

    while (wiersze.length < budzetOdczytow && !czyPrzerwac()) {
      const ile = Math.min(rozmiarStrony, budzetOdczytow - wiersze.length);
      const ostatni = wiersze.at(-1);
      const strona = ostatni ? zapytanie.startAfter(ostatni.fetched_at, ostatni.id) : zapytanie;
      const snap = await strona.limit(ile).get();
      zapytan += 1;
      for (const doc of snap.docs) wiersze.push({ id: doc.id, ...doc.data() });
      if (snap.docs.length < ile) { wyczerpano = true; break; }
    }

    const przeczytano = wiersze.length;
    if (!wyczerpano && wiersze.length) {
      /*
       * Przerwanie W ŚRODKU grupy o tym samym `fetched_at` (pobieranie zapisuje setki
       * ogłoszeń w tej samej milisekundzie) zostawiłoby jej resztę za kursorem, a filtr
       * `fetched_at > kursor` nie wróciłby już do niej. Odcinamy więc całą ostatnią
       * grupę — przeczyta ją w całości następny przebieg. Wyjątek: cały odczyt to jedna
       * grupa (budżet mniejszy niż partia jednej milisekundy) — wtedy postęp jest
       * ważniejszy niż teoretyczna reszta tej grupy.
       */
      const ostatniZnacznik = wiersze.at(-1).fetched_at;
      const bezOgona = wiersze.filter((t) => t.fetched_at !== ostatniZnacznik);
      if (bezOgona.length) {
        wiersze.length = 0;
        wiersze.push(...bezOgona);
      } else {
        console.warn(JSON.stringify({
          severity: 'WARNING', message: 'Strumień nowych: budżet mniejszy niż grupa jednego znacznika', ostatniZnacznik, przeczytano,
        }));
      }
    }

    return {
      wiersze,
      wyczerpano,
      przejrzanoDo: wiersze.at(-1)?.fetched_at ?? null,
      przeczytano,
      zapytan,
    };
  },

  /** Znacznik najświeższego ogłoszenia w bazie — punkt „od teraz" dla nowej obserwacji. */
  async najnowszyFetchedAt() {
    const snap = await db().collection('tenders')
      .orderBy('fetched_at', 'desc')
      .select('fetched_at')
      .limit(1)
      .get();
    return snap.docs[0]?.get('fetched_at') ?? null;
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

/** Rekord dopasowania z ZDENORMALIZOWANYMI polami przetargu (jedno źródło kształtu). */
function rekordDopasowania({ userId, tenderId, score, reasoning, scorer, tender, teraz = nowIso() }) {
  return {
    user_id: userId,
    tender_id: tenderId,
    confidence_score: Math.round(score),
    match_reasoning: reasoning ?? null,
    scorer,
    notified: 0,
    created_at: teraz,
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
    tender_kryteria_skrot: skrotKryteriow(tender),
    tender_liczba_czesci: tender?.liczba_czesci ?? null,
  };
}

export const matches = {
  /**
   * Tworzy dopasowanie. docId = tenderId → duplikat niemożliwy z konstrukcji
   * (odpowiednik ON CONFLICT DO NOTHING). `tender` = zdenormalizowane pola do feedu.
   */
  async create({ userId, tenderId, score, reasoning, scorer = 'ai', tender }) {
    const ref = matchCol(userId).doc(tenderId);
    const record = rekordDopasowania({ userId, tenderId, score, reasoning, scorer, tender });
    try {
      await ref.create(record);
      return { created: true, match: { id: tenderId, ...record } };
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return { created: false, match: null };
      throw err;
    }
  },

  /**
   * Skrót kryteriów w kopiach JUŻ istniejących (2026-10-31): dopasowania i zapisane z terminem
   * w przyszłości, które go nie mają, a przetarg ma już listę (zapisaną przy pobraniu albo
   * uzupełnioną wstecz). Konto po koncie — zapytanie po `tender_deadline` w kolekcji konta ma
   * indeks automatyczny. Powtórka nic nie zapisuje.
   */
  async uzupelnijSkrotKryteriow({ teraz = nowIso() } = {}) {
    const konta = await db().collection('users').select().get();
    const wynik = { konta: konta.size, kopie_bez_skrotu: 0, uzupelnione: 0 };
    for (const konto of konta.docs) {
      const [m, s] = await Promise.all([
        matchCol(konto.id).where('tender_deadline', '>=', teraz).select('tender_id', 'tender_kryteria_skrot').get(),
        savedCol(konto.id).where('tender_deadline', '>=', teraz).select('tender_id', 'tender_kryteria_skrot').get(),
      ]);
      const bez = [...m.docs, ...s.docs].filter((d) => d.get('tender_kryteria_skrot') == null);
      wynik.kopie_bez_skrotu += bez.length;
      for (let i = 0; i < bez.length; i += 300) {
        const czesc = bez.slice(i, i + 300);
        const przetargi = await db().getAll(
          ...czesc.map((d) => db().collection('tenders').doc(d.get('tender_id') ?? d.id)),
          { fieldMask: ['kryteria', 'kryteria_rozne_czesci'] },
        );
        const batch = db().batch();
        let wPartii = 0;
        przetargi.forEach((p, j) => {
          const skrot = p.exists ? skrotKryteriow(p.data()) : null;
          if (!skrot) return;
          batch.update(czesc[j].ref, { tender_kryteria_skrot: skrot });
          wPartii += 1;
        });
        if (wPartii) await batch.commit();
        wynik.uzupelnione += wPartii;
      }
    }
    return wynik;
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
    const record = rekordDopasowania({ userId, tenderId, score, reasoning, scorer, tender });
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

  /**
   * Wybrany przetarg (spec §4.5): dopasowanie z uzasadnieniem + ślad „wybrany” jednym batchem.
   * Gdy dopasowanie już istnieje (wybór z dnia awarii AI, sprzed wdrożenia), aktualizujemy
   * ocenę BEZ ruszania `created_at` i `notified` — przetarg nie wraca jako „nowy”.
   * `zapiszSlad: false` = decyzja tymczasowa (awaria AI): bez śladu, AI oceni jutro.
   * `wersjaFormalnych` (selekcja): odrzucony za warunki przy TYCH SAMYCH danych formalnych zostaje
   * odrzucony — zmiana zakresu czy terenu nie zmienia tego, czy firma spełnia warunki (spec §6.2).
   * Przywrócenie przez klienta nie podaje wersji, więc zawsze przechodzi.
   */
  async utworzWybrany({ userId, tender, score, punkty, scorer, ocenaBezAi, criteriaHash, zapiszSlad, wersjaFormalnych = null, teraz = nowIso() }) {
    const matchRef = matchCol(userId).doc(tender.id);
    const evalRef = evalCol(userId).doc(tender.id);
    const record = {
      ...rekordDopasowania({ userId, tenderId: tender.id, score, reasoning: punkty.join(' '), scorer, tender, teraz }),
      uzasadnienie: punkty,
      ocena_bez_ai: Boolean(ocenaBezAi),
      odrzucony_przez_klienta: null,
      odrzucony_przez_pracownika: null,
      warunki: null,
    };
    const slad = {
      score: Math.round(score), scorer, criteria_hash: criteriaHash, evaluated_at: teraz,
      decyzja: 'wybrany', przyczyna: null, etap: scorer === 'ai' ? 'ai' : (scorer === 'klient' ? 'klient' : 'heurystyka'), szczegol: null,
    };

    const batch = db().batch();
    batch.create(matchRef, record);
    if (zapiszSlad) batch.set(evalRef, slad);
    try {
      await batch.commit();
      return { created: true, match: { id: tender.id, ...record } };
    } catch (err) {
      if (err.code !== 6 /* ALREADY_EXISTS */) throw err;
      const obecny = (await matchRef.get()).data() ?? {};
      if (wersjaFormalnych && obecny.odrzucony_przez_pracownika?.przyczyna === 'warunki'
        && obecny.warunki?.wersja_formalnych === wersjaFormalnych) {
        // Ślad „odrzucony: warunki” zostaje, dostaje tylko bieżącą wersję karty — bez ponownej oceny co przebieg.
        if (zapiszSlad) await evalRef.set({ criteria_hash: criteriaHash, evaluated_at: teraz }, { merge: true });
        return { created: false, match: null, odrzuconyNaWarunkach: true };
      }
      await matchRef.update({
        confidence_score: Math.round(score), match_reasoning: punkty.join(' '), scorer,
        uzasadnienie: punkty, ocena_bez_ai: Boolean(ocenaBezAi), odrzucony_przez_pracownika: null,
      });
      if (zapiszSlad) await evalRef.set(slad);
      return { created: false, match: null };
    }
  },

  /** Odrzucenie przez klienta (przycisk „Odrzuć”). null = brak takiego dopasowania. */
  async oznaczOdrzuconyPrzezKlienta(userId, matchId, { przyczyna, komentarz = null, teraz = nowIso() }) {
    const ref = matchCol(userId).doc(matchId);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const odrzucenie = { przyczyna, komentarz: komentarz ?? null, o: teraz };
    await ref.update({ odrzucony_przez_klienta: odrzucenie });
    return { id: doc.id, ...doc.data(), odrzucony_przez_klienta: odrzucenie };
  },

  /** Odrzucenie wybranego przez selekcję (warunki udziału, późniejsza ocena AI) + ślad z danymi do listy. */
  async oznaczOdrzuconyPrzezPracownika(userId, tenderId, { przyczyna, szczegol = null, etap, criteriaHash, teraz = nowIso() }) {
    const ref = matchCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists) return false;
    const row = doc.data();
    const batch = db().batch();
    batch.update(ref, { odrzucony_przez_pracownika: { przyczyna, szczegol, o: teraz } });
    batch.set(evalCol(userId).doc(tenderId), {
      score: row.confidence_score ?? null, scorer: row.scorer ?? null, criteria_hash: criteriaHash, evaluated_at: teraz,
      decyzja: 'odrzucony', przyczyna, etap, szczegol,
      tytul: row.tender_title ?? null, zamawiajacy: row.tender_organization ?? null, termin: row.tender_deadline ?? null,
      wartosc: row.tender_budget ?? null, wojewodztwo: row.tender_wojewodztwo ?? null, zrodlo: row.tender_source ?? 'bzp',
    });
    await batch.commit();
    return true;
  },

  /**
   * Pełny przegląd selekcji (zmiana karty, pierwszy przebieg): widoczne dopasowania, które schodzą
   * z listy, jeśli teraz odpadną. Zapisane zostają — klient nad nimi pracuje (etap oferty żyje w `saved`).
   */
  async doSchowaniaPrzyPrzegladzie(userId) {
    const [m, s] = await Promise.all([
      matchCol(userId).select('odrzucony_przez_klienta', 'odrzucony_przez_pracownika').get(),
      savedCol(userId).select().get(),
    ]);
    const zapisane = new Set(s.docs.map((d) => d.id));
    return new Set(m.docs
      .filter((d) => !d.get('odrzucony_przez_klienta') && !d.get('odrzucony_przez_pracownika') && !zapisane.has(d.id))
      .map((d) => d.id));
  },

  /** Dopasowanie odrzucone przy ponownej ocenie schodzi z listy (ślad decyzji zapisuje lejek). */
  async schowajOdrzucony(userId, tenderId, { przyczyna, szczegol = null, teraz = nowIso() }) {
    await matchCol(userId).doc(tenderId).update({ odrzucony_przez_pracownika: { przyczyna, szczegol, o: teraz } });
  },

  /** Wybór na samej heurystyce (dzień awarii AI), który AI potem odrzuciło, schodzi z „Wybranych”. */
  async cofnijWyborBezAi(userId, tenderId, { przyczyna, teraz = nowIso() }) {
    const ref = matchCol(userId).doc(tenderId);
    const doc = await ref.get();
    if (!doc.exists || doc.data().ocena_bez_ai !== true || doc.data().odrzucony_przez_pracownika) return false;
    await ref.update({ odrzucony_przez_pracownika: { przyczyna, szczegol: null, o: teraz } });
    return true;
  },

  async zapiszWarunki(userId, matchId, warunki) {
    await matchCol(userId).doc(matchId).update({ warunki });
  },

  /** Wybrane od chwili `odIso` (np. początek doby), bez odrzuconych — „Dziś wybrane”. */
  async wybraneOd(userId, odIso) {
    const snap = await matchCol(userId).where('created_at', '>=', odIso).orderBy('created_at', 'desc').limit(200).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => !r.odrzucony_przez_klienta && !r.odrzucony_przez_pracownika);
  },

  /** Wybrane od `odIso`, o których klient jeszcze nie wie (`notified !== 1`). */
  async doPowiadomienia(userId, odIso) {
    return (await this.wybraneOd(userId, odIso)).filter((r) => r.notified !== 1);
  },
};

// ============================ zapisane (zakładki) ============================

const savedCol = (userId) => db().collection('users').doc(userId).collection('saved');

export const saved = {
  /**
   * Zapisane przetargi WSZYSTKICH kont z terminem od `od` (monitoring nowych dokumentów, 2026-11-01).
   * Po kontach, nie collectionGroup: sam zakres po `tender_deadline` w grupie kolekcji wymagałby
   * osobnego indeksu, a w kolekcji jednego konta mieści się w indeksie automatycznym.
   * @returns {Promise<{userId: string, tenderId: string, saved_at: string|null}[]>}
   */
  async otwarteWszystkich(od) {
    const konta = await db().collection('users').select().get();
    const wynik = [];
    for (const konto of konta.docs) {
      const snap = await savedCol(konto.id).where('tender_deadline', '>=', od).select('tender_id', 'saved_at').get();
      for (const d of snap.docs) wynik.push({ userId: konto.id, tenderId: d.get('tender_id') ?? d.id, saved_at: d.get('saved_at') ?? null });
    }
    return wynik;
  },

  /**
   * Najlepiej dopasowane OTWARTE przetargi z feedu każdego konta (wynik ≥ `minWynik`, do `naKonto`) —
   * leniwy użytkownik nie zapisuje, tylko przegląda listę, a wyjaśnienia SWZ dotyczą i jego (2026-11-01).
   * `od` = najwcześniejszy termin — po terminie przychodzi informacja z otwarcia ofert.
   * @returns {Promise<{userId: string, tenderId: string, saved_at: string|null}[]>}
   */
  async najlepszeDopasowaniaWszystkich(od, { minWynik = 70, naKonto = 40 } = {}) {
    const konta = await db().collection('users').select().get();
    const wynik = [];
    for (const konto of konta.docs) {
      const snap = await matchCol(konto.id).where('tender_deadline', '>=', od).select('tender_id', 'confidence_score', 'created_at').get();
      snap.docs
        .map((d) => ({ tenderId: d.get('tender_id') ?? d.id, wynik: Number(d.get('confidence_score')) || 0, od: d.get('created_at') ?? null }))
        .filter((m) => m.wynik >= minWynik)
        .sort((x, y) => y.wynik - x.wynik)
        .slice(0, naKonto)
        .forEach((m) => wynik.push({ userId: konto.id, tenderId: m.tenderId, saved_at: m.od }));
    }
    return wynik;
  },

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
      tender_kryteria_skrot: match.tender_kryteria_skrot ?? null,
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

  /**
   * Rezerwuje etap przypomnienia PRZED wysyłką — w transakcji (2026-09-25, P2).
   *
   * Dotąd job wysyłał push, a etap przesuwał DOPIERO potem i bez warunku: dwa
   * równoległe przebiegi (podwójne wyzwolenie Cloud Schedulera, ponowienie) widziały
   * ten sam wymagalny wpis i obydwa wysyłały. Teraz przesunięcie jest warunkowe:
   * przechodzi tylko, gdy wpis wciąż ma DOKŁADNIE ten etap i `remind_at`, które job
   * odczytał — drugi przebieg dostaje `zajete` i nic nie wysyła. Awarię wysyłki
   * odkręca `cofnijEtap` (z limitem prób).
   *
   * `termin` to AKTUALNY termin z dokumentu przetargu (P1): gdy w źródle się zmienił,
   * wpis dostaje nowy termin, a etapy liczymy od nowa — zamiast „zostało 7 dni"
   * przy terminie przesuniętym o dwa miesiące. Termin miniony zamyka przypomnienie.
   *
   * @param {{etap: number, remindAt: string, termin?: string|null, teraz?: string}} oczekiwane
   * @returns {Promise<{stan: 'zarezerwowany', etap: number, termin: string, poprzedni: object, ustawione: object}
   *   | {stan: 'zajete'|'brak'|'przeplanowany'|'zakonczony', powod?: string}>}
   */
  async zarezerwujEtap(userId, tenderId, { etap, remindAt, termin = null, teraz = nowIso() }) {
    const ref = savedCol(userId).doc(tenderId);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { stan: 'brak' };
      const d = doc.data();
      if (d.reminder_enabled !== true || d.reminder_notified === true
          || d.remind_etap !== etap || d.remind_at !== remindAt) {
        return { stan: 'zajete' };
      }

      const wyslane = (d.reminded_stages ?? []).filter((x) => typeof x === 'number');
      const aktualny = termin || d.tender_deadline || null;
      // Porównanie po czasie, nie po napisie — ten sam termin bywa zapisany z innym formatem.
      const zmienionyTermin = Boolean(termin)
        && new Date(termin).getTime() !== new Date(d.tender_deadline ?? NaN).getTime();
      const pola = zmienionyTermin ? { tender_deadline: termin } : {};
      const koniec = (powod) => {
        tx.update(ref, { ...pola, reminder_notified: true, remind_proby: 0 });
        return { stan: 'zakonczony', powod };
      };

      const terminMs = aktualny ? new Date(aktualny).getTime() : NaN;
      if (!Number.isFinite(terminMs) || terminMs <= new Date(teraz).getTime()) return koniec('po_terminie');

      let etapDoWyslania = d.remind_etap;
      if (pola.tender_deadline) {
        const plan = nastepneRemind(aktualny, teraz, wyslane);
        if (!plan) return koniec('termin_zmieniony');
        if (plan.at > teraz) {
          tx.update(ref, { ...pola, remind_at: plan.at, remind_etap: plan.etap, remind_proby: 0 });
          return { stan: 'przeplanowany', remind_at: plan.at, etap: plan.etap };
        }
        etapDoWyslania = plan.etap;
      }

      const poWysylce = [...wyslane, etapDoWyslania];
      const nast = nastepneRemind(aktualny, teraz, poWysylce);
      const ustawione = nast
        ? { remind_at: nast.at, remind_etap: nast.etap, reminder_notified: false }
        : { remind_at: d.remind_at, remind_etap: d.remind_etap, reminder_notified: true };
      tx.update(ref, { ...pola, ...ustawione, reminded_stages: poWysylce, remind_proby: 0 });
      return {
        stan: 'zarezerwowany',
        etap: etapDoWyslania,
        termin: aktualny,
        poprzedni: { reminded_stages: wyslane, remind_proby: d.remind_proby ?? 0 },
        ustawione,
      };
    });
  },

  /**
   * Odkręca rezerwację etapu po NIEUDANEJ wysyłce (2026-09-25, P1).
   *
   * `sendPush` nie rzuca — zwraca `{sent, failed}`. Job liczył wysyłkę jako udaną
   * i przesuwał etap bez patrzenia na wynik, więc chwilowa awaria Expo po cichu
   * kasowała przypomnienie o terminie. Teraz etap wraca z odstępem `odstepMs`
   * (kolejny przebieg, nie pętla w tym samym), a po `maksProb` nieudanych próbach
   * — albo gdy ponowienie wypadłoby po terminie — zostaje zamknięty.
   *
   * Odkręcamy tylko, jeśli wpis wciąż wygląda tak, jak zostawiła go rezerwacja —
   * gdy użytkownik w międzyczasie wyłączył albo przestawił przypomnienie, jego
   * decyzja wygrywa.
   *
   * @returns {Promise<{stan: 'ponowienie'|'porzucony'|'zmienione'|'brak', proby?: number}>}
   */
  async cofnijEtap(userId, tenderId, rezerwacja, { teraz = nowIso(), maksProb, odstepMs }) {
    const ref = savedCol(userId).doc(tenderId);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { stan: 'brak' };
      const d = doc.data();
      const u = rezerwacja.ustawione;
      if (d.reminder_enabled !== true || d.remind_at !== u.remind_at || d.remind_etap !== u.remind_etap
          || (d.reminder_notified === true) !== u.reminder_notified) {
        return { stan: 'zmienione' };
      }

      const proby = (rezerwacja.poprzedni.remind_proby ?? 0) + 1;
      const ponownieMs = new Date(teraz).getTime() + odstepMs;
      const przedTerminem = ponownieMs < new Date(rezerwacja.termin).getTime();
      // Etap zostaje zamknięty tak, jak go zostawiła rezerwacja (licznik już wyzerowany).
      if (proby >= maksProb || !przedTerminem) return { stan: 'porzucony', proby };

      tx.update(ref, {
        remind_at: new Date(ponownieMs).toISOString(),
        remind_etap: rezerwacja.etap,
        reminded_stages: rezerwacja.poprzedni.reminded_stages,
        reminder_notified: false,
        remind_proby: proby,
      });
      return { stan: 'ponowienie', proby };
    });
  },

  /**
   * Zamyka przypomnienie bez wysyłki — np. przetarg ANULOWANY przez zamawiającego
   * (2026-09-25, P1: job przypominał o postępowaniach, których już nie ma).
   * @returns {Promise<boolean>} false, gdy wpisu już nie ma
   */
  async zakonczPrzypomnienie(userId, tenderId, powod) {
    try {
      await savedCol(userId).doc(tenderId).update({
        reminder_notified: true,
        reminder_zakonczone_powod: powod,
        remind_proby: 0,
      });
      return true;
    } catch (err) {
      if (err.code === 5 /* NOT_FOUND */) return false;
      throw err;
    }
  },
};

// ============================ znacznik cotygodniowego przeglądu ============================

/*
 * `users/{id}/meta/digest_<rok>-W<tydzień ISO>` — przegląd tygodnia idzie do konta
 * NAJWYŻEJ RAZ (2026-09-25, P2). Bez znacznika podwójne wyzwolenie Cloud Schedulera
 * albo ponowienie po błędzie wysyłało każdemu drugi e-mail. Podkolekcja `meta`
 * znika razem z kontem (`usunKonto` → recursiveDelete).
 */
const digestRef = (userId, tydzien) =>
  db().collection('users').doc(userId).collection('meta').doc(`digest_${tydzien}`);

export const znacznikDigestu = {
  /** @returns {Promise<boolean>} true = wolno wysłać (znacznik właśnie powstał) */
  async zarezerwuj(userId, tydzien) {
    try {
      await digestRef(userId, tydzien).create({ stan: 'wysylanie', zarezerwowano_o: nowIso() });
      return true;
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return false;
      throw err;
    }
  },

  async potwierdz(userId, tydzien, { emailId = null } = {}) {
    await digestRef(userId, tydzien).set({ stan: 'wyslany', wyslano_o: nowIso(), email_id: emailId }, { merge: true });
  },

  /** Nieudana wysyłka — zwalniamy znacznik, żeby ponowienie mogło dosłać przegląd. */
  async zwolnij(userId, tydzien) {
    await digestRef(userId, tydzien).delete();
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

  /**
   * Zbiór tenderId z AKTUALNĄ decyzją przy tej wersji karty (lib/swiezoscOceny.js):
   * jak `idsAmong`, ale odrzucenie „termin” sprzed PRZEDŁUŻENIA terminu nie liczy się
   * za ocenę — Baza Konkurencyjności i BZP regularnie przedłużają, a klient nie powinien
   * przez to stracić przetargu, na który teraz zdąży.
   * @param {object[]} lista przetargi (potrzebne `id` i `deadline`)
   */
  async idsAktualne(userId, lista, criteriaHash) {
    if (!lista.length) return new Set();
    const snaps = await db().getAll(...lista.map((t) => evalCol(userId).doc(t.id)));
    const wynik = new Set();
    snaps.forEach((s, i) => {
      if (s.exists && ocenaAktualna(s.data(), { tender: lista[i], criteriaHash })) wynik.add(s.id);
    });
    return wynik;
  },

  /** Decyzja selekcji (spec §4.5). Odrzucony niesie dane przetargu — lista odrzuconych bez JOIN-a. */
  async zapiszDecyzje(userId, tenderId, { decyzja, przyczyna = null, etap, szczegol = null, score = null, scorer = null,
    criteriaHash, tender = null, teraz = nowIso() }) {
    const rekord = {
      score: score === null ? null : Math.round(score), scorer, criteria_hash: criteriaHash, evaluated_at: teraz,
      decyzja, przyczyna, etap, szczegol,
    };
    if (decyzja === 'odrzucony' && tender) {
      Object.assign(rekord, {
        tytul: tender.title ?? null, zamawiajacy: tender.organization ?? null, termin: tender.deadline ?? null,
        wartosc: typeof tender.budget === 'number' ? tender.budget : null, wojewodztwo: tender.wojewodztwo ?? null,
        zrodlo: tender.source ?? 'bzp',
      });
    }
    await evalCol(userId).doc(tenderId).set(rekord);
  },

  async pobierz(userId, tenderId) {
    const doc = await evalCol(userId).doc(tenderId).get();
    return doc.exists ? { tender_id: doc.id, ...doc.data() } : null;
  },

  /** Lista odrzuconych (Standard), od najnowszych, kursorem `evaluated_at|id`. */
  async odrzucone(userId, { od, przyczyna = null, przed = null, limit = 20 }) {
    let q = evalCol(userId).where('decyzja', '==', 'odrzucony');
    if (przyczyna) q = q.where('przyczyna', '==', przyczyna);
    q = q.where('evaluated_at', '>=', od)
      .orderBy('evaluated_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (przed) {
      const i = przed.lastIndexOf('|');
      q = i > 0 ? q.startAfter(przed.slice(0, i), przed.slice(i + 1)) : q.startAfter(przed, '');
    }
    const snap = await q.limit(limit).get();
    return snap.docs.map((d) => ({ tender_id: d.id, ...d.data() }));
  },

  kursorZ(row) {
    return row ? `${row.evaluated_at}|${row.tender_id}` : null;
  },
};

// ============================ dziennik selekcji ============================

const dziennikRef = (userId, doba) => db().collection('users').doc(userId).collection('dziennik').doc(doba);

/** Raport dnia (spec §4.5): inkrementy z każdego przebiegu; `oczekuje` = stan z ostatniego. */
export const dziennik = {
  async dopisz(userId, doba, { przejrzane = 0, wybrane = 0, oczekuje = 0, odrzucone = {}, aiWywolan = 0, teraz = nowIso() }) {
    const inc = FieldValue.increment;
    const przyrostOdrzuconych = Object.entries(odrzucone).filter(([, n]) => n > 0).map(([k, n]) => [k, inc(n)]);
    await dziennikRef(userId, doba).set({
      doba,
      przejrzane: inc(przejrzane),
      wybrane: inc(wybrane),
      ai_wywolan: inc(aiWywolan),
      oczekuje,
      // set+merge scala mapy GŁĘBOKO (pamięć: pulapki-firestore-merge) — tu dokładnie tego chcemy.
      // Ale PUSTA mapa to „ustaw {}” i kasuje liczniki dnia — cichy przebieg pomija pole.
      ...(przyrostOdrzuconych.length ? { odrzucone: Object.fromEntries(przyrostOdrzuconych) } : {}),
      ostatni_przebieg_o: teraz,
      przebiegi: FieldValue.arrayUnion({ o: teraz, przejrzane, wybrane }),
    }, { merge: true });
  },

  async pobierz(userId, doba) {
    const doc = await dziennikRef(userId, doba).get();
    return doc.exists ? doc.data() : null;
  },
};

/** Dobowy limit porównań warunków udziału (spec §6.2) — osobny licznik, wzór streszczenieQuota. */
const warunkiQuotaDoc = (userId, day) => db().collection('users').doc(userId).collection('warunki_quota').doc(day);

export const warunkiQuota = {
  today() { return nowIso().slice(0, 10); },
  async reserve(userId, limit) {
    const ref = warunkiQuotaDoc(userId, this.today());
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const calls = doc.exists ? (doc.data().calls ?? 0) : 0;
      if (calls >= limit) return false;
      tx.set(ref, { calls: calls + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

/** Mail dnia planu Free (spec §7): rezerwacja przed wysyłką, wzór znacznikDigestu. */
const mailSelekcjiRef = (userId, doba) => db().collection('users').doc(userId).collection('maile_selekcji').doc(doba);

export const znacznikMailaSelekcji = {
  async zarezerwuj(userId, doba) {
    try {
      await mailSelekcjiRef(userId, doba).create({ stan: 'wysylanie', zarezerwowano_o: nowIso() });
      return true;
    } catch (err) {
      if (err.code === 6 /* ALREADY_EXISTS */) return false;
      throw err;
    }
  },
  async potwierdz(userId, doba, { emailId = null } = {}) {
    await mailSelekcjiRef(userId, doba).set({ stan: 'wyslany', wyslano_o: nowIso(), email_id: emailId }, { merge: true });
  },
  async zwolnij(userId, doba) {
    await mailSelekcjiRef(userId, doba).delete();
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

// ============================ rozstrzygnięcia (etap 6) ============================

/*
 * Rozstrzygnięcia postępowań — surowe, per część, z OBU rejestrów.
 *
 * Czym się różni od `wyniki_stats`: tamto trzyma gotowy AGREGAT (mediana ceny
 * w kubełku dział|rodzaj|województwo) i nie pamięta, z czego powstał. Do
 * benchmarku „u TEGO zamawiającego" i do karty „czy warto startować" potrzebne
 * są pojedyncze rozstrzygnięcia: kto wygrał, ile firm startowało, czy część
 * unieważniono. Agregat liczy się Z TEJ kolekcji, a nie z ponownego pobierania
 * rejestru — 30-dniowe okno BZP to ~390 s samego ruchu sieciowego.
 *
 * Idempotencja: docId = identyfikator ogłoszenia o wyniku, więc ponowne
 * pobranie tej samej doby niczego nie duplikuje.
 */
export const rozstrzygniecia = {
  /**
   * Zapisuje partię rozstrzygnięć. Nadpisuje istniejące — rejestr potrafi
   * skorygować ogłoszenie, a my chcemy stan aktualny, nie pierwszy widziany.
   * @returns {{zapisane: number, czesci: number}}
   */
  async zapiszWiele(lista) {
    const wpisy = (lista ?? []).filter((w) => w?.externalId);
    let czesci = 0;
    // Batch po 400 (limit 500 operacji, zapas na bezpieczeństwo).
    for (let i = 0; i < wpisy.length; i += 400) {
      const batch = db().batch();
      for (const wynik of wpisy.slice(i, i + 400)) {
        czesci += (wynik.czesci ?? []).length;
        batch.set(db().collection('rozstrzygniecia').doc(tenderDocId(wynik.externalId)), {
          ...wynik,
          // Denormalizacja pod zapytania: te pola filtrują benchmark.
          postepowanie_id: wynik.tenderId ?? null,
          zamawiajacy_nip: wynik.zamawiajacyNip ?? null,
          // Profil konkurenta (2026-10-31): zapytania `array-contains` po NIP-ie i nazwie zwycięzcy.
          ...kluczeZwyciezcow(wynik.czesci),
          // Radar wygasających umów (2026-10-31): najpóźniejszy koniec umowy (zapytanie zakresowe).
          koniec_umowy: koniecUmowyWyniku(wynik),
          updated_at: nowIso(),
        });
      }
      await batch.commit();
    }
    return { zapisane: wpisy.length, czesci };
  },

  /**
   * Rozstrzygnięcia, których umowa kończy się w [od, do] (RRRR-MM-DD) — radar wygasających umów.
   * Indeks jednopolowy `koniec_umowy` (automatyczny). Tylko pola potrzebne do pozycji radaru,
   * stronami po 2000, z sufitem — dzień ruchu to kilkadziesiąt tysięcy umów, nie miliony.
   */
  async konczaceSie(od, doDnia, { sufit = 60_000 } = {}) {
    const pola = ['externalId', 'tytul', 'zamawiajacy', 'zamawiajacyNip', 'miasto', 'wojewodztwo', 'cpv', 'rodzaj', 'czesci', 'tenderId', 'koniec_umowy', 'opublikowano'];
    const wynik = [];
    let ostatni = null;
    for (;;) {
      let q = db().collection('rozstrzygniecia')
        .where('koniec_umowy', '>=', String(od))
        .where('koniec_umowy', '<=', String(doDnia))
        .orderBy('koniec_umowy')
        .select(...pola)
        .limit(2000);
      if (ostatni) q = q.startAfter(ostatni);
      const snap = await q.get();
      for (const d of snap.docs) wynik.push(d.data());
      if (snap.size < 2000 || wynik.length >= sufit) break;
      ostatni = snap.docs[snap.docs.length - 1];
    }
    return wynik.slice(0, sufit);
  },

  /** Rozstrzygnięcie konkretnego POSTĘPOWANIA (klucz złączenia z przetargiem). */
  async poPostepowaniu(postepowanieId) {
    if (!postepowanieId) return null;
    const snap = await db().collection('rozstrzygniecia')
      .where('postepowanie_id', '==', String(postepowanieId)).limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  /**
   * Rozstrzygnięcia jednego zamawiającego (po NIP-ie), od najnowszych.
   *
   * NIP, a nie nazwa: ta sama jednostka pisze się w BZP raz „SĄD REJONOWY
   * W RZESZOWIE", raz „Sąd Rejonowy w Rzeszowie". Grupowanie po nazwie
   * rozbiłoby jednego zamawiającego na kilku i zaniżyło każdą próbkę.
   */
  async dlaZamawiajacego(nip, { limit = 200 } = {}) {
    if (!nip) return [];
    const snap = await db().collection('rozstrzygniecia')
      .where('zamawiajacy_nip', '==', String(nip))
      .orderBy('opublikowano', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Rozstrzygnięcia od dnia `od`, w których wygrał ktoś z listy NIP-ów (≤ 30 — limit `array-contains-any`).
   * Cotygodniowy przegląd: „co wygrali Twoi konkurenci”. Indeks: zwyciezcy_nip CONTAINS + opublikowano DESC.
   */
  async wygraneOd(nipy, od, { limit = 40 } = {}) {
    const lista = [...new Set((nipy ?? []).filter(Boolean))].slice(0, 30);
    if (!lista.length || !od) return [];
    const snap = await db().collection('rozstrzygniecia')
      .where('zwyciezcy_nip', 'array-contains-any', lista)
      .where('opublikowano', '>=', String(od))
      .orderBy('opublikowano', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Rozstrzygnięcia, w których dany wykonawca wygrał co najmniej jedną część — wejście profilu
   * konkurenta. Dwa zapytania, bo BZP podaje NIP zwycięzcy, a TED tylko nazwę; wynik bez duplikatów.
   * Nazwa krótsza niż 3 znaki po normalizacji nie idzie do zapytania (za ogólna).
   */
  /**
   * Umowy wykonawcy (po NIP-ie zwycięzcy) z końcem od dnia `od` — „Twoje umowy” w radarze
   * i alert o ogłoszonym następcy (2026-11-01). Indeks: zwyciezcy_nip CONTAINS + opublikowano DESC;
   * koniec filtrowany po odczycie — firma ma najwyżej kilkaset wygranych.
   */
  async umowyWykonawcy(nip, { od, limit = 300 } = {}) {
    const n = normNip(nip);
    if (!n) return [];
    const snap = await db().collection('rozstrzygniecia')
      .where('zwyciezcy_nip', 'array-contains', n)
      .orderBy('opublikowano', 'desc')
      .select('externalId', 'tytul', 'zamawiajacy', 'zamawiajacyNip', 'miasto', 'wojewodztwo', 'cpv', 'rodzaj', 'czesci', 'tenderId', 'koniec_umowy', 'opublikowano')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data()).filter((w) => w.koniec_umowy && (!od || w.koniec_umowy >= od));
  },

  async dlaWykonawcy({ nip = null, nazwa = null } = {}, { limit = 300 } = {}) {
    const zapytania = [];
    const n = normNip(nip);
    if (n) zapytania.push(['zwyciezcy_nip', n]);
    const k = nazwa ? normNazwa(nazwa) : '';
    if (k.length >= 3) zapytania.push(['zwyciezcy_nazwy', k]);
    const snapy = await Promise.all(zapytania.map(([pole, wartosc]) => db().collection('rozstrzygniecia')
      .where(pole, 'array-contains', wartosc)
      .orderBy('opublikowano', 'desc')
      .limit(limit)
      .get()));
    const wyniki = new Map();
    for (const snap of snapy) {
      for (const d of snap.docs) if (!wyniki.has(d.id)) wyniki.set(d.id, { id: d.id, ...d.data() });
    }
    return [...wyniki.values()];
  },

  /**
   * Strona rozstrzygnięć od najnowszych — wejście agregacji benchmarku.
   *
   * 🚨 Kursor MUSI być parą (data, docId), a nie samą datą. BZP publikuje setki
   * rozstrzygnięć dziennie, więc `opublikowano` nie jest unikalne: `startAfter`
   * po samej dacie przeskakuje WSZYSTKIE dokumenty z tego dnia i benchmark liczy
   * się z ułamka rynku — po cichu, bo strona wraca pełna i bez błędu.
   * Stąd drugi klucz sortowania po identyfikatorze dokumentu.
   */
  async strona({ od = null, limit = 500, kursor = null, pola = null } = {}) {
    let q = db().collection('rozstrzygniecia');
    if (od) q = q.where('opublikowano', '>=', od);
    // Tylko potrzebne pola (benchmark z roku rynku, 2026-10-31): mniej pamięci i transferu, ten sam koszt odczytu.
    if (Array.isArray(pola) && pola.length) q = q.select(...new Set([...pola, 'opublikowano']));
    q = q.orderBy('opublikowano', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (kursor?.opublikowano) q = q.startAfter(kursor.opublikowano, kursor.id);
    const snap = await q.limit(limit).get();
    const ostatni = snap.docs[snap.docs.length - 1] ?? null;
    return {
      pozycje: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      kursor: ostatni ? { opublikowano: ostatni.get('opublikowano'), id: ostatni.id } : null,
      koniec: snap.docs.length < limit,
    };
  },
};

/*
 * Benchmark rynku (etap 6) — gotowe kubełki liczone w jobie, nie na żądanie.
 *
 * Dlaczego agregat, a nie zapytanie na żywo: karta „czy warto startować" ma się
 * otwierać przy KAŻDYM ogłoszeniu i być darmowa w odczycie, tak jak katalog.
 * Liczenie mediany z setek rozstrzygnięć per wejście na ekran byłoby i wolne,
 * i kosztowne w odczytach Firestore.
 */
export const benchmarkRynku = {
  /** Nadpisuje kubełki — benchmark liczymy od nowa z bieżącego okna. */
  async zapisz(kubelki) {
    const wpisy = Object.entries(kubelki ?? {});
    for (let i = 0; i < wpisy.length; i += 400) {
      const batch = db().batch();
      for (const [klucz, kubelek] of wpisy.slice(i, i + 400)) {
        batch.set(db().collection('benchmark').doc(benchmarkDocId(klucz)),
          { ...kubelek, klucz, updated_at: nowIso() });
      }
      await batch.commit();
    }
    return wpisy.length;
  },

  /** Jeden kubełek albo null. */
  async pobierz(klucz) {
    if (!klucz) return null;
    const doc = await db().collection('benchmark').doc(benchmarkDocId(klucz)).get();
    return doc.exists ? doc.data() : null;
  },

  /**
   * Kilka kubełków jednym odczytem wsadowym.
   *
   * Karta decyzji potrzebuje zwykle trzech (zamawiający, dział w regionie, dział
   * w kraju) — trzy osobne `get()` to trzy round-tripy na każde wejście na ekran.
   */
  async pobierzWiele(klucze) {
    const unikalne = [...new Set((klucze ?? []).filter(Boolean))];
    if (!unikalne.length) return {};
    const refy = unikalne.map((k) => db().collection('benchmark').doc(benchmarkDocId(k)));
    const snapy = await db().getAll(...refy);
    const wynik = {};
    snapy.forEach((snap, i) => { if (snap.exists) wynik[unikalne[i]] = snap.data(); });
    return wynik;
  },
};

/** Klucze kubełków niosą `|` i `:` — w docId dozwolone, ale `/` już nie. */
const benchmarkDocId = (klucz) => String(klucz).replaceAll('/', '_');

/*
 * Radar wygasających umów (2026-10-31): gotowe kubełki dział CPV × województwo (i dział w kraju)
 * z umowami kończącymi się w ciągu ~7 miesięcy. Liczy job `umowyWygasajacePrzelicz` raz na dobę,
 * a trasa czyta tylko kubełki firmy — jak benchmark, bez liczenia przy wejściu na ekran.
 */
export const umowyWygasajace = {
  async zapisz(kubelki) {
    const wpisy = Object.entries(kubelki ?? {});
    for (let i = 0; i < wpisy.length; i += 200) {
      const batch = db().batch();
      for (const [klucz, kubelek] of wpisy.slice(i, i + 200)) {
        batch.set(db().collection('umowy_wygasajace').doc(benchmarkDocId(klucz)), { ...kubelek, klucz, updated_at: nowIso() });
      }
      await batch.commit();
    }
    return wpisy.length;
  },

  async pobierzWiele(klucze) {
    const unikalne = [...new Set((klucze ?? []).filter(Boolean))];
    if (!unikalne.length) return {};
    const snapy = await db().getAll(...unikalne.map((k) => db().collection('umowy_wygasajace').doc(benchmarkDocId(k))));
    const wynik = {};
    snapy.forEach((snap, i) => { if (snap.exists) wynik[unikalne[i]] = snap.data(); });
    return wynik;
  },

  async zapiszPrzebieg(stan) {
    await db().collection('_health').doc('umowy_wygasajace').set({ ostatni_przebieg: stan }, { mergeFields: ['ostatni_przebieg'] });
  },

  async wczytajPrzebieg() {
    const doc = await db().collection('_health').doc('umowy_wygasajace').get();
    return doc.exists ? doc.data()?.ostatni_przebieg ?? null : null;
  },
};

/*
 * Zmiany umów po rozstrzygnięciu (etap 6, TED `cont-modif`).
 *
 * Po co osobna kolekcja, a nie pole w rozstrzygnięciu: zmiana umowy dotyczy
 * postępowania, które ZOSTAŁO już rozstrzygnięte — bywa publikowana rok później
 * i wiele razy. Doklejanie jej do dokumentu rozstrzygnięcia znaczyłoby nadpisywanie
 * stanu, który ma zostać historią.
 *
 * Co to mówi wykonawcy: że u tego zamawiającego zakres i wynagrodzenie bywają
 * renegocjowane po podpisaniu — czyli że wycena „na styk" jest tu mniej ryzykowna,
 * niż wygląda. To sygnał o rynku, nie o konkretnej ofercie.
 */
export const modyfikacjeUmow = {
  /** Zapisuje partię zmian. docId = numer publikacji — powtórki nieszkodliwe. */
  async zapiszWiele(lista) {
    const wpisy = (lista ?? []).filter((m) => m?.externalId);
    for (let i = 0; i < wpisy.length; i += 400) {
      const batch = db().batch();
      for (const zmiana of wpisy.slice(i, i + 400)) {
        batch.set(db().collection('modyfikacje_umow').doc(tenderDocId(zmiana.externalId)), {
          ...zmiana,
          postepowanie_id: zmiana.tenderId ?? null,
          updated_at: nowIso(),
        });
      }
      await batch.commit();
    }
    return wpisy.length;
  },

  /** Zmiany umów dla POSTĘPOWANIA — od najnowszej. */
  async dlaPostepowania(postepowanieId, { limit = 20 } = {}) {
    if (!postepowanieId) return [];
    const snap = await db().collection('modyfikacje_umow')
      .where('postepowanie_id', '==', String(postepowanieId))
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? '')));
  },
};

/**
 * Checkpoint okna rozstrzygnięć (etap 6).
 *
 * Ta sama konstrukcja, co okno BZP: doby domykane pojedynczo, od najświeższej,
 * żeby przebieg, któremu zabrakło czasu, nie ginął wiecznie na tym samym dniu.
 */
const OKNO_WYNIKOW_REF = () => db().collection('_health').doc('wyniki_okno');

export const oknoWynikow = {
  async wczytaj() {
    const doc = await OKNO_WYNIKOW_REF().get();
    return doc.exists ? doc.data() : null;
  },

  /** 🚨 `mergeFields` PODMIENIA pole w całości — `{ merge: true }` scalałby mapy głęboko. */
  async zapisz(stan) {
    await OKNO_WYNIKOW_REF().set({ dni: stan.dni ?? {} }, { mergeFields: ['dni'] });
  },

  async zapiszPrzebieg(wynik) {
    await OKNO_WYNIKOW_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
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

/*
 * Pojedyncze wpisy niosą `user_id` (do wykrycia, czyje konto pali budżet) i przeżywają
 * usunięcie konta — więc jak dziennik audytu nie mogą żyć wiecznie (audyt 2026-09-24).
 * Budżet liczy się z agregatu miesięcznego BEZ danych osobowych, który zostaje.
 */
const AI_USAGE_DNI = 90;

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
      // Pole typu Timestamp — TYLKO takie honoruje polityka TTL Firestore.
      ttl: new Date(Date.now() + AI_USAGE_DNI * 86_400_000),
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

/**
 * Checkpoint okna platformazakupowa.pl (2026-10-25): tylko kursor strony listy
 * (`nastepna_strona`) i ślad ostatniego przebiegu. Lista jest sortowana po terminie,
 * więc nie ma sensu trzymać odcisków — każde przejście i tak czyta wszystkie strony.
 */
const OKNO_PZ_REF = () => db().collection('_health').doc('pz_okno');

/**
 * Ślad dostarczania push (2026-10-28, lib/stanPush.js). `mergeFields` zamiast `merge: true`: mapa
 * `ostatni_wynik.bledy` ma być ZASTĄPIONA, a nie scalona ze starymi kodami (pułapka merge map).
 * Pola sukcesu/błędu zapisujemy tylko wtedy, gdy wystąpiły — trwała historia jak w `cron.zrodla`.
 */
const STAN_PUSH_REF = () => db().collection('_health').doc('push');
export const stanPushRepo = {
  async wczytaj() {
    const doc = await STAN_PUSH_REF().get();
    return doc.exists ? doc.data() : null;
  },
  async zapisz(slad) {
    if (!slad) return;
    await STAN_PUSH_REF().set(slad, { mergeFields: Object.keys(slad) });
  },
};

/** Ślad okna e-ProPublico (2026-10-25): pełne przejście listy co 6 h, bez kursora. */
const OKNO_EPP_REF = () => db().collection('_health').doc('epp_okno');
export const oknoEpp = {
  async wczytaj() {
    const doc = await OKNO_EPP_REF().get();
    return doc.exists ? doc.data() : null;
  },
  async zapiszPrzebieg(wynik) {
    await OKNO_EPP_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

const OKNO_LT_REF = () => db().collection('_health').doc('lt_okno');
export const oknoLt = {
  async wczytaj() {
    const doc = await OKNO_LT_REF().get();
    return doc.exists ? doc.data() : null;
  },
  async zapiszPrzebieg(wynik) {
    await OKNO_LT_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

export const oknoPz = {
  async wczytaj() {
    const doc = await OKNO_PZ_REF().get();
    return doc.exists ? doc.data() : null;
  },
  async zapisz(stan) {
    await OKNO_PZ_REF().set({ nastepna_strona: Math.max(1, Number(stan?.nastepna_strona) || 1) }, { mergeFields: ['nastepna_strona'] });
  },
  async zapiszPrzebieg(wynik) {
    await OKNO_PZ_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
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

    /*
     * Ta sama trwała historia dla AI (2026-10-17): przebieg, w którym WSZYSTKIE oceny
     * padły, nie może skasować wiedzy, kiedy AI działało ostatnio — to pierwsze
     * pytanie przy incydencie „od kiedy nie ma kredytów".
     */
    const aiBylo = poprzedni.exists ? (poprzedni.data().ai ?? {}) : {};
    const ai = {
      ostatni_sukces_o: wynik?.ai?.ostatni_sukces_o ?? aiBylo.ostatni_sukces_o ?? null,
      ostatni_blad: wynik?.ai?.ostatni_blad ?? aiBylo.ostatni_blad ?? null,
    };

    await CYKL_REF().set({ zakonczony_o: teraz, wynik, zrodla, ai });
  },

  async ostatniPrzebieg() {
    const doc = await CYKL_REF().get();
    return doc.exists ? doc.data() : null;
  },
};

/**
 * Znacznik maila alarmowego o awarii AI (2026-10-17) — najwyżej jeden na dobę
 * kalendarzową. Jeden dokument zamiast dokumentu na dzień: liczy się tylko to,
 * czy DZIŚ już poszedł. Transakcja chroni przed dublem przy ponowieniu crona,
 * które wystartuje, zanim poprzednia próba skończy wysyłkę.
 */
const ALARM_AI_REF = () => db().collection('_health').doc('alarm_ai');

/** Znacznik „najwyżej jeden mail na dobę" — wspólny dla alarmu AI i alarmu cichych źródeł. */
function znacznikAlarmu(ref) {
  return {
  /** @returns {Promise<boolean>} true = wolno wysłać (dziś jeszcze nie poszedł) */
  async zarezerwuj(dzien) {
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref());
      const bylo = doc.exists ? doc.data() : {};
      if (bylo.dzien === dzien) return false;
      tx.set(ref(), {
        dzien, stan: 'wysylanie', zarezerwowano_o: nowIso(), poprzedni_dzien: bylo.dzien ?? null,
      });
      return true;
    });
  },

  async potwierdz(dzien, { emailId = null, typ = null } = {}) {
    await ref().set({ dzien, stan: 'wyslany', wyslano_o: nowIso(), email_id: emailId, typ }, { merge: true });
  },

  /** Nieudana wysyłka — przywracamy poprzedni dzień, żeby ponowienie przebiegu dosłało alarm. */
  async zwolnij(dzien) {
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref());
      if (!doc.exists || doc.data().dzien !== dzien) return;
      tx.set(ref(), { dzien: doc.data().poprzedni_dzien ?? null, stan: 'zwolniony' }, { merge: true });
    });
  },

  async wczytaj() {
    const doc = await ref().get();
    return doc.exists ? doc.data() : null;
  },
  };
}

export const alarmAi = znacznikAlarmu(ALARM_AI_REF);
/** Alarm „źródło cicho puste" (BZP/TED bez surowych ogłoszeń w dzień roboczy, 2026-10-24). */
export const alarmZrodla = znacznikAlarmu(() => db().collection('_health').doc('alarm_zrodla'));
/** Strażnik zdrowia (2026-10-29): znacznik „ten zestaw powodów już dziś wysłany” (klucz `doba|kody`). */
export const alarmZdrowia = znacznikAlarmu(() => db().collection('_health').doc('alarm_zdrowia'));
/** Ostatni pomiar strażnika — do wykrycia powodów trwających ≥ 2 pomiary. */
export const strazZdrowia = {
  async wczytaj() {
    const doc = await db().collection('_health').doc('straz').get();
    return doc.exists ? doc.data() : null;
  },
  async zapisz(stan) {
    await db().collection('_health').doc('straz').set(stan);
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
   * Bez `orderBy` — collectionGroup z sortowaniem wymagałby indeksu złożonego.
   * Kolejność MA znaczenie (przebieg ma budżet czasu), ale ustala ją job w pamięci:
   * najdawniej sprawdzane pierwsze (`kolejnoscObslugi`, 2026-09-25).
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

// ============================ radar planów (TED planning) ============================

/*
 * Plany postępowań — wstępne ogłoszenia informacyjne z TED (`services/tedPlany.js`).
 *
 *  • `plany/{numer publikacji}` — źródło prawdy, pełna pozycja (z opisem i linkiem).
 *    Zapis przez set(): ogłoszenie planowania jest niemutowalne, powtórka tego samego
 *    numeru to ta sama treść, więc nadpisanie jest nieszkodliwe.
 *  • `radar_planow/czesc_N` — ZWARTY indeks aktywnych pozycji (`lib/indeksPlanow.js`).
 *    Ranking pod profil musi przejrzeć każdą pozycję (dopasowanie słów), a skan
 *    kolekcji przy każdym wejściu na ekran to ~2 500 odczytów na użytkownika. Indeks
 *    to kilka odczytów, a do tego pamięć podręczna instancji.
 */
const planyCol = () => db().collection('plany');
const indeksPlanowCol = () => db().collection('radar_planow');
const OKNO_PLANOW_REF = () => db().collection('_health').doc('plany_okno');

/** Pamięć podręczna indeksu w instancji — indeks zmienia się raz na dobę. */
const INDEKS_TTL_MS = 10 * 60_000;
let indeksWPamieci = null;

export const planyPostepowan = {
  /** Zapisuje partię pozycji planu z wyliczonym `wygasa_o`. Zwraca liczbę zapisanych. */
  async zapiszWiele(pozycje) {
    const wpisy = (pozycje ?? []).filter((p) => p?.id);
    for (let i = 0; i < wpisy.length; i += 400) {
      const batch = db().batch();
      for (const p of wpisy.slice(i, i + 400)) {
        batch.set(planyCol().doc(tenderDocId(p.id)), { ...p, wygasa_o: wygasaO(p), updated_at: nowIso() });
      }
      await batch.commit();
    }
    return wpisy.length;
  },

  async pobierz(id) {
    if (!id) return null;
    const doc = await planyCol().doc(tenderDocId(id)).get();
    return doc.exists ? { ...doc.data(), id: doc.data().id ?? doc.id } : null;
  },

  /**
   * Przebudowuje indeks z aktywnych pozycji (`wygasa_o >= dzisiaj`). Stare części
   * ponad nową liczbę są kasowane — inaczej wygasłe pozycje zostałyby w indeksie.
   * Części zapisujemy PRZED kasowaniem nadmiarowych, więc czytelnik w trakcie
   * przebudowy widzi najwyżej duplikat, nigdy dziury.
   */
  async przebudujIndeks({ dzisiaj }) {
    const snap = await planyCol().where('wygasa_o', '>=', dzisiaj).get();
    const wpisy = snap.docs
      .map((d) => wpisIndeksu(d.data()))
      .sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? '')));
    const czesci = podzielNaCzesci(wpisy);
    const zbudowano = nowIso();

    for (let i = 0; i < czesci.length; i++) {
      await indeksPlanowCol().doc(`czesc_${i}`).set({
        numer: i, wpisy: czesci[i], zbudowano_o: zbudowano, czesci_lacznie: czesci.length,
      });
    }
    const istniejace = await indeksPlanowCol().get();
    const nadmiarowe = istniejace.docs.filter((d) => Number(d.data().numer) >= czesci.length);
    if (nadmiarowe.length) {
      const batch = db().batch();
      for (const d of nadmiarowe) batch.delete(d.ref);
      await batch.commit();
    }
    indeksWPamieci = null;
    return { aktywnych: wpisy.length, czesci: czesci.length, zbudowano_o: zbudowano };
  },

  /** Cały indeks aktywnych pozycji: `{wpisy, zbudowano_o}`. Z pamięci instancji, gdy świeży. */
  async indeks({ swiezy = false } = {}) {
    if (!swiezy && indeksWPamieci && Date.now() - indeksWPamieci.wczytano < INDEKS_TTL_MS) {
      return indeksWPamieci.dane;
    }
    const snap = await indeksPlanowCol().get();
    const czesci = snap.docs.map((d) => d.data()).sort((a, b) => a.numer - b.numer);
    const widziane = new Set();
    const wpisy = [];
    for (const c of czesci) {
      for (const w of c.wpisy ?? []) {
        if (widziane.has(w.id)) continue; // duplikat z przebudowy w toku
        widziane.add(w.id);
        wpisy.push(w);
      }
    }
    const dane = { wpisy, zbudowano_o: czesci[0]?.zbudowano_o ?? null };
    indeksWPamieci = { dane, wczytano: Date.now() };
    return dane;
  },

  /** Tylko dla testów — pamięć instancji przeżywa między testami w jednym procesie. */
  _wyczyscPamiec() { indeksWPamieci = null; },
};

export const oknoPlanow = {
  async wczytaj() {
    const doc = await OKNO_PLANOW_REF().get();
    return doc.exists ? doc.data() : null;
  },

  /** 🚨 `mergeFields`, nie `{merge:true}` — głębokie scalanie trzymałoby stary `error`. */
  async zapiszPrzebieg(wynik) {
    await OKNO_PLANOW_REF().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

/*
 * Obserwowane pozycje planu: users/{uid}/obserwowane_plany/{planDocId}.
 * Subkolekcja, jak dopasowania: cudzej obserwacji nie da się nawet zaadresować.
 * Monitoring czyta aktywne jednym zapytaniem collection-group (indeks w
 * firestore.indexes.json, fieldOverrides: obserwowane_plany.aktywna).
 */
const obserwowaneCol = (userId) => db().collection('users').doc(userId).collection('obserwowane_plany');

export const obserwacjePlanow = {
  /**
   * Dodaje obserwację. Powtórka tego samego planu zwraca istniejącą (idempotencja
   * podwójnego kliknięcia), limit liczy się tylko przy NOWEJ.
   * @returns {Promise<{obserwacja: object|null, nowa: boolean, limit?: boolean}>}
   */
  async dodaj(userId, wpis, limit) {
    const ref = obserwowaneCol(userId).doc(tenderDocId(wpis.plan_id));
    const istnieje = await ref.get();
    if (istnieje.exists) return { obserwacja: { id: ref.id, ...istnieje.data() }, nowa: false };
    const ile = (await obserwowaneCol(userId).where('aktywna', '==', true).count().get()).data().count;
    if (ile >= limit) return { obserwacja: null, nowa: false, limit: true };
    await ref.set(wpis);
    return { obserwacja: { id: ref.id, ...wpis }, nowa: true };
  },

  async usun(userId, planId) {
    const ref = obserwowaneCol(userId).doc(tenderDocId(planId));
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  async czyObserwowany(userId, planId) {
    return (await obserwowaneCol(userId).doc(tenderDocId(planId)).get()).exists;
  },

  async lista(userId) {
    const snap = await obserwowaneCol(userId).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.utworzone_o ?? '').localeCompare(String(a.utworzone_o ?? '')));
  },

  /** Wszystkie AKTYWNE obserwacje wszystkich kont — wejście przebiegu monitoringu. */
  async aktywne() {
    const snap = await db().collectionGroup('obserwowane_plany').where('aktywna', '==', true).get();
    return snap.docs.map((d) => ({ userId: d.ref.parent.parent.id, id: d.id, ...d.data() }));
  },

  async zapiszSprawdzenie(userId, id, { aktywna, zakonczenie, znalezione, teraz }) {
    await obserwowaneCol(userId).doc(id).update({
      aktywna,
      zakonczenie: zakonczenie ?? null,
      znalezione: znalezione ?? null,
      ostatnio_sprawdzone_o: teraz,
    });
  },
};

// ============================ limit wysyłki eksportu (P2-3) ============================

/*
 * Ile razy dziennie konto może wysłać sobie eksport CSV e-mailem. To wysyłka do
 * WŁASNEGO adresu, ale każda idzie przez płatnego dostawcę poczty i nosi załącznik —
 * sufit chroni przed pętlą w kliencie i przed nadużyciem konta.
 */
const eksportLimitDoc = (userId, dzien) =>
  db().collection('users').doc(userId).collection('limity').doc(`eksport_${dzien}`);

/*
 * Dzienny limit pytań do SWZ w planie darmowym (2026-10-31). Wspólny budżet AI blokuje WSZYSTKICH,
 * gdy się wyczerpie — darmowe konta nie mogą go wyjeść płacącym. Standard i próba bez tego limitu
 * (dalej obowiązuje dobowy limit AI na Railway).
 */
const pytaniaSwzDoc = (userId, dzien) =>
  db().collection('users').doc(userId).collection('limity').doc(`pytania_swz_${dzien}`);

export const limitPytanSwz = {
  async zarezerwuj(userId, limit, dzien = nowIso().slice(0, 10)) {
    const ref = pytaniaSwzDoc(userId, dzien);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const zadane = doc.exists ? (doc.data().zadane ?? 0) : 0;
      if (zadane >= limit) return false;
      tx.set(ref, { zadane: zadane + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

/** Kontrole plików oferty dziennie (2026-10-31) — odczyt PDF-ów to CPU instancji API. */
export const limitKontroliOferty = {
  async zarezerwuj(userId, limit, dzien = nowIso().slice(0, 10)) {
    const ref = db().collection('users').doc(userId).collection('limity').doc(`kontrola_oferty_${dzien}`);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const wykonane = doc.exists ? (doc.data().wykonane ?? 0) : 0;
      if (wykonane >= limit) return false;
      tx.set(ref, { wykonane: wykonane + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

export const limitEksportu = {
  async zarezerwuj(userId, limit, dzien = nowIso().slice(0, 10)) {
    const ref = eksportLimitDoc(userId, dzien);
    return db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const wyslane = doc.exists ? (doc.data().wyslane ?? 0) : 0;
      if (wyslane >= limit) return false;
      tx.set(ref, { wyslane: wyslane + 1, updated_at: nowIso() }, { merge: true });
      return true;
    });
  },
};

/*
 * POWIĄZANIE ANALIZY SWZ Z PRZETARGIEM (audyt 2026-09-29).
 *
 * Analiza SWZ żyje na Railway (Radar SWZ), a przetarg w Firestore — i nic ich dotąd
 * nie łączyło, więc checklista „co musisz mieć do dnia składania" nigdy nie znała
 * wymagań. Powiązanie jest w zakresie UŻYTKOWNIKA (ścieżka users/{uid}/…) i PRZETARGU
 * (id dokumentu), wskazywane jawnie przez użytkownika — bez zgadywania po tytule.
 * Własność analizy sprawdza trasa przez most PRZED zapisem. Znika razem z kontem
 * (`usunKonto` → recursiveDelete).
 */
/*
 * Znaczniki automatycznej analizy SWZ (2026-10-28, jobs/autoAnalizaSwz.js). Jeden dokument na
 * (klient, przetarg): `zajmij` = create() — gdy istnieje, druga instancja/ponowienie odpada PRZED
 * płatnym AI. Usuwane razem z kontem (podkolekcja użytkownika).
 */
const autoSwzDoc = (userId, tenderId) => db().collection('users').doc(userId).collection('auto_swz').doc(String(tenderId));
const AUTO_SWZ_SLAD = () => db().collection('_health').doc('auto_swz');
export const autoSwz = {
  async pobierz(userId, tenderId) {
    const snap = await autoSwzDoc(userId, tenderId).get();
    return snap.exists ? snap.data() : null;
  },
  /** @returns {Promise<boolean>} true = zajęte przez to wywołanie */
  async zajmij(userId, tenderId, { dokument = null, teraz = nowIso() } = {}) {
    try {
      await autoSwzDoc(userId, tenderId).create({ tender_id: String(tenderId), status: 'w_toku', dokument, utworzono_o: teraz });
      return true;
    } catch (err) {
      if (err?.code === 6 || /already exists/i.test(err?.message ?? '')) return false;
      throw err;
    }
  },
  async zakoncz(userId, tenderId, { status, postepowanie_id = null, liczba_pytan = null, blad = null, naprawa_o = null, teraz = nowIso() }) {
    await autoSwzDoc(userId, tenderId).update({ status, postepowanie_id, liczba_pytan, blad: blad ? String(blad).slice(0, 300) : null, zakonczono_o: teraz, ...(naprawa_o ? { naprawa_o } : {}) });
  },
  /** Ile analiz klienta zajęto od `odIso` (dobowy limit). */
  async ileOd(userId, odIso) {
    const snap = await db().collection('users').doc(userId).collection('auto_swz').where('utworzono_o', '>=', odIso).count().get();
    return snap.data().count;
  },
  async wczytajPrzebieg() {
    const doc = await AUTO_SWZ_SLAD().get();
    return doc.exists ? doc.data() : null;
  },
  async zapiszPrzebieg(wynik) {
    await AUTO_SWZ_SLAD().set({ ostatni_przebieg: wynik }, { mergeFields: ['ostatni_przebieg'] });
  },
};

const powiazanieSwzDoc = (userId, tenderId) =>
  db().collection('users').doc(userId).collection('powiazania_swz').doc(String(tenderId));

export const powiazaniaSwz = {
  /** @returns {Promise<{tender_id: string, postepowanie_id: string, nazwa: string|null, powiazano_o: string}|null>} */
  async pobierz(userId, tenderId) {
    const snap = await powiazanieSwzDoc(userId, tenderId).get();
    if (!snap.exists) return null;
    const d = snap.data();
    return {
      tender_id: String(tenderId),
      postepowanie_id: d.postepowanie_id,
      nazwa: d.nazwa ?? null,
      powiazano_o: d.powiazano_o ?? null,
    };
  },

  async ustaw(userId, tenderId, { postepowanieId, nazwa = null }) {
    const rekord = {
      tender_id: String(tenderId),
      postepowanie_id: String(postepowanieId),
      nazwa: nazwa ?? null,
      powiazano_o: nowIso(),
    };
    await powiazanieSwzDoc(userId, tenderId).set(rekord);
    return rekord;
  },

  async usun(userId, tenderId) {
    await powiazanieSwzDoc(userId, tenderId).delete();
  },
};

/*
 * PRZYPOMNIENIE O TERMINIE PYTAŃ DO SWZ (funkcja A, 2026-09-29).
 *
 * Stan wysyłki leży na wpisie „Zapisanych" w polu `przypomnienie_pytan`
 * { termin, stan, proby, zmieniono_o, ponow_po }. `termin` (ISO terminu pytań) jest
 * kluczem idempotencji: zmiana terminu składania w źródle daje nowy termin pytań
 * i nowe — znów jedno — przypomnienie. Preferencja użytkownika to ten sam przełącznik
 * co przy terminie składania (`reminder_enabled` — „Przypomnij przed terminem").
 *
 * Stany: zarezerwowane → wyslane | ponowienie (błąd dostawcy, z limitem prób) |
 * porzucone (martwy token / wyczerpane próby) | bez_tokenu (spróbujemy znowu,
 * bo zgoda na push może przyjść jeszcze w oknie).
 */
/** Rezerwacja starsza niż to uznawana jest za osieroconą (przebieg padł w połowie). */
const PRZETERMINOWANIE_REZERWACJI_PYTAN_MS = 30 * 60_000;

export const przypomnieniaPytan = {
  /**
   * Wpisy z włączonym przypomnieniem i terminem składania w [od, doKiedy].
   * collectionGroup — indeks w firestore.indexes.json (reminder_enabled + tender_deadline).
   */
  async kandydaci({ od, doKiedy }) {
    const snap = await db().collectionGroup('saved')
      .where('reminder_enabled', '==', true)
      .where('tender_deadline', '>=', od)
      .where('tender_deadline', '<=', doKiedy)
      .get();
    return snap.docs.map((d) => ({ userId: d.ref.parent.parent.id, tenderId: d.id, ...d.data() }));
  },

  /**
   * Rezerwacja wysyłki PRZED pushem (transakcja) — dwa równoległe przebiegi joba
   * nie wyślą dwóch powiadomień o tym samym terminie.
   * @returns {Promise<{stan: 'zarezerwowane', proby: number}|{stan: 'zajete'|'wylaczone'|'brak_wpisu'}>}
   */
  async zarezerwuj(userId, tenderId, { termin, teraz }) {
    const ref = savedCol(userId).doc(tenderId);
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { stan: 'brak_wpisu' };
      const d = snap.data();
      if (d.reminder_enabled !== true) return { stan: 'wylaczone' };
      const p = d.przypomnienie_pytan?.termin === termin ? d.przypomnienie_pytan : null;
      if (p) {
        if (p.stan === 'wyslane' || p.stan === 'porzucone') return { stan: 'zajete' };
        if (p.stan === 'zarezerwowane'
          && Date.parse(teraz) - Date.parse(p.zmieniono_o) < PRZETERMINOWANIE_REZERWACJI_PYTAN_MS) {
          return { stan: 'zajete' };
        }
        if (p.stan === 'ponowienie' && p.ponow_po && p.ponow_po > teraz) return { stan: 'zajete' };
      }
      const proby = p?.proby ?? 0;
      tx.update(ref, {
        przypomnienie_pytan: { termin, stan: 'zarezerwowane', proby, zmieniono_o: teraz, ponow_po: null },
      });
      return { stan: 'zarezerwowane', proby };
    });
  },

  /** Wynik wysyłki — zapisuje się tylko na WŁASNĄ rezerwację (ten sam termin i stan). */
  async zakoncz(userId, tenderId, { termin, teraz, stan, proby, ponowPo = null }) {
    const ref = savedCol(userId).doc(tenderId);
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const p = snap.exists ? snap.data().przypomnienie_pytan : null;
      if (!p || p.termin !== termin || p.stan !== 'zarezerwowane') return false;
      tx.update(ref, { przypomnienie_pytan: { termin, stan, proby, zmieniono_o: teraz, ponow_po: ponowPo } });
      return true;
    });
  },
};
