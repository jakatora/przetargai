import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * DOSTĘPNOŚĆ (P2-6) — strażnik źródła.
 *
 * Czytnik ekranu (VoiceOver / TalkBack) ogłasza element jako przycisk wyłącznie
 * wtedy, gdy ma `accessibilityRole`. Bez niej niewidomy użytkownik słyszy samo
 * „✕" albo nic — i nie wie, że da się to nacisnąć. Audyt 2026-09-24: 24 ze 104
 * przycisków nie miały roli, w tym „Konto" w nagłówku feedu i przełącznik
 * „uwzględniono w ofercie" w Radarze SWZ.
 *
 * Skaner liczy nawiasy klamrowe, bo `onPress={() => …}` zawiera znak „>" —
 * naiwny regex kończył tag w środku funkcji i przepuszczał brak roli.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function plikiJs(katalog) {
  return readdirSync(katalog).flatMap((n) => {
    const p = join(katalog, n);
    return statSync(p).isDirectory() ? plikiJs(p) : (n.endsWith('.js') ? [p] : []);
  });
}

/** Otwierające tagi <Pressable …> / <TouchableOpacity …> z atrybutami i treścią do zamknięcia. */
function przyciski(kod) {
  const wynik = [];
  const re = /<(Pressable|TouchableOpacity)\b/g;
  let m;
  while ((m = re.exec(kod))) {
    let i = m.index + m[0].length;
    let glebokosc = 0;
    for (; i < kod.length; i++) {
      const c = kod[i];
      if (c === '{') glebokosc++;
      else if (c === '}') glebokosc--;
      else if (c === '>' && glebokosc === 0) break;
    }
    const atrybuty = kod.slice(m.index + m[0].length, i);
    const koniec = kod.indexOf(`</${m[1]}>`, i);
    const tresc = koniec > 0 ? kod.slice(i + 1, koniec) : '';
    const linia = kod.slice(0, m.index).split('\n').length;
    wynik.push({ atrybuty, tresc, linia });
  }
  return wynik;
}

const WSZYSTKIE = plikiJs(SRC).flatMap((plik) =>
  przyciski(readFileSync(plik, 'utf8')).map((p) => ({ ...p, plik: plik.slice(SRC.length) })));

test('skaner widzi przyciski (strażnik nie jest pusty)', () => {
  assert.ok(WSZYSTKIE.length >= 100, `znaleziono tylko ${WSZYSTKIE.length}`);
});

test('każdy przycisk ma accessibilityRole', () => {
  const bez = WSZYSTKIE.filter((p) => !p.atrybuty.includes('accessibilityRole'));
  assert.deepEqual(bez.map((p) => `${p.plik}:${p.linia}`), []);
});

test('przycisk z samą ikoną (✕ ★ ☆ ←) ma accessibilityLabel', () => {
  const ikonowe = WSZYSTKIE.filter((p) => />\s*[✕★☆←]\s*</.test(p.tresc));
  assert.ok(ikonowe.length > 0, 'skaner ikon nic nie znalazł — sprawdź wzorzec');
  const bez = ikonowe.filter((p) => !p.atrybuty.includes('accessibilityLabel'));
  assert.deepEqual(bez.map((p) => `${p.plik}:${p.linia}`), []);
});

test('chipy wyboru i przełączniki ogłaszają stan zaznaczenia', () => {
  const wyborowe = WSZYSTKIE.filter((p) => /accessibilityRole="(radio|checkbox|tab)"/.test(p.atrybuty));
  assert.ok(wyborowe.length >= 3);
  const bezStanu = wyborowe.filter((p) => !p.atrybuty.includes('accessibilityState'));
  assert.deepEqual(bezStanu.map((p) => `${p.plik}:${p.linia}`), []);
});
