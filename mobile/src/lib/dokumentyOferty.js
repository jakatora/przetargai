import { analizujPole } from './walidacjaLiczb.js';
import { formatujPLN } from './kalkulatorCeny.js';
import { procentDoGroszy, sumaGroszy, doGroszy } from './grosze.js';
import { zarejestrujKlucz } from './daneLokalne.js';

/*
 * „Dokumenty do oferty w 1 klik" — generator oświadczeń i formularza ofertowego.
 *
 * Problem, który rozwiązuje: wykonawca przy KAŻDEJ ofercie od nowa przepisuje te
 * same dane firmy do tych samych oświadczeń (art. 125 ust. 1, grupa kapitałowa,
 * aktualność informacji) i szkicu formularza ofertowego. Tu dane wykonawcy wpisuje
 * RAZ (ekran trzyma je lokalnie), a resztę bierze z ogłoszenia — dokumenty są
 * gotowe do podpisu elektronicznego i wysyłki.
 *
 * CZYSTA logika: bez UI, bez sieci, bez zegara (data wchodzi parametrem `dzisiaj`),
 * nigdy nie rzuca — brakujące dane to kropki „…", nie „undefined". Taki sam wzorzec
 * jak `zobowiazaniePodmiotu.generujTrescZobowiazania` (Kreator 118).
 *
 * Granice odpowiedzialności (świadome):
 *  • To SZKICE wg ustawowych wymogów — zamawiający często narzuca WŁASNE wzory
 *    załączników do SWZ. Wtedy nasz tekst służy do przepisania/porównania, a treść
 *    oświadczeń (podstawa prawna, elementy) jest ta sama. Ekran mówi to wprost.
 *  • Powyżej progów UE (ogłoszenia z TED) oświadczenie wstępne składa się na
 *    formularzu JEDZ (ESPD), nie w formie swobodnej — generator to sygnalizuje.
 *  • Fakultatywne przesłanki wykluczenia (art. 109 ust. 1) obowiązują tylko, gdy
 *    zamawiający je PRZEWIDZIAŁ w SWZ — stąd opcja, nie domyślność.
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

// ───────────────────────── dane wykonawcy ─────────────────────────

export const ID_POL_WYKONAWCY = Object.freeze({
  NAZWA: 'nazwa',
  ADRES: 'adres',
  NIP: 'nip',
  REGON: 'regon',
  REJESTR: 'rejestr',
  REPREZENTANT: 'reprezentant',
  STANOWISKO: 'stanowisko',
  EMAIL: 'email',
  TELEFON: 'telefon',
  MIEJSCOWOSC: 'miejscowosc',
  WIELKOSC: 'wielkosc',
});

/** Wielkość przedsiębiorstwa — oświadczenie w formularzu ofertowym (statystyka UZP, art. 7 pkt 11 Pzp nie, ale wzory SWZ tego wymagają). */
export const WIELKOSCI_FIRMY = deepFreeze([
  { id: 'mikro', etykieta: 'mikroprzedsiębiorstwo', opis: 'do 9 pracowników i do 2 mln € obrotu' },
  { id: 'male', etykieta: 'małe przedsiębiorstwo', opis: 'do 49 pracowników i do 10 mln € obrotu' },
  { id: 'srednie', etykieta: 'średnie przedsiębiorstwo', opis: 'do 249 pracowników i do 50 mln € obrotu' },
  { id: 'duze', etykieta: 'duże przedsiębiorstwo', opis: 'powyżej progów MŚP' },
  { id: 'jednoosobowa', etykieta: 'jednoosobowa działalność gospodarcza', opis: 'osoba fizyczna prowadząca działalność' },
]);

/**
 * Pola danych wykonawcy — kolejność = kolejność na ekranie. `wymagane` to minimum,
 * bez którego oświadczenie nie identyfikuje wykonawcy (nazwa, adres, NIP) albo
 * nie ma kto go podpisać (reprezentant) / gdzie wysłać korespondencji (e-mail).
 */
