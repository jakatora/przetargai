import { analizujPole } from './walidacjaLiczb.js';
import { formatujPLN } from './kalkulatorCeny.js';
import { procentDoGroszy } from './grosze.js';

/*
 * „Po wygranej" — co zrobić w pierwszych dniach kontraktu i trzy pisma, które
 * każdy wykonawca pisze sam:
 *  • zgłoszenie podwykonawcy (art. 464 ust. 1 Pzp — roboty: PROJEKT umowy przed
 *    przystąpieniem; ust. 8 — dostawy/usługi: kopia ZAWARTEJ umowy w 7 dni),
 *  • wniosek o zmianę terminu wykonania (art. 455 ust. 1 pkt 1 — klauzula z umowy,
 *    albo pkt 4 — okoliczności, których nie dało się przewidzieć),
 *  • wniosek o zwrot zabezpieczenia należytego wykonania (art. 453 ust. 1 — 70 %
 *    w 30 dni od odbioru; ust. 3 — pozostałe 30 % w 15 dni po rękojmi).
 * CZYSTA logika, nigdy nie rzuca, bez zegara (`dzisiaj` parametrem).
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

function dataPL(isoLubTekst) {
  if (!niepusty(isoLubTekst)) return '…';
  const m = isoLubTekst.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return isoLubTekst.trim();
}

function kwota(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x;
  const pole = analizujPole(x);
  return pole.liczba != null && pole.liczba > 0 ? pole.liczba : null;
}

function naglowek(k, u) {
  return [
    `${w(k.miejscowosc)}, %DATA%`,
    '',
    `Wykonawca: ${w(k.nazwa)}`,
    `Adres: ${w(k.adres)}`,
    `NIP ${w(k.nip)}${niepusty(k.email) ? `, e-mail: ${k.email.trim()}` : ''}`,
    '',
    `Zamawiający: ${w(u.zamawiajacy)}`,
    `Dotyczy: umowa ${w(u.numerUmowy)}${niepusty(u.dataUmowy) ? ` z dnia ${dataPL(u.dataUmowy)}` : ''} — ${w(u.tytul)}${niepusty(u.numer) ? ` (postępowanie nr ${u.numer.trim()})` : ''}`,
    '',
  ];
}

function podpis(k) {
  const osoba = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  return ['', osoba, '(podpis kwalifikowany, podpis zaufany albo podpis osobisty)'];
}

/** Pierwsze dni po podpisaniu — kolejność = kolejność terminów. */
export const CHECKLISTA_PO_WYGRANEJ = deepFreeze([
  { id: 'umowa', tytul: 'Podpisz umowę w terminie wyznaczonym przez zamawiającego', opis: 'Uchylanie się od podpisania = utrata wadium i możliwy wybór kolejnej oferty (art. 263).', ekran: 'PrzeswietlenieUmowy' },
  { id: 'zabezpieczenie', tytul: 'Wnieś zabezpieczenie należytego wykonania', opis: 'Najpóźniej w dniu podpisania; policz, czy taniej gotówką, czy gwarancją.', ekran: 'ZabezpieczenieZwrot' },
  { id: 'polisa', tytul: 'Polisa OC i dokumenty do umowy', opis: 'Zamawiający zwykle wymaga polisy na czas realizacji — sprawdź sumę i okres.', ekran: 'Sejf' },
  { id: 'podwykonawcy', tytul: 'Zgłoś podwykonawców', opis: 'Roboty: projekt umowy PRZED ich wejściem na budowę (art. 464 ust. 1); dostawy/usługi: kopia umowy w 7 dni (ust. 8).', ekran: null },
  { id: 'harmonogram', tytul: 'Harmonogram i osoby', opis: 'Kierownik, wykaz osób, harmonogram rzeczowo-finansowy — jeśli umowa ich wymaga, w terminie z umowy.', ekran: null },
  { id: 'terminy', tytul: 'Pilnuj terminów i zmian', opis: 'Opóźnienie z winy zamawiającego lub nieprzewidywalne zdarzenie = wniosek o zmianę terminu od razu, nie po fakcie.', ekran: null },
  { id: 'kary', tytul: 'Znaj limit kar', opis: 'Policz, ile dni zwłoki wyczerpuje limit kar — to Twój margines.', ekran: 'KaryUmowne' },
  { id: 'faktura', tytul: 'Faktura i odsetki', opis: 'Fakturuj zgodnie z umową; po terminie płatności należą się odsetki i rekompensata 40 €.', ekran: 'KalkulatorOdsetek' },
  { id: 'zwrot', tytul: 'Odzyskaj zabezpieczenie', opis: '70 % w 30 dni po odbiorze, 30 % w 15 dni po rękojmi — na wniosek, jeśli zamawiający nie zwraca sam.', ekran: 'ZabezpieczenieZwrot' },
]);

