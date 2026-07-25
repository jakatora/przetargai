/**
 * Detektor ZAPISÓW O PODWYKONAWCACH w projekcie umowy (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 6/12).
 *
 * Wejściem jest znormalizowany tekst umowy (z `ekstrahuj_i_normalizuj`). Detektor
 * odpowiada „po ludzku": czy umowa reguluje PODWYKONAWSTWO, czy jest ono co do
 * zasady dopuszczone, oraz na jakie warunki/ryzyka uważać — zgoda Zamawiającego,
 * obowiązek zgłaszania/przedkładania umów o podwykonawstwo, solidarna
 * odpowiedzialność i bezpośrednia zapłata podwykonawcy (art. 647(1) KC / art. 465
 * Pzp). Gdy umowa ZAKAZUJE lub istotnie ogranicza podwykonawstwo (np. obowiązek
 * osobistego wykonania) — a to potrafi wykluczyć przyjęty sposób realizacji —
 * detektor zwraca flagę w polu `ostrzezenie`.
 *
 * To rozpoznawanie po FRAZACH/REGEX — świadomie proste i konserwatywne, nie
 * rozumienie prawnicze. Reużywamy `normalize` z textNorm (małe litery, bez
 * diakrytyków), żeby łapać warianty zapisu. Cue szukamy w OKNIE wokół wzmianki o
 * podwykonawcy, żeby ogólne słowa („niedopuszczalne", „solidarnie") wiązać z
 * kontekstem podwykonawstwa, a nie z inną klauzulą.
 *
 * DWUPOZIOMOWA SKALA FLAG (spójna z resztą ulepszenia): `czerwony` rezerwujemy na
 * naruszenia i pułapki niemal zawsze szkodliwe (brak limitu kar, brak
 * obowiązkowej klauzuli waloryzacyjnej). Zakaz/ograniczenie podwykonawstwa to
 * zapis LEGALNY, którego waga zależy od tego, czy oferent planuje podwykonawców —
 * stąd `pomarańczowy`.
 *
 * ZNANE OGRANICZENIE: obecność zapisów rozpoznajemy po rdzeniu „podwykonaw"
 * (podwykonawca/podwykonawstwo/…). Zakaz wyrażony wyłącznie przez ogólne słowa
 * („nie może powierzyć") świadomie może umknąć — wolimy nie oznaczyć zakazu, niż
 * pomylić go z klauzulą „za zgodą". Na luki `opis` przy braku zapisów wprost
 * zwraca uwagę (sprawdź m.in. obowiązek osobistego wykonania w innym miejscu).
 */

import { normalize } from './textNorm.js';

// Rdzeń „podwykonaw" łapie wszystkie formy (podwykonawca/podwykonawcy/podwykonawcow/
// podwykonawstwo/podwykonawstwa/podwykonawczej/…). Globalny wariant do matchAll,
// nie-globalny do szybkiego testu obecności.
const PODWYK_G = /podwykonaw\w*/g;
const MA_PODWYKONAWCY = /podwykonaw/;

// ZAKAZ lub istotne ograniczenie podwykonawstwa (→ pomarańczowa flaga) wykrywamy
// dwupoziomowo, żeby nie mylić zakazu z sąsiednią klauzulą:
//   • ZAKAZ_GLOBAL — frazy SAME W SOBIE znaczące (zawierają „podwykonaw" albo
//     jednoznacznie mówią o osobistym wykonaniu). Szukamy ich w całym tekście.
//   • ZAKAZ_BLISKO — OGÓLNE słowa zakazu („niedopuszczalne", „wykluczone"), które
//     dopiero w CIASNYM oknie wokół wzmianki o podwykonawcy znaczą zakaz.
// Świadomie NIE traktujemy „nie może powierzyć" jako zakazu — bywa to klauzula
// „za zgodą" (dozwolone warunkowo), nie zakaz. Wolimy pominąć niż fałszywie
// oznaczyć zakaz (patrz ZNANE OGRANICZENIE).
const ZAKAZ_GLOBAL = [
  'zakaz podwykonaw', 'bez udzialu podwykonaw', 'bez podwykonaw',
  'nie przewiduje sie podwykonaw', 'nie dopuszcza sie podwykonaw',
  'nie dopuszcza podwykonaw', 'osobistego wykonania', 'osobiste wykonanie',
  'wykonac osobiscie', 'wykona osobiscie', 'osobiscie przez wykonawce',
  'wlasnymi silami', 'wlasnymi zasobami',
];
const ZAKAZ_BLISKO = ['niedopuszczaln', 'wykluczon', 'zabronion'];

