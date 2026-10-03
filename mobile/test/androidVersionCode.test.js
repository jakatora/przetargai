import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ustawVersionCode, PRZESUNIECIE, MAKS_VERSION_CODE } from '../scripts/set-android-version-code.mjs';

/*
 * NUMER WERSJI ANDROIDA W CI (codemagic.yaml → android-release, 2026-10-03).
 *
 * Krok „Numer wersji" robił `sed "s/versionCode 1$/…/"`. `expo prebuild` wpisuje jednak do
 * build.gradle wartość z app.json (dziś 17), więc wzorzec nie trafiał, podmiana była
 * no-opem, a `grep` po niej wywracał build. Skrypt dopasowuje dowolną całkowitą wartość,
 * ustawia BUILD_NUMBER + 100 i każdą niejasność zamienia w jawny błąd.
 */

const KATALOG = path.dirname(fileURLToPath(import.meta.url));
const SKRYPT = path.resolve(KATALOG, '../scripts/set-android-version-code.mjs');

/** Wycinek build.gradle w kształcie, jaki generuje `expo prebuild` (Expo 54) dla tej aplikacji. */
const gradle = (versionCode, versionName = '1.1.5') => `android {
    ndkVersion rootProject.ext.ndkVersion

    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'pl.przetargai.app'
    defaultConfig {
        applicationId 'pl.przetargai.app'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode ${versionCode}
        versionName "${versionName}"

        buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL", "\\"\${findProperty('reactNativeReleaseLevel') ?: 'stable'}\\""
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
}
`;

// ── Podmiana ─────────────────────────────────────────────────────────────────

test('stara wartość z szablonu (versionCode 1) → BUILD_NUMBER + 100', () => {
  const { tresc, stary, nowy } = ustawVersionCode(gradle(1, '1.0.0'), '20');
  assert.equal(stary, 1);
  assert.equal(nowy, 120);
  assert.equal(tresc, gradle(120, '1.0.0'), 'zmienia się wyłącznie linia versionCode');
});

test('wartość z app.json (versionCode 17) → BUILD_NUMBER + 100 (to psuł stary sed)', () => {
  const { tresc, stary, nowy } = ustawVersionCode(gradle(17), '20');
  assert.equal(stary, 17);
  assert.equal(nowy, 120);
  assert.equal(tresc, gradle(120));
  assert.match(tresc, /^ {8}versionCode 120$/m, 'wcięcie zachowane');
  assert.match(tresc, /versionName "1\.1\.5"/, 'versionName nietknięte');
  // Dla porównania: wzorzec z poprzedniej wersji kroku nie znajdował niczego.
  assert.doesNotMatch(gradle(17), /versionCode 1$/m);
});

test('dowolna całkowita wartość i różne odstępy; kod rośnie z numerem builda', () => {
  assert.equal(ustawVersionCode(gradle(16), 21).nowy, 121);
  assert.equal(ustawVersionCode(gradle(99), '0').nowy, PRZESUNIECIE);
  assert.equal(ustawVersionCode('\tversionCode\t  7   \n', ' 5 ').tresc, '\tversionCode 105\n');
  const kolejne = [1, 2, 3].map((n) => ustawVersionCode(gradle(17), n).nowy);
  assert.deepEqual(kolejne, [101, 102, 103]);
});

test('końce linii CRLF zostają CRLF', () => {
  const crlf = gradle(17).replace(/\n/g, '\r\n');
  const { tresc } = ustawVersionCode(crlf, '20');
  assert.equal(tresc, gradle(120).replace(/\n/g, '\r\n'));
});

test('komentarz i podobna nazwa nie są wpisem versionCode', () => {
  const zKomentarzem = gradle(17).replace('defaultConfig {', 'defaultConfig {\n        // versionCode 1 był w szablonie\n        versionCodeOverride 5');
  const { tresc, stary } = ustawVersionCode(zKomentarzem, '20');
  assert.equal(stary, 17);
  assert.match(tresc, /\/\/ versionCode 1 był w szablonie/);
  assert.match(tresc, /versionCodeOverride 5/);
  assert.match(tresc, /^ {8}versionCode 120$/m);
});

