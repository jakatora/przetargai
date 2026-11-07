#!/usr/bin/env node
/*
 * Sprawdza kanał dystrybucji w GOTOWYM pliku AAB/APK (2026-11-07, `src/lib/kanal.js`).
 *
 *   node scripts/sprawdz-kanal.mjs <plik.aab|plik.apk> <play|strona>
 *
 * Build dla Google Play musi mieć w paczce JS napis `kanal-google-play` (wpisany przez bundler
 * ze zmiennej `EXPO_PUBLIC_KANAL`), a APK ze strony nie może go mieć. Gradle i Metro potrafią
 * użyć paczki z poprzedniego przebiegu, więc samo ustawienie zmiennej niczego nie dowodzi —
 * dowodem jest ten plik. Kod wyjścia 0 = zgodnie z oczekiwaniem, 1 = niezgodnie, 2 = błąd.
 * Kontrolnie szuka też stałego napisu z kodu apki, żeby „brak napisu kanału” nie znaczył
 * „nie umiem czytać paczki” (Hermes trzyma napisy ASCII w tablicy napisów bajt w bajt).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export const NAPIS_PLAY = 'kanal-google-play';
export const NAPIS_KONTROLNY = 'przetargai.proba_koniec_pokazany';
const WPIS_PACZKI = /(^|\/)assets\/index\.android\.bundle$/;

/** Zawartość wpisu z archiwum ZIP (AAB i APK to ZIP) albo null. Bez ZIP64 — pliki < 4 GB. */
export function wpisZip(bufor, pasuje) {
  let eocd = -1;
  for (let i = bufor.length - 22; i >= Math.max(0, bufor.length - 65_557); i--) {
    if (bufor.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('to nie jest archiwum ZIP (brak końca katalogu)');
  const wpisow = bufor.readUInt16LE(eocd + 10);
  let p = bufor.readUInt32LE(eocd + 16);
  for (let n = 0; n < wpisow; n++) {
    if (bufor.readUInt32LE(p) !== 0x02014b50) throw new Error('uszkodzony katalog ZIP');
    const metoda = bufor.readUInt16LE(p + 10);
    const rozmiar = bufor.readUInt32LE(p + 20);
    const dlNazwy = bufor.readUInt16LE(p + 28);
    const dlExtra = bufor.readUInt16LE(p + 30);
    const dlKom = bufor.readUInt16LE(p + 32);
    const lokalny = bufor.readUInt32LE(p + 42);
    const nazwa = bufor.toString('utf8', p + 46, p + 46 + dlNazwy);
    if (pasuje(nazwa)) {
      if (bufor.readUInt32LE(lokalny) !== 0x04034b50) throw new Error('uszkodzony nagłówek wpisu ' + nazwa);
      const start = lokalny + 30 + bufor.readUInt16LE(lokalny + 26) + bufor.readUInt16LE(lokalny + 28);
      const dane = bufor.subarray(start, start + rozmiar);
      if (metoda === 0) return { nazwa, dane };
      if (metoda === 8) return { nazwa, dane: zlib.inflateRawSync(dane) };
      throw new Error(`nieobsługiwana kompresja ${metoda} we wpisie ${nazwa}`);
    }
    p += 46 + dlNazwy + dlExtra + dlKom;
  }
  return null;
}

/** 'play' | 'strona' z bufora paczki JS; rzuca, gdy paczki nie da się wiarygodnie przeczytać. */
export function kanalPaczki(paczka) {
  if (!paczka.includes(NAPIS_KONTROLNY)) throw new Error(`w paczce nie ma napisu kontrolnego „${NAPIS_KONTROLNY}” — to nie paczka PrzetargAI albo nie da się jej czytać`);
  return paczka.includes(NAPIS_PLAY) ? 'play' : 'strona';
}

function main() {
  const [plik, oczekiwany] = process.argv.slice(2);
  if (!plik || !['play', 'strona'].includes(oczekiwany)) {
    console.error('użycie: node scripts/sprawdz-kanal.mjs <plik.aab|plik.apk> <play|strona>');
    process.exit(2);
  }
  try {
    const wpis = wpisZip(fs.readFileSync(plik), (n) => WPIS_PACZKI.test(n));
    if (!wpis) throw new Error('w archiwum nie ma assets/index.android.bundle');
    const kanal = kanalPaczki(wpis.dane);
    const ok = kanal === oczekiwany;
    console.log(`${ok ? 'OK' : 'NIEZGODNE'}: ${plik} → kanał ${kanal} (oczekiwany ${oczekiwany}; ${wpis.nazwa}, ${wpis.dane.length} B)`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('BŁĄD:', e.message);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main();
