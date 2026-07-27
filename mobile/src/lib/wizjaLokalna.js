/**
 * „WYKRYWACZ OBOWIĄZKOWEJ WIZJI LOKALNEJ" — czysta logika (testowalna `node:test`).
 *
 * PROBLEM: zamawiający bywa, że wymaga OBOWIĄZKOWEJ wizji lokalnej — oferta bez odbytej wizji
 * podlega odrzuceniu (art. 226 ust. 1 pkt 18 Pzp). Wykonawca gubi ten wymóg w SWZ i przegrywa
 * przetarg, zanim się zaczął. Trzeba to odróżnić od wizji jedynie ZALECANEJ/możliwej.
 *
 * Narzędzie skanuje wklejoną treść SWZ/ogłoszenia i rozpoznaje trzy przypadki: wizja
 * OBOWIĄZKOWA (pod rygorem odrzucenia), MOŻLIWA (zalecana, bez rygoru) albo BRAK wzmianki.
 * Bez internetu i backendu — czysty parser tekstu, ostrożny (przy sygnale rygoru → obowiązkowa).
 */

const RE_WIZJA = /wizj[aeęi]\s+lokaln|wizji\s+lokaln|odby[cć]\w*\s+wizj/i;
// Sygnały OBOWIĄZKOWOŚCI (rygor odrzucenia).
const RE_OBOWIAZEK = [
  /obowiązkow/i,
  /pod\s+rygorem\s+odrzuceni/i,
  /226\s*ust\.?\s*1\s*pkt\s*18/i,
  /wymaga\w*\s+(?:odbyci|przeprowadzeni)/i,
  /niezb[eę]dn\w*\s+(?:jest\s+)?(?:odbyci|przeprowadzeni|dokonani)\w*\s+wizj/i,
];
// Sygnały jedynie ZALECENIA/możliwości.
const RE_MOZLIWA = [
  /zaleca\w*/i,
  /możliw\w*/i,
  /umożliwia\w*/i,
  /nieobowiązkow/i,
  /fakultatywn/i,
];

/** Wyciąga krótkie fragmenty wokół trafień „wizja lokalna" (do pokazania kontekstu). */
function fragmenty(tekst, maks = 3) {
  const out = [];
  const re = /[^.!?\n]*wizj[aeęi][^.!?\n]*[.!?]?/gi;
  let m;
  while ((m = re.exec(tekst)) && out.length < maks) {
    const f = m[0].trim().replace(/\s+/g, ' ');
    if (f.length > 8) out.push(f.length > 200 ? `${f.slice(0, 197)}…` : f);
  }
  return out;
}

/**
 * Analiza treści pod kątem wizji lokalnej.
 * @param {string} tekst wklejona treść SWZ / ogłoszenia
 * @returns {{wystepuje:boolean, obowiazkowa:boolean, mozliwa:boolean, ton:string,
 *   etykieta:string, dopasowania:string[]}}
 */
export function wykryjWizje(tekst) {
  const t = String(tekst || '');
  const wystepuje = RE_WIZJA.test(t);
  if (!wystepuje) {
    return { wystepuje: false, obowiazkowa: false, mozliwa: false, ton: 'neutral',
      etykieta: 'Nie znaleziono wzmianki o wizji lokalnej', dopasowania: [] };
  }
  const obowiazkowa = RE_OBOWIAZEK.some((re) => re.test(t));
  const mozliwa = !obowiazkowa && RE_MOZLIWA.some((re) => re.test(t));
  let ton;
  let etykieta;
  if (obowiazkowa) {
    ton = 'danger';
    etykieta = 'Wizja lokalna OBOWIĄZKOWA — bez niej oferta odrzucona';
  } else if (mozliwa) {
    ton = 'ostrzezenie';
    etykieta = 'Wizja lokalna możliwa/zalecana — sprawdź, czy nie jest wymagana';
  } else {
    // Jest wzmianka, ale bez jasnego rygoru — ostrożnie ostrzegamy (przeczytaj dokładnie).
    ton = 'ostrzezenie';
    etykieta = 'Wzmianka o wizji lokalnej — zweryfikuj, czy jest obowiązkowa';
  }
  return { wystepuje: true, obowiazkowa, mozliwa, ton, etykieta, dopasowania: fragmenty(t) };
}
