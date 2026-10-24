/** Warunki udziału vs karta firmy (spec §6.2) — słowa dla wyników z `GET /matches/:id/warunki`. */
export const ETYKIETY_WERDYKTU = {
  spelniasz: { etykieta: { pl: 'Spełniasz warunki udziału', en: 'You meet the participation conditions' }, ton: 'sukces' },
  nie_spelniasz: { etykieta: { pl: 'Nie spełniasz warunków samodzielnie', en: 'You do not meet the conditions on your own' }, ton: 'blad' },
  sprawdz: { etykieta: { pl: 'Sprawdź warunki — części nie da się ocenić', en: 'Check the conditions — some cannot be assessed' }, ton: 'ostrzezenie' },
};

export const ETYKIETY_STATUSU = {
  ok: { znak: '✓', etykieta: { pl: 'spełniasz', en: 'met' } },
  brak: { znak: '✗', etykieta: { pl: 'brakuje', en: 'missing' } },
  nie_wiem: { znak: '?', etykieta: { pl: 'nie wiemy', en: 'unknown' } },
};

const POWODY = {
  plan: { pl: 'Porównanie warunków udziału z Twoją firmą jest w planie Standard.', en: 'Comparing participation conditions with your company is on the Standard plan.' },
  brak_tekstu: { pl: 'Ogłoszenie nie podaje warunków udziału — sprawdź je w SWZ (Radar SWZ).', en: 'The notice does not state participation conditions — check them in the tender documents (SWZ Radar).' },
  w_swz: { pl: 'Warunki udziału są w dokumentach zamówienia (SWZ). Wklej SWZ do Radaru SWZ.', en: 'Participation conditions are in the tender documents. Paste them into SWZ Radar.' },
  brak_karty: { pl: 'Podaj w karcie firmy obrót, referencje i uprawnienia — porównamy je za Ciebie.', en: 'Enter turnover, references and licences in your company card — we will compare them for you.' },
  limit_dzienny: { pl: 'Na dziś wykorzystano limit porównań warunków. Spróbuj jutro.', en: 'Today’s limit of condition checks is used up. Try tomorrow.' },
  niedostepne: { pl: 'Nie udało się teraz porównać warunków. Spróbuj za chwilę.', en: 'Could not compare the conditions right now. Try again shortly.' },
};

export function opisPowodu(powod) {
  return POWODY[powod] ?? null;
}
