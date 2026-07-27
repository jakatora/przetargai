/**
 * Usługa sejfu dokumentów firmy + oryginały plików (ulepszenie „Sejf podmiotowych
 * środków dowodowych z licznikiem świeżości", podzadanie 3/7).
 *
 * Spina trzy rzeczy:
 *  • CRUD na tabeli `sejf_dokumenty` (fabryka `createSejfDokumentow(db)` ze
 *    WSTRZYKNIĘTYM połączeniem — jak `db/podprogoweRepo.js`; świadomie NIE dopisujemy
 *    do współdzielonego `db/repos.js`, który w drzewie roboczym ma cudzy WIP),
 *  • WYLICZANIE STATUSU świeżości przez czyste funkcje z podzadania 2
 *    (`waznoscDokumentow.js`), z parametrami (okres ważności, realny czas urzędu)
 *    branymi z katalogu typów (`config/dokumentyKatalog.js`),
 *  • ZAPIS ORYGINALNEGO PLIKU bez żadnej modyfikacji + DETEKCJĘ, czy to naprawdę
 *    dokument elektroniczny (XML z podpisem XAdES / cyfrowo podpisany PDF), czy tylko
 *    SKAN PAPIERU — wtedy `flaga_podpis_elektroniczny = false` i ostrzeżenie, żeby nie
 *    wgrać skanu zamiast oryginału (w zamówieniach publicznych to realny błąd).
 *
 * Detekcja idzie po TREŚCI (magic bytes + markery podpisu), nie po rozszerzeniu —
 * rozszerzenie bywa mylące, a plik od e-KRK/PUE ZUS/e-US to konkretny format.
 */

import fs from 'node:fs';
import path from 'node:path';

import { newId, nowIso } from '../lib/ids.js';
import {
  typDokumentu,
  jestZnanymTypem,
} from '../config/dokumentyKatalog.js';
import {
  STATUS,
  dataWaznosci,
  dniDoWaznosci,
  statusDokumentu,
} from './waznoscDokumentow.js';

// ─────────────────────────── Detekcja formatu i podpisu ─────────────────────

// Markery obecności podpisu elektronicznego w XML (XML-DSig / XAdES).
const MARKERY_PODPIS_XML = ['Signature', 'SignatureValue', 'XAdES', 'xmldsig', 'X509Certificate'];
// Markery cyfrowego podpisu w PDF (słownik /Sig, PAdES/CAdES, ByteRange podpisu).
const MARKERY_PODPIS_PDF = [
  'ByteRange', 'Adobe.PPKLite', 'adbe.pkcs7', 'ETSI.CAdES', 'ETSI.RFC3161',
  '/Type/Sig', '/Type /Sig', '/SubFilter',
];
// Markery „obrazu w PDF" — sygnał, że to zeskanowana kartka, a nie dokument elektroniczny.
const MARKERY_OBRAZ_PDF = [
  '/DCTDecode', '/JPXDecode', '/CCITTFaxDecode', '/JBIG2Decode',
  '/Subtype/Image', '/Subtype /Image',
];

/** Czy bufor (od offsetu `i`) zaczyna się od magicznych bajtów pliku graficznego. */
function jestObrazem(buf, i = 0) {
  // JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46 38), TIFF (II*\0 / MM\0*)
  if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) return true;
  if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) return true;
  if (buf[i] === 0x47 && buf[i + 1] === 0x49 && buf[i + 2] === 0x46 && buf[i + 3] === 0x38) return true;
  if (buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a && buf[i + 3] === 0x00) return true;
  if (buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 2] === 0x00 && buf[i + 3] === 0x2a) return true;
  return false;
}

/** Przesunięcie pierwszego znaczącego bajtu — pomija UTF-8 BOM i białe znaki. */
function poczatekTresci(buf) {
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  return i;
}

function naBufor(bajty) {
  if (Buffer.isBuffer(bajty)) return bajty;
  if (bajty instanceof Uint8Array) return Buffer.from(bajty);
  return Buffer.from(String(bajty ?? ''), 'utf8');
}

/**
 * Rozpoznaje format oryginału i to, czy jest to dokument elektroniczny z podpisem,
 * czy skan papieru. TREŚĆ (magic bytes) ma pierwszeństwo przed rozszerzeniem pliku.
 *
 * @param {Buffer|Uint8Array|string} bajty zawartość pliku
 * @param {string} [nazwaPliku] nazwa (używana TYLKO jako ostatnia deska ratunku)
 * @returns {{format: 'xml'|'pdf'|null, podpisElektroniczny: boolean,
 *            jestSkanem: boolean, powod: string}}
 *   format=null → treść nie jest oryginałem elektronicznym XML/PDF (np. sam obraz).
 */
