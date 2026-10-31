/* Czyste pomocnicze karty „Kto może użyczyć doświadczenia” (components/PartnerzyPrzetargu.js) — testowalne w Node. */

/** Karta ma sens tylko dla przetargu z kodem CPV (po nim szukamy firm z podobnymi zamówieniami). */
export function czyPokazacPartnerow(tender) {
  const cpv = Array.isArray(tender?.cpv) ? tender.cpv[0] : tender?.cpv;
  return Boolean(tender?.id) && String(cpv ?? '').replace(/\D/g, '').length >= 2;
}

/** Podtytuł: zakres, z którego wzięliśmy firmy (klasa CPV w województwie, w kraju albo cały dział w województwie). */
export function opisZakresu(zakres, t) {
  if (!zakres) return '';
  const branza = zakres.branza ?? '';
  if (zakres.poziom === 'klasa_kraj') return t(`${branza} · cała Polska`, `${branza} · all of Poland`);
  return t(`${branza} · województwo przetargu`, `${branza} · the tender's region`);
}
