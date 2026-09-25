import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KLUCZE_KONTA, KLUCZE_URZADZENIA, PREFIKSY_KONTA, KLUCZ_INDEKSU_KONTA, KLUCZ_WLASCICIELA,
} from '../src/lib/daneLokalne.js';

/*
 * STRAŻNIK KLUCZY MAGAZYNU (2026-09-25).
 *
 * Wyciek danych między firmami na wspólnym telefonie wziął się stąd, że każdy ekran
 * dokładał własny klucz `przetargai.…`, a wylogowanie znało tylko dwa. Ten test
 * skanuje CAŁE `src/` i wymaga, żeby każdy literał klucza był sklasyfikowany
 * w lib/daneLokalne.js: dane konta (czyszczone przy wylogowaniu) albo preferencja
 * urządzenia (zostaje). Nowy ekran, który o tym zapomni, wywróci CI — zamiast
 * po cichu zostawić swoje dane następnemu kontu.
 *
 * Klucz w szablonie (`przetargai.cos.${id}`) to klucz PER PRZETARG — SecureStore
 * nie umie ich wylistować, więc prefiks musi być w PREFIKSY_KONTA, a plik, który
 * go zapisuje, musi wołać `zarejestrujKlucz` (indeks konta).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const MODUL_KLASYFIKACJI = path.join(SRC, 'lib', 'daneLokalne.js');

function plikiJs(katalog) {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(katalog, e.name);
    if (e.isDirectory()) return plikiJs(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

/**
 * Literały kluczy: cudzysłów/apostrof/backtick TUŻ przed `przetargai.` / `przetargai_`
 * / `przetargai-`. Adresy (`https://przetargai.web.app`) nie łapią się, bo przed
 * nazwą stoi schemat, nie cudzysłów. `${` zaraz za literałem = klucz z id (prefiks).
 */
const LITERAL = /(['"`])(przetargai[._-][\w.-]*)(\$\{)?/g;

function znalezioneKlucze() {
  const stale = new Map(); // klucz → pliki
  const prefiksy = new Map(); // prefiks → pliki
  for (const plik of plikiJs(SRC)) {
    if (plik === MODUL_KLASYFIKACJI) continue;
    const tresc = fs.readFileSync(plik, 'utf8');
    const wzgledny = path.relative(SRC, plik).replace(/\\/g, '/');
    for (const m of tresc.matchAll(LITERAL)) {
      const cel = m[3] ? prefiksy : stale;
      if (!cel.has(m[2])) cel.set(m[2], []);
      cel.get(m[2]).push(wzgledny);
    }
  }
  return { stale, prefiksy };
}

const { stale, prefiksy } = znalezioneKlucze();
const KONTA = new Set(KLUCZE_KONTA);
const URZADZENIA = new Set(KLUCZE_URZADZENIA);

test('skaner widzi znane klucze (inaczej strażnik byłby ślepy i zawsze zielony)', () => {
  assert.ok(stale.has('przetargai.bankReferencji'), 'nie znaleziono klucza banku referencji');
  assert.ok(stale.has('przetargai.motyw'), 'nie znaleziono klucza motywu');
  assert.ok(stale.has('przetargai_token'), 'nie znaleziono klucza tokenu');
  assert.ok(prefiksy.has('przetargai.kontrola-oferty.'), 'nie znaleziono klucza per przetarg');
});

test('każdy stały klucz `przetargai.…` w src/ jest sklasyfikowany: konto albo urządzenie', () => {
  for (const [klucz, pliki] of stale) {
    assert.ok(
      KONTA.has(klucz) || URZADZENIA.has(klucz),
      `Klucz „${klucz}" (${pliki.join(', ')}) nie jest sklasyfikowany. Dopisz go w src/lib/daneLokalne.js `
      + 'do KLUCZE_KONTA (dane firmy — znikają przy wylogowaniu) albo KLUCZE_URZADZENIA (ustawienie telefonu — zostaje).',
    );
  }
});

test('każdy klucz per przetarg ma prefiks w PREFIKSY_KONTA, a jego plik rejestruje go w indeksie', () => {
  for (const [prefiks, pliki] of prefiksy) {
    assert.ok(
      PREFIKSY_KONTA.includes(prefiks),
      `Klucz z id „${prefiks}\${…}" (${pliki.join(', ')}) nie ma prefiksu w PREFIKSY_KONTA (src/lib/daneLokalne.js). `
      + 'SecureStore nie listuje kluczy — bez indeksu wylogowanie go nie skasuje.',
    );
    for (const plik of new Set(pliki)) {
      const tresc = fs.readFileSync(path.join(SRC, plik), 'utf8');
      assert.ok(
        tresc.includes('zarejestrujKlucz('),
        `${plik} buduje klucz „${prefiks}\${…}", ale nie woła zarejestrujKlucz — klucz nie trafi do indeksu konta.`,
      );
    }
  }
});

test('listy w daneLokalne.js nie mają martwych wpisów (każdy klucz nadal istnieje w src/)', () => {
  // Wpisy żyjące tylko w module klasyfikacji — nigdzie indziej ich nie ma i nie powinno być.
  const wlasne = new Set([KLUCZ_INDEKSU_KONTA, KLUCZ_WLASCICIELA]);
  for (const klucz of [...KLUCZE_KONTA, ...KLUCZE_URZADZENIA]) {
    if (wlasne.has(klucz)) continue;
    assert.ok(stale.has(klucz), `„${klucz}" jest na liście, ale żaden plik w src/ go nie używa — literówka albo martwy wpis`);
  }
  for (const prefiks of PREFIKSY_KONTA) {
    assert.ok(prefiksy.has(prefiks), `prefiks „${prefiks}" jest na liście, ale żaden plik w src/ go nie buduje`);
  }
});
