import { normalize } from './textNorm.js';
import { dobaWarszawska } from './czasPolski.js';

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
export const PRIORYTET_ZRODEL = ['bzp', 'ted', 'baza_konkurencyjnosci', 'epropublico', 'platformazakupowa', 'logintrade'];

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
  'kryterium_oceny', 'numer', 'kryteria', 'kryteria_sposob', 'kryteria_rozne_czesci',
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

/*
 * BLIŹNIAK Z BZP NA PLATFORMIE (2026-11-03). Klucz wyżej wymaga zgodnego zamawiającego i tytułu co do znaku, a
 * platformazakupowa.pl pisze oba po swojemu: tytuł poprzedza znakiem sprawy albo numerem BZP („2026/BZP 00514967
 * (ZP.272.19.2026) Ochrona mienia…”), zamawiającego nazywa urzędem zamiast jednostki („Starostwo Powiatowe
 * w Jaworze” ↔ „POWIAT JAWORSKI”). Pomiar 3.11: z 4582 otwartych ogłoszeń platformy 1264 miało bliźniaka w BZP
 * (ten sam termin co do minuty i tytuł, podobny zamawiający), a klucz złapał 6; 14 kont miało ten sam przetarg
 * wybrany dwa razy. Asymetria ryzyka jak wyżej: numer BZP w tytule rozstrzyga sam, bez niego potrzeba zgodnego
 * terminu, tytułu I wspólnego członu nazwy zamawiającego.
 */
const NUMER_BZP = /(\d{4})\/BZP\s*(\d{8})/;

/** Id dokumentu ogłoszenia BZP z numeru w tytule (`2026~BZP_00514967`, jak `tenderDocId`) albo null. */
export function idBzpZTytulu(tytul) {
  const m = String(tytul ?? '').match(NUMER_BZP);
  return m ? `${m[1]}~BZP_${m[2]}` : null;
}

/** Tytuł bez numeru BZP i wiodących znaków sprawy („05/Żyw/D/26”, „ZP.271.27.2026”), po normalizacji. */
export function tytulDoPorownania(tytul) {
  let t = String(tytul ?? '').replace(/\d{4}\/BZP\s*\d{8}(\/\d{2})?/g, ' ').trim();
  // Wiodące tokeny z cyfrą (znak sprawy, czasem powtórzony) i nawias ze znakiem po numerze BZP.
  for (let i = 0; i < 3; i++) t = t.replace(/^(\([^)]*\d[^)]*\)|[\p{L}0-9][\p{L}0-9./_-]*\d[\p{L}0-9./_-]*)\s+/u, '');
  return normalize(t).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Człony nazw, które nie odróżniają zamawiających (4 pierwsze litery po normalizacji). */
const OGOLNE_CZLONY = new Set(['gmin', 'mias', 'miej', 'powi', 'urza', 'urze', 'woje', 'samo', 'publ', 'zakl', 'osro',
  'cent', 'zesp', 'spec', 'jedn', 'wojs', 'inst', 'uniw', 'skar', 'pans', 'spol', 'odpo', 'ogra', 'akcy', 'regi', 'kraj',
  'zarz', 'dyre', 'gene', 'kome', 'komu', 'prze', 'szko', 'opie', 'zdro', 'medy', 'klin', 'sluz', 'kult', 'spor', 'rekr',
  'gosp', 'nier', 'obsl', 'admi', 'star', 'pols', 'szpi', 'rzec', 'dzia', 'firm', 'wspo']);

function czlonyZamawiajacego(nazwa) {
  return new Set(normalize(nazwa ?? '').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => (/^\d+$/.test(w) ? w.length >= 3 : w.length >= 4))
    .map((w) => (/^\d+$/.test(w) ? w : w.slice(0, 4)))
    .filter((w) => !OGOLNE_CZLONY.has(w)));
}

/** Wspólny znaczący człon nazwy („jawo”, „4101”) — „Szpital w Zambrowie” ≠ „Jednostka Wojskowa 4101”. */
export function podobniZamawiajacy(a, b) {
  const A = czlonyZamawiajacego(a);
  for (const x of czlonyZamawiajacego(b)) if (A.has(x)) return true;
  return false;
}

/**
 * Termin z samą datą (TED, BZP bez godziny) to koniec doby warszawskiej (lib/daty.js `doUtcIso`): 22:59:59.999Z zimą,
 * 21:59:59.999Z latem. Pomiar 3.11: TED ma tak WSZYSTKIE terminy — porównanie co do minuty nie złapało żadnej z 1034
 * kopii przetargów z TED na platformazakupowa.pl (ten sam dzień, tytuł i zamawiający).
 */
const KONIEC_DOBY = /T2[12]:59:59\.999Z$/;
export const bezGodziny = (iso) => typeof iso === 'string' && KONIEC_DOBY.test(iso);

/** Ten sam termin: co do minuty, a gdy któraś strona zna samą datę — ta sama doba warszawska. */
export function terminyZgodne(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length < 16 || b.length < 16) return false;
  if (a.slice(0, 16) === b.slice(0, 16)) return true;
  if (!bezGodziny(a) && !bezGodziny(b)) return false;
  return dobaWarszawska(a) === dobaWarszawska(b);
}

/**
 * Czy ogłoszenie z platformy (`kopia`) to to samo postępowanie co wpis rejestru wiodącego (BZP albo TED). Numer BZP
 * w tytule rozstrzyga sam (także po zmianie terminu); bez niego: termin (`terminyZgodne`) + tytuł (równy albo jeden
 * zawiera drugi, krótszy ≥ 25 znaków) + podobny zamawiający.
 */
export function toSamoPostepowanie(kopia, bzp) {
  const numer = idBzpZTytulu(kopia?.title);
  if (numer) return numer === bzp?.id;
  if (!terminyZgodne(String(kopia?.deadline ?? ''), String(bzp?.deadline ?? ''))) return false;
  const t1 = tytulDoPorownania(kopia.title);
  const t2 = tytulDoPorownania(bzp.title);
  if (!t1 || !t2) return false;
  const zgodny = t1 === t2 || (Math.min(t1.length, t2.length) >= 25 && (t1.includes(t2) || t2.includes(t1)));
  return zgodny && podobniZamawiajacy(kopia.organization, bzp.organization);
}

/** Jedyny wpis rejestru wiodącego pasujący do kopii z platformy; dwa pasujące bez numeru BZP = niepewne, null. */
export function znajdzBlizniakaBzp(kopia, kandydaci) {
  const pasujace = new Map((kandydaci ?? []).filter((b) => b && !b.zastapiony_przez && toSamoPostepowanie(kopia, b)).map((b) => [b.id, b]));
  return pasujace.size === 1 ? [...pasujace.values()][0] : null;
}
