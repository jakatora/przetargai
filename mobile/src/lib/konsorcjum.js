/**
 * „STRAŻNIK OŚWIADCZENIA KONSORCJUM (art. 117 ust. 4)" — czysta logika (testowalna `node:test`).
 *
 * PROBLEM: przy ofercie wspólnej trzeba złożyć oświadczenie, które roboty/dostawy/usługi wykonają
 * poszczególni wykonawcy. Kluczowa pułapka: jeśli warunek udziału (doświadczenie, uprawnienia)
 * potwierdza konsorcjant A, to WŁAŚNIE A musi mieć w oświadczeniu przypisane te prace —
 * przypisanie ich konsorcjantowi B to sprzeczność, którą KIO wychwytuje (oferta odrzucona).
 *
 * PODSTAWA PRAWNA: art. 117 ust. 3-4 Pzp — w odniesieniu do warunków dotyczących wykształcenia,
 * kwalifikacji zawodowych lub doświadczenia wykonawcy wspólnie ubiegający się mogą polegać na
 * zdolnościach tych, którzy wykonają roboty/usługi, do realizacji których te zdolności są
 * wymagane; do oferty dołącza się oświadczenie o podziale zadań.
 *
 * Walidacja jest DETERMINISTYCZNA: dla każdego warunku „kto potwierdza" musi = „kto wykonuje".
 */

/**
 * Sprawdza spójność oświadczenia: konsorcjant potwierdzający warunek musi wykonywać przypisaną
 * mu część.
 * @param {Array<{nazwa?:string, potwierdza?:string, wykonuje?:string}>} warunki
 *   `potwierdza`/`wykonuje` to identyfikatory/nazwy konsorcjantów.
 * @returns {{spojne:boolean, bledy:Array<{warunek:string, potwierdza:string, wykonuje:string}>,
 *   sprawdzone:number, ton:string}}
 */
export function sprawdzKonsorcjum(warunki) {
  const lista = Array.isArray(warunki) ? warunki : [];
  const bledy = [];
  let sprawdzone = 0;
  for (const w of lista) {
    const potwierdza = (w?.potwierdza ?? '').toString().trim();
    const wykonuje = (w?.wykonuje ?? '').toString().trim();
    if (!potwierdza && !wykonuje) continue; // pusty wiersz — pomijamy
    sprawdzone += 1;
    if (!potwierdza || !wykonuje || potwierdza !== wykonuje) {
      bledy.push({ warunek: (w?.nazwa ?? '').toString().trim() || 'Warunek', potwierdza, wykonuje });
    }
  }
  const spojne = sprawdzone > 0 && bledy.length === 0;
  let ton;
  if (bledy.length > 0) ton = 'danger';
  else if (spojne) ton = 'sukces';
  else ton = 'neutral';
  return { spojne, bledy, sprawdzone, ton };
}

/** Jednozdaniowy werdykt do nagłówka. */
export function werdyktKonsorcjum({ spojne, bledy, sprawdzone } = {}) {
  if (sprawdzone === 0) return 'Dodaj warunki i przypisz, kto je potwierdza i kto wykonuje';
  if (spojne) return 'Oświadczenie spójne — potwierdzający wykonują swoje części';
  return `Sprzeczność w ${bledy.length} warunku(-ach): potwierdza kto inny niż wykonuje — to ryzyko odrzucenia`;
}