/** Zgłoszenie podwykonawcy — projekt umowy (roboty) albo kopia umowy (dostawy/usługi). */
export function generujZgloszeniePodwykonawcy({ wykonawca, umowa, podwykonawca, rodzaj, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const u = umowa && typeof umowa === 'object' ? umowa : {};
  const p = podwykonawca && typeof podwykonawca === 'object' ? podwykonawca : {};
  const roboty = rodzaj !== 'uslugi' && rodzaj !== 'dostawy';
  const wart = kwota(p.wartosc);
  const tresc = [
    ...naglowek(k, u),
    roboty ? 'ZGŁOSZENIE PODWYKONAWCY ROBÓT BUDOWLANYCH' : 'ZGŁOSZENIE PODWYKONAWCY (DOSTAWY / USŁUGI)',
    '',
    roboty
      ? 'Na podstawie art. 464 ust. 1 ustawy Pzp przedkładam projekt umowy o podwykonawstwo, której przedmiotem są roboty budowlane, z zamiarem powierzenia podwykonawcy następującej części zamówienia:'
      : 'Na podstawie art. 464 ust. 8 ustawy Pzp przedkładam poświadczoną za zgodność z oryginałem kopię zawartej umowy o podwykonawstwo, której przedmiotem są dostawy / usługi, w zakresie:',
    '',
    `Podwykonawca: ${w(p.nazwa)}`,
    `Adres: ${w(p.adres)}`,
    `NIP ${w(p.nip)}`,
    `Zakres powierzonych prac: ${w(p.zakres)}`,
    `Wartość umowy o podwykonawstwo: ${wart ? formatujPLN(wart) + ' netto' : '…'}`,
    '',
    roboty
      ? 'Wnoszę o zgłoszenie ewentualnych zastrzeżeń do projektu w terminie określonym w umowie w sprawie zamówienia publicznego, nie dłuższym niż 14 dni od dnia jego przedłożenia (art. 464 ust. 3 i 4 ustawy Pzp). Brak zastrzeżeń w tym terminie oznacza akceptację projektu. Po zawarciu umowy przedłożę jej poświadczoną kopię w terminie 7 dni (art. 464 ust. 5).'
      : 'Obowiązek przedłożenia nie dotyczy umów o wartości mniejszej niż 0,5 % wartości umowy w sprawie zamówienia publicznego oraz umów o wartości mniejszej niż 50 000 zł, a także dostaw / usług wyłączonych przez Zamawiającego w SWZ (art. 464 ust. 8) — zgłoszenie składam z ostrożności.',
    '',
    'Oświadczam, że termin zapłaty wynagrodzenia podwykonawcy nie przekracza 30 dni od dnia doręczenia faktury (art. 464 ust. 2 ustawy Pzp).',
    '',
    roboty ? 'Załącznik: projekt umowy o podwykonawstwo.' : 'Załącznik: poświadczona za zgodność z oryginałem kopia umowy o podwykonawstwo.',
    ...podpis(k),
  ].join('\n').replace('%DATA%', dataPL(dzisiaj));
  return { id: 'zgloszenie_podwykonawcy', nazwa: roboty ? 'Zgłoszenie podwykonawcy robót budowlanych' : 'Zgłoszenie podwykonawcy dostaw / usług', podstawa: roboty ? 'art. 464 ust. 1 Pzp' : 'art. 464 ust. 8 Pzp', tresc };
}

/** Wniosek o zmianę terminu wykonania umowy — z klauzuli umownej albo z okoliczności nieprzewidywalnych. */
export function generujWniosekOZmianeTerminu({ wykonawca, umowa, podstawa, nowyTermin, uzasadnienie, paragrafKlauzuli, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const u = umowa && typeof umowa === 'object' ? umowa : {};
  const klauzula = podstawa !== 'nieprzewidywalne';
  const tresc = [
    ...naglowek(k, u),
    'WNIOSEK O ZMIANĘ TERMINU WYKONANIA UMOWY',
    '',
    klauzula
      ? `Na podstawie art. 455 ust. 1 pkt 1 ustawy Pzp oraz ${niepusty(paragrafKlauzuli) ? paragrafKlauzuli.trim() : 'postanowień umowy przewidujących zmianę terminu'} wnoszę o zmianę terminu wykonania umowy na dzień ${dataPL(nowyTermin)}.`
      : `Na podstawie art. 455 ust. 1 pkt 4 ustawy Pzp wnoszę o zmianę terminu wykonania umowy na dzień ${dataPL(nowyTermin)} — konieczność zmiany spowodowały okoliczności, których Zamawiający, działając z należytą starannością, nie mógł przewidzieć, a zmiana nie modyfikuje ogólnego charakteru umowy.`,
    '',
    'Uzasadnienie:',
    w(uzasadnienie),
    '',
    'Okoliczności te są niezależne od Wykonawcy i uniemożliwiają dotrzymanie dotychczasowego terminu mimo zachowania należytej staranności. Wnoszę o zawarcie aneksu do umowy w powyższym zakresie; projekt aneksu mogę przygotować na życzenie Zamawiającego.',
    '',
    'Załączniki: dokumenty potwierdzające okoliczności (korespondencja, protokoły, pisma dostawców).',
    ...podpis(k),
  ].join('\n').replace('%DATA%', dataPL(dzisiaj));
  return { id: 'wniosek_zmiana_terminu', nazwa: 'Wniosek o zmianę terminu wykonania umowy', podstawa: klauzula ? 'art. 455 ust. 1 pkt 1 Pzp' : 'art. 455 ust. 1 pkt 4 Pzp', tresc };
}

/** Wniosek o zwrot zabezpieczenia: 70 % po odbiorze (ust. 1) albo 30 % po rękojmi (ust. 3). */
export function generujWniosekOZwrotZabezpieczenia({ wykonawca, umowa, etap, kwotaZabezpieczenia, dataOdbioru, dataKoncaRekojmi, rachunek, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const u = umowa && typeof umowa === 'object' ? umowa : {};
  const poRekojmi = etap === 'po_rekojmi';
  const calosc = kwota(kwotaZabezpieczenia);
  const czesc = calosc ? procentDoGroszy(calosc, poRekojmi ? 30 : 70) : null;
  const tresc = [
    ...naglowek(k, u),
    'WNIOSEK O ZWROT ZABEZPIECZENIA NALEŻYTEGO WYKONANIA UMOWY',
    '',
    poRekojmi
      ? `Na podstawie art. 453 ust. 3 ustawy Pzp wnoszę o zwrot pozostałej części zabezpieczenia (30 % kwoty ${calosc ? formatujPLN(calosc) : '…'}, tj. ${czesc ? formatujPLN(czesc) : '…'}) w związku z upływem okresu rękojmi za wady / gwarancji w dniu ${dataPL(dataKoncaRekojmi)}. Zwrot powinien nastąpić nie później niż w 15 dni po upływie tego okresu.`
      : `Na podstawie art. 453 ust. 1 ustawy Pzp wnoszę o zwrot 70 % zabezpieczenia należytego wykonania umowy (z kwoty ${calosc ? formatujPLN(calosc) : '…'}, tj. ${czesc ? formatujPLN(czesc) : '…'}) w związku z wykonaniem zamówienia i uznaniem go przez Zamawiającego za należycie wykonane — protokół odbioru końcowego z dnia ${dataPL(dataOdbioru)}. Zwrot powinien nastąpić w terminie 30 dni od dnia odbioru.`,
    '',
    `Zwrot proszę przekazać na rachunek bankowy nr: ${w(rachunek)} (zabezpieczenie wniesione w pieniądzu zwraca się z odsetkami wynikającymi z umowy rachunku, pomniejszonymi o koszty prowadzenia rachunku i prowizję przelewu — art. 453 ust. 2). Jeżeli zabezpieczenie wniesiono w formie gwarancji, wnoszę o zwolnienie gwarancji w tej części.`,
    ...podpis(k),
  ].join('\n').replace('%DATA%', dataPL(dzisiaj));
  return { id: poRekojmi ? 'zwrot_zabezpieczenia_30' : 'zwrot_zabezpieczenia_70', nazwa: 'Wniosek o zwrot zabezpieczenia należytego wykonania umowy', podstawa: poRekojmi ? 'art. 453 ust. 3 Pzp' : 'art. 453 ust. 1 Pzp', tresc };
}
