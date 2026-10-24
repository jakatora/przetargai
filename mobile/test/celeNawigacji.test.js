import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Strażnik celów nawigacji (2026-10-24): każdy `navigation.navigate('Ekran', …)` w ekranach
 * i komponentach musi celować w trasę zarejestrowaną w RootNavigator. Martwa nazwa trasy
 * to crash przy kliknięciu, którego ani esbuild, ani testy lib nie widzą — a dziś doszło
 * kilkanaście nowych przycisków prowadzących do nowych ekranów.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

function pliki(katalog) {
  return fs.readdirSync(katalog).filter((f) => f.endsWith('.js')).map((f) => path.join(katalog, f));
}

test('każdy literalny cel navigate(...) istnieje w RootNavigator', () => {
  const nawigator = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');
  const trasy = new Set([...nawigator.matchAll(/name="(\w+)"/g)].map((m) => m[1]));
  const bledy = [];
  for (const plik of [...pliki(path.join(SRC, 'screens')), ...pliki(path.join(SRC, 'components'))]) {
    const zrodlo = fs.readFileSync(plik, 'utf8');
    for (const m of zrodlo.matchAll(/navigation\.(?:navigate|push|replace)\(\s*'(\w+)'/g)) {
      if (!trasy.has(m[1])) bledy.push(`${path.basename(plik)} → '${m[1]}' (brak w RootNavigator)`);
    }
  }
  assert.deepEqual(bledy, []);
});

test('katalog narzędzi i ścieżka nie są jedynymi wejściami — każda nowa trasa ma co najmniej jedno wejście w ekranach', () => {
  // Trasa bez żadnego navigate() do niej jest martwa dla użytkownika (tylko deep-link).
  const nawigator = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');
  const trasy = [...nawigator.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
  const zrodla = [...pliki(path.join(SRC, 'screens')), ...pliki(path.join(SRC, 'components')), ...pliki(path.join(SRC, 'lib'))]
    .map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const startowe = new Set(['MatchFeed', 'Login', 'Register', 'Witaj', 'ForgotPassword', 'ResetPassword', 'Saved', 'Account', 'Narzedzia']);
  const sieroty = trasy.filter((t) => !startowe.has(t) && !new RegExp(`['"\`]${t}['"\`]`).test(zrodla));
  assert.deepEqual(sieroty, []);
});
