/*
 * Zmiany w dokumentacji przetargu na KARCIE LISTY (2026-11-01). Serwer co 2 h sprawdza pliki
 * w e-Zamówieniach (monitoring Zapisanych i czołówki feedu) i dokłada do przetargu oraz jego kopii
 * `ez_zmiany` = { wyjasnienia, zmiany, termin, ostatnia_o }. Karta mówi wprost, że jest co czytać —
 * bez otwierania przetargu i bez zaglądania na platformę.
 */

/** „Nowy termin · Zmiany SWZ (1) · Wyjaśnienia (2)” po polsku i angielsku; bez zmian — null. */
export function znacznikZmian(tender) {
  const z = tender?.ez_zmiany;
  if (!z || typeof z !== 'object') return null;
  const pl = [];
  const en = [];
  if (z.termin > 0) { pl.push('Nowy termin'); en.push('New deadline'); }
  if (z.zmiany > 0) { pl.push(`Zmiany SWZ (${z.zmiany})`); en.push(`Document changes (${z.zmiany})`); }
  if (z.wyjasnienia > 0) { pl.push(`Wyjaśnienia (${z.wyjasnienia})`); en.push(`Clarifications (${z.wyjasnienia})`); }
  return pl.length ? { pl: pl.join(' · '), en: en.join(' · ') } : null;
}

/*
 * Informacja z otwarcia ofert (2026-11-01): serwer czyta PDF z e-Zamówień i podaje `otwarcie_ofert` =
 * { kwota, oferty, cena_min, cena_max, czesci }. Karta pokazuje skrót, ekran ogłoszenia — zdanie.
 */
const krotkoZl = (n, t) => (n >= 1e6
  ? t(`${(n / 1e6).toFixed(2).replace('.', ',')} mln zł`, `PLN ${(n / 1e6).toFixed(2)}M`)
  : n >= 1e3 ? t(`${Math.round(n / 1e3)} tys. zł`, `PLN ${Math.round(n / 1e3)}k`) : t(`${Math.round(n)} zł`, `PLN ${Math.round(n)}`));

function ofertyPl(n) {
  const d = n % 100;
  const j = n % 10;
  if (n === 1) return '1 oferta';
  return `${n} ${j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? 'oferty' : 'ofert'}`;
}

/** Skrót na kartę: „Otwarcie: 6 ofert · od 159 tys. zł” albo „Budżet zamawiającego: 195 tys. zł”; brak — null. */
export function znacznikOtwarcia(tender, t) {
  const o = tender?.otwarcie_ofert;
  if (!o) return null;
  if (o.oferty) {
    const od = Number.isFinite(o.cena_min) ? t(` · od ${krotkoZl(o.cena_min, (pl) => pl)}`, ` · from ${krotkoZl(o.cena_min, (_, en) => en)}`) : '';
    return t(`Otwarcie: ${ofertyPl(o.oferty)}${od}`, `Opening: ${o.oferty} bid${o.oferty === 1 ? '' : 's'}${od}`);
  }
  if (o.kwota) return t(`Budżet zamawiającego: ${krotkoZl(o.kwota, (pl) => pl)}`, `Buyer's budget: ${krotkoZl(o.kwota, (_, en) => en)}`);
  return null;
}

/** Zdanie na ekran ogłoszenia: liczba ofert, rozpiętość cen i kwota zamawiającego. */
/**
 * Kogo wybrano (2026-11-01, z pisma o wyborze oferty na e-Zamówieniach): „RR-BUD Sp. z o.o. (3 oferty)”,
 * przy częściach „cz. 1: X; cz. 2: Y”. Bez danych — null.
 */
export function opisWyboru(tender, t) {
  const w = (tender?.wybor_oferty?.wykonawcy ?? []).filter((x) => x?.nazwa).slice(0, 3);
  if (!w.length) return null;
  const n = tender.wybor_oferty.oferty;
  const czesci = w.some((x) => x.czesc);
  const pl = czesci ? w.map((x) => `cz. ${x.czesc ?? '?'}: ${x.nazwa}`).join('; ') : w[0].nazwa;
  const en = czesci ? w.map((x) => `lot ${x.czesc ?? '?'}: ${x.nazwa}`).join('; ') : w[0].nazwa;
  return t(`${pl}${Number.isFinite(n) ? ` (${ofertyPl(n)})` : ''}`, `${en}${Number.isFinite(n) ? ` (${n} bid${n === 1 ? '' : 's'})` : ''}`);
}

export function opisOtwarcia(tender, t) {
  const o = tender?.otwarcie_ofert;
  if (!o) return null;
  const czesciPl = [];
  const czesciEn = [];
  if (o.oferty) {
    const zakres = Number.isFinite(o.cena_min) && Number.isFinite(o.cena_max) && o.cena_min !== o.cena_max;
    czesciPl.push(`${ofertyPl(o.oferty)} z ceną${Number.isFinite(o.cena_min) ? (zakres ? `: od ${krotkoZl(o.cena_min, (pl) => pl)} do ${krotkoZl(o.cena_max, (pl) => pl)}` : `: ${krotkoZl(o.cena_min, (pl) => pl)}`) : ''}`);
    czesciEn.push(`${o.oferty} priced bid${o.oferty === 1 ? '' : 's'}${Number.isFinite(o.cena_min) ? (zakres ? `: from ${krotkoZl(o.cena_min, (_, en) => en)} to ${krotkoZl(o.cena_max, (_, en) => en)}` : `: ${krotkoZl(o.cena_min, (_, en) => en)}`) : ''}`);
  }
  if (o.kwota) {
    czesciPl.push(`zamawiający przeznaczył ${krotkoZl(o.kwota, (pl) => pl)}`);
    czesciEn.push(`the buyer budgeted ${krotkoZl(o.kwota, (_, en) => en)}`);
  }
  if (!czesciPl.length) return null;
  return t(`${czesciPl.join('; ')}.`, `${czesciEn.join('; ')}.`);
}
