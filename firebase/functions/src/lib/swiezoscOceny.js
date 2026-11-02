import { MIN_DNI_DOMYSLNIE } from './kartaFirmy.js';

/*
 * Czy wcześniejsza decyzja selekcji jest wciąż AKTUALNA dla tego przetargu (2026-10-25,
 * follow-up pracownika „termin jako odrzucenie trwałe"). Baza Konkurencyjności i BZP
 * regularnie PRZEDŁUŻAJĄ termin składania ofert — odrzucenie „za mało dni na ofertę"
 * sprzed przedłużenia nie powinno trzymać przetargu poza selekcją do końca świata.
 *
 * Reguła: ślad z tej samej wersji karty jest aktualny, CHYBA ŻE to odrzucenie
 * z przyczyną „termin", a termin w ogłoszeniu jest teraz późniejszy niż zapisany
 * przy odrzuceniu — wtedy kandydat wraca do lejka (reguły → heurystyka → AI).
 * Inne przyczyny (branża, teren, kwoty) nie zależą od terminu, więc zostają.
 */
export function ocenaAktualna(ocena, { tender = null, criteriaHash, potrzebaDni = null, teraz = null } = {}) {
  if (!ocena || typeof ocena !== 'object') return false;
  if (criteriaHash !== undefined && ocena.criteria_hash !== criteriaHash) return false;
  if (ocena.decyzja === 'odrzucony' && ocena.przyczyna === 'termin') {
    const byl = Date.parse(ocena.termin ?? '');
    const jest = Date.parse(tender?.deadline ?? '');
    if (Number.isFinite(byl) && Number.isFinite(jest) && jest > byl) return false;
    // Reguła złagodniała (2026-11-02: zapytania ofertowe 3 dni zamiast 5) — gdy przy OBECNYM progu przetarg zdąży,
    // odrzucenie przestaje obowiązywać. Bez zmiany wersji karty, więc reszta ocen (i koszt AI) zostaje.
    // Tylko gdy próg SPADŁ od odrzucenia (ślad bez `prog_dni` powstał przy domyślnych 5 dniach): inaczej odrzucenie
    // AI z przyczyną „termin” przy 3–4 dniach wracałoby do płatnej oceny w każdym przebiegu.
    if (typeof potrzebaDni === 'function' && Number.isFinite(jest) && teraz) {
      const potrzeba = potrzebaDni(tender);
      if ((ocena.prog_dni ?? MIN_DNI_DOMYSLNIE) > potrzeba && (jest - Date.parse(teraz)) / 86_400_000 >= potrzeba) return false;
    }
  }
  return true;
}
