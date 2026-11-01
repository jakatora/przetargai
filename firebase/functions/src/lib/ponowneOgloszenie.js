import { podobienstwoTytulow } from './poprzedniaEdycja.js';
import { dzialCpv } from './wynikiAgregacja.js';

/*
 * PRZETARG WRACA PO UNIEWAŻNIENIU (2026-11-01). Zamawiający unieważnia przetarg (najczęściej: oferty ponad budżet
 * albo jedna nieważna) i za kilka tygodni ogłasza go ponownie. Firma, która szykowała ofertę, ma gotowe dokumenty —
 * traci tylko wtedy, gdy przegapi nowe ogłoszenie. Szukamy go za nią: ten sam zamawiający, nowe otwarte ogłoszenie
 * opublikowane po terminie starego, tytuł podobny (ten sam próg co „poprzednia edycja”, 0,5) i — gdy oba mają CPV —
 * ten sam dział. CZYSTA logika; job: `jobs/ponowneOgloszenia.js`.
 */
export const PROG_PODOBIENSTWA = 0.5;

const czysc = (s) => String(s ?? '').replace(/^\s*\S*\d\S*\s+/, '');

/**
 * @param {{id: string, title?: string, deadline?: string, cpv_main?: string}} stary unieważniony przetarg
 * @param {object[]} kandydaci ogłoszenia tego zamawiającego (`tenders.poNipieZamawiajacego` / po nazwie)
 * @returns {{tender: object, podobienstwo: number}|null}
 */
export function znajdzPonowne(stary, kandydaci, { teraz = Date.now() } = {}) {
  const terminStarego = Date.parse(stary?.deadline ?? '');
  const dzialStarego = dzialCpv(stary?.cpv_main);
  let najlepszy = null;
  for (const k of Array.isArray(kandydaci) ? kandydaci : []) {
    if (!k?.id || k.id === stary.id || k.anulowany || k.zastapiony_przez) continue;
    if (!(Date.parse(k.deadline ?? '') > teraz)) continue;
    // Nowe ogłoszenie powstaje po terminie starego (unieważnienie przychodzi po otwarciu ofert).
    const opublikowano = Date.parse(k.published_at ?? '');
    if (Number.isFinite(terminStarego) && Number.isFinite(opublikowano) && opublikowano < terminStarego) continue;
    const dzialK = dzialCpv(k.cpv_main);
    if (dzialStarego && dzialK && dzialStarego !== dzialK) continue;
    const podob = podobienstwoTytulow(czysc(stary.title), czysc(k.title));
    if (podob >= PROG_PODOBIENSTWA && (!najlepszy || podob > najlepszy.podobienstwo)) najlepszy = { tender: k, podobienstwo: Math.round(podob * 100) / 100 };
  }
  return najlepszy;
}

const terminPL = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? new Date(t).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }) : null; };

/** Alert do centrum (+ push): klucz = stary × nowy, więc ponowny przebieg nie wysyła drugi raz. */
export function alertPonownego({ stary, nowy, zapisano = false }) {
  if (!stary?.id || !nowy?.id) return null;
  const tytul = String(nowy.title ?? stary.title ?? 'przetarg').slice(0, 90);
  const termin = terminPL(nowy.deadline);
  const czysty = (s) => String(s).replace(/[/\s]/g, '_');
  return {
    klucz: `ponownie_${czysty(stary.id)}_${czysty(nowy.id)}`,
    typ: 'przetarg_ponownie',
    tender_id: nowy.id,
    ton: 'ostrzezenie',
    tytul: { pl: `Unieważniony przetarg wraca: ${tytul}`, en: `A cancelled tender is back: ${tytul}` },
    tresc: {
      pl: `${stary.organization ?? 'Zamawiający'} ogłosił go ponownie${termin ? ` — oferty do ${termin}` : ''}. Dokumenty z poprzedniego podejścia zwykle wystarczy zaktualizować.${zapisano ? ' Dodaliśmy go do Zapisanych z przypomnieniem.' : ''}`,
      en: `${stary.organization ?? 'The buyer'} has re-tendered it${termin ? ` — bids due ${termin}` : ''}. Your documents from the previous attempt usually just need updating.${zapisano ? ' We added it to Saved with a reminder.' : ''}`,
    },
    pozycje: [{ tender_id: nowy.id, tytul: nowy.title ?? null, organizacja: stary.organization ?? null, deadline: nowy.deadline ?? null, zrodlo: nowy.source ?? null }],
  };
}
