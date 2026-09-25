/**
 * Rdzeń „czarnej skrzynki" składania oferty (ulepszenie „Czarna skrzynka składania
 * oferty — dowody na awarię platformy", podzadanie 1/7).
 *
 * Działa jak REJESTRATOR LOTU: dla jednej próby złożenia oferty prowadzi sesję i
 * UTRWALA DOWODY, które muszą obronić się przed KIO (ciężar udowodnienia awarii
 * platformy spoczywa na wykonawcy). Utrwala:
 *  • append-only LOG zdarzeń ze znacznikiem czasu z zegara SERWERA + strefą
 *    (`dopiszZdarzenie`) — dowodu nie wolno „poprawić" po fakcie,
 *  • ZRZUTY ekranu zapisywane w oryginale, bez modyfikacji (`zapiszZrzut`),
 *  • SUMĘ KONTROLNĄ pliku oferty (SHA-256) + oryginał oferty bez modyfikacji
 *    (`hashPliku` liczy sumę, `zapiszOferte` utrwala oryginał i sumę na sesji).
 *
 * Fabryka `createCzarnaSkrzynka(db, { magazynPlikow, zegar })` ze WSTRZYKNIĘTYM
 * połączeniem SQLite — jak `db/podprogoweRepo.js` / `services/sejfDokumentow.js`;
 * świadomie NIE dopisujemy do współdzielonego `db/repos.js`, który w drzewie
 * roboczym ma cudzy WIP.
 *
 * IZOLACJA PO user_id: sesja należy do użytkownika. Metody operujące na sesji
 * przyjmują `userId` jako pierwszy argument (spójnie z sejfDokumentow) i odmawiają
 * dostępu do cudzej sesji — dowód jednego wykonawcy nie może być czytany ani
 * uzupełniany przez innego. (Sygnatury z opisu podzadania są szkicem; scope po
 * user_id jest wymogiem wartości dowodowej, więc userId jest jawny.)
 */

import crypto from 'node:crypto';
import path from 'node:path';

import { newId, nowIso } from '../lib/ids.js';
import { katalogWolumenu, nazwaPliku as nazwaPublicznaPliku, utworzMagazynNaDysku } from '../lib/magazynPlikow.js';

// ─────────────────────────── Suma kontrolna (SHA-256) ───────────────────────

function naBufor(bajty) {
  if (Buffer.isBuffer(bajty)) return bajty;
  if (bajty instanceof Uint8Array) return Buffer.from(bajty);
  return Buffer.from(String(bajty ?? ''), 'utf8');
}

/**
 * SHA-256 (hex) surowych bajtów pliku oferty. Funkcja CZYSTA — używana też przez
 * `zapiszOferte` i router (upload base64). Bufor/Uint8Array liczone 1:1; string
 * traktowany jako treść UTF-8 (NIE base64 — dekodowanie base64 robi warstwa wyżej).
 * @param {Buffer|Uint8Array|string} bajty
 * @returns {string} 64-znakowy skrót heksadecymalny
 */
export function hashPliku(bajty) {
  return crypto.createHash('sha256').update(naBufor(bajty)).digest('hex');
}

// ─────────────────────────── Base64 / detekcja formatu ──────────────────────

// Mapa MIME → rozszerzenie zapisywanego oryginału (dla data-URL zrzutów/plików).
const MIME_NA_FORMAT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

/**
 * Dekoduje base64 (z opcjonalnym prefiksem data-URL) na surowe bajty + wykryty MIME.
 * @param {string|Buffer|Uint8Array} dane
 * @returns {{buf: Buffer, mime: string|null}}
 */
function dekodujBase64(dane) {
  if (Buffer.isBuffer(dane) || dane instanceof Uint8Array) return { buf: Buffer.from(dane), mime: null };
  const s = String(dane ?? '');
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(s);
  if (m) {
    const czysta = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3]), 'utf8').toString('base64');
    return { buf: Buffer.from(czysta, 'base64'), mime: m[1] || null };
  }
  return { buf: Buffer.from(s, 'base64'), mime: null };
}

// ─────────────────────────── Magazyn oryginałów plików ──────────────────────

/**
 * Domyślny magazyn na dysku: zapisuje SUROWE bajty oryginału bez modyfikacji.
 * Katalog z `CZARNA_SKRZYNKA_STORAGE_DIR`, domyślnie `<katalog bazy>/czarna-skrzynka` —
 * na TRWAŁYM wolumenie (2026-09-25: wcześniej `process.cwd()/data/...` = nietrwałe `/app`
 * na Railway; dowody awarii znikały przy każdym deployu). Szczegóły w lib/magazynPlikow.js.
 */
