/*
 * „Wniosek o wyjaśnienie treści SWZ w 1 klik" — pytania z Radaru SWZ składają się
 * w formalne pismo do zamawiającego (art. 135 ust. 1 Pzp powyżej progów UE,
 * art. 284 ust. 1 Pzp w trybie podstawowym). Lenistwo kosztuje tu najwięcej:
 * wykonawca ma pytania, ale nie wysyła ich, bo „trzeba napisać pismo" — a potem
 * składa ofertę na własnej interpretacji i odpada.
 *
 * CZYSTA logika: bez UI, bez sieci, bez zegara (`dzisiaj` parametrem), nigdy nie rzuca.
 */

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');

function dataPL(isoLubTekst) {
  if (!niepusty(isoLubTekst)) return '…';
  const m = isoLubTekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return isoLubTekst.trim();
}

function podstawaDlaTrybu(tryb) {
  if (tryb === 'krajowy') return 'art. 284 ust. 1 ustawy Pzp';
  if (tryb === 'unijny') return 'art. 135 ust. 1 ustawy Pzp';
  return 'art. 284 ust. 1 albo art. 135 ust. 1 ustawy Pzp (odpowiednio do trybu postępowania)';
}

/**
 * @param {{wykonawca?: object, postepowanie?: {nazwa?, zamawiajacy?, numer?}, pytania?: Array<{tresc, fragment_swz?}>, tryb?: 'krajowy'|'unijny', dzisiaj?: string}} we
 * @returns {{id, nazwa, podstawa, tresc, liczba}}
 */
export function generujWniosekOWyjasnienie({ wykonawca, postepowanie, pytania, tryb, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = postepowanie && typeof postepowanie === 'object' ? postepowanie : {};
  const lista = (Array.isArray(pytania) ? pytania : []).filter((q) => q && niepusty(q.tresc));
  const podstawa = podstawaDlaTrybu(tryb);

  const pozycje = lista.length
    ? lista.flatMap((q, i) => [
      `${i + 1}. ${q.tresc.trim()}${niepusty(q.fragment_swz) ? ` (dotyczy: ${q.fragment_swz.trim()})` : ''}`,
      '',
    ])
    : ['— brak pytań — wygeneruj je w Radarze SWZ albo dopisz ręcznie —', ''];

  const osoba = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  const tresc = [
    `${w(k.miejscowosc)}, ${dataPL(dzisiaj)}`,
    '',
    `Wykonawca: ${w(k.nazwa)}`,
    `Adres: ${w(k.adres)}`,
    `NIP ${w(k.nip)}${niepusty(k.email) ? `, e-mail: ${k.email.trim()}` : ''}`,
    '',
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Dotyczy: ${w(p.nazwa)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''}`,
    '',
    'WNIOSEK O WYJAŚNIENIE TREŚCI SPECYFIKACJI WARUNKÓW ZAMÓWIENIA',
    '',
    `Na podstawie ${podstawa} zwracam się z wnioskiem o wyjaśnienie treści SWZ w następującym zakresie:`,
    '',
    ...pozycje,
    'Proszę o udzielenie odpowiedzi w terminie wynikającym z ustawy oraz o udostępnienie wyjaśnień na stronie internetowej prowadzonego postępowania bez ujawniania źródła zapytania.',
    '',
    osoba,
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty — wniosek w formie elektronicznej przez platformę postępowania)',
  ].join('\n');

  return {
    id: 'wniosek_wyjasnienie_swz',
    nazwa: 'Wniosek o wyjaśnienie treści SWZ',
    podstawa,
    tresc,
    liczba: lista.length,
  };
}
