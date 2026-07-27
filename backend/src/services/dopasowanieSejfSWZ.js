/**
 * Dopasowanie sejfu firmy do konkretnego postępowania (ulepszenie „Sejf podmiotowych
 * środków dowodowych z licznikiem świeżości", podzadanie 5/7).
 *
 * Kiedy użytkownik wchodzi w konkretny przetarg, porównujemy listę podmiotowych
 * środków dowodowych WYMAGANYCH w SWZ z zawartością sejfu i rozdzielamy dokumenty na
 * trzy koszyki — WZGLĘDEM PRZEWIDYWANEGO DNIA ZŁOŻENIA oferty:
 *   • świeże             — masz i będą ważne w dniu złożenia,
 *   • przeterminuje_sie  — masz, ale stracą ważność PRZED dniem złożenia
 *                          (kluczowe przy PRZESUNIĘCIU terminu — patrz scenariusz w teście),
 *   • brakuje            — nie masz w sejfie + link, gdzie wyrobić online (e-KRK/PUE ZUS/e-US).
 *
 * DWIE decyzje modelu, świadome i istotne:
 *
 *  1. WYKRYWANIE WYMAGANYCH DOKUMENTÓW jest DETERMINISTYCZNE (parser słów kluczowych
 *     `wykryjWymaganeTypy`), a NIE przez płatne AI. Płatny analizator SWZ
 *     (`services/analizaSwz.js`) wypatruje pytań do treści SWZ, nie listy dokumentów;
 *     przepuszczanie każdego dopasowania przez model kosztowałoby realne pieniądze i
 *     otwierało denial-of-wallet. Katalog typów (`config/dokumentyKatalog.js`) ma
 *     stabilne `id`, więc mapowanie fraz → typ jest przewidywalne i testowalne. Gdyby
 *     kiedyś doszła ekstrakcja AI, wystarczy podać gotową listę `wymaganeTypy`.
 *
 *  2. ŚWIEŻOŚĆ liczy ta sama czysta logika co licznik w sejfie (`opiszDokument` z
 *     podzadania 3, oparty na `waznoscDokumentow` z podzadania 2), tyle że z
 *     `dzienOdniesienia = przewidywany dzień złożenia`. Dzięki temu przesunięcie
 *     terminu automatycznie przenosi dokument między koszykami — bez osobnej logiki dat.
 */

import { opiszDokument } from './sejfDokumentow.js';
import { typDokumentu, TYPY_DOKUMENTOW, jestZnanymTypem } from '../config/dokumentyKatalog.js';
import { STATUS } from './waznoscDokumentow.js';

// ── Parser treści SWZ → id wymaganych typów dokumentów ───────────────────────

/**
 * Normalizuje tekst do porównań: małe litery, bez polskich znaków diakrytycznych
 * (NFD zdejmuje większość, `ł` trzeba osobno — nie rozkłada się). Frazy niżej piszemy
 * już w tej postaci, więc dopasowanie jest odporne na „ł/ó/ś/…" w SWZ.
 */
function normalizuj(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // znaki łączące (diakrytyki) po NFD
    .replace(/ł/g, 'l');        // ł nie rozkłada się w NFD — zdejmujemy osobno
}

/**
 * Frazy-sygnały dla każdego typu (w postaci znormalizowanej — bez diakrytyków).
 * Dobrane tak, by były DYSTYNKTYWNE (unikamy krótkich, wieloznacznych jak „oc"),
 * więc parser nie generuje fałszywych trafień.
 * @type {ReadonlyArray<{id: string, frazy: string[]}>}
 */
const WZORCE_TYPOW = Object.freeze([
  {
    id: 'krk',
    frazy: ['niekaralno', 'krajowego rejestru karnego', 'krajowy rejestr karny', 'rejestru karnego', ' krk'],
  },
  {
    id: 'us',
    frazy: ['niezaleganiu w podatkach', 'niezalegania w podatkach', 'niezaleganie w podatkach',
      'urzedu skarbowego', 'urzad skarbowy', 'urzedzie skarbowym'],
  },
  {
    id: 'zus',
    frazy: [' zus', 'ubezpieczen spolecznych', 'skladek na ubezpieczenia', 'zakladu ubezpieczen'],
  },
  {
    id: 'polisa_oc',
    frazy: ['odpowiedzialnosci cywilnej', 'polisa oc', 'ubezpieczenia oc', 'ubezpieczenie oc'],
  },
  {
    id: 'wpis_rejestr',
    frazy: ['krajowego rejestru sadowego', ' krs', 'ceidg', 'odpis z rejestru',
      'rejestru przedsiebiorcow', 'centralnej ewidencji'],
  },
  {
    id: 'wykaz_robot_uslugi',
    frazy: ['wykaz robot', 'wykaz uslug', 'wykaz dostaw', 'wykaz wykonanych', 'wykaz zrealizowanych'],
  },
  {
    id: 'uprawnienia_pracownikow',
    frazy: ['uprawnienia budowlane', 'wykaz osob', 'osob skierowanych', 'kwalifikacje zawodowe',
      'uprawnienia do kierowania'],
  },
]);

