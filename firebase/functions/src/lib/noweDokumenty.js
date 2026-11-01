import { opisOtwarcia } from './otwarcieOfert.js';

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
  ['termin', /zmian\w*\s+termin|przed[łl]u[żz]eni\w*\s+termin|nowy\s+termin\s+sk[łl]adani/i],
  ['otwarcie', /otwarci|kwot\w*\s+(?:jak[aą]|przeznacz)|zestawieni\w*\s+ofert/i],
  ['rozstrzygniecie', /wyb[oó]r\w*\s+(?:najkorzystniejsz|oferty)|rozstrzygni|uniewa[żz]ni|uniewazni/i],
  ['wyjasnienia', /wyja[śs]nie|odpowied|pyta[nń]/i],
  ['zmiana', /zmian|modyfikac|sprostow|korekt|aktualizac|nowa\s+wersj|po\s+zmianie/i],
  ['informacja', /informacj\w*\s+(?:nr|dla\s+wykonawc|zamawiaj)|komunikat|do\s+wszystkich\s+(?:wykonawc|oferent)/i],
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
  // Pierwszy odczyt (1.11 na produkcji): SWZ i załączniki dodane na platformę po ogłoszeniu to nie
  // nowość dla wykonawcy, tylko zwykła dokumentacja — z tego okna bierzemy wyłącznie ważne rodzaje.
  return lista.filter((d) => d.opublikowano && String(d.opublikowano) > String(zapisanoO) && WAZNE.has(rodzajDokumentu(d)));
}

const WAZNE = new Set(['termin', 'zmiana', 'wyjasnienia', 'otwarcie', 'rozstrzygniecie', 'informacja']);

const OPIS_RODZAJU = {
  termin: { pl: 'zmianę terminu składania ofert', en: 'a new bid deadline' },
  informacja: { pl: 'komunikat dla wykonawców', en: 'a notice to bidders' },
  wyjasnienia: { pl: 'wyjaśnienia treści SWZ', en: 'clarifications of the tender documents' },
  zmiana: { pl: 'zmianę dokumentów', en: 'a change to the tender documents' },
  otwarcie: { pl: 'informację z otwarcia ofert', en: 'the bid opening report' },
  rozstrzygniecie: { pl: 'informację o wyborze oferty', en: 'the award decision' },
  inne: { pl: 'nowe pliki', en: 'new files' },
};
const KOLEJNOSC = ['termin', 'zmiana', 'wyjasnienia', 'informacja', 'otwarcie', 'rozstrzygniecie', 'inne'];

/** Dni na odwołanie do KIO poniżej progów UE (art. 515 ust. 2 pkt 1 Pzp, informacja przekazana elektronicznie). */
export const DNI_NA_ODWOLANIE = 5;

/**
 * Dopisek do informacji o wyborze oferty / unieważnieniu (2026-11-01): termin odwołania liczony od PUBLIKACJI
 * pliku, bez przesuwania na dzień roboczy — nasza data nigdy nie wypada później niż prawdziwy termin.
 * Po terminie (alert spóźniony) — bez daty.
 */
export function dopisekRozstrzygniecia(nowe, teraz = Date.now()) {
  const dokumenty = nowe.filter((d) => rodzajDokumentu(d) === 'rozstrzygniecie');
  if (!dokumenty.length) return null;
  const uniewaznienie = dokumenty.every((d) => /uniewa[żz]ni|uniewazni/i.test(`${d.nazwa ?? ''} ${d.plik ?? ''}`));
  const od = Math.min(...dokumenty.map((d) => Date.parse(d.opublikowano ?? '')).filter(Number.isFinite));
  const koniec = Number.isFinite(od) ? od + DNI_NA_ODWOLANIE * 86_400_000 : null;
  const data = koniec && koniec > teraz ? new Date(koniec).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
  const dataEn = koniec && koniec > teraz ? new Date(koniec).toLocaleDateString('en-GB', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }) : null;
  const termin = data
    ? { pl: ` Jeśli złożyłeś ofertę i chcesz się odwołać do KIO, masz ${DNI_NA_ODWOLANIE} dni od przekazania informacji — licząc od publikacji, do ${data}.`, en: ` If you bid and want to appeal to the KIO, you have ${DNI_NA_ODWOLANIE} days from notification — counting from publication, until ${dataEn}.` }
    : { pl: '', en: '' };
  return uniewaznienie
    ? { pl: ` Postępowanie unieważnione — zamawiający może ogłosić je ponownie.${termin.pl}`, en: ` The procedure was cancelled — the buyer may re-tender it.${termin.en}` }
    : { pl: ` Sprawdź, czy wybrano Twoją ofertę.${termin.pl}`, en: ` Check whether your bid was selected.${termin.en}` };
}

