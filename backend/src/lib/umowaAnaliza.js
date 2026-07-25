/**
 * Scalenie detektorów projektu umowy w JEDEN wynik (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 7/12).
 *
 * Poszczególne detektory (`wykryj_klauzule_waloryzacyjna`, `wykryj_kary_umowne`,
 * `wykryj_odbiory`, `wykryj_podwykonawcow`) zwracają BOGATE, różne kształtem
 * wyniki. Tu sprowadzamy je do JEDNOLITEGO kontraktu, którego oczekuje aplikacja:
 * płaskiej listy flag `[{ typ, kolor, tytul, opis }]`. Każdy obszar umowy daje
 * DOKŁADNIE jedną flagę, w stałej, deterministycznej kolejności — dzięki temu UI
 * może po ludzku pokazać cztery „karty" (waloryzacja / kary / odbiory /
 * podwykonawcy), a klient ma przewidywalny, stabilny kontrakt.
 *
 * SKALA KOLORÓW (trójstopniowa, spójna z polem `poziom` w ostrzeżeniach detektorów):
 *   • `zielony`       — obszar w porządku (klauzula obecna, kary z limitem, …),
 *   • `pomarańczowy`  — uwaga/ryzyko zależne od kontekstu ALBO brak zapisów do
 *                       ręcznej weryfikacji (nie potwierdzone naruszenie),
 *   • `czerwony`      — pułapka / naruszenie niemal zawsze szkodliwe.
 * Gdy detektor zgłasza `ostrzezenie`, flaga PRZEJMUJE jego `poziom`, `tytul` i
 * `opis` — kolor i treść pozostają spójne co do wagi problemu. Bez ostrzeżenia
 * bierzemy ogólny `opis` detektora i sami dobieramy kolor ze stanu obszaru.
 */

import { wykryj_klauzule_waloryzacyjna } from './umowaWaloryzacja.js';
import { wykryj_kary_umowne } from './umowaKary.js';
import { wykryj_odbiory } from './umowaOdbiory.js';
import { wykryj_podwykonawcow } from './umowaPodwykonawcy.js';

// Dozwolone kolory flag. Literały MUSZĄ być identyczne z polem `poziom` stałych
// `OSTRZEZENIE_*` w detektorach (m.in. „pomarańczowy" z „ą"), bo flaga ostrzeżenia
// przejmuje `poziom` żywcem — rozjazd literału rozspójniłby skalę.
export const KOLOR = Object.freeze({
  zielony: 'zielony',
  pomaranczowy: 'pomarańczowy',
  czerwony: 'czerwony',
});

// Stała kolejność obszarów w wynikowej liście flag (część kontraktu).
export const TYPY = Object.freeze(['waloryzacja', 'kary', 'odbiory', 'podwykonawcy']);

/**
 * Buduje flagę obszaru: jeśli detektor zgłosił `ostrzezenie`, przejmujemy jego
 * kolor (`poziom`), tytuł i opis (spójna waga problemu). W przeciwnym razie
 * kolor i tytuł dobiera `pozytyw` (stan „ok"/„do weryfikacji"), a opis bierzemy
 * z ogólnego `opis` detektora.
 */
function zbudujFlage(typ, wynik, pozytyw) {
  if (wynik.ostrzezenie) {
    return {
      typ,
      kolor: wynik.ostrzezenie.poziom,
      tytul: wynik.ostrzezenie.tytul,
      opis: wynik.ostrzezenie.opis,
    };
  }
  return { typ, kolor: pozytyw.kolor, tytul: pozytyw.tytul, opis: wynik.opis };
}

/**
 * Scala wszystkie detektory w jednolitą listę flag zielona/pomarańczowa/czerwona.
 * @param {string} tekst znormalizowany tekst umowy (z `ekstrahuj_i_normalizuj`)
 * @param {number} [miesiace] szacowany czas trwania umowy w miesiącach; gdy > 6
 *   a klauzuli waloryzacyjnej brak, flaga waloryzacji jest czerwona (art. 439 Pzp).
 *   Pominięty/niepoprawny => brak klauzuli daje flagę pomarańczową (uwaga, nie
 *   potwierdzone naruszenie — nie znamy czasu trwania).
 * @returns {Array<{ typ: string, kolor: string, tytul: string, opis: string }>}
 *   Dokładnie jedna flaga na obszar, w kolejności `TYPY`.
 */
export function zbuduj_flagi_umowy(tekst, miesiace) {
  const waloryzacja = wykryj_klauzule_waloryzacyjna(tekst, miesiace);
  const kary = wykryj_kary_umowne(tekst);
  const odbiory = wykryj_odbiory(tekst);
  const podwykonawcy = wykryj_podwykonawcow(tekst);

  return [
    zbudujFlage('waloryzacja', waloryzacja, waloryzacja.obecna
      ? { kolor: KOLOR.zielony, tytul: 'klauzula waloryzacyjna' }
      : { kolor: KOLOR.pomaranczowy, tytul: 'brak klauzuli waloryzacyjnej' }),

    zbudujFlage('kary', kary, kary.kary.length > 0
      // Są kary bez ostrzeżenia => mają limit (inaczej detektor dałby ostrzeżenie).
      ? { kolor: KOLOR.zielony, tytul: 'kary umowne z limitem' }
      // Brak wykrytych pojedynczych kar — mogą być opisane nietypowo, do weryfikacji.
      : { kolor: KOLOR.pomaranczowy, tytul: 'kary umowne do weryfikacji' }),

    zbudujFlage('odbiory', odbiory, odbiory.obecne
      ? { kolor: KOLOR.zielony, tytul: 'zapisy o odbiorach' }
      : { kolor: KOLOR.pomaranczowy, tytul: 'brak zapisów o odbiorach' }),

    zbudujFlage('podwykonawcy', podwykonawcy, podwykonawcy.obecne
      ? { kolor: KOLOR.zielony, tytul: 'zapisy o podwykonawcach' }
      : { kolor: KOLOR.pomaranczowy, tytul: 'brak zapisów o podwykonawcach' }),
  ];
}