/**
 * Wykrywa, jakie typy dokumentów z katalogu są WYMAGANE w treści SWZ.
 * Deterministycznie (słowa kluczowe), bez płatnego AI. Zwraca listę `id` typów
 * UNIKALNĄ i w kolejności katalogu (przewidywalny wynik dla UI i testów).
 * @param {string} swzTekst treść SWZ (oraz opcjonalnie umowy/przedmiaru sklejona)
 * @returns {string[]} np. ['krk', 'us', 'zus']
 */
export function wykryjWymaganeTypy(swzTekst) {
  const tekst = normalizuj(swzTekst);
  if (!tekst.trim()) return [];
  const out = [];
  for (const wzor of WZORCE_TYPOW) {
    if (wzor.frazy.some((f) => tekst.includes(f))) out.push(wzor.id);
  }
  return out; // WZORCE_TYPOW są w kolejności katalogu; każdy id dodany co najwyżej raz
}

// ── Rozdział dokumentów na koszyki względem dnia złożenia ─────────────────────

/** Czy wzbogacony dokument jest WAŻNY na dzień odniesienia (gotowy lub „zamów nowy"). */
function wazneNaDzien(dok) {
  return dok.status === STATUS.GOTOWY || dok.status === STATUS.ZAMOW_NOWY;
}

/**
 * Ranga kandydata do wyboru „najlepszego" egzemplarza danego typu: im dłużej ważny na
 * dzień złożenia, tym lepszy. Bezterminowy (Infinity) wygrywa; brak daty (null) — na końcu.
 */
function ranga(dok) {
  const dni = dok.dniDoWaznosci;
  if (dni === Infinity) return Number.MAX_SAFE_INTEGER;
  if (typeof dni === 'number') return dni; // może być ujemne (przeterminowany)
  return Number.NEGATIVE_INFINITY;         // null: dokument terminowy bez daty wystawienia
}

/** Infinity (bezterminowy) → null, żeby wpis był bezpieczny do JSON-a. */
function licznikDni(dok) {
  return Number.isFinite(dok.dniDoWaznosci) ? dok.dniDoWaznosci : null;
}

/** Wpis koszyka dla POSIADANEGO dokumentu (świeże / przeterminuje_sie). */
function wpisPosiadanego(typ, def, dok) {
  return {
    typ,
    nazwaTypu: def?.nazwa ?? dok.nazwaTypu ?? typ,
    id: dok.id ?? null,
    status: dok.status ?? null,
    dniDoWaznosci: licznikDni(dok),
    dataWaznosci: dok.dataWaznosci ?? null,
    flaga_podpis_elektroniczny: !!dok.flaga_podpis_elektroniczny,
    wymagaDokumentuElektronicznego: def?.wymagaDokumentuElektronicznego ?? false,
    online: def?.online ?? dok.online ?? null,
  };
}

/** Wpis koszyka dla BRAKUJĄCEGO typu (z linkiem, gdzie wyrobić online). */
function wpisBraku(typ, def) {
  return {
    typ,
    nazwaTypu: def?.nazwa ?? typ,
    wymagaDokumentuElektronicznego: def?.wymagaDokumentuElektronicznego ?? false,
    online: def?.online ?? null,
    powod: 'Brak dokumentu tego typu w sejfie.',
  };
}

/**
 * Rozdziela wymagane dokumenty na trzy koszyki względem dnia złożenia.
 *
 * `dokumenty` to dokumenty sejfu JUŻ WZBOGACONE na przewidywany dzień złożenia
 * (np. `sejf.lista(userId, { dzienOdniesienia: dzienZlozenia })` albo `opiszDokument`
 * z tym samym `dzienOdniesienia`) — świeżość liczy jedna, współdzielona logika.
 *
 * @param {object} arg
 * @param {string[]} arg.wymaganeTypy id typów wymaganych w SWZ (patrz wykryjWymaganeTypy)
 * @param {Array<object>} arg.dokumenty wzbogacone dokumenty sejfu (na dzień złożenia)
 * @returns {{swieze: object[], przeterminuja_sie: object[], brakuje: object[]}}
 */
