import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Strażnik propsów ekranów (2026-10-24): ekran użył `navigation.navigate(...)`, ale jego
 * sygnatura brała tylko `{ route }` — esbuild tego nie widzi, a w aplikacji to ReferenceError
 * przy kliknięciu. Skanujemy każdy ekran: jeśli w ciele jest `navigation.` albo `route.`/`route?.`,
 * to komponent musi je odebrać w sygnaturze (albo wziąć `navigation` z `useNavigation()`).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KATALOG = path.resolve(__dirname, '../src/screens');

test('każdy ekran, który używa navigation/route, odbiera je w sygnaturze (albo useNavigation)', () => {
  const bledy = [];
  for (const plik of fs.readdirSync(KATALOG).filter((f) => f.endsWith('Screen.js'))) {
    const zrodlo = fs.readFileSync(path.join(KATALOG, plik), 'utf8');
    const sygnatura = zrodlo.match(/export default function \w+\(([^)]*)\)/)?.[1] ?? '';
    const maUseNavigation = /useNavigation\(\)/.test(zrodlo);
    if (/\bnavigation\.(navigate|goBack|push|replace|setOptions|setParams)\(/.test(zrodlo) && !/\bnavigation\b/.test(sygnatura) && !maUseNavigation) {
      bledy.push(`${plik}: używa navigation, a sygnatura to ({ ${sygnatura.trim()} })`);
    }
    if (/\broute(\?\.|\.)params/.test(zrodlo) && !/\broute\b/.test(sygnatura) && !/useRoute\(\)/.test(zrodlo)) {
      bledy.push(`${plik}: używa route.params, a sygnatura to ({ ${sygnatura.trim()} })`);
    }
  }
  assert.deepEqual(bledy, []);
});
