/**
 * „Trener negocjacji i oferty dodatkowej" — czysta logika (testowalna node:test).
 * ZERO importów, ZERO sieci, ZERO zegara — ekran renderuje i dokłada kolor z
 * motyw.js na podstawie semantycznego `ton`.
 *
 * PROBLEM: w trybie podstawowym w wariancie 2 lub 3 (art. 275 pkt 2-3 Pzp) po
 * otwarciu ofert wykonawca może dostać zaproszenie do negocjacji i złożyć OFERTĘ
 * DODATKOWĄ, którą przebije konkurencję. Pułapka: oferta dodatkowa NIE MOŻE być
 * mniej korzystna w ŻADNYM kryterium niż pierwotna — inaczej jest odrzucana
 * (art. 296 ust. 3 Pzp). Ten moduł: (a) rozpoznaje tryb z tekstu ogłoszenia,
 * (b) tłumaczy userowi co to znaczy, (c) formatuje termin odpowiedzi z odmianą PL,
 * (d) niesie treść żelaznej zasady, (e) porównuje ofertę dodatkową z pierwotną
 * pole po polu i BLOKUJE wysyłkę, gdy cokolwiek jest mniej korzystne.
 *
 * PODSTAWA PRAWNA:
 *  • art. 275 Pzp — tryb podstawowy w trzech wariantach:
 *     pkt 1 — wybór oferty BEZ negocjacji (brak oferty dodatkowej),
 *     pkt 2 — zamawiający MOŻE prowadzić negocjacje (fakultatywne),
 *     pkt 3 — zamawiający PROWADZI negocjacje (obowiązkowe);
 *  • art. 296 ust. 2-3 Pzp — po negocjacjach wykonawca składa ofertę dodatkową,
 *    która NIE MOŻE być mniej korzystna w żadnym z kryteriów niż oferta pierwotna;
 *    ofertę dodatkową mniej korzystną odrzuca się.
 */

// Znak litery Z polskimi diakrytykami — `\w` (ASCII) nie obejmuje ą/ć/ę/ł/ń/ó/ś/ź/ż.
const L = '[\\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]';

