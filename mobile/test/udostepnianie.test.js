import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Tryb udostępniania: telefon → arkusz systemowy; web z navigator.share → arkusz;
 * web bez (Electron/Windows) → schowek; nic → jawny brak. Sama decyzja jest czysta —
 * (osobny moduł bez react-native) — oraz pilnujemy, że ekrany nie wołają Share.share wprost.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');
const { trybUdostepniania } = await import('../src/lib/trybUdostepniania.js');

test('telefon → share; web z navigator.share → share; web bez share, ze schowkiem → schowek; nic → brak', () => {
  assert.equal(trybUdostepniania({ platformaWeb: false, maShare: false, maClipboard: false }), 'share');
  assert.equal(trybUdostepniania({ platformaWeb: true, maShare: true, maClipboard: true }), 'share');
  assert.equal(trybUdostepniania({ platformaWeb: true, maShare: false, maClipboard: true }), 'schowek');
  assert.equal(trybUdostepniania({ platformaWeb: true, maShare: false, maClipboard: false }), 'brak');
  assert.equal(trybUdostepniania(), 'share');
});

test('żaden ekran nie woła Share.share wprost — wszystko przez udostepnijTekst (inaczej Windows nie dostanie dokumentu)', () => {
  const katalog = path.join(SRC, 'screens');
  const winni = fs.readdirSync(katalog)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /\bShare\.share\(/.test(fs.readFileSync(path.join(katalog, f), 'utf8')));
  assert.deepEqual(winni, []);
});
