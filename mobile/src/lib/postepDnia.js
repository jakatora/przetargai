/**
 * Postęp decyzji dnia (2026-11-12, runda 2 ulepszeń; kierunek z projektu UI: „jedna decyzja naraz”,
 * stan „Gotowe” po ostatniej). Czysta logika — panel `PanelWyboru` tylko ją rysuje.
 *
 * `razem` to wybrane DZIŚ według raportu serwera (`raport.wybrane`), bo odrzucone („Nie dla nas”)
 * znikają z listy `wybrane` po odświeżeniu — bez raportu pasek liczyłby od nowa po każdej decyzji.
 * Decyzją jest „Biorę” (wzięty w tej wizycie albo zapisany z etapem „Przygotowuję ofertę”) i odrzucenie.
 *
 * @param {{wybrane?: Array<{id: string, status?: string}>, raportWybrane?: number,
 *   czyWziety: (m: object) => boolean}} wejscie
 * @returns {{razem: number, zostalo: number, zdecydowane: number, wziete: number, gotowe: boolean,
 *   kolejnosc: object[]}} `kolejnosc` — najpierw czekające na decyzję, potem wzięte (stabilnie)
 */
export function postepDnia({ wybrane = [], raportWybrane = 0, czyWziety = () => false } = {}) {
  const lista = (Array.isArray(wybrane) ? wybrane : []).filter(Boolean);
  const czekajace = lista.filter((m) => !czyWziety(m));
  const wziete = lista.length - czekajace.length;
  const razem = Math.max(Number(raportWybrane) || 0, lista.length);
  const zostalo = czekajace.length;
  return {
    razem,
    zostalo,
    zdecydowane: razem - zostalo,
    wziete,
    gotowe: razem > 0 && zostalo === 0,
    kolejnosc: [...czekajace, ...lista.filter((m) => czyWziety(m))],
  };
}

/** Podpis paska: „Do decyzji: 2 z 4” albo null, gdy nie ma czego decydować. */
export function podpisPostepu({ razem, zostalo }) {
  if (!razem || !zostalo) return null;
  return { pl: `Do decyzji: ${zostalo} z ${razem}`, en: `Left to decide: ${zostalo} of ${razem}` };
}

/** Treść karty „Na dziś gotowe”. */
export function opisGotowego({ razem, wziete }) {
  // Odmiana: 1 — „Dzisiejszy przetarg ma”, 2–4 (poza 12–14) — „Wszystkie 3 dzisiejsze przetargi mają”, reszta — „Wszystkie 5 dzisiejszych przetargów ma”.
  const kilka = razem % 10 >= 2 && razem % 10 <= 4 && (razem % 100 < 10 || razem % 100 >= 20);
  const zdanie = razem === 1 ? 'Dzisiejszy przetarg ma decyzję.'
    : kilka ? `Wszystkie ${razem} dzisiejsze przetargi mają decyzję.` : `Wszystkie ${razem} dzisiejszych przetargów ma decyzję.`;
  const pl = wziete > 0
    ? `${zdanie} Bierzesz ${wziete} — ${wziete === 1 ? 'jest' : 'są'} w Zapisanych z przypomnieniami przed terminem.`
    : `${zdanie} Żadnego dziś nie bierzesz — Twoje przyczyny poprawią jutrzejszy wybór.`;
  const zdanieEn = razem === 1 ? "Today's tender has a decision." : `All ${razem} of today's tenders have a decision.`;
  const en = wziete > 0
    ? `${zdanieEn} You are bidding on ${wziete} — saved with deadline reminders.`
    : `${zdanieEn} None taken today — your reasons will sharpen tomorrow's picks.`;
  return { pl, en };
}
