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
import fs from 'node:fs';
import path from 'node:path';

import { newId, nowIso } from '../lib/ids.js';

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
 * Katalog z `CZARNA_SKRZYNKA_STORAGE_DIR` (czytany lokalnie z process.env, żeby to
 * podzadanie nie mieszało się z niezależnym WIP w config/env.js), domyślnie
 * `data/czarna-skrzynka`.
 */
export function magazynNaDysku(
  katalog = process.env.CZARNA_SKRZYNKA_STORAGE_DIR || path.join(process.cwd(), 'data', 'czarna-skrzynka'),
) {
  return {
    async zapisz(id, format, bajty) {
      fs.mkdirSync(katalog, { recursive: true });
      const sciezka = path.join(katalog, `${id}.${format}`);
      fs.writeFileSync(sciezka, naBufor(bajty)); // oryginał 1:1, bez żadnej obróbki
      return sciezka;
    },
    async czytaj(id, format) {
      return fs.readFileSync(path.join(katalog, `${id}.${format}`));
    },
  };
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
      (id, user_id, postepowanie_id, strefa_czasowa, hash_oferty, plik_oferty_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`);
  const _sesjaById = lazy(db, `SELECT * FROM czarna_skrzynka_sesja WHERE id = ?`);
  const _updateOferta = lazy(db, `
    UPDATE czarna_skrzynka_sesja
       SET hash_oferty = ?, plik_oferty_url = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`);
  const _insertZdarzenie = lazy(db, `
    INSERT INTO czarna_skrzynka_zdarzenie (sesja_id, typ, opis, plik_url, czas_serwera, strefa_czasowa)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const _zdarzenieById = lazy(db, `SELECT * FROM czarna_skrzynka_zdarzenie WHERE id = ?`);
  const _zdarzeniaBySesja = lazy(db, `
    SELECT * FROM czarna_skrzynka_zdarzenie WHERE sesja_id = ? ORDER BY id ASC`);

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

  /** Rozpoczyna sesję rejestratora lotu dla jednej próby złożenia oferty. */
  function rozpocznijSesje(userId, { postepowanieId = null } = {}) {
    const id = newId();
    const ts = zegar.teraz();
    _insertSesja().run(id, userId, postepowanieId ?? null, zegar.strefa(), ts, ts);
    return sesja(userId, id);
  }

  /** Sesja właściciela (wzbogacona), albo null gdy nie jego / nie istnieje. */
  function sesja(userId, sesjaId) {
    return wierszSesji(userId, sesjaId);
  }

  /** Append-only taśma sesji w kolejności dopisywania; null gdy sesja nie jest jego. */
  function zdarzenia(userId, sesjaId) {
    if (!wierszSesji(userId, sesjaId)) return null;
    return _zdarzeniaBySesja().all(sesjaId);
  }

  /** Wstawia wpis do append-only logu i zwraca utrwalony wiersz. */
  function wstawZdarzenie(sesjaId, { typ, opis = null, plikUrl = null }) {
    const info = _insertZdarzenie().run(sesjaId, typ, opis, plikUrl, zegar.teraz(), zegar.strefa());
    const rowid = typeof info.lastInsertRowid === 'bigint'
      ? Number(info.lastInsertRowid)
      : info.lastInsertRowid;
    return _zdarzenieById().get(rowid);
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
    return wstawZdarzenie(sesjaId, { typ: 'zrzut', opis, plikUrl });
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
    wstawZdarzenie(sesjaId, { typ: 'hash_oferty', opis: `SHA-256 oferty: ${hash}` });
    return { hash, plikUrl, sesja: sesja(userId, sesjaId) };
  }

  return {
    rozpocznijSesje,
    sesja,
    zdarzenia,
    dopiszZdarzenie,
    zapiszZrzut,
    zapiszOferte,
    hashPliku,
  };
}
