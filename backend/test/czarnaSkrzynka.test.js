import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  createCzarnaSkrzynka,
  hashPliku,
} from '../src/services/czarnaSkrzynka.js';

/*
 * Rdzeń „czarnej skrzynki" składania oferty (podzadanie 1/7 ulepszenia „Czarna
 * skrzynka składania oferty — dowody na awarię platformy"). Rejestrator lotu ma
 * dawać dowód, który obroni się przed KIO, więc testujemy trzy filary wartości
 * dowodowej:
 *  1. LOG APPEND-ONLY — dopisujemy zdarzenia ze znacznikiem czasu z zegara SERWERA
 *     i strefą; wcześniejszych wpisów NIE da się zmienić ani skasować (usługa nie
 *     wystawia takich metod), a kolejność jest stabilna.
 *  2. POPRAWNOŚĆ SHA-256 — suma kontrolna pliku oferty musi być zgodna z wektorem
 *     testowym i z referencyjnym crypto; oryginał zapisujemy BEZ modyfikacji.
 *  3. IZOLACJA PO user_id — cudza sesja jest niewidoczna i niedotykalna (nie da się
 *     do niej dopisać zdarzenia ani zrzutu, ani jej odczytać).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
// Tabele czarnej skrzynki nie są (jeszcze) w zacommitowanym schema.sql — bierzemy je
// wprost z migracji 011, żeby test był samowystarczalny niezależnie od WIP schema.sql.
const migracjaSql = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/011_czarna_skrzynka.sql'),
  'utf8',
);

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  d.exec(migracjaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u2','c@d.pl','h','t','t')").run();
  return d;
}

/** Magazyn plików w pamięci — test nie dotyka dysku i sprawdza bajt-w-bajt. */
function magazynPamiec() {
  const store = new Map();
  return {
    async zapisz(id, format, bajty) {
      store.set(id, Buffer.from(bajty));
      return `mem://${id}.${format}`;
    },
    async czytaj(id) {
      return store.get(id);
    },
    _store: store,
  };
}

// Zegar wstrzykiwany — deterministyczny czas serwera i strefa (dowód czasowy).
const ZEGAR = { teraz: () => '2026-07-27T10:00:00.000Z', strefa: () => 'Europe/Warsaw' };

function fabryka(d) {
  return createCzarnaSkrzynka(d, { magazynPlikow: magazynPamiec(), zegar: ZEGAR });
}

// ══════════════════════════ 0. HASH SHA-256 ══════════════════════════════════

test('hashPliku — zgodny z wektorem testowym „abc" i z referencyjnym crypto', () => {
  // SHA-256("abc") — kanoniczny wektor testowy.
  assert.equal(
    hashPliku(Buffer.from('abc', 'utf8')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const buf = Buffer.from('OFERTA XML — treść nieistotna dla sumy', 'utf8');
  assert.equal(hashPliku(buf), crypto.createHash('sha256').update(buf).digest('hex'));
});

// ══════════════════════════ 1. SESJA + LOG APPEND-ONLY ═══════════════════════

test('rozpocznijSesje — tworzy sesję z id, właścicielem i strefą z zegara serwera', () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  assert.ok(s.id, 'nadany id sesji');
  assert.equal(s.user_id, 'u1');
  assert.equal(s.postepowanie_id, 'p1');
  assert.equal(s.strefa_czasowa, 'Europe/Warsaw', 'strefa z zegara serwera');
  d.close();
});

test('dopiszZdarzenie — append-only log ze znacznikiem czasu serwera + strefą, w kolejności', () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });

  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Otwarto platformę' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Wgrano plik oferty' });
  const poDwoch = cs.zdarzenia('u1', s.id);
  assert.equal(poDwoch.length, 2);

  cs.dopiszZdarzenie('u1', s.id, { typ: 'blad_wysylki', opis: 'HTTP 500 przy wysyłce' });
  const poTrzech = cs.zdarzenia('u1', s.id);

  // Kolejność stabilna (append order).
  assert.deepEqual(poTrzech.map((z) => z.opis), [
    'Otwarto platformę',
    'Wgrano plik oferty',
    'HTTP 500 przy wysyłce',
  ]);
  assert.deepEqual(poTrzech.map((z) => z.typ), ['krok', 'krok', 'blad_wysylki']);

  // Każdy wpis ma czas z zegara serwera + strefę.
  for (const z of poTrzech) {
    assert.equal(z.czas_serwera, '2026-07-27T10:00:00.000Z');
    assert.equal(z.strefa_czasowa, 'Europe/Warsaw');
  }

  // APPEND-ONLY: dopisanie trzeciego nie zmieniło dwóch wcześniejszych (bajt-w-bajt).
  assert.deepEqual(poTrzech.slice(0, 2), poDwoch, 'wcześniejsze wpisy niezmienione po dopisaniu');

  // Usługa NIE daje żadnej drogi do edycji/usunięcia wpisu (log niezmienny).
  assert.equal(typeof cs.usunZdarzenie, 'undefined');
  assert.equal(typeof cs.edytujZdarzenie, 'undefined');
  assert.equal(typeof cs.aktualizujZdarzenie, 'undefined');
  d.close();
});

