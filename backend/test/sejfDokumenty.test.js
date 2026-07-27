import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  TYPY_DOKUMENTOW,
  PLIK_FORMATY,
  ID_TYPOW_DOKUMENTOW,
  typDokumentu,
  jestZnanymTypem,
} from '../src/config/dokumentyKatalog.js';

/*
 * Sejf dokumentów firmy z licznikiem świeżości — model danych + katalog typów
 * (podzadanie 1/7 ulepszenia „Sejf podmiotowych środków dowodowych").
 *
 * Powstaje SAM MODEL: tabela `sejf_dokumenty` (dokument firmy z datą wystawienia,
 * okresem ważności, oryginalnym plikiem XML/PDF i flagą podpisu elektronicznego)
 * oraz katalog typów w config (realny czas oczekiwania urzędu + linki online).
 * Bez logiki świeżości/CRUD — to dalsze podzadania (2, 3). Test pilnuje kontraktu
 * schematu i kształtu katalogu.
 */

// ── Część 1: kontrakt schematu / migracji (izolowana baza w pamięci) ─────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const mig010 = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/010_sejf_dokumenty.sql'),
  'utf8',
);

const KOLUMNY_WYMAGANE = [
  'id', 'user_id', 'typ_dokumentu', 'data_wystawienia', 'okres_waznosci_dni',
  'plik_url', 'plik_format', 'flaga_podpis_elektroniczny', 'notatka',
  'created_at', 'updated_at',
];

function freshDb(sql) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(sql);
  return d;
}

function maTabele(d, nazwa) {
  return Boolean(
    d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(nazwa),
  );
}

test('schema.sql — świeża baza ma tabelę sejf_dokumenty z kompletem kolumn', () => {
  const d = freshDb(schemaSql);
  assert.ok(maTabele(d, 'sejf_dokumenty'), 'tabela musi być w schema.sql (świeża instalacja)');
  const kolumny = d.prepare('PRAGMA table_info(sejf_dokumenty)').all().map((c) => c.name);
  for (const k of KOLUMNY_WYMAGANE) {
    assert.ok(kolumny.includes(k), `sejf_dokumenty musi mieć kolumnę ${k}`);
  }
  d.close();
});

test('migracja 010 — dokłada tabelę na ISTNIEJĄCEJ bazie i jest idempotentna', () => {
  // Symulacja działającej produkcji: jest tylko `users` (cel klucza obcego).
  const d = freshDb('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);');
  d.exec(mig010);
  d.exec(mig010); // ponowne zastosowanie nie może się wywrócić (CREATE ... IF NOT EXISTS)
  assert.ok(maTabele(d, 'sejf_dokumenty'), 'migracja 010 musi utworzyć sejf_dokumenty na istniejącej bazie');
  d.close();
});

test('schema — sejf_dokumenty.user_id wymusza istnienie użytkownika (FK z kaskadą)', () => {
  const d = freshDb(schemaSql);
  assert.throws(
    () => d.prepare(
      `INSERT INTO sejf_dokumenty (id, user_id, typ_dokumentu, created_at, updated_at)
       VALUES ('s1', 'widmo', 'krk', 't', 't')`,
    ).run(),
    'dokument dla nieistniejącego usera musi zostać odrzucony przez klucz obcy',
  );
  d.close();
});

test('schema — usunięcie użytkownika kaskaduje na jego dokumenty', () => {
  const d = freshDb(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare(`INSERT INTO sejf_dokumenty (id, user_id, typ_dokumentu, created_at, updated_at)
             VALUES ('s1','u1','krk','t','t')`).run();
  d.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sejf_dokumenty').get().n, 0, 'dokumenty znikają z kontem');
  assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(), [], 'zero osieroconych wierszy');
  d.close();
});

