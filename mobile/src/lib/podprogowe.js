/**
 * Prezentacja „RADARU ZAMÓWIEŃ PODPROGOWYCH" — czysta logika bez importów z React
 * Native, więc testowalna zwykłym `node:test` (ulepszenie „Radar zamówień
 * podprogowych — poniżej 170 tys. zł", podzadanie 7/7).
 *
 * Band w `MatchFeedScreen` i ekran `PodprogoweDetailScreen` tylko RENDERUJĄ to, co
 * policzył backend (scalony strumień z `zamowienia_podprogowe`). Tu żyją reguły
 * „kod/liczba → słowo": jak nazwać źródło ogłoszenia, które flagi „łatwiejszego
 * startu" pokazać i w jakiej kolejności, jak sformatować wartość netto oraz jak
 * uszeregować scalony strumień „obok" dużych przetargów. Trzymamy je pod testem,
 * żeby ekran ich nie wymyślał na nowo (a kolory dokładał już tylko sam ekran przez
 * useTheme() — bez nowych brązów, z tokenów motyw.js).
 */

import { formatBudget } from './format.js';
import { analizujPole, bladKwoty, zbierzBledy } from './walidacjaLiczb.js';

// ── Źródła ogłoszeń ───────────────────────────────────────────────────────────

/**
 * Ludzka etykieta źródła (kody = CHECK w migracji 009 `zamowienia_podprogowe`).
 * Zakupy, których NIE ma w Biuletynie Zamówień Publicznych: postępowania wyłączone
 * z Pzp na platformach zakupowych, e-propublico, BIP-y oraz Baza Konkurencyjności.
 */
export const ETYKIETY_ZRODEL = Object.freeze({
  bzp_wylaczone: 'Wyłączone z Pzp',
  platformazakupowa: 'platformazakupowa.pl',
  ezamawiajacy: 'eZamawiający',
  epropublico: 'e-propublico',
  baza_konkurencyjnosci: 'Baza Konkurencyjności',
  bip: 'BIP',
});

/** Etykieta źródła z fallbackiem (nieznany kod → sam kod, pusty → „Inne źródło"). */
export function etykietaZrodla(zrodlo) {
  return ETYKIETY_ZRODEL[zrodlo] ?? (zrodlo || 'Inne źródło');
}

// ── Flagi „łatwiejszego startu" ───────────────────────────────────────────────

/*
 * Kolejność stała (a nie kolejność kluczy w obiekcie `flagi`) — chip układa się
 * zawsze tak samo: najpierw pieniądze wykonawcy (wadium), potem ryzyko sporu (KIO),
 * na końcu prostota procedury. Klucze == JSON `flagi` z `normalizacjaPodprogowe`.
 */
const KOLEJNOSC_FLAG = [
  ['bez_wadium', 'bez wadium'],
  ['bez_kio', 'bez KIO'],
  ['prosta_procedura', 'prosta procedura'],
];

/**
 * Flagi „łatwiejszego startu" do pokazania — tylko te ustawione na `true`,
 * w stałej kolejności.
 * @param {{bez_wadium?: boolean, bez_kio?: boolean, prosta_procedura?: boolean}|null|undefined} flagi
 * @returns {Array<{klucz: string, etykieta: string}>}
 */
export function flagiPodprogowe(flagi) {
  const f = flagi ?? {};
  return KOLEJNOSC_FLAG.filter(([klucz]) => f[klucz]).map(([klucz, etykieta]) => ({ klucz, etykieta }));
}

// ── Wartość netto ─────────────────────────────────────────────────────────────

/**
 * Etykieta wartości netto — kwota z separatorem tysięcy + „netto" (podprogowe są
 * z definicji szacowane netto: filtr progu 170/80 tys. zł liczy się od netto).
 * Brak/NaN → null, żeby ekran nie pokazywał mylącego „0 PLN netto".
 * @param {number|null|undefined} wartosc
 * @param {string} [waluta]
 * @returns {string|null}
 */
