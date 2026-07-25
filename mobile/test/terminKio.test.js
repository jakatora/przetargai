import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  oblicz_termin_kio,
  pozostaly_czas_do,
  TRYBY_KIO,
  TRYB_KIO_DOMYSLNY,
} from '../src/lib/terminKio.js';

/*
 * Kalkulator terminu na odwołanie do KIO (podzadanie 3/13). Czysta funkcja daty
 * granicznej wg art. 515 ust. 1 Pzp + art. 111 § 2 i 115 KC. Bez UI/modelu/storage.
 *
 * Daty oczekiwane policzone ręcznie (kotwica 2026-01-01 = czwartek;
 * Wielkanoc 2026 = 5 kwietnia → Pon. Wielkanocny 6 kwietnia, Boże Ciało 4 czerwca).
 */

// --- Enum trybów wg art. 515 ust. 1 Pzp ---

test('TRYBY_KIO: cztery reżimy z długościami 10/15/5/10 dni', () => {
  assert.deepEqual(
    TRYBY_KIO.map((t) => [t.wartosc, t.dni]),
    [
      ['unijny', 10],
      ['unijny_pisemny', 15],
      ['krajowy', 5],
      ['krajowy_pisemny', 10],
    ],
  );
});

test('TRYB_KIO_DOMYSLNY: najkrótszy (krajowy) — zachowawczo', () => {
  assert.equal(TRYB_KIO_DOMYSLNY, 'krajowy');
});

// --- Rdzeń liczenia: art. 111 § 2 KC (dnia zdarzenia nie liczymy) ---

test('unijny (10 dni): brak przesunięcia — koniec w dzień roboczy', () => {
  // 2026-07-20 (pon) + 10 = 2026-07-30 (czw), nie weekend/święto.
  assert.equal(oblicz_termin_kio('2026-07-20', 'unijny'), '2026-07-30');
});

test('dnia ogłoszenia nie liczymy: krajowy (5 dni) od 2026-07-01', () => {
  // 2026-07-01 (śr) NIE liczony; dni 2..6 lipca → koniec 2026-07-06 (pon, roboczy).
  assert.equal(oblicz_termin_kio('2026-07-01', 'krajowy'), '2026-07-06');
});

test('unijny_pisemny (15 dni): 2026-07-20 → 2026-08-04', () => {
  // +15 = 2026-08-04 (wt), roboczy.
  assert.equal(oblicz_termin_kio('2026-07-20', 'unijny_pisemny'), '2026-08-04');
});

test('krajowy_pisemny (10 dni) daje ten sam termin co unijny (10 dni)', () => {
  assert.equal(oblicz_termin_kio('2026-07-20', 'krajowy_pisemny'), '2026-07-30');
});

// --- art. 115 KC: przesunięcie z dnia wolnego na najbliższy roboczy ---

test('sobota → poniedziałek: krajowy (5 dni) od 2026-07-20', () => {
  // +5 = 2026-07-25 (sobota) → 2026-07-27 (poniedziałek).
  assert.equal(oblicz_termin_kio('2026-07-20', 'krajowy'), '2026-07-27');
});

test('łańcuch święto+weekend+święto: koniec 1 maja → 4 maja', () => {
  // 2026-04-21 + 10 = 2026-05-01 (pt, Święto Pracy) → 02.05 sob → 03.05 niedz (i Konstytucji)
  // → 2026-05-04 (poniedziałek, roboczy).
  assert.equal(oblicz_termin_kio('2026-04-21', 'unijny'), '2026-05-04');
});

test('święto ruchome — Boże Ciało (2026-06-04, czw) → 2026-06-05', () => {
  // 2026-05-25 + 10 = 2026-06-04 (Boże Ciało) → 2026-06-05 (piątek, roboczy).
  assert.equal(oblicz_termin_kio('2026-05-25', 'unijny'), '2026-06-05');
});

