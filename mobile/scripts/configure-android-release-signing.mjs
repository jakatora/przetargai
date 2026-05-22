/*
 * Konfiguruje podpis release Androida po `expo prebuild`.
 * Uruchamiany w CI (Codemagic) z katalogu mobile/.
 *
 * Wejście — zmienne środowiskowe ustawiane przez Codemagic dla referencji
 * keystore (`android_signing`): CM_KEYSTORE_PATH, CM_KEYSTORE_PASSWORD,
 * CM_KEY_ALIAS, CM_KEY_PASSWORD.
 *
 * Działanie (idempotentne):
 *  1. Dopisuje dane keystore do android/gradle.properties.
 *  2. Dodaje signingConfig „release" w android/app/build.gradle i przełącza
 *     buildType release na ten config (domyślnie Expo używa debug).
 */
import fs from 'node:fs';
import path from 'node:path';

const gradlePath = path.join('android', 'app', 'build.gradle');
const propsPath = path.join('android', 'gradle.properties');

const {
  CM_KEYSTORE_PATH,
  CM_KEYSTORE_PASSWORD = '',
  CM_KEY_ALIAS = '',
  CM_KEY_PASSWORD = '',
} = process.env;

if (!CM_KEYSTORE_PATH) {
  console.error('BŁĄD: brak CM_KEYSTORE_PATH — skonfiguruj keystore (android_signing) w Codemagic.');
  process.exit(1);
}
if (!fs.existsSync(gradlePath)) {
  console.error(`BŁĄD: nie znaleziono ${gradlePath} — uruchom najpierw „expo prebuild".`);
  process.exit(1);
}

// --- 1. gradle.properties ---
let props = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, 'utf8') : '';
if (!props.includes('PRZETARGAI_UPLOAD_STORE_FILE')) {
  props += [
    '',
    '# PrzetargAI — dane keystore release (wstrzyknięte przez CI)',
    `PRZETARGAI_UPLOAD_STORE_FILE=${CM_KEYSTORE_PATH}`,
    `PRZETARGAI_UPLOAD_STORE_PASSWORD=${CM_KEYSTORE_PASSWORD}`,
    `PRZETARGAI_UPLOAD_KEY_ALIAS=${CM_KEY_ALIAS}`,
    `PRZETARGAI_UPLOAD_KEY_PASSWORD=${CM_KEY_PASSWORD}`,
    '',
  ].join('\n');
  fs.writeFileSync(propsPath, props);
  console.log('gradle.properties: dopisano dane keystore.');
}

// --- 2. build.gradle ---
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (gradle.includes('PRZETARGAI_RELEASE_SIGNING')) {
  console.log('build.gradle: podpis release już skonfigurowany.');
  process.exit(0);
}

const releaseSigningConfig = `
        release {
            // PRZETARGAI_RELEASE_SIGNING
            storeFile file(PRZETARGAI_UPLOAD_STORE_FILE)
            storePassword PRZETARGAI_UPLOAD_STORE_PASSWORD
            keyAlias PRZETARGAI_UPLOAD_KEY_ALIAS
            keyPassword PRZETARGAI_UPLOAD_KEY_PASSWORD
        }`;

if (!/signingConfigs\s*\{/.test(gradle)) {
  console.error('BŁĄD: w build.gradle brak bloku signingConfigs — sprawdź szablon Expo.');
  process.exit(1);
}

gradle = gradle.replace(/signingConfigs\s*\{/, (match) => match + releaseSigningConfig);

// buildType „release" — przełącz z signingConfigs.debug na signingConfigs.release.
const before = gradle;
gradle = gradle.replace(
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.)debug/,
  '$1release',
);
if (gradle === before) {
  console.warn('UWAGA: nie udało się przełączyć buildType release na signingConfigs.release — sprawdź build.gradle ręcznie.');
}

fs.writeFileSync(gradlePath, gradle);
console.log('build.gradle: skonfigurowano podpis release.');