test('dopiszZdarzenie — odrzuca pusty/nieokreślony typ zdarzenia', () => {
  const d = freshDb();
  const cs = fabryka(d);
  const s = cs.rozpocznijSesje('u1', {});
  assert.throws(() => cs.dopiszZdarzenie('u1', s.id, { opis: 'bez typu' }), /typ/i);
  d.close();
});

// ══════════════════════════ 2. ZRZUTY + ORYGINAŁ OFERTY ══════════════════════

test('zapiszZrzut — zapisuje ORYGINAŁ zrzutu bez modyfikacji + wpis „zrzut" z czasem', async () => {
  const d = freshDb();
  const mag = magazynPamiec();
  const cs = createCzarnaSkrzynka(d, { magazynPlikow: mag, zegar: ZEGAR });
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const z = await cs.zapiszZrzut('u1', s.id, dataUrl, { opis: 'Ekran wysyłki 11:59' });
  assert.equal(z.typ, 'zrzut');
  assert.ok(z.plik_url, 'zrzut zapisany do magazynu');
  assert.equal(z.czas_serwera, '2026-07-27T10:00:00.000Z');
  assert.equal(z.strefa_czasowa, 'Europe/Warsaw');

  // Oryginał zrzutu bajt-w-bajt (bez re-kompresji/modyfikacji).
  const zapisane = [...mag._store.values()];
  assert.ok(zapisane.some((b) => b.equals(png)), 'bajty zrzutu identyczne z wejściem');

  // Zrzut jest też na taśmie append-only.
  assert.ok(cs.zdarzenia('u1', s.id).some((e) => e.typ === 'zrzut'));
  d.close();
});

test('zapiszOferte — SHA-256 oferty + oryginał bez modyfikacji, hash zapisany na sesji', async () => {
  const d = freshDb();
  const mag = magazynPamiec();
  const cs = createCzarnaSkrzynka(d, { magazynPlikow: mag, zegar: ZEGAR });
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });

  const oferta = Buffer.from('<Oferta><Cena>123456.78</Cena></Oferta>', 'utf8');
  const wynik = await cs.zapiszOferte('u1', s.id, oferta.toString('base64'), { nazwaPliku: 'oferta.xml' });

  assert.equal(wynik.hash, hashPliku(oferta), 'zwrócony hash = SHA-256 oferty');

  const s2 = cs.sesja('u1', s.id);
  assert.equal(s2.hash_oferty, hashPliku(oferta), 'hash utrwalony na sesji');
  assert.ok(s2.plik_oferty_url, 'oryginał oferty zapisany');

  // Oryginał oferty bajt-w-bajt.
  assert.ok([...mag._store.values()].some((b) => b.equals(oferta)), 'bajty oferty identyczne z wejściem');

  // Fakt policzenia sumy trafia na taśmę append-only.
  assert.ok(cs.zdarzenia('u1', s.id).some((e) => e.typ === 'hash_oferty'));
  d.close();
});

// ══════════════════════════ 3. IZOLACJA PO user_id ═══════════════════════════

test('izolacja — cudza sesja jest niewidoczna i niedotykalna (user2 vs sesja user1)', async () => {
  const d = freshDb();
  const mag = magazynPamiec();
  const cs = createCzarnaSkrzynka(d, { magazynPlikow: mag, zegar: ZEGAR });
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Wpis właściciela' });

  // Zapis: user2 nie dopisze zdarzenia ani zrzutu do cudzej sesji.
  assert.throws(() => cs.dopiszZdarzenie('u2', s.id, { typ: 'krok', opis: 'wchodzę' }), /sesj/i);
  await assert.rejects(
    () => cs.zapiszZrzut('u2', s.id, `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`),
    /sesj/i,
  );
  await assert.rejects(() => cs.zapiszOferte('u2', s.id, Buffer.from('x').toString('base64')), /sesj/i);

  // Odczyt: user2 nie widzi sesji ani jej taśmy.
  assert.equal(cs.sesja('u2', s.id), null, 'cudza sesja niewidoczna');
  assert.equal(cs.zdarzenia('u2', s.id), null, 'cudza taśma niewidoczna');

  // Dane właściciela nietknięte przez próby user2.
  assert.equal(cs.zdarzenia('u1', s.id).length, 1, 'log właściciela bez obcych wpisów');
  d.close();
});