/**
 * Alert do centrum alertów + push. Klucz = przetarg × najnowszy nowy dokument — ten sam stan
 * zapisany drugi raz zostaje jednym wpisem (ponowienie przebiegu nie wyśle drugiego pushu).
 * `zapisany: false` = przetarg z czołówki feedu (nie z Zapisanych) — inny nagłówek, a job nie wysyła pushu.
 * `otwarcie` (`lib/otwarcieOfert.js`) — liczby z informacji z otwarcia ofert, dopisywane do treści.
 * @param {{tender: {id: string, title?: string, organization?: string, deadline?: string}, nowe: object[], zapisany?: boolean, otwarcie?: object|null}} wejscie
 */
export function alertNowychDokumentow({ tender, nowe, zapisany = true, otwarcie = null, teraz = Date.now() }) {
  if (!tender?.id || !nowe?.length) return null;
  const rodzaje = [...new Set(nowe.map(rodzajDokumentu))].sort((a, b) => KOLEJNOSC.indexOf(a) - KOLEJNOSC.indexOf(b));
  const pilne = rodzaje.includes('termin') || rodzaje.includes('zmiana') || rodzaje.includes('wyjasnienia');
  const lista = (jez) => rodzaje.map((r) => OPIS_RODZAJU[r][jez]).join(', ');
  const nazwy = nowe.slice(0, 3).map((d) => d.nazwa).filter(Boolean).join(' · ');
  const tytul = String(tender.title ?? 'przetarg').slice(0, 90);
  const czysc = (s) => String(s).replace(/[/\s]/g, '_');
  const ostatni = [...nowe].map((d) => d.id).sort().at(-1);
  const liczby = rodzaje.includes('otwarcie') ? opisOtwarcia(otwarcie) : null;
  const wybor = dopisekRozstrzygniecia(nowe, teraz);
  const dopisek = {
    pl: wybor ? wybor.pl : liczby ? ` ${liczby.pl}` : pilne ? ' Sprawdź przed złożeniem oferty — oferta bez ich uwzględnienia może zostać odrzucona.' : rodzaje.includes('otwarcie') ? ' Zobacz, jakie ceny dali konkurenci.' : '',
    en: wybor ? wybor.en : liczby ? ` ${liczby.en}` : pilne ? ' Check them before you bid — an offer that ignores them may be rejected.' : rodzaje.includes('otwarcie') ? ' See what prices competitors offered.' : '',
  };
  return {
    klucz: `dok_${czysc(tender.id)}_${czysc(ostatni)}`,
    typ: 'nowe_dokumenty',
    tender_id: tender.id,
    ton: pilne || wybor ? 'ostrzezenie' : 'neutral',
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

/**
 * Podsumowanie zmian w dokumentacji do KARTY NA LIŚCIE (2026-11-01): „Nowy termin · Wyjaśnienia (2)”
 * bez otwierania przetargu. Liczymy z CAŁEJ aktualnej listy plików, nie tylko z nowych — karta mówi,
 * co w postępowaniu jest, a alert — co doszło. Bez wyjaśnień, zmian i nowego terminu — null.
 * @returns {{wyjasnienia: number, zmiany: number, termin: number, ostatnia_o: string|null}|null}
 */
export function podsumowanieZmian(dokumenty) {
  const wynik = { wyjasnienia: 0, zmiany: 0, termin: 0, ostatnia_o: null };
  for (const d of Array.isArray(dokumenty) ? dokumenty : []) {
    const r = rodzajDokumentu(d);
    const pole = r === 'wyjasnienia' || r === 'informacja' ? 'wyjasnienia' : r === 'zmiana' ? 'zmiany' : r === 'termin' ? 'termin' : null;
    if (!pole) continue;
    wynik[pole] += 1;
    if (d.opublikowano && (!wynik.ostatnia_o || String(d.opublikowano) > wynik.ostatnia_o)) wynik.ostatnia_o = String(d.opublikowano);
  }
  return wynik.wyjasnienia + wynik.zmiany + wynik.termin ? wynik : null;
}