test('schema — plik_format ograniczony do xml/pdf (CHECK), NULL dozwolony', () => {
  const d = freshDb(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  // Poprawne formaty i brak pliku (NULL) przechodzą.
  for (const [id, fmt] of [['s-xml', 'xml'], ['s-pdf', 'pdf'], ['s-null', null]]) {
    d.prepare(`INSERT INTO sejf_dokumenty (id, user_id, typ_dokumentu, plik_format, created_at, updated_at)
               VALUES (?, 'u1', 'us', ?, 't', 't')`).run(id, fmt);
  }
  // Skan „papieru" jako format spoza zbioru musi paść na CHECK.
  assert.throws(
    () => d.prepare(`INSERT INTO sejf_dokumenty (id, user_id, typ_dokumentu, plik_format, created_at, updated_at)
                     VALUES ('s-bad', 'u1', 'us', 'jpg', 't', 't')`).run(),
    'format spoza xml/pdf musi zostać odrzucony przez CHECK',
  );
  d.close();
});

test('schema — flaga_podpis_elektroniczny domyślnie 0 (brak/skan, nie dokument elektroniczny)', () => {
  const d = freshDb(schemaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare(`INSERT INTO sejf_dokumenty (id, user_id, typ_dokumentu, created_at, updated_at)
             VALUES ('s1','u1','krk','t','t')`).run();
  assert.equal(
    d.prepare('SELECT flaga_podpis_elektroniczny AS f FROM sejf_dokumenty WHERE id = ?').get('s1').f,
    0,
    'domyślnie zakładamy „nie wiadomo/skan" — flaga podpisu zapala się dopiero po detekcji',
  );
  d.close();
});

// ── Część 2: kształt katalogu typów (config/dokumentyKatalog.js) ─────────────

test('katalog — PLIK_FORMATY zgadza się z CHECK-iem schematu (xml/pdf)', () => {
  assert.deepEqual([...PLIK_FORMATY], ['xml', 'pdf']);
});

test('katalog — zawiera wszystkie typy z ulepszenia, każdy poprawnie opisany', () => {
  const WYMAGANE = ['krk', 'us', 'zus', 'polisa_oc', 'wpis_rejestr', 'wykaz_robot_uslugi', 'uprawnienia_pracownikow'];
  assert.deepEqual([...ID_TYPOW_DOKUMENTOW], WYMAGANE, 'komplet typów w ustalonej kolejności prezentacji');

  for (const t of TYPY_DOKUMENTOW) {
    assert.ok(t.id && typeof t.id === 'string', 'każdy typ ma id');
    assert.ok(t.nazwa && typeof t.nazwa === 'string', `${t.id}: nazwa PL`);
    assert.ok(t.opis && typeof t.opis === 'string', `${t.id}: opis podstawy ważności`);
    assert.ok(
      t.okresWaznosciDniDomyslny === null
        || (Number.isInteger(t.okresWaznosciDniDomyslny) && t.okresWaznosciDniDomyslny > 0),
      `${t.id}: okres ważności to null (bezterminowy) albo dodatnia liczba dni`,
    );
    assert.ok(
      Number.isInteger(t.czasOczekiwaniaUrzadDni) && t.czasOczekiwaniaUrzadDni >= 0,
      `${t.id}: czas oczekiwania urzędu to nieujemna liczba dni`,
    );
    assert.equal(typeof t.wymagaDokumentuElektronicznego, 'boolean', `${t.id}: flaga oryginału elektronicznego`);
    if (t.online !== null) {
      assert.ok(t.online.nazwa, `${t.id}: nazwa e-usługi`);
      assert.equal(new URL(t.online.url).protocol, 'https:', `${t.id}: link online po https`);
    }
  }
});

test('katalog — realne okresy ważności zgodne z praktyką postępowań (KRK 180, US/ZUS 90)', () => {
  assert.equal(typDokumentu('krk').okresWaznosciDniDomyslny, 180, 'KRK: 6 miesięcy = 180 dni');
  assert.equal(typDokumentu('us').okresWaznosciDniDomyslny, 90, 'US: ~3 miesiące');
  assert.equal(typDokumentu('zus').okresWaznosciDniDomyslny, 90, 'ZUS: ~3 miesiące');
  // Dokumenty własne/bezterminowe — licznik świeżości ich nie przeterminowuje.
  assert.equal(typDokumentu('wykaz_robot_uslugi').okresWaznosciDniDomyslny, null);
  assert.equal(typDokumentu('uprawnienia_pracownikow').okresWaznosciDniDomyslny, null);
});

test('katalog — czas oczekiwania urzędu jest realny: KRK pocztą alertuje najwcześniej', () => {
  // Sedno wcześniejszego alertu: KRK potrafi iść tygodniami, więc jego czas
  // oczekiwania jest istotnie dłuższy niż zaświadczeń US/ZUS wydawanych od ręki.
  assert.ok(typDokumentu('krk').czasOczekiwaniaUrzadDni >= 21, 'KRK: realnie ~3 tygodnie pocztą');
  assert.ok(
    typDokumentu('krk').czasOczekiwaniaUrzadDni > typDokumentu('us').czasOczekiwaniaUrzadDni,
    'KRK musi alertować wcześniej niż US',
  );
  assert.ok(
    typDokumentu('krk').czasOczekiwaniaUrzadDni > typDokumentu('zus').czasOczekiwaniaUrzadDni,
    'KRK musi alertować wcześniej niż ZUS',
  );
});

test('katalog — linki online tam, gdzie jest e-usługa; NULL dla dokumentów własnych', () => {
  assert.equal(typDokumentu('krk').online.nazwa, 'e-KRK');
  assert.equal(typDokumentu('zus').online.nazwa, 'PUE ZUS');
  assert.equal(typDokumentu('us').online.nazwa, 'e-Urząd Skarbowy');
  assert.equal(typDokumentu('wykaz_robot_uslugi').online, null, 'dokument własny — brak e-usługi');
  assert.equal(typDokumentu('uprawnienia_pracownikow').online, null);
});

test('katalog — dokumenty elektroniczne (KRK/US/ZUS/rejestr) wymagają oryginału elektronicznego', () => {
  for (const id of ['krk', 'us', 'zus', 'wpis_rejestr']) {
    assert.equal(typDokumentu(id).wymagaDokumentuElektronicznego, true, `${id}: oryginał XML/podpisany PDF, nie skan`);
  }
});

test('katalog — helpery typDokumentu/jestZnanymTypem rozpoznają tylko znane typy', () => {
  assert.ok(jestZnanymTypem('krk'));
  assert.equal(jestZnanymTypem('nieistniejacy'), false);
  assert.equal(typDokumentu('nieistniejacy'), undefined);
});
