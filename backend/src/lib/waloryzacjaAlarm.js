/**
 * Logika ALARMU waloryzacji w trakcie kontraktu (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 11/12).
 *
 * Czysta funkcja, bez I/O: dostaje wskaźnik cen GUS z chwili podpisania
 * (`wskaznikBazowy`), aktualny wskaźnik GUS (`wskaznikAktualny`) oraz PRÓG
 * waloryzacji odczytany z umowy (`prog`, w procentach) i odpowiada, czy wzrost
 * cen PRZEKROCZYŁ próg — a więc czy uruchomić powiadomienie i (podzadanie 12)
 * wniosek o waloryzację. Pobranie wskaźnika z GUS i wysłanie powiadomienia to
 * osobne, „brudne" warstwy (services/gus.js, jobs/monitorWaloryzacji.js).
 *
 * Świadome decyzje:
 *  • wzrost cen liczymy WZGLĘDEM BAZY z chwili podpisania: (aktualny/bazowy - 1),
 *    bo o taką realną zmianę kosztów chodzi w art. 439/455 Pzp — nie o poziom
 *    samego wskaźnika (wskaźniki GUS bywają publikowane w różnych podstawach);
 *  • „przekroczenie progu" = wzrost STRICTLY większy niż próg, spójnie z typowym
 *    brzmieniem klauzuli („waloryzacja uruchamia się, gdy ceny zmienią się o
 *    PONAD X%") i z opisem z detektora klauzuli (lib/umowaWaloryzacja.js);
 *  • porównujemy wzrost ZAOKRĄGLONY do 2 miejsc — tę samą liczbę pokazujemy
 *    użytkownikowi, więc decyzja i to, co widzi, nigdy się nie rozjadą przez
 *    szum zmiennoprzecinkowy;
 *  • przy każdej niejednoznaczności (baza/aktualny ≤ 0, próg nieznany) NIE
 *    alarmujemy — fałszywy alarm o pieniądzach jest gorszy niż jego brak.
 */

/** Ile miejsc po przecinku ma wynik wzrostu (i próg do porównania). */
const MIEJSCA = 2;

/** Zaokrągla do 2 miejsc po przecinku (deterministycznie, bez szumu float). */
function zaokr(v) {
  const k = 10 ** MIEJSCA;
  return Math.round(v * k) / k;
}

/**
 * Wzrost cen w procentach względem bazy: (aktualny / bazowy - 1) * 100.
 * Zwraca `null`, gdy którakolwiek wartość nie jest dodatnią, skończoną liczbą
 * (wskaźnik cen jest zawsze dodatni — 0/ujemny/NaN to brak danych, nie 0% wzrostu).
 * @param {number} wskaznikBazowy wskaźnik GUS z chwili podpisania
 * @param {number} wskaznikAktualny aktualny wskaźnik GUS
 * @returns {number|null} wzrost w %, zaokrąglony do 2 miejsc, albo null
 */
export function wzrostCenProc(wskaznikBazowy, wskaznikAktualny) {
  if (!(Number.isFinite(wskaznikBazowy) && wskaznikBazowy > 0)) return null;
  if (!(Number.isFinite(wskaznikAktualny) && wskaznikAktualny > 0)) return null;
  return zaokr((wskaznikAktualny / wskaznikBazowy - 1) * 100);
}

/** Wartość procentowa po polsku (kropka dziesiętna → przecinek). */
function pl(v) {
  return String(v).replace('.', ',');
}

/**
 * Ocenia, czy wzrost cen przekroczył próg waloryzacji z umowy.
 * @param {{wskaznikBazowy: number, wskaznikAktualny: number, prog: number|null}} arg
 *   `prog` to próg z umowy w procentach; `null`/nieznany => nie da się orzec
 *   przekroczenia progu Z UMOWY (ścieżkę art. 455 Pzp dla umów bez wystarczającej
 *   klauzuli obsługuje podzadanie 12).
 * @returns {{przekroczony: boolean, wzrost: number|null, prog: number|null, powod: string}}
 *   `wzrost` = policzony wzrost cen w % (albo null przy braku danych); `powod` to
 *   krótkie zdanie „po ludzku" do logu/UI/powiadomienia.
 */
export function ocenAlarmWaloryzacji({ wskaznikBazowy, wskaznikAktualny, prog } = {}) {
  const wzrost = wzrostCenProc(wskaznikBazowy, wskaznikAktualny);
  if (wzrost === null) {
    return {
      przekroczony: false,
      wzrost: null,
      prog: Number.isFinite(prog) ? prog : null,
      powod: 'Brak kompletnych danych o wskaźnikach cen — nie można policzyć wzrostu.',
    };
  }

  if (!(Number.isFinite(prog) && prog > 0)) {
    return {
      przekroczony: false,
      wzrost,
      prog: null,
      powod: `Ceny zmieniły się o ${pl(wzrost)}%, ale w umowie nie ma jednoznacznego progu `
        + 'waloryzacji — porównania z progiem nie wykonano.',
    };
  }

  const przekroczony = wzrost > prog;
  return {
    przekroczony,
    wzrost,
    prog,
    powod: przekroczony
      ? `Wzrost cen (${pl(wzrost)}%) przekroczył próg waloryzacji z umowy (${pl(prog)}%) `
        + '— możesz wystąpić o waloryzację wynagrodzenia.'
      : `Wzrost cen (${pl(wzrost)}%) nie przekroczył jeszcze progu z umowy (${pl(prog)}%).`,
  };
}
