/**
 * „KONTROLER GWARANCJI WADIALNEJ — wadium z banku, które nie utopi oferty" — czysta logika
 * (testowalna `node:test`). Ekran renderuje werdykt; kolor dokłada motyw.js z `ton`.
 *
 * PROBLEM: gdy wykonawca wnosi wadium gwarancją bankową/ubezpieczeniową, treść gwarancji musi
 * LITERALNIE obejmować WSZYSTKIE przesłanki zatrzymania wadium — brak choćby jednej = oferta
 * odrzucona (utrwalona linia KIO). Do tego zły beneficjent albo za krótka ważność też wywracają
 * ofertę, a przy konsorcjum gwarancja musi obejmować wszystkich członków.
 *
 * PODSTAWA PRAWNA — art. 98 ust. 6 Pzp (przesłanki zatrzymania wadium):
 *  pkt 1 — wykonawca w odpowiedzi na wezwanie (art. 128 ust. 1) z przyczyn leżących po jego
 *          stronie nie złożył podmiotowych środków dowodowych / oświadczeń / pełnomocnictw,
 *          co uniemożliwiło wybór jego oferty jako najkorzystniejszej;
 *  pkt 2 — odmówił podpisania umowy na warunkach określonych w ofercie;
 *  pkt 3 — zawarcie umowy stało się niemożliwe z przyczyn po jego stronie / nie wniósł
 *          zabezpieczenia należytego wykonania umowy.
 * Ważność: gwarancja musi obowiązywać przez cały termin związania ofertą (i obejmować jego
 * przedłużenie). Nieodwołalna, bezwarunkowa, płatna na pierwsze żądanie.
 */

/** Wymogi kontrolne. `krytyczny` = brak = odrzucenie oferty (nie tylko ryzyko). */
export const WYMOGI = Object.freeze([
  { klucz: 'beneficjent', krytyczny: true, etykieta: 'Właściwy beneficjent',
    opis: 'Beneficjentem jest DOKŁADNIE ten zamawiający z SWZ (nazwa i adres) — nie oddział, nie pełnomocnik.' },
  { klucz: 'przeslanka1', krytyczny: true, etykieta: 'Przesłanka pkt 1 (nieuzupełnienie dokumentów)',
    opis: 'Gwarancja obejmuje art. 98 ust. 6 pkt 1: nieuzupełnienie środków dowodowych / oświadczeń / pełnomocnictw na wezwanie.' },
  { klucz: 'przeslanka2', krytyczny: true, etykieta: 'Przesłanka pkt 2 (odmowa podpisania umowy)',
    opis: 'Gwarancja obejmuje odmowę podpisania umowy na warunkach oferty.' },
  { klucz: 'przeslanka3', krytyczny: true, etykieta: 'Przesłanka pkt 3 (niemożność zawarcia / brak zabezpieczenia)',
    opis: 'Gwarancja obejmuje niemożność zawarcia umowy z winy wykonawcy oraz niewniesienie zabezpieczenia należytego wykonania.' },
  { klucz: 'waznosc', krytyczny: true, etykieta: 'Ważność ≥ termin związania ofertą',
    opis: 'Okres obowiązywania pokrywa cały termin związania ofertą i jego ewentualne przedłużenie.' },
  { klucz: 'nieodwolalna', krytyczny: true, etykieta: 'Nieodwołalna, na pierwsze żądanie',
    opis: 'Gwarancja jest bezwarunkowa, nieodwołalna i płatna na pierwsze pisemne żądanie zamawiającego.' },
  { klucz: 'forma', krytyczny: false, etykieta: 'Forma elektroniczna (oryginał gwaranta)',
    opis: 'Oryginał w formie elektronicznej z podpisem kwalifikowanym gwaranta — nie skan papierowej gwarancji.' },
  { klucz: 'konsorcjum', krytyczny: true, etykieta: 'Obejmuje wszystkich członków konsorcjum',
    opis: 'Przy ofercie wspólnej gwarancja wymienia wszystkich konsorcjantów lub obejmuje działania/zaniechania każdego z nich.',
    tylkoKonsorcjum: true },
]);

/**
 * Wymogi mające zastosowanie (konsorcjum tylko przy ofercie wspólnej).
 * @param {{konsorcjum?: boolean}} opcje
 */
export function wymogiDla(opcje = {}) {
  return WYMOGI.filter((w) => !w.tylkoKonsorcjum || opcje.konsorcjum);
}

/**
 * Ocena gwarancji na podstawie odpowiedzi (klucz → boolean „spełnia").
 * @param {Object<string, boolean>} odpowiedzi
 * @param {{konsorcjum?: boolean}} opcje
 * @returns {{gotowa: boolean, braki: Array, krytyczneBraki: number, ton: string, wymogi: Array}}
 */
export function ocenaGwarancji(odpowiedzi = {}, opcje = {}) {
  const wymogi = wymogiDla(opcje);
  const braki = wymogi.filter((w) => !odpowiedzi[w.klucz]);
  const krytyczneBraki = braki.filter((w) => w.krytyczny).length;
  const gotowa = braki.length === 0;
  let ton;
  if (krytyczneBraki > 0) ton = 'danger';
  else if (braki.length > 0) ton = 'ostrzezenie';
  else ton = 'sukces';
  return { gotowa, braki, krytyczneBraki, ton, wymogi };
}

/** Jednozdaniowy werdykt do nagłówka. */
export function werdykt({ gotowa, krytyczneBraki, braki } = {}) {
  if (gotowa) return 'Gwarancja gotowa — obejmuje wszystkie wymogi';
  if (krytyczneBraki > 0) {
    return `Nie wnoś tej gwarancji — ${krytyczneBraki} krytyczny brak = odrzucenie oferty`;
  }
  return `Do poprawy: ${braki.length} drobny brak`;
}
