/**
 * „ASYSTENT OBRONY CENY (rażąco niska cena)" — czysta logika (testowalna `node:test`).
 * Ekran renderuje; kolor dokłada motyw.js z semantycznego `ton`.
 *
 * PROBLEM: wykonawca wygrywa ceną, dostaje wezwanie z art. 224 Pzp i odpada, bo odpisuje
 * ogólnikami BEZ dowodów — traci zamówienie, które praktycznie miał, a czasem i wadium.
 *
 * PODSTAWA PRAWNA — art. 224 Pzp:
 *  • ust. 1 — zamawiający żąda wyjaśnień, gdy cena wydaje się rażąco niska (sygnał: ≥30%
 *    poniżej wartości zamówienia lub średniej arytmetycznej cen ofert);
 *  • ust. 3 — wyjaśnienia dotyczą m.in. kosztów pracy (nie niższych niż minimalne wynagrodzenie
 *    / minimalna stawka godzinowa), pomocy publicznej, rozwiązań technicznych;
 *  • ust. 5 — CIĘŻAR DOWODU, że oferta nie zawiera rażąco niskiej ceny, spoczywa na wykonawcy;
 *  • ust. 6 — odrzuca ofertę, jeśli wyjaśnienia nie uzasadniają ceny (a wyjaśnienia bez dowodów
 *    są z automatu niewystarczające).
 *
 * Narzędzie: rozbij cenę na składniki (mają sumować się do oferty), sprawdź stawkę pracy vs
 * minimum i przypilnuj, żeby KAŻDY istotny składnik miał dowód. Bez dowodu = odrzucenie.
 */

function liczba(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Składniki kalkulacji ceny (kolejność = kolejność w formularzu). */
export const SKLADNIKI = Object.freeze([
  { klucz: 'robocizna', etykieta: 'Robocizna', dowod: 'Kalkulacja roboczogodzin + potwierdzenie stawek (nie niższych niż minimalne wynagrodzenie).' },
  { klucz: 'materialy', etykieta: 'Materiały', dowod: 'Oferty/cenniki dostawców, umowy, potwierdzenia rabatów.' },
  { klucz: 'sprzet', etykieta: 'Sprzęt', dowod: 'Oferty najmu, koszt amortyzacji, faktury paliwa/serwisu.' },
  { klucz: 'posrednie', etykieta: 'Koszty pośrednie', dowod: 'Kalkulacja narzutu (zarząd, biuro, ubezpieczenia, gwarancje).' },
  { klucz: 'zysk', etykieta: 'Zysk', dowod: 'Założona marża — pokaż, że dodatnia i realna.' },
]);

/**
 * Analiza kompletności obrony ceny.
 * @param {{cena:number, skladniki?:object, roboczogodziny?:number, minStawkaGodz?:number,
 *   dowody?:object}} we
 * @returns {Readonly<object>} { suma, roznicaDoCeny, zgodna, stawkaGodz, ponizejMinimum,
 *   brakDowodu:string[], problemy:Array, gotowa:boolean, ton:string }
 */
export function analizaObrony(we = {}) {
  const cena = liczba(we.cena);
  const skladniki = we.skladniki || {};
  const dowody = we.dowody || {};

  const suma = SKLADNIKI.reduce((s, sk) => s + liczba(skladniki[sk.klucz]), 0);
  const roznicaDoCeny = cena - suma;
  // tolerancja 0,5% ceny (albo 1 zł) — zaokrąglenia kalkulacji nie są błędem
  const zgodna = cena > 0 && Math.abs(roznicaDoCeny) <= Math.max(1, cena * 0.005);

  const roboczogodziny = liczba(we.roboczogodziny);
  const minStawka = liczba(we.minStawkaGodz);
  const stawkaGodz = roboczogodziny > 0 ? liczba(skladniki.robocizna) / roboczogodziny : null;
  const ponizejMinimum = stawkaGodz !== null && minStawka > 0 && stawkaGodz < minStawka;

  // Każdy NIEZEROWY składnik musi mieć dowód (ciężar dowodu — art. 224 ust. 5).
  const brakDowodu = SKLADNIKI
    .filter((sk) => liczba(skladniki[sk.klucz]) > 0 && !dowody[sk.klucz])
    .map((sk) => sk.etykieta);

  const problemy = [];
  if (ponizejMinimum) {
    problemy.push({ ton: 'danger', tekst: `Stawka pracy ${stawkaGodz.toFixed(2)} zł/h jest PONIŻEJ minimum — to samodzielna podstawa odrzucenia (art. 224 ust. 3).` });
  }
  if (brakDowodu.length > 0) {
    problemy.push({ ton: 'danger', tekst: `Bez dowodów: ${brakDowodu.join(', ')}. Wyjaśnienia bez dowodów są niewystarczające (art. 224 ust. 5-6).` });
  }
  if (!zgodna && cena > 0) {
    problemy.push({ ton: 'ostrzezenie', tekst: `Składniki (${Math.round(suma)} zł) nie sumują się do ceny oferty (${Math.round(cena)} zł) — uzupełnij kalkulację.` });
  }

  const gotowa = zgodna && !ponizejMinimum && brakDowodu.length === 0;
  let ton;
  if (ponizejMinimum || brakDowodu.length > 0) ton = 'danger';
  else if (!zgodna) ton = 'ostrzezenie';
  else ton = 'sukces';

  return Object.freeze({
    suma: Math.round(suma),
    roznicaDoCeny: Math.round(roznicaDoCeny),
    zgodna,
    stawkaGodz: stawkaGodz === null ? null : Math.round(stawkaGodz * 100) / 100,
    ponizejMinimum,
    brakDowodu,
    problemy,
    gotowa,
    ton,
  });
}

/** Jednozdaniowy werdykt do nagłówka. */
export function werdyktObrony({ gotowa, ton } = {}) {
  if (gotowa) return 'Wyjaśnienie kompletne — składniki, stawki i dowody na miejscu';
  if (ton === 'danger') return 'Tak przygotowane wyjaśnienie grozi odrzuceniem — uzupełnij dowody i stawki';
  return 'Wyjaśnienie prawie gotowe — domknij kalkulację';
}
