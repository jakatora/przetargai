import { NAZWY_CPV } from './cpvNazwy.js';
import { normalize } from './textNorm.js';

/*
 * PROFIL PODPOWIEDZIANY ZA KLIENTA (2026-11-02). Konto z 27.10 wpisało jedno hasło „Remont posadzka żywica”, bez CPV,
 * i przez tydzień nie dostało ani jednego przetargu; przycisku „Podpowiedz słowa i kody CPV” nie użyło. Gdy konto
 * od 30 dni nie ma żadnego dopasowania, przebieg selekcji sam pyta AI o profil (`zaproponujProfil` — kody z katalogu
 * pickera), liczy na puli, ile otwartych przetargów by pasowało, a panel pokazuje propozycję z „Przyjmij”.
 * Koszt: jedno wywołanie AI na konto najwyżej raz na 14 dni, tylko dla kont bez dopasowań (bramka budżetu w ai.js).
 */
export const DNI_BEZ_DOPASOWAN = 30;
export const MIN_WIEK_KONTA_DNI = 2;
export const ODSTEP_SUGESTII_DNI = 14;
const DOBA_MS = 86_400_000;

/** Czy przebieg ma zapytać AI o profil (bez liczenia dopasowań — to robi wołający, bo wymaga odczytu). */
export function czasNaSugestie(user, teraz) {
  if (!(user?.keywords?.length || user?.cpv_codes?.length)) return false;
  const t = Date.parse(teraz);
  if (!(Date.parse(user.created_at ?? '') <= t - MIN_WIEK_KONTA_DNI * DOBA_MS)) return false;
  const ostatnia = Date.parse(user.profil_sugestia?.o ?? '');
  return !(ostatnia > t - ODSTEP_SUGESTII_DNI * DOBA_MS);
}

/** Opis firmy dla AI: opis z karty, słowa, kody i nazwa — to, co klient już powiedział. */
export function opisDlaSugestii(user) {
  return [
    user?.karta?.opis,
    user?.keywords?.length ? `Słowa: ${user.keywords.join(', ')}` : null,
    user?.cpv_codes?.length ? `Kody CPV: ${user.cpv_codes.join(', ')}` : null,
    user?.company_name ? `Firma: ${user.company_name}` : null,
  ].filter(Boolean).join('. ').slice(0, 600);
}

/** Tylko to, czego konto jeszcze nie ma (słowa porównywane bez wielkości liter i ogonków). */
export function noweZSugestii(user, sugestia) {
  const mamSlowa = new Set((user?.keywords ?? []).map((k) => normalize(k)));
  const mamKody = new Set((user?.cpv_codes ?? []).map((k) => String(k).replace(/\D/g, '').slice(0, 8)));
  return {
    keywords: (sugestia?.keywords ?? []).filter((k) => !mamSlowa.has(normalize(k))),
    cpv: (sugestia?.cpv ?? []).filter((k) => !mamKody.has(k)),
  };
}

const odmienPrzetargi = (n) => (n === 1 ? 'przetarg' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'przetargi' : 'przetargów');

/** Treść propozycji w panelu („Przyjmij” dopisuje słowa i kody do profilu). */
export function opisSugestii({ keywords = [], cpv = [], w_puli: wPuli = 0 }) {
  const slowa = keywords.length ? `słowa: ${keywords.map((k) => `„${k}”`).join(', ')}` : null;
  const kody = cpv.length ? `${cpv.length === 1 ? 'kod' : 'kody'} CPV: ${cpv.map((k) => `${k} (${NAZWY_CPV[k] ?? 'CPV'})`).join(', ')}` : null;
  const kodyEn = cpv.length ? `CPV ${cpv.join(', ')}` : null;
  return {
    pl: `Od miesiąca nie było żadnego przetargu dla Twojego profilu. Dopisać ${[slowa, kody].filter(Boolean).join(' i ')}? `
      + `Wstępnie pasuje do tego dziś ${wPuli} ${odmienPrzetargi(wPuli)} — resztę przesieje selekcja.`,
    en: `No tender has matched your profile for a month. Add ${[keywords.length ? `keywords ${keywords.join(', ')}` : null, kodyEn].filter(Boolean).join(' and ')}? `
      + `${wPuli} open tender(s) pass the first filter today; the selection sifts the rest.`,
  };
}
