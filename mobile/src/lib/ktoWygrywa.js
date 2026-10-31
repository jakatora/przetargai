/* Czyste pomocnicze dla karty „Kto wygrywa u tego zamawiającego” (components/KtoWygrywa.js) — testowalne w Node. */
export function kwotaKrotko(n, t) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return t(`${(n / 1e6).toFixed(2).replace('.', ',')} mln zł`, `PLN ${(n / 1e6).toFixed(2)}M`);
  if (n >= 1e3) return t(`${Math.round(n / 1e3)} tys. zł`, `PLN ${Math.round(n / 1e3)}k`);
  return t(`${Math.round(n)} zł`, `PLN ${Math.round(n)}`);
}

/** Czy pokazywać kartę dla tego przetargu (rozstrzygnięcia mamy z BZP i TED). */
export function czyPokazacKtoWygrywa(tender) {
  const kod = tender?.zrodlo?.kod ?? tender?.source;
  return Boolean(tender?.id) && (kod === 'bzp' || kod === 'ted');
}
