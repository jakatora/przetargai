import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { kanalZWartosci, KANAL, POKAZUJ_ZAKUP } from '../src/lib/kanal.js';
import { wpisZip, kanalPaczki, NAPIS_PLAY, NAPIS_KONTROLNY } from '../scripts/sprawdz-kanal.mjs';

/** Minimalne archiwum ZIP (jak AAB/APK) z wpisami {nazwa, dane, deflate}. */
function zip(wpisy) {
  const lokalne = []; const katalog = []; let offset = 0;
  for (const w of wpisy) {
    const nazwa = Buffer.from(w.nazwa);
    const dane = w.deflate ? zlib.deflateRawSync(w.dane) : w.dane;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(w.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(dane.length, 18); lh.writeUInt32LE(w.dane.length, 22); lh.writeUInt16LE(nazwa.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(w.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(dane.length, 20); cd.writeUInt32LE(w.dane.length, 24); cd.writeUInt16LE(nazwa.length, 28); cd.writeUInt32LE(offset, 42);
    lokalne.push(lh, nazwa, dane); katalog.push(cd, nazwa);
    offset += 30 + nazwa.length + dane.length;
  }
  const kat = Buffer.concat(katalog);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(wpisy.length, 8); eocd.writeUInt16LE(wpisy.length, 10);
  eocd.writeUInt32LE(kat.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokalne, kat, eocd]);
}

/*
 * Kanał dystrybucji (2026-11-07): build dla Google Play nie może pokazywać zakupu przez Stripe
 * ani paska „pobierz APK ze strony” (polityki Payments oraz Device and Network Abuse).
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function plikiJs(katalog) {
  return fs.readdirSync(katalog, { withFileTypes: true }).flatMap((w) => {
    const p = path.join(katalog, w.name);
    if (w.isDirectory()) return plikiJs(p);
    return w.name.endsWith('.js') ? [p] : [];
  });
}

test('kanalZWartosci: końcówka „play” → play; brak, śmieci i inne kanały → strona', () => {
  assert.equal(kanalZWartosci('kanal-google-play'), 'play');
  assert.equal(kanalZWartosci(' PLAY '), 'play');
  assert.equal(kanalZWartosci(undefined), 'strona');
  assert.equal(kanalZWartosci(''), 'strona');
  assert.equal(kanalZWartosci('strona'), 'strona');
  assert.equal(kanalZWartosci('display'), 'strona', 'samo „play” na końcu słowa nie wystarcza');
});

test('bez zmiennej buildu (testy, APK ze strony, web, iOS) zakup jest widoczny', () => {
  assert.equal(process.env.EXPO_PUBLIC_KANAL, undefined);
  assert.equal(KANAL, 'strona');
  assert.equal(POKAZUJ_ZAKUP, true);
});

test('napis kanału Play występuje tylko w paczce z buildu — nie ma go w kodzie apki', () => {
  // scripts/sprawdz-kanal.mjs szuka go w gotowym AAB/APK; gdyby był w kodzie, sprawdzenie zawsze by przechodziło.
  // Komentarze nie trafiają do paczki release (minifikacja), więc tylko kod.
  const bezKomentarzy = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const plik of plikiJs(SRC)) {
    assert.ok(!bezKomentarzy(fs.readFileSync(plik, 'utf8')).includes(NAPIS_PLAY), path.relative(SRC, plik));
  }
});

test('sprawdz-kanal: paczka z AAB (base/…, deflate) i APK (stored) → właściwy kanał; obca paczka → błąd', () => {
  const play = Buffer.from(`var a="${NAPIS_KONTROLNY}";var k="${NAPIS_PLAY}";`);
  const strona = Buffer.from(`var a="${NAPIS_KONTROLNY}";var k=void 0;`);
  const aab = zip([{ nazwa: 'base/manifest/AndroidManifest.xml', dane: Buffer.from('x') }, { nazwa: 'base/assets/index.android.bundle', dane: play, deflate: true }]);
  const apk = zip([{ nazwa: 'assets/index.android.bundle', dane: strona }]);
  const zAab = wpisZip(aab, (n) => /(^|\/)assets\/index\.android\.bundle$/.test(n));
  assert.equal(zAab.nazwa, 'base/assets/index.android.bundle');
  assert.equal(kanalPaczki(zAab.dane), 'play');
  assert.equal(kanalPaczki(wpisZip(apk, (n) => n.endsWith('index.android.bundle')).dane), 'strona');
  assert.equal(wpisZip(apk, (n) => n === 'brak'), null);
  assert.throws(() => kanalPaczki(Buffer.from('cudza paczka')), /napisu kontrolnego/);
  assert.throws(() => wpisZip(Buffer.from('to nie zip, tylko tekst dłuższy niż dwadzieścia dwa bajty'), () => true), /nie jest archiwum ZIP/);
});

test('napis kontrolny skryptu istnieje w kodzie apki (inaczej sprawdzanie plików zawsze by padało)', () => {
  const kod = plikiJs(SRC).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  assert.ok(kod.includes(`'${NAPIS_KONTROLNY}'`));
});

test('strażnik: każdy plik z zakupem Standard (link Stripe albo cena) liczy się z kanałem dystrybucji', () => {
  const ZAKUP = /createUpgradeLink\(|\d+\s*zł\s*\/\s*(mc|miesiąc)|PLN \d+\s*\/\s*(mo|month)/;
  const bez = plikiJs(SRC)
    .filter((p) => !p.includes(`${path.sep}api${path.sep}`))
    .filter((p) => ZAKUP.test(fs.readFileSync(p, 'utf8')))
    .filter((p) => !/POKAZUJ_ZAKUP/.test(fs.readFileSync(p, 'utf8')))
    .map((p) => path.relative(SRC, p));
  assert.deepEqual(bez, [], 'te pliki pokazują zakup bez sprawdzenia POKAZUJ_ZAKUP (lib/kanal.js)');
});
