/**
 * Prezentacja meta ogłoszenia (rundy 5-6): kryterium oceny + liczba części.
 * Nieznane / bez wartości informacyjnej → null (nie zaśmiecamy karty).
 */

export function opisKryterium(tender) {
  switch (tender?.kryterium_oceny) {
    case 'tylko_cena':
      return { wartosc: 'Tylko najniższa cena', podpis: 'Wygrywa najtańsza oferta — licz się z ostrą konkurencją cenową.' };
    case 'cena_i_jakosc':
      return { wartosc: 'Cena + jakość', podpis: 'Liczą się też kryteria jakościowe — doświadczenie i jakość mogą przeważyć.' };
    default:
      return null;
  }
}

export function opisCzesci(tender) {
  const n = tender?.liczba_czesci;
  if (typeof n === 'number' && n >= 2) {
    return { wartosc: `Podzielone na ${n} części`, podpis: 'Możesz startować tylko w wybranej części — łatwiej dla mniejszej firmy.' };
  }
  return null; // jedna część lub nieznane — bez szumu
}