export function wykryjFormatIPodpis(bajty, nazwaPliku = '') {
  const buf = naBufor(bajty);
  const tekst = buf.toString('latin1'); // latin1 = 1:1 bajty, nie psuje markerów ASCII
  const i = poczatekTresci(buf);
  const naglowek = buf.subarray(i, i + 8).toString('latin1');
  const rozszerzenie = String(nazwaPliku).toLowerCase().split('.').pop();

  let format = null;
  if (naglowek.startsWith('%PDF-')) {
    format = 'pdf';
  } else if (naglowek.startsWith('<?xml') || naglowek.startsWith('<')) {
    format = 'xml';
  } else if (jestObrazem(buf, i)) {
    format = null; // surowy obraz — nie jest dokumentem elektronicznym
  } else if (rozszerzenie === 'xml' || rozszerzenie === 'pdf') {
    format = rozszerzenie; // treść nierozstrzygająca — ufamy rozszerzeniu (ostrożnie)
  }

  let podpisElektroniczny = false;
  let jestSkanem = false;
  let powod;

  if (format === 'xml') {
    podpisElektroniczny = MARKERY_PODPIS_XML.some((m) => tekst.includes(m));
    powod = podpisElektroniczny
      ? 'XML z podpisem elektronicznym (XML-DSig/XAdES).'
      : 'XML bez wykrytego podpisu elektronicznego.';
  } else if (format === 'pdf') {
    podpisElektroniczny = MARKERY_PODPIS_PDF.some((m) => tekst.includes(m));
    const maObraz = MARKERY_OBRAZ_PDF.some((m) => tekst.includes(m));
    jestSkanem = maObraz && !podpisElektroniczny;
    if (podpisElektroniczny) powod = 'PDF z podpisem elektronicznym (PAdES/CAdES).';
    else if (jestSkanem) powod = 'PDF wygląda na skan papieru (obraz), bez podpisu elektronicznego.';
    else powod = 'PDF bez wykrytego podpisu elektronicznego.';
  } else {
    jestSkanem = jestObrazem(buf, i);
    powod = jestSkanem
      ? 'Plik graficzny (skan/zdjęcie) — nie jest oryginałem elektronicznym XML/PDF.'
      : 'Nierozpoznany format — akceptujemy tylko oryginał elektroniczny XML/PDF.';
  }

  return { format, podpisElektroniczny, jestSkanem, powod };
}

// ─────────────────────────── Wyliczanie statusu ─────────────────────────────

/** Dzisiejsza data ISO 'YYYY-MM-DD' (używana, gdy wołający nie poda dnia odniesienia). */
function dzienDzis() {
  return nowIso().slice(0, 10);
}

/**
 * Wzbogaca surowy wiersz `sejf_dokumenty` o dane z katalogu i licznik świeżości:
 * datę ważności, dni do ważności i status. Funkcja CZYSTA (bez DB) — `dzienOdniesienia`
 * jest wstrzykiwany, więc tego samego wzbogacenia użyje krok 5/7 (dopasowanie do SWZ)
 * z przewidywanym dniem złożenia oferty.
 *
 * Rozwiązanie okresu ważności: `okres_waznosci_dni` z rekordu, a gdy NULL — domyślny
 * z katalogu. Dla typów bezterminowych (katalog = null) dokument jest zawsze „gotowy".
 *
 * @param {object} row wiersz z `sejf_dokumenty`
 * @param {{dzienOdniesienia?: string}} [opts]
 */
