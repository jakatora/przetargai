/*
 * NOWE DOKUMENTY W ZAPISANYM PRZETARGU (2026-11-01). Zamawiający w trakcie postępowania publikuje
 * na e-Zamówieniach wyjaśnienia treści SWZ, zmiany SWZ, a po terminie — informację z otwarcia ofert.
 * Oferta złożona bez uwzględnienia wyjaśnienia albo zmiany bywa odrzucona, a wykonawca musiałby
 * codziennie zaglądać na platformę. Robimy to za niego: monitoring porównuje listę plików z tym, co
 * widzieliśmy, i wysyła alert z tym, CO doszło.
 *
 * CZYSTA logika: listy dokumentów (`services/eZamowieniaDokumenty.js`) i zegar parametrem.
 */

const REGULY = [
  ['otwarcie', /otwarci|kwot\w*\s+(?:jak[aą]|przeznacz)|zestawieni\w*\s+ofert/i],
  ['rozstrzygniecie', /wyb[oó]r\w*\s+(?:najkorzystniejsz|oferty)|rozstrzygni|uniewa[żz]ni|uniewazni/i],
  ['wyjasnienia', /wyja[śs]nie|odpowied|pyta[nń]/i],
  ['zmiana', /zmian|modyfikac|sprostow|korekt|aktualizac|nowa\s+wersj|po\s+zmianie/i],
];

/** Rodzaj dokumentu po nazwie: wyjaśnienia, zmiana SWZ, otwarcie ofert, rozstrzygnięcie albo inne. */
export function rodzajDokumentu(dok) {
  const tekst = `${dok?.nazwa ?? ''} ${dok?.plik ?? ''}`;
  for (const [rodzaj, re] of REGULY) if (re.test(tekst)) return rodzaj;
  return 'inne';
}

/**
 * Które dokumenty są nowe dla danego wpisu w Zapisanych. Przy pierwszym sprawdzeniu przetargu (brak
 * znanej listy) — opublikowane po zapisaniu przez użytkownika; potem — te, których id jeszcze nie znamy.
 * @param {object[]} dokumenty aktualna lista z e-Zamówień
 * @param {{znane: string[]|null, zapisanoO: string|null}} stan
 */
export function noweDokumenty(dokumenty, { znane = null, zapisanoO = null } = {}) {
  const lista = Array.isArray(dokumenty) ? dokumenty.filter((d) => d?.id) : [];
  if (Array.isArray(znane)) {
    const zbior = new Set(znane);
    return lista.filter((d) => !zbior.has(d.id));
  }
  if (!zapisanoO) return [];
  return lista.filter((d) => d.opublikowano && String(d.opublikowano) > String(zapisanoO));
}

const OPIS_RODZAJU = {
  wyjasnienia: { pl: 'wyjaśnienia treści SWZ', en: 'clarifications of the tender documents' },
  zmiana: { pl: 'zmianę dokumentów', en: 'a change to the tender documents' },
  otwarcie: { pl: 'informację z otwarcia ofert', en: 'the bid opening report' },
  rozstrzygniecie: { pl: 'informację o wyborze oferty', en: 'the award decision' },
  inne: { pl: 'nowe pliki', en: 'new files' },
};
const KOLEJNOSC = ['zmiana', 'wyjasnienia', 'otwarcie', 'rozstrzygniecie', 'inne'];

/**
 * Alert do centrum alertów + push. Klucz = przetarg × najnowszy nowy dokument — ten sam stan
 * zapisany drugi raz zostaje jednym wpisem (ponowienie przebiegu nie wyśle drugiego pushu).
 * `zapisany: false` = przetarg z czołówki feedu (nie z Zapisanych) — inny nagłówek, a job nie wysyła pushu.
 * @param {{tender: {id: string, title?: string, organization?: string, deadline?: string}, nowe: object[], zapisany?: boolean}} wejscie
 */
export function alertNowychDokumentow({ tender, nowe, zapisany = true }) {
  if (!tender?.id || !nowe?.length) return null;
  const rodzaje = [...new Set(nowe.map(rodzajDokumentu))].sort((a, b) => KOLEJNOSC.indexOf(a) - KOLEJNOSC.indexOf(b));
  const pilne = rodzaje.includes('zmiana') || rodzaje.includes('wyjasnienia');
  const lista = (jez) => rodzaje.map((r) => OPIS_RODZAJU[r][jez]).join(', ');
  const nazwy = nowe.slice(0, 3).map((d) => d.nazwa).filter(Boolean).join(' · ');
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const czysc = (s) => String(s).replace(/[/\s]/g, '_');
  const ostatni = [...nowe].map((d) => d.id).sort().at(-1);
  const dopisek = {
    pl: pilne ? ' Sprawdź przed złożeniem oferty — oferta bez ich uwzględnienia może zostać odrzucona.' : rodzaje.includes('otwarcie') ? ' Zobacz, jakie ceny dali konkurenci.' : '',
    en: pilne ? ' Check them before you bid — an offer that ignores them may be rejected.' : rodzaje.includes('otwarcie') ? ' See what prices competitors offered.' : '',
  };
  return {
    klucz: `dok_${czysc(tender.id)}_${czysc(ostatni)}`,
    typ: 'nowe_dokumenty',
    tender_id: tender.id,
    ton: pilne ? 'ostrzezenie' : 'neutral',
    tytul: zapisany
      ? { pl: `Nowe dokumenty w zapisanym przetargu: ${tytul}`, en: `New documents in a saved tender: ${tytul}` }
      : { pl: `Nowe dokumenty w przetargu z Twojej listy: ${tytul}`, en: `New documents in a tender from your list: ${tytul}` },
    tresc: {
      pl: `Zamawiający opublikował ${lista('pl')} (${nowe.length}).${dopisek.pl}${nazwy ? ` ${nazwy}` : ''}`,
      en: `The buyer published ${lista('en')} (${nowe.length}).${dopisek.en}${nazwy ? ` ${nazwy}` : ''}`,
    },
    pozycje: [{
      tender_id: tender.id,
      tytul: tender.title ?? null,
      organizacja: tender.organization ?? null,
      deadline: tender.deadline ?? null,
      zrodlo: 'bzp',
    }],
  };
}