export function dopasujSejfDoSWZ({ wymaganeTypy = [], dokumenty = [] } = {}) {
  // Grupujemy posiadane dokumenty po typie (jeden typ może mieć wiele egzemplarzy).
  const poTypie = new Map();
  for (const d of dokumenty) {
    if (!d || !d.typ_dokumentu) continue;
    const arr = poTypie.get(d.typ_dokumentu) ?? [];
    arr.push(d);
    poTypie.set(d.typ_dokumentu, arr);
  }

  const swieze = [];
  const przeterminuja_sie = [];
  const brakuje = [];
  const widziane = new Set();

  for (const typ of wymaganeTypy) {
    if (widziane.has(typ)) continue; // ten sam wymagany typ liczymy raz
    widziane.add(typ);

    const def = typDokumentu(typ);
    const kandydaci = poTypie.get(typ) ?? [];
    if (kandydaci.length === 0) {
      brakuje.push(wpisBraku(typ, def));
      continue;
    }

    // Najlepszy egzemplarz = najdłużej ważny na dzień złożenia.
    const najlepszy = kandydaci.reduce((a, b) => (ranga(b) > ranga(a) ? b : a));
    const wpis = wpisPosiadanego(typ, def, najlepszy);
    if (wazneNaDzien(najlepszy)) swieze.push(wpis);
    else przeterminuja_sie.push(wpis);
  }

  return { swieze, przeterminuja_sie, brakuje };
}

// ── Usługa spinająca postępowanie + sejf (dla endpointu) ─────────────────────

/** 'YYYY-MM-DD' z wartości daty/ISO albo null (dla przewidywanego dnia złożenia). */
function dzienZ(wartosc) {
  if (wartosc === undefined || wartosc === null || String(wartosc).trim() === '') return null;
  const s = String(wartosc).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Tworzy usługę dopasowania na wstrzykniętych zależnościach (sejf + „dziś").
 * @param {object} deps
 * @param {{lista: Function}} deps.sejf usługa sejfu (createSejfDokumentow) — źródło dokumentów
 * @param {() => string} [deps.dzisiaj] fabryka bieżącego dnia 'YYYY-MM-DD' (test seam)
 */
export function createDopasowanieSejfSWZ({ sejf, dzisiaj } = {}) {
  const dzienDzis = dzisiaj ?? (() => new Date().toISOString().slice(0, 10));

  /**
   * Liczy dopasowanie dla jednego postępowania i użytkownika.
   * @param {object} arg
   * @param {string} arg.userId właściciel sejfu
   * @param {object} arg.postepowanie wiersz postępowania (dla terminu składania)
   * @param {string} [arg.swzTekst] treść SWZ do wykrycia wymaganych dokumentów
   * @param {string[]} [arg.wymaganeTypy] jawna lista typów (pomija parser SWZ)
   * @param {string} [arg.dzienZlozenia] przewidywany dzień złożenia (override terminu)
   * @returns {{dzien_zlozenia: string, wymagane_typy: string[],
   *            swieze: object[], przeterminuja_sie: object[], brakuje: object[]}}
   */
  function dlaPostepowania({ userId, postepowanie, swzTekst = '', wymaganeTypy, dzienZlozenia } = {}) {
    // Przewidywany dzień złożenia: override → termin składania z postępowania → dziś.
    const dzien = dzienZ(dzienZlozenia)
      ?? dzienZ(postepowanie?.termin_skladania_ofert)
      ?? dzienDzis();

    // Wymagane typy: jawna lista (np. z przyszłej ekstrakcji AI) albo parser treści SWZ.
    const typy = Array.isArray(wymaganeTypy) && wymaganeTypy.length
      ? wymaganeTypy.filter((t) => jestZnanymTypem(t))
      : wykryjWymaganeTypy(swzTekst);

    // Dokumenty sejfu wzbogacone NA DZIEŃ ZŁOŻENIA (nie „na dzisiaj").
    const dokumenty = sejf.lista(userId, { dzienOdniesienia: dzien });

    const koszyki = dopasujSejfDoSWZ({ wymaganeTypy: typy, dokumenty });
    return { dzien_zlozenia: dzien, wymagane_typy: typy, ...koszyki };
  }

  return { dlaPostepowania };
}

/** Lista wszystkich typów katalogu (id + nazwa) — pomocnicze dla UI/debugowania. */
export const TYPY_KATALOGU = Object.freeze(TYPY_DOKUMENTOW.map((t) => ({ id: t.id, nazwa: t.nazwa })));