export function etykietaWartosciNetto(wartosc, waluta = 'PLN') {
  const kwota = formatBudget(wartosc, waluta);
  return kwota ? `${kwota} netto` : null;
}

// ── Sortowanie scalonego strumienia ───────────────────────────────────────────

/**
 * Klucz sortowania po terminie składania: otwarte rosnąco wg terminu, potem bez
 * terminu, na końcu po terminie (najmniej istotne). Ta sama reguła co feedSort.
 */
function kluczTerminu(termin, nowMs) {
  const d = termin ? new Date(termin).getTime() : NaN;
  if (!Number.isFinite(d)) return Number.MAX_SAFE_INTEGER - 1; // bez terminu
  if (d < nowMs) return Number.MAX_SAFE_INTEGER;               // po terminie — na koniec
  return d;                                                     // otwarte — wg terminu
}

/**
 * Szereguje scalony strumień podprogowy do pokazania „obok" dużych przetargów:
 *   1. „łatwiejszy start" na górze (to sedno ulepszenia — bez wadium/KIO, prościej),
 *   2. w obrębie grupy — najbliższy OTWARTY termin składania (bez terminu / po
 *      terminie spadają niżej),
 *   3. przy remisie — najnowsza publikacja pierwsza.
 * Zwraca NOWĄ, posortowaną tablicę (bez mutacji wejścia). `nowIso` wstrzykiwane w testach.
 *
 * @param {Array} lista rekordy ogłoszeń podprogowych (repo `list` → panel)
 * @param {string} [nowIso] „teraz"
 * @returns {Array}
 */
export function sortujPodprogowe(lista, nowIso = new Date().toISOString()) {
  if (!Array.isArray(lista)) return [];
  const nowMs = new Date(nowIso).getTime();
  return [...lista].sort((a, b) => {
    const la = a.latwiejszy_start ? 0 : 1;
    const lb = b.latwiejszy_start ? 0 : 1;
    if (la !== lb) return la - lb;
    const ta = kluczTerminu(a.termin_skladania, nowMs);
    const tb = kluczTerminu(b.termin_skladania, nowMs);
    if (ta !== tb) return ta - tb;
    const pa = String(a.data_publikacji ?? a.created_at ?? '');
    const pb = String(b.data_publikacji ?? b.created_at ?? '');
    return pb.localeCompare(pa); // najnowsze pierwsze
  });
}

// ── Próg netto w ustawieniach radaru ──────────────────────────────────────────

/** Górny limit progu — ten sam co walidacja backendu (`prog_netto` ≤ 100 000 000). */
export const PROG_NETTO_MAX = 100_000_000;

/** Błąd pola progu: kwota > 0 i ≤ PROG_NETTO_MAX. Puste = brak błędu (próg domyślny). */
function bladProguNetto(prog) {
  const blad = bladKwoty(prog);
  if (blad) return blad;
  const { liczba } = analizujPole(prog);
  if (liczba === null) return null; // puste pole
  if (liczba <= 0) return 'Próg musi być większy od 0 zł';
  if (liczba > PROG_NETTO_MAX) return 'Próg nie może przekraczać 100 000 000 zł';
  return null;
}

/**
 * Waliduje pole „Górny próg wartości netto". Dotąd ekran robił `Number(prog)`, więc
 * „150 000" (zapis jak w podpowiedzi) dawało NaN, pole znikało z żądania i backend po
 * cichu brał domyślne 170 000 zł. Teraz błędny zapis dostaje jawny komunikat PL.
 * @param {string} prog tekst z pola
 * @returns {{bledy: {prog?: string}, maBledy: boolean}}
 */
export function walidujProgNetto(prog) {
  return zbierzBledy({ prog: bladProguNetto(prog) });
}

/**
 * Próg z pola → liczba do `prog_netto` (polski zapis: spacje tysięcy, przecinek
 * dziesiętny). Puste albo błędne pole → null — wtedy pole pomijamy (próg domyślny).
 * @param {string} prog
 * @returns {number|null}
 */
export function progNettoZPola(prog) {
  if (bladProguNetto(prog)) return null;
  return analizujPole(prog).liczba;
}
