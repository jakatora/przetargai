import { parametryNarzedzia } from './sciezkaDoOferty.js';

/**
 * Plan działania do oferty dla wybranego przetargu (spec §6.3) — bez AI. Kroki prowadzą do
 * ISTNIEJĄCYCH ekranów (nazwy tras z RootNavigatora), terminy liczone z ogłoszenia, a postęp
 * z tego, co klient już zrobił (etap pracy, powiązana SWZ). Termin pytań przychodzi z API
 * (ten sam przepis co kalendarz terminów: art. 284 ust. 2 / art. 135 ust. 2 Pzp).
 */
const DOBA_MS = 86_400_000;
const PILNE_MS = 2 * DOBA_MS;
const ETAPY_PO_DECYZJI = ['przygotowuje', 'zlozona', 'wygrana', 'przegrana'];
const ETAPY_PO_ZLOZENIU = ['zlozona', 'wygrana', 'przegrana'];

const iso = (ms) => new Date(ms).toISOString();
/** Grupy po 3 cyfry zwykłą spacją — `toLocaleString('pl-PL')` nie grupuje liczb czterocyfrowych (5000). */
const grupy = (k) => String(Math.round(k)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const zl = (k) => `${grupy(k)} zł`;
const pln = (k) => `PLN ${grupy(k).replace(/ /g, ',')}`;

export function zbudujPlanDzialania({ match, terminPytan = null, swzPowiazana = false, etap = null, teraz = Date.now() }) {
  const tender = match?.tender ?? {};
  const deadline = Date.parse(tender.deadline ?? '');
  const znanyTermin = Number.isFinite(deadline);
  const przed = (dni) => (znanyTermin ? iso(deadline - dni * DOBA_MS) : null);

  const kroki = [
    { klucz: 'decyzja', ekran: 'CzyWarto', termin: iso(teraz), wykonany: ETAPY_PO_DECYZJI.includes(etap),
      tytul: { pl: 'Zdecyduj, czy startujesz', en: 'Decide whether to bid' } },
    { klucz: 'swz', ekran: 'RadarSwz', termin: null, wykonany: Boolean(swzPowiazana),
      tytul: { pl: 'Wklej SWZ do Radaru SWZ', en: 'Paste the tender documents into SWZ Radar' } },
  ];
  if (terminPytan) {
    kroki.push({ klucz: 'pytania', ekran: 'KalendarzTerminow', termin: terminPytan, wykonany: false,
      tytul: { pl: 'Zadaj pytania do SWZ', en: 'Ask questions about the tender documents' } });
  }
  kroki.push({ klucz: 'dokumenty', ekran: 'Sejf', termin: przed(0), wykonany: false,
    tytul: { pl: 'Sprawdź ważność dokumentów w Sejfie', en: 'Check document validity in the Vault' } });
  if (tender.wadium_wymagane) {
    const kwota = typeof tender.wadium_kwota === 'number' ? tender.wadium_kwota : null;
    kroki.push({ klucz: 'wadium', ekran: 'KontrolerGwarancji', termin: przed(0), wykonany: false,
      tytul: kwota ? { pl: `Wnieś wadium ${zl(kwota)}`, en: `Lodge a bid bond of ${pln(kwota)}` }
        : { pl: 'Wnieś wadium', en: 'Lodge the bid bond' } });
  }
  const punkty = tender.kryterium_oceny === 'cena_i_jakosc';
  kroki.push({ klucz: 'cena', ekran: punkty ? 'KalkulatorPunktow' : 'KalkulatorCeny', termin: przed(2), wykonany: false,
    tytul: punkty ? { pl: 'Policz cenę i punkty', en: 'Work out price and points' } : { pl: 'Policz cenę', en: 'Work out your price' } });
  kroki.push({ klucz: 'kontrola', ekran: 'KontrolaOferty', termin: przed(1), wykonany: ETAPY_PO_ZLOZENIU.includes(etap),
    tytul: { pl: 'Sprawdź ofertę przed wysłaniem', en: 'Check your bid before sending' } });
  kroki.push({ klucz: 'zlozenie', ekran: 'RejestratorOferty', termin: przed(0), wykonany: ETAPY_PO_ZLOZENIU.includes(etap),
    tytul: { pl: 'Złóż ofertę i nagraj dowody', en: 'Submit and record evidence' } });

  return kroki.map((k) => {
    const t = Date.parse(k.termin ?? '');
    const minal = Number.isFinite(t) && k.klucz !== 'decyzja' && t < teraz && !k.wykonany;
    return {
      ...k,
      parametry: parametryNarzedzia(k.ekran, match),
      minal,
      pilny: Number.isFinite(t) && !k.wykonany && !minal && k.klucz !== 'decyzja' && t - teraz <= PILNE_MS,
    };
  });
}