test('święto ruchome — Poniedziałek Wielkanocny (2026-04-06) → 2026-04-07', () => {
  // 2026-03-27 + 10 = 2026-04-06 (Pon. Wielkanocny) → 2026-04-07 (wt, roboczy).
  assert.equal(oblicz_termin_kio('2026-03-27', 'krajowy_pisemny'), '2026-04-07');
});

test('stałe święto Bożego Narodzenia + weekend: 25.12 → 28.12', () => {
  // 2026-12-15 + 10 = 2026-12-25 (pt, święto) → 26.12 sob (święto) → 27.12 niedz
  // → 2026-12-28 (poniedziałek, roboczy).
  assert.equal(oblicz_termin_kio('2026-12-15', 'unijny'), '2026-12-28');
});

test('przełom roku: święta przeliczane dla właściwego roku', () => {
  // 2026-12-28 + 10 = 2027-01-07 (czw). 01.01 i 06.01 2027 to święta, ale 07.01 roboczy.
  assert.equal(oblicz_termin_kio('2026-12-28', 'unijny'), '2027-01-07');
});

// --- Domyślny/nieznany tryb → TRYB_KIO_DOMYSLNY (krajowy, 5 dni) ---

test('brak trybu → domyślny krajowy (5 dni)', () => {
  assert.equal(oblicz_termin_kio('2026-07-20'), '2026-07-27');
});

test('nieznany tryb → fallback na domyślny (krajowy)', () => {
  assert.equal(oblicz_termin_kio('2026-07-20', 'kosmiczny'), '2026-07-27');
});

// --- Formaty wejścia ---

test('wejście jako Date daje ten sam wynik co string', () => {
  assert.equal(
    oblicz_termin_kio(new Date('2026-07-20T00:00:00Z'), 'unijny'),
    '2026-07-30',
  );
});

test('pełny ISO z godziną: liczymy po dniu kalendarzowym', () => {
  assert.equal(oblicz_termin_kio('2026-07-20T12:00:00Z', 'unijny'), '2026-07-30');
});

test('późna godzina UTC nie przesuwa dnia (bierzemy YYYY-MM-DD)', () => {
  assert.equal(oblicz_termin_kio('2026-07-20T23:30:00Z', 'unijny'), '2026-07-30');
});

// --- Niepoprawna/pusta data → null (nie zgadujemy terminu prawnego) ---

test('zła data → null', () => {
  assert.equal(oblicz_termin_kio('nie-data', 'unijny'), null);
});

test('null/undefined/pusty string → null', () => {
  assert.equal(oblicz_termin_kio(null, 'unijny'), null);
  assert.equal(oblicz_termin_kio(undefined, 'unijny'), null);
  assert.equal(oblicz_termin_kio('', 'unijny'), null);
});

test('niepoprawny Date (Invalid Date) → null', () => {
  assert.equal(oblicz_termin_kio(new Date('cokolwiek'), 'unijny'), null);
});

test('data o poprawnym kształcie, ale nieistniejąca → null (bez cichej normalizacji)', () => {
  assert.equal(oblicz_termin_kio('2026-13-45', 'unijny'), null); // miesiąc 13
  assert.equal(oblicz_termin_kio('2026-02-30', 'unijny'), null); // 30 lutego
});

/*
 * ===== Odliczanie do upływu terminu — pozostaly_czas_do (podzadanie 4/13) =====
 * `teraz` wstrzykiwany jako ms (UTC), żeby test nie zależał od zegara/strefy.
 * Moment upływu = koniec dnia granicznego = północ dnia następnego (UTC).
 */

// --- Pełne dni / dni + godziny (rozbicie w dół) ---

test('pozostaly_czas_do: równe pełne dni przed terminem', () => {
  // 2026-08-10 → upływ 2026-08-11T00:00Z; teraz 2026-08-05T00:00Z = dokładnie 6 dni.
  const r = pozostaly_czas_do('2026-08-10', Date.UTC(2026, 7, 5, 0, 0, 0));
  assert.deepEqual(
    { poTerminie: r.poTerminie, dni: r.dni, godziny: r.godziny },
    { poTerminie: false, dni: 6, godziny: 0 },
  );
});

