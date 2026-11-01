import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsujKryteriaSwz } from '../src/lib/kryteriaSwz.js';
import { plikSwzPz, kryteriaZSwzPz } from '../src/services/kryteriaSwzPz.js';

/*
 * Kryteria z treści SWZ (2026-11-01) dla ogłoszeń platformazakupowa.pl bez bliźniaka w BZP/TED. Fixture =
 * rozdziały o kryteriach z prawdziwych SWZ (PDF z platformy, 1.11.2026, tekst z `liniePdf`): „waga 80%”,
 * „– 60 % ( 1% = 1 pkt )”, „60/100 punktów”, „- 60 pkt;”, „1 0 %” rozbite przez PDF, „tylko kryterium ceny”.
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/swz-kryteria.json', import.meta.url), 'utf8'));
const proste = (k) => k?.lista.map((c) => [c.nazwa, c.waga, c.rodzaj]) ?? null;

test('procenty: „waga N%”, „– N %” z przelicznikiem pkt, nazwy bez numeracji i oznaczeń (C)', () => {
  assert.deepEqual(proste(parsujKryteriaSwz([F.pz_1393678])), [
    ['cena ofertowa brutto', 80, 'cena'], ['Doświadczenie pracowników', 10, 'doswiadczenie'], ['Obniżenie składki PEFRON', 10, 'spoleczne']]);
  assert.deepEqual(proste(parsujKryteriaSwz([F.pz_1393429])), [['CENA OFERTY BRUTTO', 60, 'cena'], ['OKRES GWARANCJI', 40, 'gwarancja']]);
  assert.deepEqual(proste(parsujKryteriaSwz([F.pz_1384519])), [['Cena', 60, 'cena'], ['Okres gwarancji', 40, 'gwarancja']]);
});

test('punkty na liście: „60/100 punktów”, „(C) - 60 pkt;” — progi „Gwarancja 48 miesięcy – 20 punktów” pominięte', () => {
  assert.deepEqual(proste(parsujKryteriaSwz([F.pz_1390119])), [['Cena', 60, 'cena'], ['Gwarancja', 40, 'gwarancja']]);
  const k = parsujKryteriaSwz([F.pz_1395490]);
  assert.deepEqual(k.lista.map((c) => [c.nazwa, c.waga]), [
    ['Cena', 60], ['Doświadczenie pracowników ochrony', 30], ['Deklarowany maksymalny czas przyjazdu grupy interwencyjnej', 10]]);
  assert.equal(k.pozacenowe, true);
});

test('PDF rozbija cyfry i polskie litery: „1 0 %”, „os ó b” → 10 i „osób”', () => {
  assert.deepEqual(proste(parsujKryteriaSwz([F.pz_1399527])), [
    ['najniższa cena', 90, 'cena'], ['doświadczenie osób skierowanych do realizacji zamówienia', 10, 'doswiadczenie']]);
});

test('„tylko na podstawie kryterium cenowego” = Cena 100%, bez pozacenowych', () => {
  const k = parsujKryteriaSwz([F.pz_1395261]);
  assert.deepEqual([proste(k), k.pozacenowe, k.sposob], [[['Cena', 100, 'cena']], false, 'procentowo']);
});

test('bez sumy 100 albo bez sekcji kryteriów → null; VAT i zabezpieczenie to nie kryteria', () => {
  assert.equal(parsujKryteriaSwz(['Kryteria oceny ofert: 1) Cena – 60% 2) Gwarancja – 30%']), null);
  assert.equal(parsujKryteriaSwz(['Zabezpieczenie w wysokości 5% ceny. Stawka VAT 23%. Cena 60% Gwarancja 40%']), null);
  assert.equal(parsujKryteriaSwz(['Opis kryteriów oceny ofert. Cena oferty zawiera podatek VAT 23%. 1) Cena (C) – 100%']).lista[0].waga, 100);
  assert.equal(parsujKryteriaSwz(null), null);
});

test('progi podkryterium („Do 15 minut – 10%”) nie są osobnymi kryteriami, „Doświadczenie” tak', () => {
  const k = parsujKryteriaSwz(['Kryteria oceny ofert: 1) Cena – 80% 2) Czas reakcji – 20%: Do 15 minut – 20%, 16-25 minut – 10%. 3) Doświadczenie – 10%']);
  assert.deepEqual(proste(k), [['Cena', 80, 'cena'], ['Czas reakcji', 20, 'reakcja']]);
});

test('plik SWZ z załączników: „SWZ.pdf” przed „Załącznik nr 1 do SWZ”, bez PDF-a → null', () => {
  const zal = [
    { nazwa: 'Załącznik nr 1 do SWZ - formularz', rozszerzenie: 'pdf', url: 'https://platformazakupowa.pl/file/1' },
    { nazwa: 'SWZ', rozszerzenie: 'pdf', url: 'https://platformazakupowa.pl/file/2' },
    { nazwa: 'SWZ edytowalna', rozszerzenie: 'docx', url: 'https://platformazakupowa.pl/file/3' },
  ];
  assert.equal(plikSwzPz({ zalaczniki: zal }).url, 'https://platformazakupowa.pl/file/2');
  assert.equal(plikSwzPz({ zalaczniki: zal.slice(0, 1) }).url, 'https://platformazakupowa.pl/file/1');
  assert.equal(plikSwzPz({ zalaczniki: zal.slice(2) }), null);
  assert.equal(plikSwzPz(null), null);
});

test('kryteriaZSwzPz: pobiera tylko SWZ, czyta tekst i parsuje; bez SWZ nie chodzi do sieci', async () => {
  const pobrane = [];
  const pobierz = async (url) => { pobrane.push(url); return Buffer.from('%PDF-').toString('base64'); };
  const czytaj = async (buf) => { assert.equal(buf.toString('latin1'), '%PDF-'); return F.pz_1390119.split('. '); };
  const k = await kryteriaZSwzPz({ zalaczniki: [{ nazwa: 'SWZ.pdf', rozszerzenie: 'pdf', url: 'https://platformazakupowa.pl/file/9' }] }, { pobierz, czytaj });
  assert.deepEqual([proste(k), pobrane], [[['Cena', 60, 'cena'], ['Gwarancja', 40, 'gwarancja']], ['https://platformazakupowa.pl/file/9']]);
  assert.equal(await kryteriaZSwzPz({ zalaczniki: [] }, { pobierz, czytaj }), null);
  assert.equal(pobrane.length, 1);
});

test('wadium z SWZ: kwota z walutą albo z groszami, „nie wymaga”, bez słownego „00/100”; brak wzmianki — null', async () => {
  const { parsujWadiumSwz } = await import('../src/lib/wadium.js');
  assert.deepEqual(parsujWadiumSwz(['XVII. WYMAGANIA DOTYCZĄCE WADIUM 1. Wykonawca zobowiązany jest do zabezpieczenia swojej oferty wadium w wysokości: 3 000 ,00 zł (słownie: trzy tysiące 00/100 złotych) .']), { wymagane: true, kwota: 3000, wieleCzesci: false });
  assert.deepEqual(parsujWadiumSwz(['XXI. WYMAGANIA DOTYCZĄCE WADIUM 1. Wykonawca zobowiązany jest wnieść wadium przed upływem terminu składania ofert. Wadium wynosi 20 000,00 PLN (słownie : dwadzieścia tysięcy złotych 00/100 ).']).kwota, 20000);
  assert.equal(parsujWadiumSwz(['1. Wykonawca zobowiązany jest wnieść wadium przed upływem terminu składania ofert w wysokości: 1 500,00 ( słownie: jeden tysiąc pięćset złotych 00/100 ) PLN.']).kwota, 1500);
  assert.deepEqual(parsujWadiumSwz(['XII. WYMAGANIA DOTYCZĄCE WADIUM Zamawiający nie wymaga wniesienia wadium. XIII. TERMIN']), { wymagane: false, kwota: null });
  assert.deepEqual(parsujWadiumSwz(['XX. WYMAGANIA DOTYCZĄCE WADIUM. ZAMAWIAJĄCY nie wymaga składania wadium.']), { wymagane: false, kwota: null });
  assert.deepEqual(parsujWadiumSwz(['Zapytanie ofertowe na dostawę mebli. Termin realizacji 30 dni.']), { wymagane: null, kwota: null });
});

test('daneZSwzPz: jedno pobranie, kryteria i wadium z tego samego tekstu', async () => {
  const { daneZSwzPz } = await import('../src/services/kryteriaSwzPz.js');
  let pobran = 0;
  const w = await daneZSwzPz({ zalaczniki: [{ nazwa: 'SWZ', rozszerzenie: 'pdf', url: 'https://platformazakupowa.pl/file/7' }] }, {
    pobierz: async () => { pobran += 1; return Buffer.from('%PDF-').toString('base64'); },
    czytaj: async () => [...F.pz_1390119.split('. '), 'XII Wymagania dotyczące wadium. Zamawiający nie wymaga wniesienia wadium.'],
  });
  assert.deepEqual([pobran, proste(w.kryteria), w.wadium], [1, [['Cena', 60, 'cena'], ['Gwarancja', 40, 'gwarancja']], { wymagane: false, kwota: null }]);
});