export function magazynNaDysku(
  katalog = process.env.CZARNA_SKRZYNKA_STORAGE_DIR || path.join(katalogWolumenu(), 'czarna-skrzynka'),
) {
  return utworzMagazynNaDysku(katalog);
}

/*
 * Publiczna postać wierszy (2026-09-25): klient dostaje NAZWĘ pliku, nigdy ścieżkę na
 * serwerze. Surowe wiersze (z kluczem magazynu) zostają wewnątrz usługi.
 */
function publicznaSesja(row) {
  return row ? { ...row, plik_oferty_url: nazwaPublicznaPliku(row.plik_oferty_url) } : row;
}
function publiczneZdarzenie(row) {
  return row ? { ...row, plik_url: nazwaPublicznaPliku(row.plik_url) } : row;
}

// ─────────────────────────── Zegar serwera (wstrzykiwalny) ───────────────────

/** Strefa czasowa zegara serwera (IANA, np. 'Europe/Warsaw'); fallback 'UTC'. */
function domyslnaStrefa() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const ZEGAR_DOMYSLNY = { teraz: nowIso, strefa: domyslnaStrefa };

// ─────────────────────────── Okno życia sesji (TTL) ─────────────────────────

/*
 * 2026-09-25: sesja bez wgranej oferty była „otwarta" NA ZAWSZE — monitor dostępności
 * pingował ją co 15 min bez końca (log rósł w nieskończoność), a użytkownik mógł otworzyć
 * dowolnie wiele sesji. Okno pingowania kończy się po 48 h od utworzenia albo z terminem
 * składania ofert (jeśli znany), co nastąpi wcześniej — po terminie pomiar niczego już nie
 * dowodzi. Wygasłej sesji NIE kasujemy (to dowód), tylko przestajemy ją pingować i liczyć.
 */

/** Maks. czas pingowania sesji od jej utworzenia. */
export const TTL_SESJI_MS = 48 * 60 * 60 * 1000;

/** Ile jednocześnie otwartych (niewygasłych, bez oferty) sesji może mieć użytkownik. */
export const LIMIT_OTWARTYCH_SESJI = 5;

/** Koniec okna pingowania sesji (ms epoki): min(utworzenie + 48 h, termin składania). */
export function koniecOknaSesji(row) {
  const odUtworzenia = Date.parse(row.created_at) + TTL_SESJI_MS;
  const termin = row.termin_skladania ? Date.parse(row.termin_skladania) : NaN;
  return Number.isFinite(termin) ? Math.min(odUtworzenia, termin) : odUtworzenia;
}

/** Sesja w toku: oferta niezłożona i okno pingowania jeszcze trwa. */
function sesjaOtwarta(row, terazMs) {
  return !row.hash_oferty && terazMs < koniecOknaSesji(row);
}

// ─────────────────────────── Warstwa danych (fabryka) ───────────────────────

function lazy(db, sql) {
  let stmt = null;
  return () => (stmt ||= db.prepare(sql));
}

/**
 * Tworzy usługę czarnej skrzynki na podanym połączeniu SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{magazynPlikow?: {zapisz: Function, czytaj?: Function},
 *          zegar?: {teraz: () => string, strefa: () => string}}} [opts]
 */
