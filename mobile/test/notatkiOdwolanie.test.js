import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wygeneruj_notatki_odwolanie,
  TYTUL_NOTATEK,
} from '../src/lib/notatkiOdwolanie.js';

import { PoprzetargowaKontrola } from '../src/lib/poprzetargowaKontrola.js';

/*
 * Generator NOTATEK ROBOCZYCH pod odwołanie do KIO (podzadanie 12/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie"). Czysta funkcja: bierze
 * poprzetargową kontrolę (z gotowym wynikiem analizy z podzadania 11/13 i wyliczonym
 * terminem KIO) i składa gotowy do pobrania dokument .txt, którym użytkownik może się
 * posłużyć przy pisaniu odwołania. WYŁĄCZNIE formatowanie ISTNIEJĄCYCH danych —
 * zero nowych reguł/decyzji (te wyliczyły podzadania 3/10/11).
 *
 * Determinizm jak w wniosekProtokol/terminKio: bez Date.now() w środku — czas
 * odniesienia do „ile zostało" wstrzykuje wołający przez opcje.teraz.
 */

// Przykładowa analiza w kształcie z ocen_szanse_i_rekomendacja (11/13).
function analizaWalcz() {
  return {
    zarzuty: [
      {
        rodzaj: 'niezgodnosc_swz',
        tytul: 'Niezgodność treści oferty z SWZ',
        opis_zarzutu: 'Oferta wyrażona w EUR, a SWZ wymaga PLN (art. 226 ust. 1 pkt 5 Pzp).',
        sila: 'mocna',
      },
      {
        rodzaj: 'brak_oswiadczen',
        tytul: 'Brak wymaganych oświadczeń',
        opis_zarzutu: 'Brak oświadczenia o niepodleganiu wykluczeniu (art. 125 Pzp).',
        sila: 'umiarkowana',
      },
    ],
    liczbaZarzutow: 2,
    punkty: 9,
    ocenaSzans: 'wysoka',
    rekomendacja: { wartosc: 'walcz', etykieta: 'jest podstawa, walcz' },
    kompletDokumentow: true,
    uzasadnienie: 'Wykryto 2 potencjalne przesłanki odrzucenia oferty zwycięzcy; szanse wysokie.',
  };
}

function analizaOdpusc() {
  return {
    zarzuty: [],
    liczbaZarzutow: 0,
    punkty: 0,
    ocenaSzans: 'niska',
    rekomendacja: { wartosc: 'odpusc', etykieta: 'odpuść' },
    kompletDokumentow: true,
    uzasadnienie: 'Nie wykryto przesłanek dających realną podstawę do odwołania. Rekomendacja: odpuść.',
  };
}

function kontrolaZAnaliza(analiza, nadpisz = {}) {
  return new PoprzetargowaKontrola({
    postepowanieId: 42,
    daneZamawiajacego: 'Urząd Miasta X',
    dataOgloszeniaWyniku: '2026-07-20',
    terminOdwolaniaKio: '2026-07-27',
    status: 'analiza_gotowa',
    analiza,
    ...nadpisz,
  });
}

// --- Kształt dokumentu do pobrania ---

test('zwraca dokument z tytułem, nazwą pliku, typem MIME i treścią', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.equal(dok.tytul, TYTUL_NOTATEK);
  assert.equal(typeof dok.tresc, 'string');
  assert.ok(dok.tresc.length > 0);
  assert.ok(dok.nazwaPliku.endsWith('.txt'));
  assert.match(dok.typMime, /text\/plain/);
});

test('nazwa pliku zawiera id postępowania', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.equal(dok.nazwaPliku, 'notatki-odwolanie-42.txt');
});

test('brak id → neutralna nazwa pliku, bez „undefined"', () => {
  const dok = wygeneruj_notatki_odwolanie({ analiza: analizaWalcz() });
  assert.equal(dok.nazwaPliku, 'notatki-odwolanie.txt');
  assert.doesNotMatch(dok.nazwaPliku, /undefined|null/);
});

test('id sanityzowane w nazwie pliku (spacje/ukośniki → myślnik)', () => {
  const dok = wygeneruj_notatki_odwolanie(
    kontrolaZAnaliza(analizaWalcz(), { postepowanieId: 'BZP 2026/S 12/3' }),
  );
  assert.doesNotMatch(dok.nazwaPliku, /[ /\\]/);
  assert.match(dok.nazwaPliku, /^notatki-odwolanie-.+\.txt$/);
});