// ── Złe albo brakujące dane → jawny błąd ─────────────────────────────────────

test('brak wpisu versionCode → błąd, nie cichy no-op', () => {
  const bez = gradle(17).replace(/^ *versionCode 17\n/m, '');
  assert.throws(() => ustawVersionCode(bez, '20'), /nie znaleziono wpisu „versionCode"/);
  assert.throws(() => ustawVersionCode('', '20'), /pusty albo nieczytelny/);
  assert.throws(() => ustawVersionCode(undefined, '20'), /pusty albo nieczytelny/);
});

test('dwa wpisy versionCode → błąd (nie wiadomo, który jest właściwy)', () => {
  const dwa = gradle(17).replace('versionName', 'versionCode 3\n        versionName');
  assert.throws(() => ustawVersionCode(dwa, '20'), /występuje 2 razy/);
});

test('wartość nieliczbowa → błąd z pokazaną wartością', () => {
  for (const zla of ['rootProject.ext.versionCode', '= 17', '17.5', '-3', '"17"', '']) {
    assert.throws(
      () => ustawVersionCode(gradle(zla), '20'),
      /nie jest liczbą całkowitą/,
      `versionCode ${zla}`,
    );
  }
});

test('zły albo brakujący BUILD_NUMBER → błąd', () => {
  for (const zly of [undefined, null, '', '  ', 'abc', '12a', '-1', '1.5', '0x10', {}, Number.NaN]) {
    assert.throws(() => ustawVersionCode(gradle(17), zly), /BUILD_NUMBER musi być/, JSON.stringify(zly));
  }
  assert.throws(() => ustawVersionCode(gradle(17), String(MAKS_VERSION_CODE)), /przekracza limit Google Play/);
});

test('kod, który nie rośnie względem app.json → błąd (Play odrzuciłby upload)', () => {
  assert.throws(() => ustawVersionCode(gradle(120), '20'), /nie jest większy od obecnego 120/);
  assert.throws(() => ustawVersionCode(gradle(500), '20'), /kod wersji musi rosnąć/);
  assert.equal(ustawVersionCode(gradle(119), '20').nowy, 120);
});

// ── Skrypt uruchamiany tak, jak w CI ─────────────────────────────────────────

function uruchom(tresc, env) {
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-vc-'));
  const plik = path.join(katalog, 'build.gradle');
  if (tresc !== null) fs.writeFileSync(plik, tresc, 'utf8');
  const srodowisko = { ...process.env, ...env };
  if (!('BUILD_NUMBER' in env)) delete srodowisko.BUILD_NUMBER;
  const wynik = spawnSync(process.execPath, [SKRYPT, plik], { encoding: 'utf8', env: srodowisko });
  const po = fs.existsSync(plik) ? fs.readFileSync(plik, 'utf8') : null;
  fs.rmSync(katalog, { recursive: true, force: true });
  return { kod: wynik.status, stdout: wynik.stdout, stderr: wynik.stderr, po };
}

test('CLI: versionCode 17 i BUILD_NUMBER=20 → plik ma 120, kod wyjścia 0', () => {
  const w = uruchom(gradle(17), { BUILD_NUMBER: '20' });
  assert.equal(w.kod, 0, w.stderr);
  assert.equal(w.po, gradle(120));
  assert.match(w.stdout, /versionCode: 17 -> 120 \(BUILD_NUMBER 20 \+ 100\)/);
});

test('CLI: versionCode 1 (stary szablon) działa tak samo', () => {
  const w = uruchom(gradle(1, '1.0.0'), { BUILD_NUMBER: '1' });
  assert.equal(w.kod, 0, w.stderr);
  assert.equal(w.po, gradle(101, '1.0.0'));
});

test('CLI: błąd = kod 1, komunikat „BŁĄD:" i plik NIETKNIĘTY', () => {
  const przypadki = [
    [gradle(17), {}, /BUILD_NUMBER musi być/],
    [gradle(17), { BUILD_NUMBER: 'abc' }, /BUILD_NUMBER musi być/],
    [gradle('rootProject.ext.versionCode'), { BUILD_NUMBER: '20' }, /nie jest liczbą całkowitą/],
    [gradle(17).replace(/^ *versionCode 17\n/m, ''), { BUILD_NUMBER: '20' }, /nie znaleziono wpisu/],
    [gradle(500), { BUILD_NUMBER: '20' }, /nie jest większy/],
  ];
  for (const [tresc, env, wzor] of przypadki) {
    const w = uruchom(tresc, env);
    assert.equal(w.kod, 1, `oczekiwany błąd: ${wzor}`);
    assert.match(w.stderr, /^BŁĄD: /);
    assert.match(w.stderr, wzor);
    assert.equal(w.po, tresc, 'przy błędzie plik zostaje bez zmian');
  }
});

test('CLI: brak pliku build.gradle → jawny błąd z podpowiedzią o prebuild', () => {
  const w = uruchom(null, { BUILD_NUMBER: '20' });
  assert.equal(w.kod, 1);
  assert.match(w.stderr, /nie znaleziono .*build\.gradle — uruchom najpierw „expo prebuild"/);
});

// ── codemagic.yaml ───────────────────────────────────────────────────────────

const YAML = fs.readFileSync(path.resolve(KATALOG, '../../codemagic.yaml'), 'utf8').replace(/\r\n/g, '\n');
const ANDROID = YAML.slice(YAML.indexOf('  android-release:'));
const IOS = YAML.slice(YAML.indexOf('  ios-release:'), YAML.indexOf('  # ========================== Android'));

test('codemagic.yaml: krok „Numer wersji" woła skrypt, a kruchy sed zniknął', () => {
  assert.match(ANDROID, /- name: Numer wersji\n(?: {8}#.*\n)+ {8}script: cd mobile && node scripts\/set-android-version-code\.mjs\n/);
  const bezKomentarzy = ANDROID.replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(bezKomentarzy, /sed -i/);
  assert.doesNotMatch(bezKomentarzy, /versionCode 1\$/);
  // Kolejność: prebuild → podpis → numer wersji → build.
  const kroki = [...ANDROID.matchAll(/- name: (.+)\n/g)].map((m) => m[1]);
  assert.deepEqual(kroki, [
    'Instalacja zależności', 'Kontrola google-services.json', 'Expo prebuild (Android)',
    'Konfiguracja podpisu release', 'Numer wersji', 'Build AAB',
  ]);
});

test('codemagic.yaml: podpis, grupy i publikacja Androida bez zmian', () => {
  assert.match(ANDROID, /android_signing:\n {8}- przetargai_keystore/);
  assert.match(ANDROID, /groups:\n {8}- google_credentials[^\n]*\n {8}- produkcja/);
  assert.match(ANDROID, /script: cd mobile && node scripts\/configure-android-release-signing\.mjs/);
  assert.match(ANDROID, /credentials: \$GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS\n {8}track: internal\n {8}submit_as_draft: true/);
});

test('codemagic.yaml: workflow iOS nietknięty (podpis, numer builda, publikacja)', () => {
  assert.match(IOS, /groups:\n {8}- ios_signing[^\n]*\n {8}- produkcja/);
  assert.match(IOS, /app-store-connect fetch-signing-files "\$BUNDLE_ID" \\\n {12}--type IOS_APP_STORE --create/);
  assert.match(IOS, /script: cd mobile\/ios && agvtool new-version -all \$\(\(\$BUILD_NUMBER \+ 100\)\)/);
  assert.match(IOS, /submit_to_testflight: true\n {8}submit_to_app_store: false/);
  assert.doesNotMatch(IOS, /set-android-version-code/);
});
