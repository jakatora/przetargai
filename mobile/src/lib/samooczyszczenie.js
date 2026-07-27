/**
 * „KREATOR SAMOOCZYSZCZENIA — druga szansa po karze, zerwanej umowie lub zaległości" — czysta
 * logika (testowalna `node:test`).
 *
 * PROBLEM: wykonawca z „skazą" w historii (rozwiązana umowa, kary umowne, zaległości ZUS/US,
 * wcześniejsze wykluczenie) sądzi, że jest wykluczony na starcie — a Pzp daje procedurę
 * naprawczą (self-cleaning), o której mało kto wie.
 *
 * PODSTAWA PRAWNA — art. 110 ust. 2 Pzp: wykonawca podlegający wykluczeniu NIE podlega mu, jeśli
 * udowodni, że łącznie: (1) naprawił albo zobowiązał się naprawić szkodę (odszkodowanie);
 * (2) wyczerpująco wyjaśnił fakty i okoliczności, aktywnie współpracując z organami; (3) podjął
 * KONKRETNE środki techniczne, organizacyjne i kadrowe, odpowiednie do zapobieżenia dalszym
 * nieprawidłowościom. Zamawiający ocenia wystarczalność — dowody muszą być konkretne.
 */

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