test('pozostaly_czas_do: dni + godziny liczone w dół (floor, bez zawyżania)', () => {
  // upływ 2026-08-11T00:00Z − teraz 2026-08-05T10:30Z = 5 dni 13 godz. 30 min → 5 dni 13 godz.
  const r = pozostaly_czas_do('2026-08-10', Date.UTC(2026, 7, 5, 10, 30, 0));
  assert.equal(r.poTerminie, false);
  assert.equal(r.dni, 5);
  assert.equal(r.godziny, 13);
});

// --- Cały dzień graniczny jest jeszcze ważny (kluczowa semantyka) ---

test('pozostaly_czas_do: rano DNIA granicznego termin NIE minął (można wnieść do końca dnia)', () => {
  // termin 2026-08-05, teraz 2026-08-05T09:00Z → do północy 2026-08-06 zostaje 15 godz.
  const r = pozostaly_czas_do('2026-08-05', Date.UTC(2026, 7, 5, 9, 0, 0));
  assert.equal(r.poTerminie, false);
  assert.equal(r.dni, 0);
  assert.equal(r.godziny, 15);
});

// --- Granica i po terminie ---

test('pozostaly_czas_do: dokładnie w chwili upływu (północ następnego dnia) → po terminie', () => {
  const r = pozostaly_czas_do('2026-08-05', Date.UTC(2026, 7, 6, 0, 0, 0));
  assert.deepEqual(
    { poTerminie: r.poTerminie, dni: r.dni, godziny: r.godziny },
    { poTerminie: true, dni: 0, godziny: 0 },
  );
  assert.equal(r.pozostaloMs, 0);
});

test('pozostaly_czas_do: po upływie → poTerminie=true, dni/godziny=0, ujemny pozostaloMs', () => {
  const r = pozostaly_czas_do('2026-08-05', Date.UTC(2026, 7, 6, 0, 0, 1)); // sekunda po
  assert.equal(r.poTerminie, true);
  assert.equal(r.dni, 0);
  assert.equal(r.godziny, 0);
  assert.equal(r.pozostaloMs, -1000);
});

// --- Formaty wejścia (spójnie z oblicz_termin_kio) ---

test('pozostaly_czas_do: akceptuje Date i pełny ISO (dzień z pierwszych 10 znaków)', () => {
  const teraz = Date.UTC(2026, 7, 5, 0, 0, 0);
  const zDate = pozostaly_czas_do(new Date(Date.UTC(2026, 7, 10)), teraz);
  const zIso = pozostaly_czas_do('2026-08-10T23:30:00Z', teraz); // godzina nie przesuwa dnia
  assert.equal(zDate.dni, 6);
  assert.equal(zIso.dni, 6);
});

test('pozostaly_czas_do: nieczytelny/pusty termin → null (jak oblicz_termin_kio)', () => {
  const teraz = Date.UTC(2026, 7, 5);
  assert.equal(pozostaly_czas_do(null, teraz), null);
  assert.equal(pozostaly_czas_do(undefined, teraz), null);
  assert.equal(pozostaly_czas_do('', teraz), null);
  assert.equal(pozostaly_czas_do('nie-data', teraz), null);
  assert.equal(pozostaly_czas_do('2026-02-30', teraz), null); // nieistniejąca data
});

// --- Współpraca z kalkulatorem terminu (cały łańcuch) ---

test('pozostaly_czas_do: łańcuch z oblicz_termin_kio', () => {
  const termin = oblicz_termin_kio('2026-07-20', 'unijny'); // → 2026-07-30
  assert.equal(termin, '2026-07-30');
  // teraz 2026-07-25T00:00Z → upływ 2026-07-31T00:00Z = 6 dni.
  const r = pozostaly_czas_do(termin, Date.UTC(2026, 6, 25, 0, 0, 0));
  assert.equal(r.poTerminie, false);
  assert.equal(r.dni, 6);
});