// --- Decyzja końcowa i ocena szans ---

test('niesie decyzję „walcz" i ocenę szans', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /jest podstawa, walcz/i);
  assert.match(dok.tresc, /wysok/i); // ocena szans: wysoka
});

test('niesie decyzję „odpuść", gdy taka rekomendacja', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaOdpusc()));
  assert.match(dok.tresc, /odpu[śs]/i);
  assert.match(dok.tresc, /nisk/i); // ocena szans: niska
});

// --- Lista zarzutów ---

test('wypisuje wszystkie zarzuty: tytuł i opis', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /Niezgodność treści oferty z SWZ/);
  assert.match(dok.tresc, /art\.\s*226 ust\.\s*1 pkt 5/);
  assert.match(dok.tresc, /Brak wymaganych oświadczeń/);
  assert.match(dok.tresc, /art\.\s*125/);
});

test('podaje liczbę zarzutów', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /2/);
});

test('brak zarzutów (odpuść) → czytelna informacja, bez pustej listy', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaOdpusc()));
  assert.match(dok.tresc, /nie wykryto|brak/i);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});

// --- Termin KIO (data + odliczanie) ---

test('niesie datę graniczną terminu KIO', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /27\.07\.2026|2026-07-27/);
});

test('opcje.teraz przed terminem → pokazuje ile zostało', () => {
  // 2026-07-25 12:00Z — termin 2026-07-27 (upływa końcem dnia = 2026-07-28 00:00Z).
  const teraz = Date.UTC(2026, 6, 25, 12, 0, 0);
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()), { teraz });
  assert.match(dok.tresc, /pozosta/i);
  assert.doesNotMatch(dok.tresc, /upłyn|min[ąa][łl]/i);
});

test('opcje.teraz po terminie → informuje, że termin upłynął', () => {
  const teraz = Date.UTC(2026, 7, 1, 12, 0, 0); // 2026-08-01, długo po 27.07
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()), { teraz });
  assert.match(dok.tresc, /upłyn|min[ąa][łl]/i);
});

test('brak wyliczonego terminu KIO → czytelny placeholder, bez „null"', () => {
  const dok = wygeneruj_notatki_odwolanie(
    kontrolaZAnaliza(analizaWalcz(), { terminOdwolaniaKio: null }),
    { teraz: Date.UTC(2026, 6, 25) },
  );
  assert.match(dok.tresc, /nieustalon|nieznan|brak/i);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});

// --- Uzasadnienie i zamawiający ---

test('niesie uzasadnienie oceny', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /szanse wysokie/);
});

test('niesie dane zamawiającego z kontroli', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /Urząd Miasta X/);
});

test('opcje.nazwaPostepowania trafia do notatek', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()), {
    nazwaPostepowania: 'Dostawa serwerów dla szpitala',
  });
  assert.match(dok.tresc, /Dostawa serwerów dla szpitala/);
});

// --- Zastrzeżenie (to nie pismo procesowe / porada prawna) ---

test('zawiera zastrzeżenie, że to notatki robocze, nie pismo procesowe', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(analizaWalcz()));
  assert.match(dok.tresc, /notatki robocze|nie stanowi/i);
  assert.match(dok.tresc, /KIO|Krajow/i);
});

// --- Best-effort: braki danych nie wywracają generatora ---

test('kontrola bez analizy → nie rzuca, informuje o braku analizy', () => {
  const dok = wygeneruj_notatki_odwolanie(kontrolaZAnaliza(null));
  assert.equal(dok.tytul, TYTUL_NOTATEK);
  assert.match(dok.tresc, /nie przeprowadzono|brak analizy/i);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});

test('null/undefined kontrola → nie rzuca, zwraca szablon', () => {
  for (const wejscie of [null, undefined]) {
    const dok = wygeneruj_notatki_odwolanie(wejscie);
    assert.equal(dok.tytul, TYTUL_NOTATEK);
    assert.ok(dok.tresc.length > 0);
    assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
  }
});

test('akceptuje surową analizę podaną wprost (bez opakowania w kontrolę)', () => {
  const dok = wygeneruj_notatki_odwolanie(analizaWalcz());
  assert.match(dok.tresc, /jest podstawa, walcz/i);
  assert.match(dok.tresc, /Niezgodność treści oferty z SWZ/);
});
