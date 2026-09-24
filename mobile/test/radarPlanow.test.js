import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRYBY_RADARU, etykietaTerminu, tonPoziomu, opisPoziomu, opisKamienia, opisOgloszenia,
  formatujWartoscPlanu, podsumowanieRadaru,
} from '../src/lib/radarPlanow.js';

const DZIS = Date.UTC(2026, 8, 24);

test('tryby: „Dla mnie" i „Wszystkie" z etykietami PL/EN', () => {
  assert.deepEqual(TRYBY_RADARU.map((t) => t.wartosc), ['dla_mnie', 'wszystkie']);
  for (const t of TRYBY_RADARU) assert.ok(t.etykieta.pl && t.etykieta.en);
});

test('termin: odmiana miesięcy i nazwa miesiąca', () => {
  assert.equal(etykietaTerminu({ terminWszczecia: '2026-11-02', miesiacyDoWszczecia: 2 }, 'pl').tekst,
    'Ogłoszenie za ok. 2 miesiące (listopad 2026)');
  assert.equal(etykietaTerminu({ terminWszczecia: '2027-03-01', miesiacyDoWszczecia: 6 }, 'pl').tekst,
    'Ogłoszenie za ok. 6 miesięcy (marzec 2027)');
  assert.equal(etykietaTerminu({ terminWszczecia: '2026-10-20', miesiacyDoWszczecia: 1 }, 'pl').tekst,
    'Ogłoszenie za ok. 1 miesiąc (październik 2026)');
  assert.equal(etykietaTerminu({ terminWszczecia: '2026-11-02', miesiacyDoWszczecia: 2 }, 'en').tekst,
    'Notice in about 2 months (November 2026)');
});

test('termin: bieżący miesiąc i minione są pilne, nieznany jest neutralny', () => {
  const teraz = etykietaTerminu({ terminWszczecia: '2026-09-30', miesiacyDoWszczecia: 0 }, 'pl');
  assert.equal(teraz.tekst, 'Ogłoszenie spodziewane w tym miesiącu (wrzesień 2026)');
  assert.equal(teraz.ton, 'ostrzezenie');
  const po = etykietaTerminu({ terminWszczecia: '2026-08-28', miesiacyDoWszczecia: -1 }, 'pl');
  assert.match(po.tekst, /Przewidywany termin minął/);
  assert.equal(po.ton, 'ostrzezenie', 'przetarg mógł już wyjść — trzeba sprawdzić');
  const brak = etykietaTerminu({ terminWszczecia: null, miesiacyDoWszczecia: null }, 'pl');
  assert.equal(brak.tekst, 'Zamawiający nie podał przewidywanej daty');
  assert.equal(brak.ton, 'neutral');
  assert.equal(etykietaTerminu({ terminWszczecia: '2027-06-01', miesiacyDoWszczecia: 9 }, 'pl').ton, 'neutral');
});

test('poziom dopasowania → ton i etykieta; brak rankingu nie udaje sukcesu', () => {
  assert.equal(tonPoziomu('MOCNE'), 'sukces');
  assert.equal(tonPoziomu('SLABE'), 'ostrzezenie');
  assert.equal(tonPoziomu(null), 'neutral');
  assert.equal(opisPoziomu('MOCNE', 'pl'), 'Mocne dopasowanie');
  assert.equal(opisPoziomu('SLABE', 'en'), 'Weak match');
  assert.equal(opisPoziomu(null, 'pl'), null);
});

test('kamień milowy: data, ile dni, minione na czerwono', () => {
  const przyszly = opisKamienia({ tytul: 'Skompletuj dokumenty', data: '2026-10-04', dniOdDzis: 10, minelo: false }, 'pl');
  assert.equal(przyszly.kiedy, 'za 10 dni · 2026-10-04');
  assert.equal(przyszly.ton, 'neutral');
  const jutro = opisKamienia({ tytul: 'x', data: '2026-09-25', dniOdDzis: 1, minelo: false }, 'pl');
  assert.equal(jutro.kiedy, 'za 1 dzień · 2026-09-25');
  assert.equal(jutro.ton, 'ostrzezenie', 'tydzień i mniej = pilne');
  const minal = opisKamienia({ tytul: 'x', data: '2026-09-20', dniOdDzis: -4, minelo: true }, 'pl');
  assert.equal(minal.kiedy, '4 dni po terminie · 2026-09-20');
  assert.equal(minal.ton, 'danger');
  const dzis = opisKamienia({ tytul: 'x', data: '2026-09-24', dniOdDzis: 0, minelo: false }, 'pl');
  assert.equal(dzis.kiedy, 'dziś · 2026-09-24');
  const bez = opisKamienia({ tytul: 'x', data: null, dniOdDzis: null, dniPrzed: 90, minelo: false }, 'pl');
  assert.equal(bez.kiedy, '90 dni przed ogłoszeniem');
});

test('ogłoszenie: alarm „to jest to" zielony, prawdopodobne żółte, brak = null', () => {
  const alarm = opisOgloszenia({ alarm: true, etykieta: 'pewne', pewnosc: 85 }, 'pl');
  assert.equal(alarm.naglowek, 'To jest to, na co czekałeś — przetarg już ogłoszono');
  assert.equal(alarm.ton, 'sukces');
  const moze = opisOgloszenia({ alarm: false, etykieta: 'prawdopodobne', pewnosc: 55 }, 'pl');
  assert.equal(moze.naglowek, 'Możliwe, że przetarg już ogłoszono — sprawdź');
  assert.equal(moze.ton, 'ostrzezenie');
  assert.match(moze.pewnosc, /55%/);
  assert.equal(opisOgloszenia(null, 'pl'), null);
});

test('wartość planu: kwota z separatorami albo „nie podano"', () => {
  assert.equal(formatujWartoscPlanu(13150027.21, 'PLN', 'pl'), '13 150 027 PLN');
  assert.equal(formatujWartoscPlanu(null, null, 'pl'), 'Wartości nie podano');
  assert.equal(formatujWartoscPlanu(null, null, 'en'), 'Value not stated');
});

test('podsumowanie listy mówi, z ilu planów wybrano', () => {
  assert.equal(podsumowanieRadaru({ tryb: 'dla_mnie', dopasowanych: 3, lacznie_aktywnych: 250 }, 'pl'),
    '3 z 250 aktywnych planów pasuje do Twojego profilu');
  assert.equal(podsumowanieRadaru({ tryb: 'wszystkie', dopasowanych: null, lacznie_aktywnych: 250 }, 'pl'),
    '250 aktywnych planów zamówień');
  assert.equal(podsumowanieRadaru({ tryb: 'wszystkie', lacznie_aktywnych: 1 }, 'en'), '1 active procurement plan');
  assert.equal(podsumowanieRadaru(null, 'pl'), '');
});

test('moduł jest czysty — bez React Native i bez sieci', async () => {
  const { readFile } = await import('node:fs/promises');
  const kod = await readFile(new URL('../src/lib/radarPlanow.js', import.meta.url), 'utf8');
  assert.ok(!/from 'react-native'|fetch\(|#[0-9a-fA-F]{6}/.test(kod));
  assert.ok(DZIS > 0);
});
