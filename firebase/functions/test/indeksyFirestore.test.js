import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Audyt 2026-07-10, znalezisko CRITICAL.
 *
 * `openPool()` miało `where('deadline','==',null).orderBy('fetched_at','desc')`.
 * Firestore obsługuje filtr równościowy + sortowanie po INNYM polu wyłącznie przez
 * indeks ZŁOŻONY. Indeksu nie było, więc zapytanie rzucało FAILED_PRECONDITION,
 * a ponieważ obie gałęzie puli szły przez Promise.all — padał cały silnik dopasowań:
 * codzienny cron, backfill po rejestracji i /admin/fetch-tenders.
 *
 * Najgorsze: **emulator Firestore nie egzekwuje indeksów złożonych**, więc 86 testów
 * jednostkowych i pełny E2E przechodziły, a produkcja byłaby martwa od pierwszego dnia.
 *
 * Ten test czyta ŹRÓDŁO i pilnuje, by każde zapytanie dało się obsłużyć indeksem
 * automatycznym — albo miało odpowiadający mu wpis w firestore.indexes.json.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const INDEXES = path.resolve(__dirname, '../../firestore.indexes.json');

/** Wycina komentarze — wzorce opisane w dokumentacji nie są zapytaniami. */
function bezKomentarzy(kod) {
  return kod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Skanujemy CAŁE źródło, nie tylko `db/repos.js`.
 *
 * Audyt 2026-07-10: strażnik czytał wyłącznie warstwę danych, a zapytanie
 * `collectionGroup('matches').orderBy('created_at')` — jedyne, które NIGDY nie
 * zadziała bez jawnego indeksu — mieszka w `routes/admin.js`. Test pilnował
 * miejsca, w którym problemu nie było.
 */
function wszystkieZrodla(katalog) {
  const pliki = [];
  for (const wpis of fs.readdirSync(katalog, { withFileTypes: true })) {
    const sciezka = path.join(katalog, wpis.name);
    if (wpis.isDirectory()) pliki.push(...wszystkieZrodla(sciezka));
    else if (wpis.name.endsWith('.js')) pliki.push(sciezka);
  }
  return pliki;
}

const PLIKI = wszystkieZrodla(SRC);
const kod = PLIKI.map((p) => bezKomentarzy(fs.readFileSync(p, 'utf8'))).join('\n');

/**
 * Zapytania widziane w kodzie: filtr + pierwsze sortowanie po NIM NASTĘPUJĄCE.
 *
 * Wzorzec regexowy „where(...) zaraz .orderBy(...)" miał LUKĘ: `[^)]*` zatrzymywał
 * się na pierwszym nawiasie zamykającym, więc `where('nip', '==', String(nip))`
 * w ogóle nie był dopasowany — a to dokładnie ten kształt wymaga indeksu
 * złożonego. Strażnik, który nie widzi zapytania, nie chroni przed niczym.
 * Dlatego szukamy `.where(` i przeglądamy OKNO kodu aż do wykonania zapytania.
 */
function zapytaniaZKodu() {
  const znalezione = [];
  for (const m of kod.matchAll(/\.where\(\s*['"]([\w.]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
    const [, pole, operator] = m;
    const reszta = kod.slice(m.index, m.index + 400);
    const koniec = reszta.search(/\.(?:get|stream|count)\(/);
    const okno = koniec > 0 ? reszta.slice(0, koniec) : reszta;
    const sortowania = [...okno.matchAll(/\.orderBy\(\s*['"]([\w.]+)['"]/g)].map((s) => s[1]);
    if (sortowania.length) znalezione.push({ pole, operator, sortowania });
  }
  return znalezione;
}

/** Czy firestore.indexes.json deklaruje indeks obsługujący ten filtr i sortowanie. */
function indeksIstnieje({ pole, sortowanie }) {
  const konfiguracja = JSON.parse(fs.readFileSync(INDEXES, 'utf8'));
  return (konfiguracja.indexes ?? []).some((i) => {
    const pola = (i.fields ?? []).map((f) => f.fieldPath);
    return pola.includes(pole) && pola.includes(sortowanie);
  });
}

test('KRYTYCZNE: where(==) z orderBy po INNYM polu ma zadeklarowany indeks złożony', () => {
  const naruszenia = [];
  for (const { pole, operator, sortowania } of zapytaniaZKodu()) {
    if (operator !== '==') continue;
    const sortowanie = sortowania.find((s) => s !== pole && s !== '__name__');
    if (!sortowanie) continue;
    if (!indeksIstnieje({ pole, sortowanie })) {
      naruszenia.push(`where('${pole}','==') + orderBy('${sortowanie}')`);
    }
  }
  assert.deepEqual(naruszenia, [],
    'takie zapytanie wymaga indeksu złożonego — dodaj go do firestore.indexes.json albo uprość zapytanie');
});

test('KRYTYCZNE: nierówność i PIERWSZE orderBy dotyczą TEGO SAMEGO pola', () => {
  // Firestore wymaga, by pierwsze orderBy było na polu z nierównością.
  const naruszenia = [];
  for (const { pole, operator, sortowania } of zapytaniaZKodu()) {
    if (!['<', '<=', '>', '>=', '!='].includes(operator)) continue;
    if (sortowania[0] !== pole) naruszenia.push(`where('${pole}','${operator}') + orderBy('${sortowania[0]}')`);
  }
  assert.deepEqual(naruszenia, [], 'pierwsze orderBy musi być na polu nierówności');
});

test('strażnik WIDZI zapytanie z wywołaniem funkcji w wartości filtru', () => {
  /*
   * Asercja na samego strażnika: poprzednia wersja gubiła `where('x','==',String(v))`,
   * czyli kształt, którym etap 6 czyta rozstrzygnięcia zamawiającego. Test, który
   * nie widzi zapytania, przechodzi na zielono i niczego nie pilnuje.
   */
  const widziane = zapytaniaZKodu().some((z) => z.pole === 'zamawiajacy_nip');
  assert.ok(widziane, 'strażnik nie dostrzegł filtru po NIP-ie zamawiającego z wywołaniem String()');
});

test('collectionGroup ma zadeklarowany indeks w firestore.indexes.json', () => {
  /*
   * collectionGroup + orderBy NIGDY nie działa bez jawnego indeksu.
   * Deploy produkcyjny 2026-07-10 nauczył nas drugiej połowy zasady:
   * indeks JEDNOPOLOWY w zakresie grupy Firestore ODRZUCA w sekcji `indexes`
   * (HTTP 400 „configure using single field index controls") — jego miejsce
   * to `fieldOverrides[].indexes[]` z queryScope COLLECTION_GROUP.
   * Strażnik honoruje więc OBA poprawne miejsca deklaracji.
   */
  const uzycia = [...kod.matchAll(/collectionGroup\(\s*['"](\w+)['"]\s*\)/g)].map((m) => m[1]);
  if (!uzycia.length) return;

  const konfiguracja = JSON.parse(fs.readFileSync(INDEXES, 'utf8'));
  const zadeklarowane = new Set([
    ...(konfiguracja.indexes ?? [])
      .filter((i) => i.queryScope === 'COLLECTION_GROUP')
      .map((i) => i.collectionGroup),
    ...(konfiguracja.fieldOverrides ?? [])
      .filter((o) => (o.indexes ?? []).some((i) => i.queryScope === 'COLLECTION_GROUP'))
      .map((o) => o.collectionGroup),
  ]);
  for (const grupa of uzycia) {
    assert.ok(zadeklarowane.has(grupa), `collectionGroup('${grupa}') bez indeksu COLLECTION_GROUP w firestore.indexes.json`);
  }
});

test('strażnik naprawdę skanuje wszystkie pliki źródłowe, nie tylko repos.js', () => {
  // Bez tej asercji test mógłby cicho zwęzić zakres i przestać cokolwiek chronić.
  assert.ok(PLIKI.length >= 15, `spodziewam się kilkunastu plików źródłowych, jest ${PLIKI.length}`);
  assert.ok(PLIKI.some((p) => p.endsWith('repos.js')), 'warstwa danych musi być skanowana');
  assert.ok(PLIKI.some((p) => p.endsWith('admin.js')), 'trasy admina też robią zapytania');
  assert.ok(kod.includes('collectionGroup'), 'w kodzie jest zapytanie collectionGroup — strażnik je widzi');
});

test('firestore.indexes.json jest poprawnym JSON-em o oczekiwanym kształcie', () => {
  const konfiguracja = JSON.parse(fs.readFileSync(INDEXES, 'utf8'));
  assert.ok(Array.isArray(konfiguracja.indexes), 'brak tablicy indexes');
  for (const i of konfiguracja.indexes) {
    assert.ok(i.collectionGroup, 'indeks bez collectionGroup');
    assert.ok(Array.isArray(i.fields) && i.fields.length, 'indeks bez pól');
  }
});
