/**
 * „KREATOR SAMOOCZYSZCZENIA — druga szansa po karze lub zerwanej umowie" — czysta
 * logika (testowalna `node:test`).
 *
 * PROBLEM: wykonawca z „skazą" w historii (rozwiązana umowa, kary umowne, poważne naruszenie
 * obowiązków zawodowych) sądzi, że jest wykluczony na starcie — a Pzp daje procedurę
 * naprawczą (self-cleaning), o której mało kto wie.
 *
 * PODSTAWA PRAWNA — art. 110 ust. 2 Pzp: wykonawca podlegający wykluczeniu NIE podlega mu, jeśli
 * udowodni, że łącznie: (1) naprawił albo zobowiązał się naprawić szkodę (odszkodowanie);
 * (2) wyczerpująco wyjaśnił fakty i okoliczności, aktywnie współpracując z organami; (3) podjął
 * KONKRETNE środki techniczne, organizacyjne i kadrowe, odpowiednie do zapobieżenia dalszym
 * nieprawidłowościom. Zamawiający ocenia wystarczalność — dowody muszą być konkretne.
 *
 * ZAKRES (poprawka 2026-09-25): art. 110 ust. 2 obejmuje WYŁĄCZNIE podstawy z art. 108 ust. 1
 * pkt 1, 2, 5 i art. 109 ust. 1 pkt 2–5, 7–10. Ekran obiecywał procedurę także przy
 * zaległościach ZUS/US — błąd prawny: zaległości podatkowe i składkowe (art. 108 ust. 1 pkt 3,
 * art. 109 ust. 1 pkt 1) usuwa tylko zapłata z odsetkami/grzywnami albo wiążące porozumienie
 * w sprawie spłaty, zawarte PRZED upływem terminu składania ofert (wniosków).
 */

/** Podstawy wykluczenia objęte samooczyszczeniem — zamknięta lista z art. 110 ust. 2 Pzp. */
export const PODSTAWY_110 = Object.freeze({
  art108: Object.freeze([1, 2, 5]), // art. 108 ust. 1 pkt …
  art109: Object.freeze([2, 3, 4, 5, 7, 8, 9, 10]), // art. 109 ust. 1 pkt …
});

/**
 * Czy podstawę wykluczenia (art. 108 ust. 1 / art. 109 ust. 1, punkt) da się usunąć procedurą
 * z art. 110 ust. 2. Zaległości podatkowe/ZUS (108.1.3, 109.1.1) → false.
 * @param {number|string} artykul 108 albo 109
 * @param {number|string} pkt numer punktu w ust. 1
 */
export function czyObjeteSamooczyszczeniem(artykul, pkt) {
  const a = Number(artykul);
  const lista = a === 108 ? PODSTAWY_110.art108 : a === 109 ? PODSTAWY_110.art109 : [];
  return lista.includes(Number(pkt));
}

/** Wstęp ekranu — tylko przypadki, które art. 110 ust. 2 faktycznie obejmuje. */
export const WSTEP =
  'Masz w historii firmy skazę — rozwiązaną albo nienależycie wykonaną wcześniejszą umowę '
  + '(kary, odszkodowanie), poważne naruszenie obowiązków zawodowych, wprowadzenie zamawiającego '
  + 'w błąd albo wyrok wobec członka zarządu? To nie musi kończyć startów. Art. 110 ust. 2 Pzp '
  + 'daje procedurę naprawczą: udowodnij trzy rzeczy łącznie, a zamawiający może odstąpić od '
  + 'wykluczenia.';

/** Wyraźna uwaga: zaległości podatkowe i ZUS NIE podlegają samooczyszczeniu. */
export const UWAGA_ZALEGLOSCI =
  'Zaległości w podatkach lub składkach ZUS (art. 108 ust. 1 pkt 3, art. 109 ust. 1 pkt 1 Pzp) '
  + 'samooczyszczenie nie obejmuje. Wykluczenia unikniesz tylko wtedy, gdy przed upływem terminu '
  + 'składania ofert (wniosków) zapłacisz zaległość wraz z odsetkami lub grzywnami albo zawrzesz '
  + 'wiążące porozumienie w sprawie spłaty (np. układ ratalny z US/ZUS). Po terminie tego już się '
  + 'nie naprawi.';

/** Trzy elementy skutecznego samooczyszczenia (wszystkie wymagane). */
export const ELEMENTY = Object.freeze([
  { klucz: 'naprawa', etykieta: 'Naprawa szkody',
    opis: 'Naprawiłeś szkodę lub zobowiązałeś się do jej naprawienia (wypłata/ugoda/odszkodowanie) — załącz dowód.' },
  { klucz: 'wyjasnienie', etykieta: 'Wyczerpujące wyjaśnienie',
    opis: 'Wyczerpująco wyjaśniłeś fakty i okoliczności, aktywnie współpracując z organami.' },
  { klucz: 'srodki', etykieta: 'Środki zapobiegawcze',
    opis: 'Podjąłeś KONKRETNE środki techniczne, organizacyjne i kadrowe, by problem się nie powtórzył (nie ogólniki).' },
]);

/**
 * Ocena kompletności samooczyszczenia.
 * @param {Object<string, boolean>} odp
 * @returns {{kompletne:boolean, braki:Array, zrobione:number, ton:string, powod:string}}
 */
export function ocenaSamooczyszczenia(odp = {}) {
  const braki = ELEMENTY.filter((e) => !odp[e.klucz]);
  const zrobione = ELEMENTY.length - braki.length;
  const kompletne = braki.length === 0;
  let ton;
  if (kompletne) ton = 'sukces';
  else if (zrobione === 0) ton = 'neutral';
  else ton = 'ostrzezenie';
  return {
    kompletne,
    braki,
    zrobione,
    ton,
    powod: kompletne
      ? 'Wszystkie trzy elementy na miejscu — samooczyszczenie ma szansę zostać uznane.'
      : `Domknij ${braki.length} z 3 elementów — bez kompletu i DOWODÓW zamawiający uzna samooczyszczenie za niewystarczające.`,
  };
}
