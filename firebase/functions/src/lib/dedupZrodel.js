import { normalize } from './textNorm.js';

/*
 * Deduplikacja MIĘDZY rejestrami ogłoszeń (etap 3).
 *
 * Każde źródło deduplikuje się samo — po `externalId`. To wystarczało, dopóki
 * rejestry się nie nakładały. Baza Konkurencyjności nakłada się z BZP: zamawiający
 * współfinansowany z UE potrafi ogłosić to samo postępowanie w obu miejscach,
 * a identyfikatory są wtedy zupełnie różne (`bzp:2026/BZP-00123` vs `bk:292028`).
 * Bez scalania użytkownik dostaje ten sam przetarg dwa razy, a konto Free zużywa
 * na to dwa z pięciu dziennych dopasowań.
 *
 * ASYMETRIA RYZYKA, która dyktuje cały projekt tego modułu: zgubiony przetarg
 * kosztuje wykonawcę kontrakt, a pokazany duplikat — jedno przewinięcie listy.
 * Dlatego klucz jest WĄSKI i wymaga zgodności trzech rzeczy naraz (tytuł, dzień
 * terminu, zamawiający). Ogłoszenie, któremu brakuje którejkolwiek z nich, NIE
 * jest scalane z niczym — przechodzi dalej nietknięte.
 */

/**
 * Kolejność rejestrów przy scalaniu: wygrywa PIERWOTNE źródło postępowania.
 *
 * BZP to urzędowy rejestr zamówień wg Pzp, TED — ogłoszeń powyżej progów UE,
 * a Baza Konkurencyjności rejestruje zakupy BENEFICJENTA dotacji. Gdy to samo
 * postępowanie jest w BZP i w BK, wiążąca jest wersja z BZP (tam idą odwołania
 * i tam zamawiający publikuje zmiany SWZ), a wpis z BK zostaje jako link poboczny.
 *
 * 🚨 Ta kolejność MUSI zgadzać się z kolejnością źródeł w `domyslneZrodla()`
 * (jobs/fetchTenders.js) — inaczej scalanie i pobieranie mówiłyby co innego.
 */
export const PRIORYTET_ZRODEL = ['bzp', 'ted', 'baza_konkurencyjnosci'];

/** Formy prawne, które nie odróżniają podmiotów, a bywają zapisywane na 3 sposoby. */
const FORMY_PRAWNE = [
  'spolka z ograniczona odpowiedzialnoscia',
  'spolka akcyjna',
  'spolka jawna',
  'spolka komandytowa',
  'sp z o o',
  'sp z oo',
  'spzoo',
  'sa',
  'zoo',
];

/** Sprowadza tekst do porównywalnego rdzenia: bez diakrytyków, interpunkcji i „sp. z o.o.". */
function rdzen(tekst) {
  const bezOzdob = normalize(tekst).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!bezOzdob) return '';
  let wynik = bezOzdob;
  for (const forma of FORMY_PRAWNE) {
    wynik = wynik.replace(new RegExp(`(^| )${forma}( |$)`, 'g'), ' ');
  }
  return wynik.replace(/\s+/g, ' ').trim();
}

/** Doba terminu składania ofert — rejestry zapisują godzinę odcięcia różnie. */
function dobaTerminu(deadline) {
  if (typeof deadline !== 'string' || deadline.length < 10) return '';
  return deadline.slice(0, 10);
}

/**
 * Klucz tożsamości postępowania, wspólny dla wszystkich rejestrów.
 *
 * @param {object} t znormalizowane ogłoszenie (kształt `tenders.upsert`)
 * @returns {string|null} `null` = brak danych do porównania, ogłoszenie zostaje osobno
 */
export function kluczOgloszenia(t) {
  const tytul = rdzen(t?.title);
  const organizacja = rdzen(t?.organization);
  const doba = dobaTerminu(t?.deadline);
  if (!tytul || !organizacja || !doba) return null;
  return `${doba}|${organizacja}|${tytul}`;
}

/**
 * Pola, które wpis wiodący może PRZEJĄĆ z duplikatu, gdy sam ich nie ma.
 *
 * BK zna szacowaną wartość i CPV tam, gdzie BZP milczy (i odwrotnie). Uzupełnianie
 * idzie wyłącznie w stronę pustych pól — dane rejestru wiodącego są nienaruszalne,
 * bo to one są wiążące dla wykonawcy.
 */
const POLA_UZUPELNIANE = [
  'budget', 'currency', 'cpvMain', 'deadline', 'publishedAt', 'organization',
  'wojewodztwo', 'rodzaj', 'liczba_czesci', 'wadium_wymagane', 'wadium_kwota',
  'kryterium_oceny', 'numer',
];

const pusty = (v) => v === undefined || v === null || v === '';

/**
 * Scala listy ogłoszeń z kilku źródeł w jedną, bez powtórzeń.
 *
 * Kolejność wejścia NIE ma znaczenia — funkcja sama układa źródła wg
 * `PRIORYTET_ZRODEL`. To celowe: rejestr źródeł w `fetchTenders` może kiedyś zmienić
 * kolejność pobierania (np. dla budżetu czasu), a wtedy cicha zmiana decydowała
 * o tym, który link zobaczy wykonawca. Tu ta decyzja jest jedna i jawna.
 *
 * @param {Array<{zrodlo: string, ogloszenia: object[]}>} wedlugZrodel
 * @returns {{ogloszenia: object[], duplikaty: number, wgZrodla: Record<string, number>}}
 *   `wgZrodla` — ile wpisów z danego źródła scalono z wpisem wcześniejszym.
 *   Bez tej liczby nie da się odpowiedzieć, czy nowy rejestr wnosi rynek, czy kopię.
 */
export function scalMiedzyZrodlami(wedlugZrodel) {
  const wgKlucza = new Map();
  const wynik = [];
  const wgZrodla = {};
  let duplikaty = 0;

  // Nieznane źródło (np. dopiero dodawane) ustępuje wszystkim znanym, zamiast
  // przypadkiem przejmować pierwszeństwo nad BZP.
  const ranga = (z) => {
    const i = PRIORYTET_ZRODEL.indexOf(z);
    return i === -1 ? PRIORYTET_ZRODEL.length : i;
  };
  const wKolejnosci = [...(wedlugZrodel ?? [])].sort((a, b) => ranga(a?.zrodlo) - ranga(b?.zrodlo));

  for (const { zrodlo, ogloszenia } of wKolejnosci) {
    wgZrodla[zrodlo] ??= 0;
    for (const o of ogloszenia ?? []) {
      const klucz = kluczOgloszenia(o);
      const wiodace = klucz === null ? undefined : wgKlucza.get(klucz);

      if (!wiodace) {
        const kopia = { ...o };
        if (klucz !== null) wgKlucza.set(klucz, kopia);
        wynik.push(kopia);
        continue;
      }

      duplikaty += 1;
      wgZrodla[zrodlo] += 1;
      // Link do rejestru pobocznego zostaje przy wpisie — zamawiający prowadzi
      // sprawę w OBU miejscach, a wykonawca musi wiedzieć, gdzie składa ofertę.
      wiodace.zrodla_alternatywne = [
        ...(wiodace.zrodla_alternatywne ?? []),
        { source: o.source ?? zrodlo, externalId: o.externalId ?? null, url: o.url ?? null },
      ];
      for (const pole of POLA_UZUPELNIANE) {
        if (pusty(wiodace[pole]) && !pusty(o[pole])) wiodace[pole] = o[pole];
      }
    }
  }

  return { ogloszenia: wynik, duplikaty, wgZrodla };
}