/** Liczba skończona albo 0 (defensywnie). */
function liczba(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** Liczba skończona albo null — dla pól, których „brak" ma znaczyć „nieporównywalne". */
function liczbaOrNull(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Grupowanie tysięcy: 1050000 → „1 050 000". */
function grupujTysiace(n) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ─────────────────────────── (a) wykrywanie trybu ────────────────────────────

const RE_TRYB_PODSTAWOWY = /tryb\w*\s+podstawow\w*/i;
// „art. 275 pkt 2", „art. 275 ust. 1 pkt 3" — łapiemy numer punktu (1-3).
// Opcjonalny „ust. N" pomiędzy 275 a „pkt" musi być przeskoczony razem z jego cyfrą.
const RE_ART_275_PKT = /275[\s.,]*(?:ust\.?\s*\d+[\s.,]*)?(?:pkt|punkt)\.?\s*([1-3])\b/i;
// Inne, nazwane tryby — jeśli obecne i nie ma trybu podstawowego, to nie nasz przypadek.
const RE_INNY_TRYB = new RegExp(
  [
    'przetarg\\w*\\s+nieograniczon\\w*',
    'przetarg\\w*\\s+ograniczon\\w*',
    'negocjacj\\w*\\s+z\\s+ogłoszeniem',
    'negocjacj\\w*\\s+bez\\s+ogłoszenia',
    'dialog\\w*\\s+konkurencyjn\\w*',
    'partnerstw\\w*\\s+innowacyjn\\w*',
    'wolnej\\s+r[ęe]ki',
  ].join('|'),
  'i',
);

const NEGOCJACJE_WG_WARIANTU = { 1: 'brak', 2: 'fakultatywne', 3: 'obowiazkowe' };

/**
 * Rozpoznaje z tekstu ogłoszenia tryb podstawowy i jego wariant (art. 275 Pzp).
 * Priorytet ma jawne „art. 275 pkt N"; w razie braku — opis słowny („z możliwością
 * negocjacji" = wariant 2, „prowadzi negocjacje" bez „może" = wariant 3, „bez
 * negocjacji" = wariant 1). Dla innych trybów i pustego wejścia → nic nie wykryto.
 *
 * @param {string|any} tekst treść ogłoszenia / SWZ.
 * @returns {Readonly<{
 *   trybPodstawowy: boolean,
 *   wariant: 1|2|3|null,
 *   negocjacje: 'brak'|'fakultatywne'|'obowiazkowe'|null,
 *   mozliwaOfertaDodatkowa: boolean,
 * }>}
 */
export function wykryjTrybNegocjacji(tekst) {
  const t = typeof tekst === 'string' ? tekst : '';
  const wynik = (trybPodstawowy, wariant) =>
    Object.freeze({
      trybPodstawowy,
      wariant,
      negocjacje: wariant ? NEGOCJACJE_WG_WARIANTU[wariant] : null,
      mozliwaOfertaDodatkowa: wariant === 2 || wariant === 3,
    });

  if (t.trim() === '') return wynik(false, null);

  // 1) Jawny punkt art. 275 — najsilniejszy sygnał (art. 275 = tryb podstawowy).
  const pkt = t.match(RE_ART_275_PKT);
  if (pkt) return wynik(true, Number(pkt[1]));

  const maTrybPodstawowy = RE_TRYB_PODSTAWOWY.test(t);
  if (!maTrybPodstawowy) {
    // Brak trybu podstawowego — jeśli to nazwany inny tryb (albo cokolwiek), nie nasz przypadek.
    return wynik(false, null);
  }

  // 2) Opis słowny wariantu (gdy nie podano punktu).
  const reFakultatywne = new RegExp(
    `mo[żz]\\w*\\s+(?:${L}*\\s+)?negocj|mo[żz]liwo[śs]${L}*\\s+(?:${L}*\\s+)?negocj`,
    'i',
  );
  const reBezNegocjacji = /bez\s+(?:przeprowadzenia\s+)?negocjacj/i;
  const reZNegocjacjami = new RegExp(`(?:prowadz|przeprowadz|z)${L}*\\s+negocjacj`, 'i');

  if (reBezNegocjacji.test(t)) return wynik(true, 1);
  if (reFakultatywne.test(t)) return wynik(true, 2);
  if (reZNegocjacjami.test(t)) return wynik(true, 3);

  // Tryb podstawowy rozpoznany, ale wariantu nie da się ustalić — konserwatywnie bez oferty dodatkowej.
  return wynik(true, null);
}

// ─────────────────────────── (b) wyjaśnienie dla usera ────────────────────────

/**
 * Składa wyjaśnienie dla użytkownika na bazie wyniku {@link wykryjTrybNegocjacji}:
 * co oznacza rozpoznany tryb, że po otwarciu ofert może przyjść zaproszenie do
 * negocjacji i że przysługuje prawo do złożenia oferty dodatkowej. Dla wariantu 1
 * i innych trybów `dotyczy=false` (trener nie ma zastosowania).
 *
 * @param {{wariant:1|2|3|null, mozliwaOfertaDodatkowa:boolean}} wykrycie
 * @returns {Readonly<{dotyczy:boolean, tytul:string, tresc:string, akapity:string[]}>}
 */
export function wyjasnienieDlaUzytkownika(wykrycie = {}) {
  const wariant = wykrycie.wariant ?? null;
  const dotyczy = wariant === 2 || wariant === 3;

  if (!dotyczy) {
    const tresc =
      wariant === 1
        ? 'To tryb podstawowy BEZ negocjacji (art. 275 pkt 1 Pzp): zamawiający wybierze ofertę bez zaproszeń do rozmów, więc nie będzie oferty dodatkowej. Trener negocjacji nie ma tu zastosowania — licz się w pierwszej i jedynej ofercie.'
        : 'To postępowanie nie przewiduje negocjacji ani oferty dodatkowej (nie rozpoznano trybu podstawowego wariant 2 lub 3). Trener negocjacji nie ma tu zastosowania.';
    return Object.freeze({
      dotyczy: false,
      tytul: 'Negocjacje i oferta dodatkowa: brak w tym postępowaniu',
      tresc,
      akapity: Object.freeze([tresc]),
    });
  }

  const wstep =
    'To tryb podstawowy z negocjacjami (art. 275 pkt ' +
    wariant +
    ' Pzp). Po otwarciu ofert zamawiający może przysłać zaproszenie do negocjacji, a po nich masz prawo złożyć OFERTĘ DODATKOWĄ — nową propozycję, którą możesz przebić konkurencję (art. 296 ust. 2 Pzp).';

  const trybZdanie =
    wariant === 3
      ? 'W tym wariancie negocjacje są OBOWIĄZKOWE — zamawiający je przeprowadzi, więc realnie przygotuj się na zaproszenie.'
      : 'W tym wariancie negocjacje są fakultatywne — zamawiający MOŻE je przeprowadzić, ale nie musi; bądź gotowy na zaproszenie, choć może nie przyjść.';

  const ostrzezenie =
    ZELAZNA_ZASADA.tresc + ' ' + ZELAZNA_ZASADA.konsekwencja;

  const akapity = Object.freeze([wstep, trybZdanie, ostrzezenie]);
  return Object.freeze({
    dotyczy: true,
    tytul: 'Możesz dostać zaproszenie do negocjacji i złożyć ofertę dodatkową',
    tresc: akapity.join(' '),
    akapity,
  });
}

// ─────────────────────────── (c) odmiana terminu PL ───────────────────────────

/** Formy odmiany: [dla 1, dla 2-4, dla 5+ / 12-14]. */
const JEDNOSTKI = {
  godzina: ['godzina', 'godziny', 'godzin'],
  dzien: ['dzień', 'dni', 'dni'],
  tydzien: ['tydzień', 'tygodnie', 'tygodni'],
};

// Aliasy — pozwalają podać jednostkę w liczbie mnogiej / z polskim znakiem.
const ALIASY_JEDNOSTEK = {
  godzina: 'godzina',
  godziny: 'godzina',
  godzin: 'godzina',
  h: 'godzina',
  dzien: 'dzien',
  'dzień': 'dzien',
  dni: 'dzien',
  tydzien: 'tydzien',
  'tydzień': 'tydzien',
  tygodnie: 'tydzien',
  tygodni: 'tydzien',
};

/** Polska odmiana rzeczownika dla liczby n wg form [jeden, kilka, wiele]. */
function odmiana(n, [jeden, kilka, wiele]) {
  const abs = Math.abs(n);
  if (abs === 1) return jeden;
  const ost = abs % 10;
  const ost2 = abs % 100;
  if (ost >= 2 && ost <= 4 && !(ost2 >= 12 && ost2 <= 14)) return kilka;
  return wiele;
}

/**
 * Formatuje termin odpowiedzi z poprawną odmianą PL: „1 godzina", „5 godzin",
 * „1 dzień", „3 dni", „2 tygodnie", „5 tygodni". Jednostkę można podać w dowolnej
 * formie (godzina/godziny/godzin/h, dzień/dni, tydzień/tygodnie/tygodni). Wartość
 * niepoprawna / ujemna → 0 w danej jednostce.
 *
 * @param {number} ilosc liczba jednostek.
 * @param {string} jednostka nazwa jednostki (dowolna forma z listy aliasów).
 */
export function formatujTermin(ilosc, jednostka) {
  const klucz = ALIASY_JEDNOSTEK[String(jednostka).trim().toLowerCase()] || 'dzien';
  const formy = JEDNOSTKI[klucz];
  const n = Math.max(0, Math.round(liczba(ilosc)));
  return `${n} ${odmiana(n, formy)}`;
}

// ─────────────────────────── (d) żelazna zasada ───────────────────────────────

/**
 * Twarda zasada oferty dodatkowej — do przypomnienia userowi na każdym kroku
 * negocjacji. Osobny, zamrożony obiekt, bo ten sam tekst wchodzi też do wyjaśnienia.
 */
export const ZELAZNA_ZASADA = Object.freeze({
  tytul: 'Żelazna zasada oferty dodatkowej',
  tresc:
    'Oferta dodatkowa NIE MOŻE być mniej korzystna w ŻADNYM kryterium oceny ofert niż oferta pierwotna (art. 296 ust. 3 Pzp): cena nie wyższa, terminy nie dłuższe, gwarancja nie krótsza, żaden parametr punktowany nie gorszy.',
  konsekwencja:
    'Pogorszenie choćby jednej pozycji oznacza odrzucenie oferty dodatkowej — dlatego przed wysyłką porównaj ją z pierwotną pole po polu.',
});

// ─────────────────────────── (e) porównanie pole po polu ──────────────────────

/**
 * Domyślny katalog kryteriów porównania. `kierunek` mówi, co jest KORZYSTNE:
 *  • nizej_lepiej — mniejsza wartość lepsza (cena, termin realizacji),
 *  • wyzej_lepiej — większa wartość lepsza (okres gwarancji, doświadczenie).
 * `slowoGorzej` = przymiotnik do powodu, gdy pozycja wypadła gorzej.
 */
export const KRYTERIA_DOMYSLNE = Object.freeze([
  Object.freeze({ klucz: 'cena', etykieta: 'Cena', kierunek: 'nizej_lepiej', slowoGorzej: 'wyższa', jednostka: 'zł' }),
  Object.freeze({ klucz: 'termin', etykieta: 'Termin realizacji', kierunek: 'nizej_lepiej', slowoGorzej: 'dłuższy', jednostka: 'dni' }),
  Object.freeze({ klucz: 'gwarancja', etykieta: 'Okres gwarancji', kierunek: 'wyzej_lepiej', slowoGorzej: 'krótsza', jednostka: 'mies.' }),
]);

/** Ocena pojedynczego pola: 'lepsza' | 'remis' | 'gorsza' (z perspektywy oferty dodatkowej). */
function ocenPole(kierunek, wp, wd) {
  if (wp === wd) return 'remis';
  const lepsza = kierunek === 'nizej_lepiej' ? wd < wp : wd > wp;
  return lepsza ? 'lepsza' : 'gorsza';
}

/**
 * Porównuje ofertę dodatkową z pierwotną POLE PO POLU wg katalogu kryteriów i
 * zwraca listę pozycji mniej korzystnych oraz twardą flagę `blokujWyslanie`
 * (art. 296 ust. 3 Pzp — jakiekolwiek pogorszenie = odrzucenie). Porównywane są
 * tylko pola z liczbową wartością w OBU ofertach; pola nieporównywalne pomijamy,
 * żeby nie blokować na ślepo.
 *
 * @param {{pierwotna?:object, dodatkowa?:object, kryteria?:Array}} we
 * @returns {Readonly<{
 *   pozycje: Array,
 *   mniejKorzystne: Array,
 *   blokujWyslanie: boolean,
 *   ton: 'sukces'|'danger',
 *   komunikat: string,
 * }>}
 */
export function porownajOfertaDodatkowa(we = {}) {
  const pierwotna = we.pierwotna || {};
  const dodatkowa = we.dodatkowa || {};
  const kryteria = Array.isArray(we.kryteria) ? we.kryteria : KRYTERIA_DOMYSLNE;

  const pozycje = [];
  for (const k of kryteria) {
    const wp = liczbaOrNull(pierwotna[k.klucz]);
    const wd = liczbaOrNull(dodatkowa[k.klucz]);
    if (wp === null || wd === null) continue; // nieporównywalne — pomijamy

    const ocena = ocenPole(k.kierunek, wp, wd);
    const pozycja = {
      klucz: k.klucz,
      etykieta: k.etykieta,
      kierunek: k.kierunek,
      wartoscPierwotna: wp,
      wartoscDodatkowa: wd,
      roznica: wd - wp,
      ocena,
      powod:
        ocena === 'gorsza'
          ? `${k.etykieta} ${k.slowoGorzej} o ${grupujTysiace(wd - wp)}${k.jednostka ? ' ' + k.jednostka : ''} (${grupujTysiace(wp)} → ${grupujTysiace(wd)})`
          : null,
    };
    pozycje.push(pozycja);
  }

  const mniejKorzystne = pozycje.filter((p) => p.ocena === 'gorsza');
  const blokujWyslanie = mniejKorzystne.length > 0;

  return Object.freeze({
    pozycje,
    mniejKorzystne,
    blokujWyslanie,
    ton: blokujWyslanie ? 'danger' : 'sukces',
    komunikat: blokujWyslanie
      ? `Blokada wysyłki: ${mniejKorzystne.length} ${odmiana(mniejKorzystne.length, ['pozycja', 'pozycje', 'pozycji'])} mniej ${mniejKorzystne.length === 1 ? 'korzystna' : 'korzystnych'} niż w ofercie pierwotnej — poprawa wymagana, inaczej odrzucenie.`
      : 'Oferta dodatkowa nie jest gorsza w żadnym kryterium — można ją wysłać.',
  });
}
