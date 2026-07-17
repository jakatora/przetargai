/**
 * Prezentacja wadium na karcie przetargu (D-056).
 * Wadium to twardy próg: brak przed terminem składania ofert = odrzucenie oferty,
 * bez uzupełnienia. Dlatego wymagane wadium podświetlamy jako ważne.
 */

function formatKwota(n) {
  return `${Math.round(n).toLocaleString('pl-PL').replace(/ /g, ' ')} zł`;
}

/**
 * @param {{wadium_wymagane?: boolean|null, wadium_kwota?: number|null, wadium_wiele_czesci?: boolean}} tender
 * @returns {{wartosc: string, ostrzezenie: boolean, podpis?: string}|null}
 *   null → nieznane; wiersza nie pokazujemy (nie sugerujemy, że wadium nie ma).
 */
export function opisWadium(tender) {
  const w = tender?.wadium_wymagane;
  if (w === null || w === undefined) return null;

  if (w === false) {
    return { wartosc: 'Nie wymagane', ostrzezenie: false };
  }

  // wymagane
  if (typeof tender.wadium_kwota === 'number' && tender.wadium_kwota > 0) {
    return {
      wartosc: formatKwota(tender.wadium_kwota),
      ostrzezenie: true,
      podpis: tender.wadium_wiele_czesci
        ? 'Kwota za pierwszą część — wnieś przed terminem składania ofert.'
        : 'Wnieś przed terminem składania ofert.',
    };
  }
  return {
    wartosc: 'Wymagane',
    ostrzezenie: true,
    podpis: 'Kwota podana w ogłoszeniu — wnieś przed terminem składania ofert.',
  };
}
