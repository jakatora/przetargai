#!/usr/bin/env node
/*
 * Czyści paczkę JS przed buildem Androida (2026-11-07, kanały dystrybucji — `src/lib/kanal.js`).
 *
 * Pomiar 7.11: `expo export:embed` bez `EXPO_PUBLIC_KANAL` po przebiegu z tą zmienną wydał paczkę
 * ZE znacznikiem Play (pamięć Metro trzyma przekształcone pliki ze starą wartością); dopiero
 * reset pamięci dał paczkę bez znacznika. Gradle z kolei pomija zadanie paczki, gdy jego wyniki
 * już są. Dlatego przed KAŻDYM przebiegiem (APK ze strony, AAB dla Play) usuwamy pamięć Metro
 * i wygenerowaną paczkę, a po buildzie `scripts/sprawdz-kanal.mjs` potwierdza kanał w pliku.
 *
 *   node scripts/czysc-paczke-js.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(MOBILE, 'android', 'app', 'build');

export const DO_USUNIECIA = [
  path.join(os.tmpdir(), 'metro-cache'),
  path.join(BUILD, 'generated', 'assets', 'createBundleReleaseJsAndAssets'),
  path.join(BUILD, 'generated', 'res', 'createBundleReleaseJsAndAssets'),
  path.join(BUILD, 'intermediates', 'assets', 'release', 'mergeReleaseAssets'),
];

for (const p of DO_USUNIECIA) {
  const bylo = fs.existsSync(p);
  fs.rmSync(p, { recursive: true, force: true });
  console.log(`${bylo ? 'usunięte' : 'nie było'}: ${p}`);
}
