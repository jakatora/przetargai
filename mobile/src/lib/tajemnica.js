/**
 * „TARCZA TAJEMNICY PRZEDSIĘBIORSTWA — zastrzeż skutecznie albo świadomie odpuść" — czysta
 * logika (testowalna `node:test`).
 *
 * PROBLEM: po otwarciu ofert konkurencja czyta kosztorys, wykaz osób, wyjaśnienia ceny. Można
 * je zastrzec jako tajemnicę przedsiębiorstwa, ale TYLKO skutecznie — inaczej KIO odtajnia i
 * konkurent i tak zobaczy, a Ty tracisz czas.
 *
 * PODSTAWA PRAWNA: art. 18 ust. 3 Pzp + art. 11 ust. 2 ustawy o zwalczaniu nieuczciwej
 * konkurencji. Linia orzecznicza KIO: skuteczne zastrzeżenie wymaga WYKAZANIA trzech przesłanek
 * łącznie. Dodatkowo: nie wolno zastrzec elementów jawnych z mocy ustawy (m.in. nazwa/firma
 * wykonawcy, cena — art. 222 ust. 5), a zastrzeżenie musi paść najpóźniej w terminie składania.
 */

/** Trzy przesłanki tajemnicy przedsiębiorstwa (muszą być spełnione łącznie). */
export const PRZESLANKI = Object.freeze([
  { klucz: 'wartosc', etykieta: 'Wartość gospodarcza',
    opis: 'Informacja ma realną wartość gospodarczą (techniczną, technologiczną, organizacyjną lub handlową) — wyjaśnij, jaką.' },
  { klucz: 'nieznane', etykieta: 'Nie jest powszechnie znana',
    opis: 'Informacja nie jest powszechnie znana osobom z branży ani łatwo dostępna.' },
  { klucz: 'dzialania', etykieta: 'Działania zabezpieczające',
    opis: 'Podjąłeś działania, by zachować poufność (procedury, ograniczony dostęp, klauzule NDA) — opisz je.' },
]);

/**
 * Ocena skuteczności zastrzeżenia jednego dokumentu.
 * @param {{nazwa?:string, wartosc?:boolean, nieznane?:boolean, dzialania?:boolean, jawny?:boolean}} dok
 * @returns {{skuteczne:boolean, jawny:boolean, braki:Array, ton:string, powod:string}}
 */
export function ocenaZastrzezenia(dok = {}) {
  if (dok.jawny) {
    return {
      skuteczne: false, jawny: true, braki: [], ton: 'danger',
      powod: 'To element jawny z mocy ustawy (np. cena, nazwa wykonawcy) — nie można go zastrzec (art. 222 ust. 5).',
    };
  }
  const braki = PRZESLANKI.filter((p) => !dok[p.klucz]);
  const skuteczne = braki.length === 0;
  return {
    skuteczne,
    jawny: false,
    braki,
    ton: skuteczne ? 'sukces' : 'danger',
    powod: skuteczne
      ? 'Trzy przesłanki wykazane — zastrzeżenie ma szansę się obronić.'
      : `Brak ${braki.length} z 3 przesłanek — KIO takie zastrzeżenie odtajni. Wykaż wszystkie albo odpuść.`,
  };
}