export function createCzarnaSkrzynka(db, { magazynPlikow = magazynNaDysku(), zegar = ZEGAR_DOMYSLNY } = {}) {
  const _insertSesja = lazy(db, `
    INSERT INTO czarna_skrzynka_sesja
      (id, user_id, postepowanie_id, strefa_czasowa, hash_oferty, plik_oferty_url, created_at, updated_at, termin_skladania)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`);
  const _sesjaById = lazy(db, `SELECT * FROM czarna_skrzynka_sesja WHERE id = ?`);
  const _updateOferta = lazy(db, `
    UPDATE czarna_skrzynka_sesja
       SET hash_oferty = ?, plik_oferty_url = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`);
  const _insertZdarzenie = lazy(db, `
    INSERT INTO czarna_skrzynka_zdarzenie (sesja_id, typ, opis, plik_url, plik_sha256, czas_serwera, strefa_czasowa)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const _zdarzenieById = lazy(db, `SELECT * FROM czarna_skrzynka_zdarzenie WHERE id = ?`);
  const _zdarzeniaBySesja = lazy(db, `
    SELECT * FROM czarna_skrzynka_zdarzenie WHERE sesja_id = ? ORDER BY id ASC`);
  // Kandydaci z ostatnich 48 h (ISO 8601 porównuje się leksykograficznie); termin składania
  // dofiltrowujemy w JS (`sesjaOtwarta`), żeby reguła okna była w jednym miejscu.
  const _sesjeOtwarte = lazy(db, `
    SELECT * FROM czarna_skrzynka_sesja
     WHERE hash_oferty IS NULL AND created_at > ?
     ORDER BY created_at ASC, id ASC`);
  const _sesjeOtwarteUsera = lazy(db, `
    SELECT * FROM czarna_skrzynka_sesja
     WHERE user_id = ? AND hash_oferty IS NULL AND created_at > ?`);

  /** Chwila „teraz" z zegara serwera (ms) i granica 48 h wstecz (ISO). */
  function terazIGranica() {
    const terazMs = Date.parse(zegar.teraz());
    return { terazMs, granica: new Date(terazMs - TTL_SESJI_MS).toISOString() };
  }

  /** Surowy wiersz sesji przypisany do właściciela (albo null). */
  function wierszSesji(userId, sesjaId) {
    const row = _sesjaById().get(sesjaId);
    return row && row.user_id === userId ? row : null;
  }

  /** Sesja, do której MUSI mieć dostęp `userId` — inaczej błąd (izolacja). */
  function wymagajSesji(userId, sesjaId) {
    const row = wierszSesji(userId, sesjaId);
    if (!row) throw new Error('Sesja nie istnieje albo należy do innego użytkownika');
    return row;
  }

  /**
   * Rozpoczyna sesję rejestratora lotu dla jednej próby złożenia oferty.
   * @param {string} userId
   * @param {{postepowanieId?: string|null, terminSkladania?: string|null}} [opts]
   *   terminSkladania — ISO 8601; skraca okno pingowania (patrz `koniecOknaSesji`).
   * @throws {Error & {code: 'LIMIT_SESJI'}} gdy użytkownik ma już LIMIT_OTWARTYCH_SESJI otwartych
   */
  function rozpocznijSesje(userId, { postepowanieId = null, terminSkladania = null } = {}) {
    const { terazMs, granica } = terazIGranica();
    const otwarte = _sesjeOtwarteUsera().all(userId, granica).filter((r) => sesjaOtwarta(r, terazMs));
    if (otwarte.length >= LIMIT_OTWARTYCH_SESJI) {
      const err = new Error(
        `Masz już ${LIMIT_OTWARTYCH_SESJI} otwartych sesji rejestratora — wgraj ofertę w jednej z nich `
        + 'albo poczekaj, aż wygaśnie (48 h od rozpoczęcia lub termin składania ofert).',
      );
      err.code = 'LIMIT_SESJI';
      throw err;
    }
    const id = newId();
    const ts = zegar.teraz();
    _insertSesja().run(id, userId, postepowanieId ?? null, zegar.strefa(), ts, ts, terminSkladania ?? null);
    return sesja(userId, id);
  }

  /** Sesja właściciela (postać publiczna — bez ścieżki serwera), albo null gdy nie jego / nie istnieje. */
  function sesja(userId, sesjaId) {
    return publicznaSesja(wierszSesji(userId, sesjaId));
  }

  /** Append-only taśma sesji w kolejności dopisywania; null gdy sesja nie jest jego. */
  function zdarzenia(userId, sesjaId) {
    if (!wierszSesji(userId, sesjaId)) return null;
    return _zdarzeniaBySesja().all(sesjaId).map(publiczneZdarzenie);
  }

  /**
   * Wstawia wpis do append-only logu i zwraca utrwalony wiersz (postać publiczna).
   * `plikSha256` — suma pliku policzona W CHWILI ZAPISU (2026-09-25): bez niej zrzut w
   * pakiecie był tylko nazwą pliku, którą dało się podmienić bez śladu.
   */
  function wstawZdarzenie(sesjaId, { typ, opis = null, plikUrl = null, plikSha256 = null }) {
    const info = _insertZdarzenie().run(sesjaId, typ, opis, plikUrl, plikSha256, zegar.teraz(), zegar.strefa());
    const rowid = typeof info.lastInsertRowid === 'bigint'
      ? Number(info.lastInsertRowid)
      : info.lastInsertRowid;
    return publiczneZdarzenie(_zdarzenieById().get(rowid));
  }

  /**
   * Dopisuje zdarzenie do append-only logu sesji ze znacznikiem czasu z zegara
   * serwera i strefą. Brak drogi do edycji/usunięcia wpisu — log jest niezmienny.
   */
  function dopiszZdarzenie(userId, sesjaId, { typ, opis = null } = {}) {
    wymagajSesji(userId, sesjaId);
    if (!typ || !String(typ).trim()) throw new Error('Zdarzenie wymaga typu');
    return wstawZdarzenie(sesjaId, { typ, opis });
  }

  /**
   * Zapisuje zrzut ekranu (base64 / data-URL) jako ORYGINAŁ bez modyfikacji i
   * dokłada wpis typu 'zrzut' do taśmy (ze znacznikiem czasu serwera i strefą —
   * to jest „widoczny czas" dowodu).
   */
  async function zapiszZrzut(userId, sesjaId, plikBase64, { opis = 'Zrzut ekranu' } = {}) {
    wymagajSesji(userId, sesjaId);
    const { buf, mime } = dekodujBase64(plikBase64);
    const format = MIME_NA_FORMAT[mime] || 'png';
    const plikUrl = await magazynPlikow.zapisz(newId(), format, buf); // oryginał 1:1
    return wstawZdarzenie(sesjaId, { typ: 'zrzut', opis, plikUrl, plikSha256: hashPliku(buf) });
  }

  /**
   * Utrwala plik oferty: liczy SHA-256, zapisuje ORYGINAŁ bez modyfikacji, zapina
   * sumę i lokalizację oryginału na sesji oraz dokłada wpis 'hash_oferty' do taśmy.
   * @returns {Promise<{hash: string, plikUrl: string, sesja: object}>}
   */
  async function zapiszOferte(userId, sesjaId, plik, { nazwaPliku = '' } = {}) {
    wymagajSesji(userId, sesjaId);
    const { buf, mime } = dekodujBase64(plik);
    const hash = hashPliku(buf);
    const format = MIME_NA_FORMAT[mime]
      || (String(nazwaPliku).toLowerCase().endsWith('.xml') ? 'xml'
        : String(nazwaPliku).toLowerCase().endsWith('.pdf') ? 'pdf' : 'bin');
    const plikUrl = await magazynPlikow.zapisz(newId(), format, buf); // oryginał 1:1
    _updateOferta().run(hash, plikUrl, zegar.teraz(), sesjaId, userId);
    // Wpis na taśmie wskazuje KONKRETNY oryginał i jego sumę: przy ponownym wgraniu oferty
    // poprzednia wersja zostaje w logu razem ze swoim plikiem (dowodu nie nadpisujemy).
    wstawZdarzenie(sesjaId, { typ: 'hash_oferty', opis: `SHA-256 oferty: ${hash}`, plikUrl, plikSha256: hash });
    return { hash, plikUrl: nazwaPublicznaPliku(plikUrl), sesja: sesja(userId, sesjaId) };
  }

  /**
   * Otwarte sesje WSZYSTKICH użytkowników — próby złożenia oferty jeszcze w toku
   * (oferta niezłożona: `hash_oferty IS NULL`) i wciąż w oknie pingowania (TTL 48 h /
   * termin składania — 2026-09-25). Tylko w nich monitor dostępności platformy (job 2/7)
   * utrwala wynik pingu. Zapytanie systemowe (bez izolacji po user_id) — wołane wyłącznie
   * przez scheduler, nie z żądania.
   */
  function sesjeOtwarte() {
    const { terazMs, granica } = terazIGranica();
    return _sesjeOtwarte().all(granica).filter((r) => sesjaOtwarta(r, terazMs));
  }

  /**
   * Utrwala wynik cyklicznego sprawdzenia dostępności platformy jako wpis 'ping' w
   * append-only logu sesji (dowód (nie)dostępności ze znacznikiem czasu serwera + strefą).
   * Operacja SYSTEMOWA (monitor pinguje dla właściciela) — bez userId; nie czyta ani nie
   * modyfikuje danych innego użytkownika, tylko DOKŁADA wpis do wskazanej sesji.
   * @param {string} sesjaId
   * @param {{url?: string, kodHttp?: number|null, czasMs?: number|null, dostepna?: boolean}} wynik
   */
  function zapiszPing(sesjaId, { url = '', kodHttp = null, czasMs = null, dostepna = false } = {}) {
    if (!_sesjaById().get(sesjaId)) throw new Error('Sesja nie istnieje');
    const kod = kodHttp == null ? 'brak odpowiedzi' : `HTTP ${kodHttp}`;
    const opis = `Ping ${url}: ${kod}, czas odpowiedzi ${czasMs} ms — platforma `
      + `${dostepna ? 'dostępna' : 'NIEDOSTĘPNA'}`;
    return wstawZdarzenie(sesjaId, { typ: 'ping', opis });
  }

  return {
    rozpocznijSesje,
    sesja,
    zdarzenia,
    dopiszZdarzenie,
    zapiszZrzut,
    zapiszOferte,
    sesjeOtwarte,
    zapiszPing,
    hashPliku,
  };
}
