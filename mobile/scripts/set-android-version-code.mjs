/*
 * Ustawia `versionCode` w android/app/build.gradle po `expo prebuild`.
 * Uruchamiany w CI (Codemagic) z katalogu mobile/:  node scripts/set-android-version-code.mjs
 *
 * Wejście: zmienna środowiskowa BUILD_NUMBER (numer builda Codemagic).
 * Nowy kod wersji = BUILD_NUMBER + 100 — rośnie z każdym buildem workflow.
 *
 * Dlaczego osobny skrypt (2026-10-03): krok w codemagic.yaml robił
 * `sed "s/versionCode 1$/…/"`, zakładając, że prebuild zawsze wpisuje `versionCode 1`.
 * `expo prebuild` wpisuje jednak wartość z app.json (`android.versionCode`, dziś 17) —
 * wzorzec nie trafiał, podmiana była no-opem, a następujący po niej `grep` wywracał build.
 * Tu dopasowujemy DOWOLNĄ całkowitą wartość, a każdą niejasność zamieniamy w jawny błąd:
 * brak wpisu, więcej niż jeden wpis, wartość nieliczbowa, zły BUILD_NUMBER, kod, który
 * nie rośnie względem tego z app.json (Google Play odrzuciłby taki upload).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** O ile kod wersji wyprzedza numer builda Codemagic (zgodnie z workflow iOS). */
export const PRZESUNIECIE = 100;
/** Górna granica versionCode akceptowana przez Google Play. */
export const MAKS_VERSION_CODE = 2_100_000_000;

/**
 * Podmienia jedyny wpis `versionCode <liczba>` na `BUILD_NUMBER + 100`.
 * Czysta funkcja: niczego nie czyta ani nie zapisuje.
 *
 * @param {string} tresc treść android/app/build.gradle
 * @param {string|number} buildNumber numer builda Codemagic
 * @returns {{tresc: string, stary: number, nowy: number}}
 * @throws {Error} z czytelnym powodem — wołający ma przerwać build
 */
export function ustawVersionCode(tresc, buildNumber) {
  if (typeof tresc !== 'string' || !tresc.trim()) {
    throw new Error('build.gradle jest pusty albo nieczytelny');
  }
  const numer = typeof buildNumber === 'number' ? String(buildNumber) : String(buildNumber ?? '').trim();
  if (!/^\d+$/.test(numer)) {
    throw new Error(`BUILD_NUMBER musi być nieujemną liczbą całkowitą (jest: ${JSON.stringify(buildNumber ?? null)})`);
  }
  const nowy = Number(numer) + PRZESUNIECIE;
  if (!Number.isSafeInteger(nowy) || nowy > MAKS_VERSION_CODE) {
    throw new Error(`versionCode ${numer} + ${PRZESUNIECIE} przekracza limit Google Play (${MAKS_VERSION_CODE})`);
  }

  // Każda linia zaczynająca się od `versionCode` — także z wartością, której nie rozumiemy.
  const wpisy = [...tresc.matchAll(/^[ \t]*versionCode\b([^\r\n]*)$/gm)];
  if (wpisy.length === 0) {
    throw new Error('nie znaleziono wpisu „versionCode" w build.gradle — czy wykonano „expo prebuild"?');
  }
  if (wpisy.length > 1) {
    throw new Error(`wpis „versionCode" występuje ${wpisy.length} razy — oczekiwano dokładnie jednego`);
  }
  const wartosc = wpisy[0][1].trim();
  if (!/^\d+$/.test(wartosc)) {
    throw new Error(`wartość „versionCode" nie jest liczbą całkowitą (jest: „${wartosc}")`);
  }
  const stary = Number(wartosc);
  if (nowy <= stary) {
    throw new Error(
      `nowy versionCode ${nowy} (BUILD_NUMBER ${numer} + ${PRZESUNIECIE}) nie jest większy od obecnego ${stary} — `
      + 'kod wersji musi rosnąć; zwiększ przesunięcie albo popraw android.versionCode w app.json',
    );
  }

  const wynik = tresc.replace(/^([ \t]*versionCode)\b[^\r\n]*$/m, `$1 ${nowy}`);
  // Kontrola podmiany: dokładnie jeden wpis i ma nową wartość.
  const po = [...wynik.matchAll(/^[ \t]*versionCode[ \t]+(\d+)[ \t]*$/gm)];
  if (po.length !== 1 || Number(po[0][1]) !== nowy) {
    throw new Error('podmiana „versionCode" nie powiodła się (wynik nie zawiera oczekiwanego wpisu)');
  }
  return { tresc: wynik, stary, nowy };
}

const uruchomionyWprost = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (uruchomionyWprost) {
  const gradlePath = process.argv[2] ?? path.join('android', 'app', 'build.gradle');
  try {
    if (!fs.existsSync(gradlePath)) {
      throw new Error(`nie znaleziono ${gradlePath} — uruchom najpierw „expo prebuild"`);
    }
    const { tresc, stary, nowy } = ustawVersionCode(fs.readFileSync(gradlePath, 'utf8'), process.env.BUILD_NUMBER);
    fs.writeFileSync(gradlePath, tresc, 'utf8');
    // Sprawdzamy to, co faktycznie leży na dysku — tego użyje Gradle.
    const zapisane = fs.readFileSync(gradlePath, 'utf8').match(/^[ \t]*versionCode[ \t]+(\d+)[ \t]*$/m);
    if (!zapisane || Number(zapisane[1]) !== nowy) {
      throw new Error(`po zapisie ${gradlePath} nie zawiera „versionCode ${nowy}"`);
    }
    console.log(`versionCode: ${stary} -> ${nowy} (BUILD_NUMBER ${process.env.BUILD_NUMBER} + ${PRZESUNIECIE}) w ${gradlePath}`);
  } catch (err) {
    console.error(`BŁĄD: ${err.message}`);
    process.exit(1);
  }
}
