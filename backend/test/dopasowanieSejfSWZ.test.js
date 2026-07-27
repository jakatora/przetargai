import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opiszDokument } from '../src/services/sejfDokumentow.js';
import {
  wykryjWymaganeTypy,
  dopasujSejfDoSWZ,
} from '../src/services/dopasowanieSejfSWZ.js';

/*
 * Dopasowanie sejf ↔ SWZ (podzadanie 5/7 ulepszenia „Sejf podmiotowych środków
 * dowodowych z licznikiem świeżości"). Testy CZYSTEJ logiki (bez DB, bez sieci):
 *
 *  • wykryjWymaganeTypy — deterministyczny parser treści SWZ → id typów z katalogu
 *    (bez płatnego AI: parser słów kluczowych odporny na polskie znaki),
 *  • dopasujSejfDoSWZ  — trzy koszyki (świeże / przeterminuje się przed dniem
 *    złożenia / brakuje) liczone WZGLĘDEM PRZEWIDYWANEGO DNIA ZŁOŻENIA.
 *
 * Kluczowy scenariusz: PRZESUNIĘCIE TERMINU składania. Ten sam dokument, który jest
 * świeży dla wcześniejszego terminu, ląduje w koszyku „przeterminuje się", gdy termin
 * przesunie się na później — bo to na dzień złożenia liczy się ważność dokumentu.
 */

// Buduje wzbogacony dokument (jak z sejfu) na wskazany dzień odniesienia.
function opis(row, dzienOdniesienia) {
  return opiszDokument(row, { dzienOdniesienia });
}

// ── wykryjWymaganeTypy: parser treści SWZ → id typów dokumentów ──────────────

test('wykryjWymaganeTypy — rozpoznaje KRK, US, ZUS z treści SWZ (mimo polskich znaków)', () => {
  const swz = `
    VIII. Podmiotowe środki dowodowe:
    1) informacja z Krajowego Rejestru Karnego w zakresie niekaralności,
    2) zaświadczenie o niezaleganiu w podatkach z właściwego urzędu skarbowego,
    3) zaświadczenie z ZUS o niezaleganiu w opłacaniu składek na ubezpieczenia społeczne.
  `;
  const typy = wykryjWymaganeTypy(swz);
  assert.ok(typy.includes('krk'), 'wykrywa KRK');
  assert.ok(typy.includes('us'), 'wykrywa US');
  assert.ok(typy.includes('zus'), 'wykrywa ZUS');
});

test('wykryjWymaganeTypy — rozpoznaje polisę OC, odpis z rejestru, wykaz robót i uprawnienia', () => {
  const swz = `
    Wykonawca złoży: polisę ubezpieczenia odpowiedzialności cywilnej,
    odpis z Krajowego Rejestru Sądowego (KRS), wykaz robót budowlanych wykonanych
    w okresie ostatnich 5 lat oraz wykaz osób skierowanych do realizacji zamówienia
    posiadających uprawnienia budowlane.
  `;
  const typy = wykryjWymaganeTypy(swz);
  assert.ok(typy.includes('polisa_oc'), 'wykrywa polisę OC');
  assert.ok(typy.includes('wpis_rejestr'), 'wykrywa odpis z rejestru');
  assert.ok(typy.includes('wykaz_robot_uslugi'), 'wykrywa wykaz robót');
  assert.ok(typy.includes('uprawnienia_pracownikow'), 'wykrywa uprawnienia pracowników');
});

test('wykryjWymaganeTypy — pusta/nieistotna treść => brak typów', () => {
  assert.deepEqual(wykryjWymaganeTypy(''), []);
  assert.deepEqual(wykryjWymaganeTypy('Zamawiający zaprasza do składania ofert.'), []);
  assert.deepEqual(wykryjWymaganeTypy(null), []);
});

test('wykryjWymaganeTypy — nie dubluje typu i zachowuje kolejność katalogu', () => {
  const swz = 'ZUS, ZUS, informacja z Krajowego Rejestru Karnego, ZUS';
  const typy = wykryjWymaganeTypy(swz);
  assert.deepEqual(typy, ['krk', 'zus'], 'unikalne + kolejność wg katalogu (krk przed zus)');
});

// ── dopasujSejfDoSWZ: trzy koszyki ───────────────────────────────────────────

test('dopasujSejfDoSWZ — świeże / przeterminuje się / brakuje w jednym przebiegu', () => {
  const dzien = '2026-09-01';
  const dokumenty = [
    // KRK świeży na dzień złożenia (180 dni od 2026-05-01 → ważny do 2026-10-28)
    opis({ id: 'k1', typ_dokumentu: 'krk', data_wystawienia: '2026-05-01', okres_waznosci_dni: null }, dzien),
    // US już przeterminowany na dzień złożenia (90 dni od 2026-01-01 → do 2026-04-01)
    opis({ id: 'u1', typ_dokumentu: 'us', data_wystawienia: '2026-01-01', okres_waznosci_dni: null }, dzien),
    // ZUS w ogóle nie ma → koszyk „brakuje"
  ];

  const wynik = dopasujSejfDoSWZ({ wymaganeTypy: ['krk', 'us', 'zus'], dokumenty });

  assert.deepEqual(wynik.swieze.map((d) => d.typ), ['krk'], 'KRK świeży');
  assert.deepEqual(wynik.przeterminuja_sie.map((d) => d.typ), ['us'], 'US przeterminowany na dzień złożenia');
  assert.deepEqual(wynik.brakuje.map((d) => d.typ), ['zus'], 'ZUS brakuje');
});