export function opiszDokument(row, { dzienOdniesienia } = {}) {
  const typ = typDokumentu(row.typ_dokumentu);
  const okres = row.okres_waznosci_dni ?? typ?.okresWaznosciDniDomyslny ?? null;
  const czasUrzedu = typ?.czasOczekiwaniaUrzadDni ?? 0;
  const dzien = dzienOdniesienia ?? dzienDzis();

  let wazDo = null;
  let dni = null;
  let status = null;

  if (okres === null) {
    // Bezterminowy — licznik świeżości go nie tyka, niezależnie od daty wystawienia.
    dni = Infinity;
    status = STATUS.GOTOWY;
  } else if (row.data_wystawienia) {
    wazDo = dataWaznosci(row.data_wystawienia, okres);
    dni = dniDoWaznosci(row.data_wystawienia, okres, dzien);
    status = statusDokumentu({
      dataWystawienia: row.data_wystawienia,
      okresWaznosciDni: okres,
      czasOczekiwaniaUrzadDni: czasUrzedu,
      dzienOdniesienia: dzien,
    });
  }
  // else: dokument terminowy bez daty wystawienia → status nieznany (null); UI poprosi o datę.

  return {
    ...row,
    flaga_podpis_elektroniczny: !!row.flaga_podpis_elektroniczny,
    okresWaznosciDni: okres,
    czasOczekiwaniaUrzadDni: czasUrzedu,
    nazwaTypu: typ?.nazwa ?? row.typ_dokumentu,
    wymagaDokumentuElektronicznego: typ?.wymagaDokumentuElektronicznego ?? false,
    online: typ?.online ?? null,
    dataWaznosci: wazDo,
    dniDoWaznosci: dni,
    status,
  };
}

// ─────────────────────────── Magazyn oryginałów plików ──────────────────────

/**
 * Domyślny magazyn na dysku: zapisuje SUROWE bajty oryginału bez modyfikacji.
 * Katalog z `SEJF_STORAGE_DIR` (czytany lokalnie z process.env, żeby to podzadanie
 * nie mieszało się z niezależnym WIP w config/env.js), domyślnie `data/sejf`.
 */
