/**
 * Województwa — mapa kodów TERYT (BZP `organizationProvince`, format „PLxx") na nazwy,
 * plus filtr feedu po regionie. Wykonawcy zwykle pracują w kilku województwach, więc filtr
 * po regionie realnie skraca przeglądanie.
 *
 * Region dochodzi do dopasowań „w przód" (denormalizacja na backendzie) — starsze/zagraniczne
 * (TED) mogą mieć null. Filtr pokazujemy tylko, gdy w feedzie SĄ dane regionu (patrz feed).
 */

export const WOJEWODZTWA = {
  '02': 'Dolnośląskie', '04': 'Kujawsko-pomorskie', '06': 'Lubelskie', '08': 'Lubuskie',
  '10': 'Łódzkie', '12': 'Małopolskie', '14': 'Mazowieckie', '16': 'Opolskie',
  '18': 'Podkarpackie', '20': 'Podlaskie', '22': 'Pomorskie', '24': 'Śląskie',
  '26': 'Świętokrzyskie', '28': 'Warmińsko-mazurskie', '30': 'Wielkopolskie', '32': 'Zachodniopomorskie',
};

/** Normalizuje wartość województwa („PL02" / „02" / „2") do 2-cyfrowego kodu TERYT albo null. */
export function kodWojewodztwa(w) {
  if (!w) return null;
  const cyfry = String(w).replace(/\D/g, '');
  if (!cyfry) return null;
  const kod = cyfry.slice(-2).padStart(2, '0');
  return WOJEWODZTWA[kod] ? kod : null;
}

/** Nazwa województwa z wartości surowej (albo null, gdy nierozpoznane). */
export function nazwaWojewodztwa(w) {
  const k = kodWojewodztwa(w);
  return k ? WOJEWODZTWA[k] : null;
}

/** Kody województw OBECNE w dopasowaniach, posortowane po nazwie (do zbudowania filtra). */
export function wojewodztwaObecne(dopasowania) {
  const kody = new Set();
  for (const m of Array.isArray(dopasowania) ? dopasowania : []) {
    const k = kodWojewodztwa(m?.tender?.wojewodztwo);
    if (k) kody.add(k);
  }
  return [...kody].sort((a, b) => WOJEWODZTWA[a].localeCompare(WOJEWODZTWA[b], 'pl'));
}

/** Filtruje dopasowania po kodzie województwa. Pusty/null kod = bez filtra (wszystkie). */
export function filtrujWojewodztwo(dopasowania, kod) {
  const lista = Array.isArray(dopasowania) ? dopasowania : [];
  if (!kod) return lista;
  return lista.filter((m) => kodWojewodztwa(m?.tender?.wojewodztwo) === kod);
}