export const POLA_WYKONAWCY = deepFreeze([
  { id: ID_POL_WYKONAWCY.NAZWA, etykieta: 'Pełna nazwa firmy', opis: 'Tak jak w KRS/CEIDG, z formą prawną', wymagane: true },
  { id: ID_POL_WYKONAWCY.ADRES, etykieta: 'Adres siedziby', opis: 'Ulica, kod pocztowy, miejscowość', wymagane: true },
  { id: ID_POL_WYKONAWCY.NIP, etykieta: 'NIP', opis: '10 cyfr, kreski dozwolone', wymagane: true },
  { id: ID_POL_WYKONAWCY.REGON, etykieta: 'REGON', opis: '9 lub 14 cyfr', wymagane: false },
  { id: ID_POL_WYKONAWCY.REJESTR, etykieta: 'Rejestr', opis: 'np. „KRS 0000123456" albo „CEIDG"', wymagane: false },
  { id: ID_POL_WYKONAWCY.REPREZENTANT, etykieta: 'Osoba podpisująca', opis: 'Imię i nazwisko osoby uprawnionej do reprezentacji', wymagane: true },
  { id: ID_POL_WYKONAWCY.STANOWISKO, etykieta: 'Stanowisko / podstawa reprezentacji', opis: 'np. Prezes Zarządu, właściciel, pełnomocnik', wymagane: false },
  { id: ID_POL_WYKONAWCY.EMAIL, etykieta: 'E-mail do korespondencji', opis: 'Na ten adres zamawiający wyśle wezwania', wymagane: true },
  { id: ID_POL_WYKONAWCY.TELEFON, etykieta: 'Telefon', opis: '', wymagane: false },
  { id: ID_POL_WYKONAWCY.MIEJSCOWOSC, etykieta: 'Miejscowość podpisania', opis: 'Trafia obok daty pod dokumentem', wymagane: false },
  { id: ID_POL_WYKONAWCY.WIELKOSC, etykieta: 'Wielkość firmy', opis: 'Do oświadczenia MŚP w formularzu ofertowym', wymagane: false },
]);

/** Klucz lokalnego magazynu z danymi wykonawcy (wpisane raz, używane przy każdej ofercie). */
export const KLUCZ_DANYCH_WYKONAWCY = 'przetargai.dane_wykonawcy';

/*
 * Stan „tej oferty" (cena, termin, gwarancja, przełączniki sytuacji) PER PRZETARG —
 * po powrocie do tego samego ogłoszenia nic nie trzeba wpisywać drugi raz.
 * Klucz per przetarg → rejestracja w indeksie konta (wylogowanie go skasuje; SecureStore
 * nie listuje kluczy). Prefiks jest wpisany w `daneLokalne.PREFIKSY_KONTA`.
 */
