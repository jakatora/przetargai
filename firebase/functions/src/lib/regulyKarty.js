import { matchKeywords } from './textNorm.js';
import { kodWojewodztwa, WOJEWODZTWA } from './wojewodztwa.js';
import { kartaZUzytkownika } from './kartaFirmy.js';

/*
 * Twarde reguły karty firmy (spec §4.3) — bez AI i bez kosztu. Odrzucenie jest
 * ostateczne i ma przyczynę, którą widzi klient. Zasada nadrzędna: GDY OGŁOSZENIE
 * NIE PODAJE DANYCH, REGUŁA NIE ODRZUCA (TED nie ma wartości, BZP często też) —
 * przetarg idzie dalej do heurystyki i AI.
 */

/** Pzp: wadium to najwyżej 3% wartości zamówienia → wartość ≥ wadium / 0,03. */
export const WADIUM_MAKS_UDZIAL = 0.03;
const DOBA_MS = 86_400_000;

const zl = (k) => `${Math.round(k).toLocaleString('pl-PL')} zł`;
const pln = (k) => `PLN ${Math.round(k).toLocaleString('en-GB')}`;

export function dolnaGranicaWartosci(tender) {
  if (typeof tender?.budget === 'number' && tender.budget > 0) return { kwota: tender.budget, zrodlo: 'wartosc' };
  if (typeof tender?.wadium_kwota === 'number' && tender.wadium_kwota > 0) {
    return { kwota: tender.wadium_kwota / WADIUM_MAKS_UDZIAL, zrodlo: 'wadium' };
  }
  return null;
}

export function sprawdzReguly(user, tender, teraz) {
  const karta = kartaZUzytkownika(user);

  const wykluczone = matchKeywords(karta.wykluczenia, tender?.title ?? '');
  if (wykluczone.length) {
    return { przyczyna: 'wykluczenie', szczegol: {
      pl: `Tytuł pasuje do „${wykluczone[0]}” z Twojej listy „nie bierzemy”.`,
      en: `The title matches “${wykluczone[0]}” from your “we don’t do” list.`,
    } };
  }

  const moje = (user?.regiony ?? []).map(kodWojewodztwa).filter(Boolean);
  const kod = kodWojewodztwa(tender?.wojewodztwo);
  if (moje.length && kod && !moje.includes(kod)) {
    return { przyczyna: 'teren', szczegol: {
      pl: `Województwo ${WOJEWODZTWA[kod]} jest poza Twoim terenem.`,
      en: `The ${WOJEWODZTWA[kod]} voivodeship is outside your area.`,
    } };
  }

  const maks = typeof user?.wartosc_max === 'number' ? user.wartosc_max : null;
  const granica = dolnaGranicaWartosci(tender);
  if (maks !== null && granica && granica.kwota > maks) {
    return { przyczyna: 'za_duze', szczegol: granica.zrodlo === 'wartosc'
      ? { pl: `Wartość ${zl(granica.kwota)} przekracza Twoje „do” ${zl(maks)}.`,
        en: `The value of ${pln(granica.kwota)} exceeds your maximum of ${pln(maks)}.` }
      : { pl: `Wadium ${zl(tender.wadium_kwota)} oznacza zamówienie warte co najmniej ${zl(granica.kwota)} — ponad Twoje „do” ${zl(maks)}.`,
        en: `A bid bond of ${pln(tender.wadium_kwota)} means a contract worth at least ${pln(granica.kwota)} — above your maximum of ${pln(maks)}.` } };
  }

  if (karta.wartosc_min !== null && typeof tender?.budget === 'number' && tender.budget < karta.wartosc_min) {
    return { przyczyna: 'za_male', szczegol: {
      pl: `Wartość ${zl(tender.budget)} jest poniżej Twojego „od” ${zl(karta.wartosc_min)}.`,
      en: `The value of ${pln(tender.budget)} is below your minimum of ${pln(karta.wartosc_min)}.`,
    } };
  }

  const termin = Date.parse(tender?.deadline ?? '');
  if (Number.isFinite(termin)) {
    const dni = (termin - Date.parse(teraz)) / DOBA_MS;
    if (dni < karta.min_dni_oferta) {
      const zostalo = Math.max(0, Math.floor(dni));
      return { przyczyna: 'termin', szczegol: {
        pl: `Do terminu ofert zostało ${zostalo} dni, a potrzebujesz co najmniej ${karta.min_dni_oferta}.`,
        en: `${zostalo} days left to bid, and you need at least ${karta.min_dni_oferta}.`,
      } };
    }
  }

  return null;
}