test('dopasujSejfDoSWZ — brakujący typ niesie link „gdzie wyrobić online"', () => {
  const wynik = dopasujSejfDoSWZ({ wymaganeTypy: ['krk'], dokumenty: [] });
  assert.equal(wynik.brakuje.length, 1);
  assert.equal(wynik.brakuje[0].typ, 'krk');
  assert.equal(wynik.brakuje[0].online.nazwa, 'e-KRK', 'link e-KRK z katalogu');
  assert.ok(wynik.brakuje[0].nazwaTypu, 'ma czytelną nazwę typu');
});

test('dopasujSejfDoSWZ — dokument bezterminowy jest zawsze świeży', () => {
  const dzien = '2030-12-31';
  const dokumenty = [
    opis({ id: 'w1', typ_dokumentu: 'wykaz_robot_uslugi', data_wystawienia: '2020-01-01', okres_waznosci_dni: null }, dzien),
  ];
  const wynik = dopasujSejfDoSWZ({ wymaganeTypy: ['wykaz_robot_uslugi'], dokumenty });
  assert.deepEqual(wynik.swieze.map((d) => d.typ), ['wykaz_robot_uslugi']);
  assert.equal(wynik.przeterminuja_sie.length, 0);
});

test('dopasujSejfDoSWZ — z wielu egzemplarzy wybiera najdłużej ważny', () => {
  const dzien = '2026-09-01';
  const dokumenty = [
    opis({ id: 'stary', typ_dokumentu: 'krk', data_wystawienia: '2026-01-01', okres_waznosci_dni: null }, dzien), // do 2026-06-30 → przeterminowany
    opis({ id: 'nowy', typ_dokumentu: 'krk', data_wystawienia: '2026-06-01', okres_waznosci_dni: null }, dzien),  // do 2026-11-28 → świeży
  ];
  const wynik = dopasujSejfDoSWZ({ wymaganeTypy: ['krk'], dokumenty });
  assert.deepEqual(wynik.swieze.map((d) => d.id), ['nowy'], 'wybrany świeższy egzemplarz KRK');
  assert.equal(wynik.przeterminuja_sie.length, 0, 'skoro jest świeży, KRK nie trafia do „przeterminuje się"');
});

test('dopasujSejfDoSWZ — nie dubluje wymaganego typu podanego dwa razy', () => {
  const dzien = '2026-09-01';
  const dokumenty = [
    opis({ id: 'k1', typ_dokumentu: 'krk', data_wystawienia: '2026-05-01', okres_waznosci_dni: null }, dzien),
  ];
  const wynik = dopasujSejfDoSWZ({ wymaganeTypy: ['krk', 'krk'], dokumenty });
  assert.equal(wynik.swieze.length, 1, 'KRK policzony raz mimo duplikatu wymagania');
});

// ── SCENARIUSZ: przesunięcie terminu składania ───────────────────────────────

test('SCENARIUSZ przesunięcia terminu — ten sam KRK: świeży dla wcześniejszego, przeterminowany dla późniejszego', () => {
  // KRK wystawiony 2026-05-01, domyślna ważność 180 dni → ważny do 2026-10-28.
  const krkRow = { id: 'krk-1', typ_dokumentu: 'krk', data_wystawienia: '2026-05-01', okres_waznosci_dni: null };

  // Termin pierwotny: 2026-09-01 (KRK jeszcze ważny) → koszyk „świeże".
  const wynikPrzed = dopasujSejfDoSWZ({
    wymaganeTypy: ['krk'],
    dokumenty: [opis(krkRow, '2026-09-01')],
  });
  assert.deepEqual(wynikPrzed.swieze.map((d) => d.typ), ['krk'], 'dla wcześniejszego terminu KRK jest świeży');
  assert.equal(wynikPrzed.przeterminuja_sie.length, 0);

  // Termin przesunięty na 2026-11-15 (po 2026-10-28) → TEN SAM KRK „przeterminuje się przed złożeniem".
  const wynikPo = dopasujSejfDoSWZ({
    wymaganeTypy: ['krk'],
    dokumenty: [opis(krkRow, '2026-11-15')],
  });
  assert.equal(wynikPo.swieze.length, 0, 'po przesunięciu terminu KRK nie jest już świeży');
  assert.deepEqual(wynikPo.przeterminuja_sie.map((d) => d.typ), ['krk'],
    'po przesunięciu terminu KRK przeterminuje się przed dniem złożenia');
  // Wpis niesie ujemny licznik dni i link do odnowienia.
  const wpis = wynikPo.przeterminuja_sie[0];
  assert.ok(wpis.dniDoWaznosci < 0, 'ujemny licznik dni na dzień złożenia');
  assert.equal(wpis.online.nazwa, 'e-KRK', 'gdzie odnowić');
});
