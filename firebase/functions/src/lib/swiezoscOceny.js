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
export function ocenaAktualna(ocena, { tender = null, criteriaHash } = {}) {
  if (!ocena || typeof ocena !== 'object') return false;
  if (criteriaHash !== undefined && ocena.criteria_hash !== criteriaHash) return false;
  if (ocena.decyzja === 'odrzucony' && ocena.przyczyna === 'termin') {
    const byl = Date.parse(ocena.termin ?? '');
    const jest = Date.parse(tender?.deadline ?? '');
    if (Number.isFinite(byl) && Number.isFinite(jest) && jest > byl) return false;
  }
  return true;
}
