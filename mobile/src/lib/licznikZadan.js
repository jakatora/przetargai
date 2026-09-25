/**
 * Licznik żądań „wygrywa najnowsze" — czysta logika, zero React Native.
 *
 * Audyt 2026-09-25 (P1): przy szybkiej zmianie filtra/zakładki odpowiedź STAREGO
 * żądania, która wróciła później, nadpisywała wyniki nowszego — lista pokazywała
 * wyniki filtra, którego już nie ma na ekranie. Ekran trzyma jeden licznik
 * (`useRef(utworzLicznikZadan())`):
 *  - `nowe()` przy każdym żądaniu, które ZASTĘPUJE listę (pierwsza strona, zmiana
 *    filtra, odświeżenie) — unieważnia wszystko, co jeszcze leci;
 *  - `biezace()` przy dociąganiu kolejnej strony — nie unieważnia listy, ale
 *    samo traci ważność, gdy w międzyczasie lista została zastąpiona;
 *  - `czyAktualne(nr)` po `await` — false = odpowiedź do wyrzucenia.
 */
export function utworzLicznikZadan() {
  let ostatnie = 0;
  return {
    nowe() {
      ostatnie += 1;
      return ostatnie;
    },
    biezace() {
      return ostatnie;
    },
    czyAktualne(numer) {
      return numer === ostatnie;
    },
  };
}