export function magazynNaDysku(
  katalog = process.env.SEJF_STORAGE_DIR || path.join(process.cwd(), 'data', 'sejf'),
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

// ─────────────────────────── Warstwa danych (fabryka) ───────────────────────

function lazy(db, sql) {
  let stmt = null;
  return () => (stmt ||= db.prepare(sql));
}

// Kolumny, które wolno zmienić przez `aktualizuj` (klucz API → kolumna DB).
const POLA_EDYTOWALNE = {
  typ: 'typ_dokumentu',
  dataWystawienia: 'data_wystawienia',
  okresWaznosciDni: 'okres_waznosci_dni',
  notatka: 'notatka',
};

/**
 * Tworzy usługę sejfu dokumentów na podanym połączeniu SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{magazynPlikow?: {zapisz: Function, czytaj?: Function}}} [opts]
 *   magazynPlikow — wstrzykiwalny magazyn oryginałów (test bez dysku); domyślnie dysk.
 */
export function createSejfDokumentow(db, { magazynPlikow = magazynNaDysku() } = {}) {
  const _insert = lazy(db, `
    INSERT INTO sejf_dokumenty (
      id, user_id, typ_dokumentu, data_wystawienia, okres_waznosci_dni,
      plik_url, plik_format, flaga_podpis_elektroniczny, notatka, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const _byId = lazy(db, `SELECT * FROM sejf_dokumenty WHERE id = ?`);
  const _byUser = lazy(db, `
    SELECT * FROM sejf_dokumenty WHERE user_id = ?
    ORDER BY COALESCE(data_wystawienia, created_at) DESC, created_at DESC`);
  // Skan WSZYSTKICH userów — dla cyklicznego monitora (podzadanie 6/7), grupując po
  // właścicielu (jak `preferencjeRadaruRepo.listAll` w monitorze podprogowym).
  const _wszystkie = lazy(db, `
    SELECT * FROM sejf_dokumenty
    ORDER BY user_id ASC, COALESCE(data_wystawienia, created_at) DESC, created_at DESC`);
  const _delete = lazy(db, `DELETE FROM sejf_dokumenty WHERE id = ? AND user_id = ?`);
  const _setPlik = lazy(db, `
    UPDATE sejf_dokumenty
       SET plik_url = ?, plik_format = ?, flaga_podpis_elektroniczny = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`);

  /** Surowy wiersz przypisany do właściciela (albo null). */
  function wierszWlasciciela(userId, id) {
    const row = _byId().get(id);
    return row && row.user_id === userId ? row : null;
  }

  function pobierz(userId, id, opts = {}) {
    const row = wierszWlasciciela(userId, id);
    return row ? opiszDokument(row, opts) : null;
  }

  function utworz(userId, { typ, dataWystawienia = null, okresWaznosciDni, notatka = null } = {}) {
    if (!jestZnanymTypem(typ)) {
      throw new Error(`Nieznany typ dokumentu: ${typ}`);
    }
    const id = newId();
    const ts = nowIso();
    _insert().run(
      id,
      userId,
      typ,
      dataWystawienia ?? null,
      // NULL = „użyj domyślnego z katalogu" (rozwiązywane w opiszDokument); liczba = nadpisanie.
      okresWaznosciDni ?? null,
      null, // plik_url — dopiero po uploadzie
      null, // plik_format
      0,    // flaga_podpis_elektroniczny — zapala się dopiero po detekcji pliku
      notatka ?? null,
      ts,
      ts,
    );
    return pobierz(userId, id);
  }

  function aktualizuj(userId, id, zmiany = {}) {
    const row = wierszWlasciciela(userId, id);
    if (!row) return null;
    if ('typ' in zmiany && !jestZnanymTypem(zmiany.typ)) {
      throw new Error(`Nieznany typ dokumentu: ${zmiany.typ}`);
    }
    const sety = [];
    const params = [];
    for (const [klucz, kolumna] of Object.entries(POLA_EDYTOWALNE)) {
      if (klucz in zmiany) {
        sety.push(`${kolumna} = ?`);
        params.push(zmiany[klucz] ?? null);
      }
    }
    if (sety.length === 0) return pobierz(userId, id); // nic do zmiany
    sety.push('updated_at = ?');
    params.push(nowIso(), id, userId);
    db.prepare(`UPDATE sejf_dokumenty SET ${sety.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    return pobierz(userId, id);
  }

  function usun(userId, id) {
    return _delete().run(id, userId).changes > 0;
  }

  function lista(userId, opts = {}) {
    return _byUser().all(userId).map((row) => opiszDokument(row, opts));
  }

  /**
   * Dokumenty WSZYSTKICH użytkowników, wzbogacone licznikiem świeżości (status/dni).
   * Dla cyklicznego monitora przypomnień (jobs/monitorSejf.js) — przelot po całej
   * bazie. `dzienOdniesienia` wstrzykiwany (test/monitor sam podaje „dziś").
   * @param {{dzienOdniesienia?: string}} [opts]
   */
  function listaWszystkich(opts = {}) {
    return _wszystkie().all().map((row) => opiszDokument(row, opts));
  }

  /**
   * Wgrywa oryginalny plik dokumentu: wykrywa format i podpis, zapisuje bajty BEZ
   * modyfikacji, ustawia `plik_url`/`plik_format`/`flaga_podpis_elektroniczny`.
   * Skan papieru (obraz w PDF) jest przyjmowany, ale flaga = false + ostrzeżenie;
   * surowy obraz spoza XML/PDF jest ODRZUCANY (nie mieści się w CHECK-u kolumny).
   *
   * @param {string} userId właściciel dokumentu
   * @param {string} id id rekordu z sejfu
   * @param {{nazwaPliku?: string, bajty: Buffer|Uint8Array|string}} plik
   * @returns {Promise<{rekord: object, ostrzezenie: string|null, detekcja: object}>}
   */
  async function zapiszPlik(userId, id, { nazwaPliku = '', bajty } = {}) {
    const row = wierszWlasciciela(userId, id);
    if (!row) throw new Error('Dokument nie istnieje albo należy do innego użytkownika');

    const bufor = naBufor(bajty);
    const detekcja = wykryjFormatIPodpis(bufor, nazwaPliku);
    if (detekcja.format === null) {
      throw new Error(
        `Nieobsługiwany format pliku — akceptuję tylko oryginał elektroniczny XML/PDF (${detekcja.powod})`,
      );
    }

    const plikUrl = await magazynPlikow.zapisz(id, detekcja.format, bufor); // oryginał 1:1
    _setPlik().run(
      plikUrl,
      detekcja.format,
      detekcja.podpisElektroniczny ? 1 : 0,
      nowIso(),
      id,
      userId,
    );

    let ostrzezenie = null;
    if (!detekcja.podpisElektroniczny) {
      ostrzezenie = detekcja.jestSkanem
        ? 'To wygląda na skan papieru, nie dokument elektroniczny — w zamówieniach publicznych zwykle wymagany jest oryginał XML lub podpisany PDF.'
        : 'Nie wykryto podpisu elektronicznego — upewnij się, że to oryginał, a nie skan.';
    }

    return { rekord: pobierz(userId, id), ostrzezenie, detekcja };
  }

  return { utworz, pobierz, lista, listaWszystkich, aktualizuj, usun, zapiszPlik };
}