/** SecureStore dopuszcza tylko [A-Za-z0-9._-] — id ogłoszeń mają „:" (np. `bzp:2026-BZP-…`). */
export function kluczStanuOferty(tenderId) {
  return `przetargai.dokumenty-oferty.${String(tenderId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** @returns {Promise<{oferta?: object, sytuacja?: object, pelnomocnik?: object}|null>} */
export async function wczytajStanOferty(storage, tenderId) {
  if (!tenderId) return null;
  try {
    const raw = await storage.getItem(kluczStanuOferty(tenderId));
    const dane = raw ? JSON.parse(raw) : null;
    return dane && typeof dane === 'object' ? dane : null;
  } catch {
    return null;
  }
}

export async function zapiszStanOferty(storage, tenderId, stan) {
  if (!tenderId || !stan || typeof stan !== 'object') return;
  const klucz = kluczStanuOferty(tenderId);
  await zarejestrujKlucz(storage, klucz);
  await storage.setItem(klucz, JSON.stringify({ oferta: stan.oferta ?? {}, sytuacja: stan.sytuacja ?? {}, pelnomocnik: stan.pelnomocnik ?? {} }));
}

/** Same cyfry NIP (kreski/spacje z CEIDG i profilu precz). */
export function normalizujNip(nip) {
  return String(nip ?? '').replace(/\D/g, '');
}

/**
 * Suma kontrolna NIP (wagi 6 5 7 2 3 4 5 6 7, mod 11 — jak `lib/nip.js` w Functions). Do 1.11.2026 były tu
 * złe wagi (6 7 8 9 5 7 6 5 7): każdy prawdziwy NIP dostawał „niepoprawną sumę kontrolną”.
 */
export function czyPoprawnyNip(nip) {
  const cyfry = normalizujNip(nip);
  if (!/^\d{10}$/.test(cyfry)) return false;
  const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const suma = wagi.reduce((s, waga, i) => s + waga * Number(cyfry[i]), 0);
  const kontrolna = suma % 11;
  return kontrolna !== 10 && kontrolna === Number(cyfry[9]);
}

/** Pusty szablon; z profilu konta bierze nazwę i NIP, żeby nie przepisywać. */
export function szablonDanychWykonawcy(profil) {
  const dane = {};
  for (const p of POLA_WYKONAWCY) dane[p.id] = '';
  if (profil && typeof profil === 'object') {
    if (niepusty(profil.company_name)) dane.nazwa = profil.company_name.trim();
    if (niepusty(profil.company_nip)) dane.nip = normalizujNip(profil.company_nip);
  }
  return dane;
}

/**
 * @returns {{kompletne: boolean, braki: {id,etykieta}[], bledy: {id,etykieta,komunikat}[]}}
 *   braki = puste wymagane pola; bledy = wypełnione, ale niepoprawne (NIP, e-mail).
 */
export function walidujDaneWykonawcy(dane) {
  const d = dane && typeof dane === 'object' ? dane : {};
  const braki = [];
  const bledy = [];
  for (const p of POLA_WYKONAWCY) {
    if (p.wymagane && !niepusty(d[p.id])) braki.push({ id: p.id, etykieta: p.etykieta });
  }
  if (niepusty(d.nip) && !czyPoprawnyNip(d.nip)) {
    bledy.push({ id: ID_POL_WYKONAWCY.NIP, etykieta: 'NIP', komunikat: 'NIP ma 10 cyfr i niepoprawną sumę kontrolną — sprawdź cyfry.' });
  }
  if (niepusty(d.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    bledy.push({ id: ID_POL_WYKONAWCY.EMAIL, etykieta: 'E-mail', komunikat: 'To nie wygląda na adres e-mail.' });
  }
  return { kompletne: braki.length === 0 && bledy.length === 0, braki, bledy };
}

// ───────────────────────── dane ogłoszenia ─────────────────────────

/** Mapuje ogłoszenie z feedu (`tender`) na to, czego potrzebują dokumenty. */
export function daneZOgloszenia(tender) {
  const t = tender && typeof tender === 'object' ? tender : {};
  const s = (v) => (niepusty(v) ? v.trim() : null);
  return {
    tytul: s(t.title),
    zamawiajacy: s(t.organization),
    numer: s(t.numer),
    termin: s(t.deadline),
    zrodlo: s(t.source) ?? s(t.zrodlo),
  };
}

// ───────────────────────── wspólne kawałki tekstu ─────────────────────────

export const KIEDY = Object.freeze({ Z_OFERTA: 'z_oferta', NA_WEZWANIE: 'na_wezwanie' });

export const ETYKIETY_KIEDY = Object.freeze({
  [KIEDY.Z_OFERTA]: 'Składasz razem z ofertą',
  [KIEDY.NA_WEZWANIE]: 'Dopiero na wezwanie zamawiającego (zwykle 5 dni)',
});

function dataPL(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '…';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

function blokWykonawcy(wykonawca) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const linie = [`Wykonawca: ${w(k.nazwa)}`, `Adres: ${w(k.adres)}`, `NIP ${w(normalizujNip(k.nip) || k.nip)}`];
  if (niepusty(k.regon)) linie[2] += `, REGON ${k.regon.trim()}`;
  if (niepusty(k.rejestr)) linie[2] += `, ${k.rejestr.trim()}`;
  const kontakt = [niepusty(k.email) ? `e-mail: ${k.email.trim()}` : null, niepusty(k.telefon) ? `tel.: ${k.telefon.trim()}` : null].filter(Boolean);
  if (kontakt.length) linie.push(kontakt.join(', '));
  return linie.join('\n');
}

function blokPostepowania(przetarg) {
  const p = przetarg && typeof przetarg === 'object' ? przetarg : {};
  return [
    `Zamawiający: ${w(p.zamawiajacy)}`,
    `Postępowanie: ${w(p.tytul)}`,
    `Numer referencyjny: ${w(p.numer)}`,
  ].join('\n');
}

function blokPodpisu(wykonawca, dzisiaj) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const osoba = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  return [
    `${w(k.miejscowosc)}, ${dataPL(dzisiaj)}`,
    '',
    osoba,
    '(podpis kwalifikowany, podpis zaufany albo podpis osobisty — oferta i oświadczenia w Pzp wymagają formy elektronicznej)',
  ].join('\n');
}

// ───────────────────────── cena ─────────────────────────

/**
 * Netto z tekstu po polsku („12 500,50") + VAT% → {netto, vat, brutto} na groszach.
 * Puste, nie-liczba albo niejednoznaczne „1.200" → null (spójnie z kalkulatorami).
 */
export function policzBrutto(cenaNetto, vatProc) {
  const pole = analizujPole(cenaNetto);
  if (pole.pusty || pole.liczba == null || pole.liczba < 0) return null;
  const stawka = Number(vatProc);
  if (!Number.isFinite(stawka) || stawka < 0) return null;
  const netto = doGroszy(pole.liczba);
  const vat = procentDoGroszy(netto, stawka);
  return { netto, vat, brutto: sumaGroszy([netto, vat]) };
}

// ───────────────────────── dokumenty ─────────────────────────

/** Oświadczenie wstępne z art. 125 ust. 1 Pzp (zastępuje JEDZ poniżej progów UE). */
export function generujOswiadczenie125({ wykonawca, przetarg, dzisiaj, opcje } = {}) {
  const art109 = Boolean(opcje && opcje.art109);
  const zTed = (przetarg && przetarg.zrodlo) === 'ted';
  const tresc = [
    'OŚWIADCZENIE WYKONAWCY',
    'składane na podstawie art. 125 ust. 1 ustawy z dnia 11 września 2019 r. — Prawo zamówień publicznych',
    'o niepodleganiu wykluczeniu i spełnianiu warunków udziału w postępowaniu',
    '',
    blokPostepowania(przetarg),
    '',
    blokWykonawcy(wykonawca),
    '',
    'I. OŚWIADCZENIE O NIEPODLEGANIU WYKLUCZENIU',
    `Oświadczam, że nie podlegam wykluczeniu z postępowania na podstawie art. 108 ust. 1 ustawy Pzp${art109 ? ' oraz na podstawie art. 109 ust. 1 ustawy Pzp w zakresie przesłanek przewidzianych przez Zamawiającego w SWZ' : ''}.`,
    'Oświadczam, że nie zachodzą wobec mnie przesłanki wykluczenia z art. 7 ust. 1 ustawy z dnia 13 kwietnia 2022 r. o szczególnych rozwiązaniach w zakresie przeciwdziałania wspieraniu agresji na Ukrainę oraz służących ochronie bezpieczeństwa narodowego.',
    '',
    'II. OŚWIADCZENIE O SPEŁNIANIU WARUNKÓW UDZIAŁU',
    'Oświadczam, że spełniam warunki udziału w postępowaniu określone przez Zamawiającego w SWZ.',
    '',
    'III. OŚWIADCZENIE DOTYCZĄCE PODANYCH INFORMACJI',
    'Oświadczam, że wszystkie informacje podane w powyższych oświadczeniach są aktualne i zgodne z prawdą oraz zostały przedstawione z pełną świadomością konsekwencji wprowadzenia Zamawiającego w błąd przy przedstawianiu informacji.',
    '',
    blokPodpisu(wykonawca, dzisiaj),
  ].join('\n');

  return {
    id: 'oswiadczenie_125',
    nazwa: 'Oświadczenie wstępne (art. 125 ust. 1 Pzp)',
    podstawa: 'art. 125 ust. 1 Pzp',
    kiedy: KIEDY.Z_OFERTA,
    tresc,
    uwaga: zTed
      ? 'To ogłoszenie pochodzi z TED (powyżej progów UE) — oświadczenie wstępne składa się tam na formularzu JEDZ (ESPD), a nie w formie swobodnej. Użyj tego tekstu jako ściągi przy wypełnianiu JEDZ.'
      : null,
  };
}

/** Szkic formularza ofertowego — zamawiający zwykle ma własny wzór; tu masz komplet treści do przepisania. */
export function generujFormularzOfertowy({ wykonawca, przetarg, oferta, dzisiaj } = {}) {
  const o = oferta && typeof oferta === 'object' ? oferta : {};
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const braki = [];
  const stawka = Number.isFinite(Number(o.vatProc)) ? Number(o.vatProc) : 23;
  const cena = policzBrutto(o.cenaNetto, stawka);
  if (!cena) braki.push('cena');
  const gwarancja = analizujPole(o.gwarancjaMies);
  const wielkosc = WIELKOSCI_FIRMY.find((x) => x.id === k.wielkosc);
  const podwykonawcy = niepusty(o.podwykonawcy) ? o.podwykonawcy.trim() : null;

  const tresc = [
    'FORMULARZ OFERTOWY',
    '',
    blokPostepowania(przetarg),
    '',
    blokWykonawcy(wykonawca),
    `Osoba do kontaktu: ${w(k.reprezentant)}${niepusty(k.telefon) ? `, tel. ${k.telefon.trim()}` : ''}`,
    '',
    'W odpowiedzi na ogłoszenie o zamówieniu składam ofertę na wykonanie przedmiotu zamówienia zgodnie z wymaganiami Specyfikacji Warunków Zamówienia:',
    '',
    '1. CENA OFERTY',
    `   Cena netto: ${cena ? formatujPLN(cena.netto) : '…'}`,
    `   VAT ${stawka} %: ${cena ? formatujPLN(cena.vat) : '…'}`,
    `   Cena brutto: ${cena ? formatujPLN(cena.brutto) : '…'}`,
    '   (cena zawiera wszystkie koszty wykonania zamówienia)',
    '',
    `2. TERMIN WYKONANIA ZAMÓWIENIA: ${w(o.terminWykonania)}`,
    '',
    `3. OKRES GWARANCJI: ${gwarancja.liczba != null ? `${gwarancja.liczba} miesięcy` : '…'}`,
    '',
    `4. PODWYKONAWCY: ${podwykonawcy ? `zamierzam powierzyć podwykonawcom następujące części zamówienia: ${podwykonawcy}` : 'zamówienie wykonam samodzielnie, bez udziału podwykonawców'}`,
    '',
    `5. RODZAJ PRZEDSIĘBIORSTWA: ${wielkosc ? wielkosc.etykieta : '…'}`,
    '',
    '6. OŚWIADCZENIA',
    '   a) Zapoznałem się ze Specyfikacją Warunków Zamówienia wraz z załącznikami i nie wnoszę do niej zastrzeżeń; zdobyłem informacje konieczne do przygotowania oferty.',
    '   b) Uważam się za związanego ofertą przez okres wskazany w SWZ.',
    '   c) Akceptuję projektowane postanowienia umowy i w razie wyboru oferty zobowiązuję się do zawarcia umowy na tych warunkach, w miejscu i terminie wyznaczonym przez Zamawiającego.',
    '   d) Wypełniłem obowiązki informacyjne przewidziane w art. 13 lub art. 14 RODO wobec osób fizycznych, od których dane osobowe pozyskałem w celu ubiegania się o udzielenie zamówienia.',
    o.tajemnica
      ? '   e) Informacje zawarte w wydzielonej części oferty stanowią tajemnicę przedsiębiorstwa w rozumieniu ustawy o zwalczaniu nieuczciwej konkurencji i nie mogą być udostępniane — uzasadnienie zastrzeżenia załączam.'
      : '   e) Oferta nie zawiera informacji stanowiących tajemnicę przedsiębiorstwa.',
    '',
    '7. ZAŁĄCZNIKI',
    '   • oświadczenie z art. 125 ust. 1 Pzp',
    '   • pozostałe dokumenty wymagane w SWZ (pełnomocnictwo, zobowiązanie podmiotu trzeciego, dowód wadium — jeśli dotyczy)',
    '',
    blokPodpisu(wykonawca, dzisiaj),
  ].join('\n');

  return {
    id: 'formularz_ofertowy',
    nazwa: 'Formularz ofertowy (szkic)',
    podstawa: 'art. 218 i art. 63 ust. 2 Pzp (forma elektroniczna)',
    kiedy: KIEDY.Z_OFERTA,
    tresc,
    braki,
    uwaga: 'Jeśli zamawiający dołączył do SWZ własny wzór formularza, przepisz te wartości do jego wzoru — zamawiający może odrzucić ofertę złożoną na innym formularzu, gdy brakuje w nim wymaganych elementów.',
  };
}

/** Oświadczenie o przynależności do grupy kapitałowej (art. 108 ust. 1 pkt 5 Pzp) — podmiotowy środek dowodowy na wezwanie. */
export function generujOswiadczenieGrupaKapitalowa({ wykonawca, przetarg, nalezy, czlonkowie, dzisiaj } = {}) {
  const lista = Array.isArray(czlonkowie) ? czlonkowie.filter(niepusty).map((c) => `   • ${c.trim()}`) : [];
  const tresc = [
    'OŚWIADCZENIE WYKONAWCY',
    'o przynależności lub braku przynależności do tej samej grupy kapitałowej',
    '(art. 108 ust. 1 pkt 5 ustawy Pzp; § 2 ust. 1 pkt 1 rozporządzenia w sprawie podmiotowych środków dowodowych)',
    '',
    blokPostepowania(przetarg),
    '',
    blokWykonawcy(wykonawca),
    '',
    nalezy
      ? 'Oświadczam, że należę do tej samej grupy kapitałowej, w rozumieniu ustawy z dnia 16 lutego 2007 r. o ochronie konkurencji i konsumentów, co następujący wykonawca/wykonawcy, którzy złożyli odrębne oferty w tym postępowaniu:'
      : 'Oświadczam, że nie należę do tej samej grupy kapitałowej, w rozumieniu ustawy z dnia 16 lutego 2007 r. o ochronie konkurencji i konsumentów, z żadnym z wykonawców, którzy złożyli odrębne oferty w tym postępowaniu.',
    ...(nalezy ? (lista.length ? lista : ['   • …']) : []),
    ...(nalezy ? ['', 'Jednocześnie oświadczam, że oferta została przygotowana niezależnie od wymienionego wykonawcy/wykonawców, a powiązania nie prowadzą do zakłócenia konkurencji w postępowaniu. Dowody potwierdzające niezależność załączam.'] : []),
    '',
    blokPodpisu(wykonawca, dzisiaj),
  ].join('\n');

  return {
    id: 'oswiadczenie_grupa_kapitalowa',
    nazwa: 'Oświadczenie o grupie kapitałowej (art. 108 ust. 1 pkt 5)',
    podstawa: 'art. 108 ust. 1 pkt 5 Pzp',
    kiedy: KIEDY.NA_WEZWANIE,
    tresc,
    uwaga: null,
  };
}

/** Oświadczenie o aktualności informacji z oświadczenia art. 125 ust. 1 — na wezwanie przed wyborem oferty. */
export function generujOswiadczenieAktualnosci({ wykonawca, przetarg, dzisiaj } = {}) {
  const tresc = [
    'OŚWIADCZENIE WYKONAWCY',
    'o aktualności informacji zawartych w oświadczeniu, o którym mowa w art. 125 ust. 1 ustawy Pzp',
    '(§ 2 ust. 1 pkt 7 i § 3 rozporządzenia w sprawie podmiotowych środków dowodowych)',
    '',
    blokPostepowania(przetarg),
    '',
    blokWykonawcy(wykonawca),
    '',
    'Oświadczam, że informacje zawarte w oświadczeniu złożonym wraz z ofertą na podstawie art. 125 ust. 1 ustawy Pzp, w zakresie podstaw wykluczenia z postępowania wskazanych przez Zamawiającego, pozostają aktualne na dzień złożenia niniejszego oświadczenia.',
    '',
    blokPodpisu(wykonawca, dzisiaj),
  ].join('\n');

  return {
    id: 'oswiadczenie_aktualnosc',
    nazwa: 'Oświadczenie o aktualności informacji',
    podstawa: '§ 3 rozporządzenia o podmiotowych środkach dowodowych',
    kiedy: KIEDY.NA_WEZWANIE,
    tresc,
    uwaga: null,
  };
}

/** Pełnomocnictwo do złożenia oferty — gdy podpisuje ktoś inny niż osoba z rejestru. */
export function generujPelnomocnictwo({ wykonawca, przetarg, pelnomocnik, dzisiaj } = {}) {
  const k = wykonawca && typeof wykonawca === 'object' ? wykonawca : {};
  const pm = pelnomocnik && typeof pelnomocnik === 'object' ? pelnomocnik : {};
  const mocodawca = niepusty(k.stanowisko) ? `${w(k.reprezentant)}, ${k.stanowisko.trim()}` : w(k.reprezentant);
  const tresc = [
    'PEŁNOMOCNICTWO',
    '',
    `${w(k.miejscowosc)}, ${dataPL(dzisiaj)}`,
    '',
    `Mocodawca: ${w(k.nazwa)}, ${w(k.adres)}, NIP ${w(normalizujNip(k.nip) || k.nip)}`,
    `reprezentowany przez: ${mocodawca}`,
    '',
    `niniejszym udziela pełnomocnictwa Pani/Panu: ${w(pm.imie)}${niepusty(pm.stanowisko) ? ` (${pm.stanowisko.trim()})` : ''}${niepusty(pm.dokument) ? `, legitymującej/-emu się: ${pm.dokument.trim()}` : ''}`,
    '',
    'do reprezentowania Mocodawcy w postępowaniu o udzielenie zamówienia publicznego:',
    blokPostepowania(przetarg),
    '',
    'w zakresie:',
    '1. podpisania i złożenia oferty wraz z załącznikami oraz oświadczeń, o których mowa w art. 125 ust. 1 ustawy Pzp,',
    '2. składania wyjaśnień, uzupełnień i podmiotowych środków dowodowych na wezwanie Zamawiającego,',
    '3. udziału w negocjacjach i składania ofert dodatkowych, jeżeli postępowanie je przewiduje,',
    '4. wnoszenia środków ochrony prawnej (odwołanie do Krajowej Izby Odwoławczej) i odbioru korespondencji,',
    niepusty(pm.zakres) ? `5. ${pm.zakres.trim()}` : '5. podpisania umowy w sprawie zamówienia publicznego — TAK / NIE (skreśl niepotrzebne).',
    '',
    'Pełnomocnik nie może udzielać dalszych pełnomocnictw. Pełnomocnictwo obowiązuje do zakończenia postępowania.',
    '',
    blokPodpisu(wykonawca, dzisiaj).replace('(podpis kwalifikowany, podpis zaufany albo podpis osobisty — oferta i oświadczenia w Pzp wymagają formy elektronicznej)', '(podpis kwalifikowany, zaufany albo osobisty MOCODAWCY — pełnomocnictwo w formie elektronicznej albo elektroniczna kopia poświadczona przez notariusza)'),
  ].join('\n');
  return {
    id: 'pelnomocnictwo',
    nazwa: 'Pełnomocnictwo do złożenia oferty',
    podstawa: 'art. 98–99 KC; forma wg art. 63 Pzp i § 7 rozporządzenia o sposobie sporządzania dokumentów',
    kiedy: KIEDY.Z_OFERTA,
    tresc,
    uwaga: 'Podpisuje MOCODAWCA (osoba z KRS/CEIDG), nie pełnomocnik. Skan podpisanego odręcznie papieru wymaga poświadczenia notarialnego — najprościej podpisać elektronicznie.',
  };
}

/**
 * Co jeszcze dołączyć do oferty poza pakietem — zależnie od sytuacji wykonawcy.
 * Każda pozycja z `ekran` prowadzi do narzędzia, które ten dokument robi.
 */
export function coJeszczeDolaczyc({ pelnomocnik, polegaNaZasobach, konsorcjum, wadium } = {}) {
  const lista = [];
  if (pelnomocnik) {
    lista.push({ id: 'pelnomocnictwo', tytul: 'Pełnomocnictwo', opis: 'Ofertę podpisuje pełnomocnik — dołącz pełnomocnictwo w formie elektronicznej albo elektroniczną kopię poświadczoną przez notariusza.', ekran: null });
  }
  if (polegaNaZasobach) {
    lista.push({ id: 'zobowiazanie118', tytul: 'Zobowiązanie podmiotu udostępniającego zasoby', opis: 'Polegasz na doświadczeniu innej firmy — bez zobowiązania (art. 118 ust. 3) warunek nie jest wykazany.', ekran: 'Kreator118' });
  }
  if (konsorcjum) {
    lista.push({ id: 'konsorcjum117', tytul: 'Oświadczenie konsorcjum (art. 117 ust. 4)', opis: 'Które roboty/usługi wykona który członek konsorcjum + pełnomocnictwo lidera.', ekran: 'Konsorcjum' });
  }
  if (wadium) {
    lista.push({ id: 'wadium', tytul: 'Dowód wniesienia wadium', opis: 'Przelew przed terminem albo oryginał gwarancji w formie elektronicznej — sprawdź kontrolerem gwarancji.', ekran: 'KontrolerGwarancji' });
  }
  lista.push({ id: 'podpis', tytul: 'Podpis elektroniczny na KAŻDYM dokumencie', opis: 'Kwalifikowany, zaufany albo osobisty — brak podpisu lub podpis tylko na „kopercie" to odrzucenie (najczęstszy błąd formalny).', ekran: 'KontrolaOferty' });
  return lista;
}

/**
 * Komplet dokumentów w stałej kolejności: najpierw to, co idzie z ofertą.
 * Pełnomocnictwo dochodzi tylko, gdy ofertę podpisuje pełnomocnik (`opcje.pelnomocnik`).
 */
export function pakietDokumentow({ wykonawca, przetarg, oferta, opcje, dzisiaj } = {}) {
  const o = opcje && typeof opcje === 'object' ? opcje : {};
  return [
    generujFormularzOfertowy({ wykonawca, przetarg, oferta, dzisiaj }),
    generujOswiadczenie125({ wykonawca, przetarg, dzisiaj, opcje: { art109: Boolean(o.art109) } }),
    ...(o.pelnomocnik ? [generujPelnomocnictwo({ wykonawca, przetarg, pelnomocnik: o.danePelnomocnika, dzisiaj })] : []),
    generujOswiadczenieGrupaKapitalowa({ wykonawca, przetarg, nalezy: Boolean(o.grupaKapitalowa), czlonkowie: o.czlonkowieGrupy, dzisiaj }),
    generujOswiadczenieAktualnosci({ wykonawca, przetarg, dzisiaj }),
  ];
}
