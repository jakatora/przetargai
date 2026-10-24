import { analizujPole } from './walidacjaLiczb.js';
import { formatujPLN } from './kalkulatorCeny.js';

/*
 * „Wniosek o zwrot wadium w 1 klik" — art. 98 ust. 2 Pzp. Z urzędu (ust. 1) zamawiający
 * zwraca wadium po wyborze oferty / unieważnieniu / upływie związania; w czterech
 * sytuacjach z ust. 2 zwrot jest NA WNIOSEK wykonawcy, w ciągu 7 dni od jego złożenia:
 *   1) wykonawca wycofał ofertę przed upływem terminu składania ofert,
 *   2) oferta została odrzucona,
 *   3) wybrano najkorzystniejszą ofertę (innego wykonawcy),
 *   4) postępowanie unieważniono, a odwołania nie wniesiono.
 * Wadium w gwarancji zwraca się przez oświadczenie o zwolnieniu wadium skierowane
 * do gwaranta (art. 98 ust. 5).
 *
 * CZYSTA logika: bez UI, bez sieci, bez zegara (`dzisiaj` parametrem), nigdy nie rzuca.
 */

const niepusty = (v) => typeof v === 'string' && v.trim().length > 0;
const w = (v) => (niepusty(v) ? v.trim() : '…');

function deepFreeze(wartosc) {
  if (wartosc && typeof wartosc === 'object' && !Object.isFrozen(wartosc)) {
    for (const v of Object.values(wartosc)) deepFreeze(v);
    Object.freeze(wartosc);
  }
  return wartosc;
}

export const PODSTAWY_ZWROTU = deepFreeze([
  { id: 'wycofanie', podstawa: 'art. 98 ust. 2 pkt 1 Pzp', etykieta: 'Wycofałem ofertę przed terminem składania', opis: 'wycofania oferty przed upływem terminu składania ofert' },
  { id: 'odrzucenie', podstawa: 'art. 98 ust. 2 pkt 2 Pzp', etykieta: 'Moja oferta została odrzucona', opis: 'odrzucenia oferty Wykonawcy' },
  { id: 'wybor_innej', podstawa: 'art. 98 ust. 2 pkt 3 Pzp', etykieta: 'Wybrano ofertę innego wykonawcy', opis: 'wyboru najkorzystniejszej oferty innego wykonawcy' },
  { id: 'uniewaznienie', podstawa: 'art. 98 ust. 2 pkt 4 Pzp', etykieta: 'Postępowanie unieważniono', opis: 'unieważnienia postępowania, w przypadku gdy nie zostało wniesione odwołanie' },
]);

export const FORMY_WADIUM = deepFreeze([
  { id: 'przelew', etykieta: 'Pieniądz (przelew)' },
  { id: 'gwarancja', etykieta: 'Gwarancja bankowa / ubezpieczeniowa / poręczenie' },
]);

/** Kwota wadium z ogłoszenia (pola feedu) albo null, gdy nieznana lub niewymagane. */
export function kwotaWadiumZOgloszenia(tender) {
  const t = tender && typeof tender === 'object' ? tender : {};
  if (t.wadium_wymagane !== true) return null;
  return typeof t.wadium_kwota === 'number' && t.wadium_kwota > 0 ? t.wadium_kwota : null;
}

function dataPL(isoLubTekst) {
  if (!niepusty(isoLubTekst)) return '…';
  const m = isoLubTekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return isoLubTekst.trim();
}

function kwotaTekst(kwota) {
  if (typeof kwota === 'number' && Number.isFinite(kwota) && kwota > 0) return formatujPLN(kwota);
  const pole = analizujPole(kwota);
  return pole.liczba != null && pole.liczba > 0 ? formatujPLN(pole.liczba) : '…';
}

/**
 * @param {{wykonawca?: object, przetarg?: {tytul?, zamawiajacy?, numer?}, podstawa?: string, wadium?: {kwota?, forma?: 'przelew'|'gwarancja', rachunek?, bank?, gwarant?, numerGwarancji?}, dzisiaj?: string}} we
 * @returns {{id, nazwa, podstawa, tresc}}
 */
export function generujWniosekOZwrotWadium({ wykonawca, przetarg, podstawa, wadium, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  const wd = wadium && typeof wadium === 'object' ? wadium : {};
  const pod = PODSTAWY_ZWROTU.find((x) => x.id === podstawa) ?? null;
  const gwarancja = wd.forma === 'gwarancja';

  const sposob = gwarancja
    ? [
      `Wadium zostało wniesione w formie ${niepusty(wd.gwarant) ? `gwarancji wystawionej przez: ${wd.gwarant.trim()}` : 'gwarancji / poręczenia'}${niepusty(wd.numerGwarancji) ? ` (nr ${wd.numerGwarancji.trim()})` : ''}.`,
      'Wnoszę o złożenie gwarantowi oświadczenia o zwolnieniu wadium (art. 98 ust. 5 ustawy Pzp) i przekazanie Wykonawcy kopii tego oświadczenia.',
    ]
    : [
      'Wadium zostało wniesione w pieniądzu, przelewem na rachunek Zamawiającego.',
      `Zwrot proszę przekazać na rachunek bankowy nr: ${w(wd.rachunek)}${niepusty(wd.bank) ? ` (${wd.bank.trim()})` : ''}, wraz z odsetkami wynikającymi z umowy rachunku bankowego, pomniejszonymi o koszty prowadzenia rachunku i prowizję przelewu (art. 98 ust. 4 ustawy Pzp).`,
    ];

  const osoba = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  const tresc = [
    `${w(k.miejscowosc)}, ${dataPL(dzisiaj)}`,
    '',
    `Wykonawca: ${w(k.nazwa)}`,
    `Adres: ${w(k.adres)}`,
    `NIP ${w(k.nip)}${niepusty(k.email) ? `, e-mail: ${k.email.trim()}` : ''}`,
    '',
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Dotyczy: ${w(p.tytul)}${niepusty(p.numer) ? ` (nr ${p.numer.trim()})` : ''}`,
    '',
    'WNIOSEK O ZWROT WADIUM',
    '',
    pod
      ? `Na podstawie ${pod.podstawa} wnoszę o zwrot wadium w kwocie ${kwotaTekst(wd.kwota)} wniesionego w powyższym postępowaniu — w związku z ${pod.opis}.`
      : `Na podstawie art. 98 ust. 2 ustawy Pzp wnoszę o zwrot wadium w kwocie ${kwotaTekst(wd.kwota)} wniesionego w powyższym postępowaniu.`,
    '',
    ...sposob,
    '',
    'Zgodnie z art. 98 ust. 2 ustawy Pzp zwrot wadium następuje niezwłocznie, nie później niż w terminie 7 dni od dnia złożenia niniejszego wniosku.',
    '',
    osoba,
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty — wniosek w formie elektronicznej przez platformę postępowania)',
  ].join('\n');

  return {
    id: 'wniosek_zwrot_wadium',
    nazwa: 'Wniosek o zwrot wadium',
    podstawa: pod?.podstawa ?? 'art. 98 ust. 2 Pzp',
    tresc,
  };
}