// Warunki/ryzyka podwykonawstwa dopuszczonego — noty informacyjne (bez flagi).
const RYZYKA = [
  {
    kod: 'zgoda_zamawiajacego',
    cues: ['zgoda zamawiajacego', 'zgode zamawiajacego', 'zgody zamawiajacego',
      'wymaga zgody', 'za zgoda'],
    nota: 'Powierzenie prac podwykonawcy wymaga zgody Zamawiającego — zaplanuj czas '
      + 'na jej uzyskanie.',
  },
  {
    kod: 'przedkladanie_umow',
    cues: ['przedlozy', 'przedlozenia', 'przedkladania', 'przedklada',
      'projekt umowy o podwykonawstwo', 'zgloszenie podwykonaw', 'zglosi podwykonaw',
      'zglaszania podwykonaw'],
    nota: 'Umowa nakłada obowiązek zgłaszania/przedkładania umów o podwykonawstwo — '
      + 'pilnuj terminów, bo od tego zależy m.in. bezpośrednia zapłata podwykonawcy.',
  },
  {
    kod: 'solidarna_odpowiedzialnosc',
    cues: ['solidarn', 'bezposredniej zaplaty', 'bezposrednia zaplata',
      'bezposrednio podwykonaw', 'zaplaty wynagrodzenia podwykonaw'],
    nota: 'Zamawiający może zapłacić podwykonawcy bezpośrednio, a Ty odpowiadasz '
      + 'solidarnie za jego wynagrodzenie (art. 647(1) KC / art. 465 Pzp) — dopilnuj '
      + 'rozliczeń z podwykonawcami.',
  },
];

const OKNO = 140;       // okno dla not informacyjnych (zgoda/przedkładanie/solidarna)
const OKNO_ZAKAZ = 60;  // ciaśniejsze okno dla ogólnych słów zakazu (mniej „wycieku")

const OPIS_BRAK = 'Nie wykryto zapisów o podwykonawcach. Sprawdź, czy umowa nie ogranicza '
  + 'podwykonawstwa w innym miejscu (np. obowiązek osobistego wykonania) — brak wzmianki '
  + 'nie zawsze oznacza pełną swobodę.';

// Pomarańczowa flaga: zakaz/istotne ograniczenie podwykonawstwa (legalny zapis,
// waga zależna od planu realizacji). Zamrożona — współdzielona, niezmienna stała.
const OSTRZEZENIE_ZAKAZ = Object.freeze({
  poziom: 'pomarańczowy',
  kod: 'zakaz_podwykonawstwa',
  tytul: 'ograniczenie podwykonawstwa',
  opis: 'Umowa zakazuje lub istotnie ogranicza podwykonawstwo (np. obowiązek osobistego '
    + 'wykonania kluczowych części). Jeśli Twoja oferta zakłada podwykonawców, sprawdź, '
    + 'czy zapis nie wyklucza przyjętego sposobu realizacji.',
});

/** Krótki opis „po ludzku", gdy zapisy o podwykonawcach są obecne. */
function opisObecne(dozwolone, ryzyka) {
  const czesci = ['Wykryto zapisy o podwykonawcach.'];
  czesci.push(dozwolone
    ? 'Podwykonawstwo jest co do zasady dopuszczone.'
    : 'UWAGA: wykryto zakaz lub istotne ograniczenie podwykonawstwa — jeśli planujesz '
      + 'podwykonawców, może to wykluczyć Twój sposób realizacji.');
  if (ryzyka.length) czesci.push('Na co uważać: ' + ryzyka.join(' '));
  czesci.push('Zweryfikuj zakres i warunki podwykonawstwa ręcznie.');
  return czesci.join(' ');
}

/**
 * Wykrywa i objaśnia zapisy o podwykonawcach w tekście umowy.
 * @param {string} tekst znormalizowany tekst umowy (surowy też zadziała)
 * @returns {{ obecne: boolean, dozwolone: boolean|null, ryzyka: string[], opis: string,
 *   ostrzezenie: {poziom: string, kod: string, tytul: string, opis: string}|null }}
 *   `dozwolone` = czy podwykonawstwo jest co do zasady dopuszczone (`false` przy
 *   wykrytym zakazie, `null` gdy brak zapisów). `ryzyka` = krótkie noty o
 *   warunkach/ryzykach. `ostrzezenie` = pomarańczowa flaga zakazu, albo `null`.
 */
export function wykryj_podwykonawcow(tekst) {
  const t = normalize(tekst);
  if (!t || !MA_PODWYKONAWCY.test(t)) {
    return { obecne: false, dozwolone: null, ryzyka: [], opis: OPIS_BRAK, ostrzezenie: null };
  }

  // Okna wokół każdej wzmianki o podwykonawcy: szerokie (noty informacyjne) i
  // ciasne (ogólne słowa zakazu — mniej podatne na „wyciek" z sąsiedniej klauzuli).
  const okna = [];
  const oknaZakaz = [];
  for (const m of t.matchAll(PODWYK_G)) {
    const koniec = m.index + m[0].length;
    okna.push(t.slice(Math.max(0, m.index - OKNO), koniec + OKNO));
    oknaZakaz.push(t.slice(Math.max(0, m.index - OKNO_ZAKAZ), koniec + OKNO_ZAKAZ));
  }
  const wOknie = (cue) => okna.some((w) => w.includes(cue));

  // Zakaz: fraza samoznacząca gdziekolwiek w tekście LUB ogólne słowo zakazu tuż
  // przy wzmiance o podwykonawcy.
  const zakaz = ZAKAZ_GLOBAL.some((c) => t.includes(c))
    || ZAKAZ_BLISKO.some((c) => oknaZakaz.some((w) => w.includes(c)));
  const dozwolone = !zakaz;

  const ryzyka = [];
  for (const r of RYZYKA) {
    if (r.cues.some(wOknie)) ryzyka.push(r.nota);
  }

  const ostrzezenie = zakaz ? OSTRZEZENIE_ZAKAZ : null;
  return { obecne: true, dozwolone, ryzyka, opis: opisObecne(dozwolone, ryzyka), ostrzezenie };
}
