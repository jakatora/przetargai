import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsujKryteria, rodzajKryterium, kryteriaPrzetargu, skrotKryteriow, MAKS_KRYTERIOW } from '../src/lib/ogloszenieMeta.js';
import { publicMatch, publicTender } from '../src/lib/serialize.js';

/*
 * Kryteria oceny z wagami (2026-10-31). Fixture = DOSŁOWNE sekcje 4.3 sześciu ogłoszeń BZP
 * z 27–30.10.2026 (cała próbka: 1258 ogłoszeń, każde z sekcją kryteriów; 98% kryteriów
 * dostaje konkretny rodzaj, reszta to jednorazowe nazwy w stylu „Autonomia pracy PRP”).
 */
const FIX = JSON.parse(readFileSync(new URL('./fixtures/bzp-kryteria.json', import.meta.url), 'utf8'));

test('cena 60 + gwarancja 40: nazwy, wagi z przecinkiem, udział, rodzaj; jedna część', () => {
  const k = parsujKryteria(FIX['2026/BZP 00510580']);
  assert.deepEqual(k, {
    lista: [
      { nazwa: 'Cena', waga: 60, rodzaj: 'cena', udzial: 60 },
      { nazwa: 'Gwarancja i rękojmia', waga: 40, rodzaj: 'gwarancja', udzial: 40 },
    ],
    sposob: 'procentowo',
    rozne_w_czesciach: false,
    pozacenowe: true,
  });
});

test('wagi sumują się do 112: udział z sumy; organizacja = koncepcja, ISO = certyfikat', () => {
  const k = parsujKryteria(FIX['2026/BZP 00506672']);
  assert.deepEqual(k.lista.map((c) => [c.nazwa, c.waga, c.udzial, c.rodzaj]), [
    ['Cena', 60, 53.6, 'cena'],
    ['Organizacja nadzoru wykonywanych usług', 36, 32.1, 'koncepcja'],
    ['Certyfikat ISO 9001', 8, 7.1, 'certyfikat'],
    ['Certyfikat ISO 45001', 8, 7.1, 'certyfikat'],
  ]);
});

test('„Wg kolejności”, sześć części: lista z 1. części bez wagi; część 3 ma jakość → różne i pozacenowe', () => {
  const k = parsujKryteria(FIX['2026/BZP 00511392']);
  assert.equal(k.sposob, 'kolejnosc');
  assert.deepEqual(k.lista, [{ nazwa: 'Cena', waga: null, rodzaj: 'cena', udzial: null }]);
  assert.equal(k.rozne_w_czesciach, true);
  assert.equal(k.pozacenowe, true, 'część 3: cena 60 + jakość 40');
});

test('„Kryteria oceny ofert” w opisie sposobu oceny to nie druga część; encje HTML w nazwie rozkodowane', () => {
  const jedna = parsujKryteria(FIX['2026/BZP 00510587']);
  assert.deepEqual([jedna.lista.length, jedna.rozne_w_czesciach, jedna.pozacenowe], [1, false, false]);
  const k = parsujKryteria(FIX['2026/BZP 00505972']);
  assert.equal(k.lista[1].nazwa, 'Doświadczenie zawodowe Dietetyka "D"');
  assert.equal(k.lista[1].rodzaj, 'doswiadczenie');
});

test('rodzaj po nazwie: kolejność reguł rozstrzyga „termin gwarancji”, „termin płatności”, reklamacje, kary', () => {
  const przypadki = [
    ['Termin gwarancji', 'gwarancja'],
    ['Termin płatności faktury VAT – „TF”', 'platnosc'],
    ['Termin realizacji reklamacji', 'reakcja'],
    ['Czas podstawienia pojazdu zastępczego', 'reakcja'],
    ['Termin dostawy (T)', 'termin'],
    ['Skrócenie terminu realizacji dostawy', 'termin'],
    ['Wysokość upustu stałego', 'cena'],
    ['b) Cena brutto – ogłoszenia kolorowe (C2)', 'cena'],
    ['Wymiar kary (%) za niewłaściwą realizację umowy', 'umowa'],
    ['karty z możliwością wypłaty z POS', 'inne'],
    ['Klauzula społeczna (K)', 'spoleczne'],
    ['Europejski standard emisji spalin pojazdów', 'srodowisko'],
    ['Doświadczenie kierownika budowy', 'doswiadczenie'],
    ['Dodatkowe mycie okien', 'dodatkowe'],
    ['Odległość siedziby Wykonawcy od siedziby Zamawiającego', 'dostepnosc'],
    ['Parametry techniczne', 'jakosc'],
  ];
  for (const [nazwa, rodzaj] of przypadki) assert.equal(rodzajKryterium(nazwa), rodzaj, nazwa);
  // Nazwa bez treści → słownik BZP z 4.3.4.
  assert.equal(rodzajKryterium('K2', 'organizacja, kwalifikacje zawodowe i doświadczenie osób wyznaczonych do realizacji zamówienia'), 'doswiadczenie');
});

test('brak sekcji albo brak nagłówków „Kryterium N” → null; najwyżej MAKS_KRYTERIOW', () => {
  assert.equal(parsujKryteria(''), null);
  assert.equal(parsujKryteria('<h3 class="mb-0">4.3.) Kryteria oceny ofert</h3> SEKCJA V'), null);
  const duzo = '<h3 class="mb-0">4.3.) Kryteria oceny ofert</h3>' + Array.from({ length: 20 }, (_, i) =>
    `<h3 class="mb-0">Kryterium ${i + 1}</h3><h3 class="mb-0">4.3.5.) Nazwa kryterium: <span class="normal">K${i}</span></h3><h3 class="mb-0">4.3.6.) Waga: <span class="normal">5</span></h3>`).join('');
  assert.equal(parsujKryteria(duzo).lista.length, MAKS_KRYTERIOW);
});

test('kryteriaPrzetargu: bez listy → dostepne false; z listą → oczyszczona kopia', () => {
  assert.deepEqual(kryteriaPrzetargu({ kryterium_oceny: 'tylko_cena' }), { dostepne: false, powod: 'brak_listy', kryterium_oceny: 'tylko_cena' });
  const d = kryteriaPrzetargu({
    kryteria: [{ nazwa: ' Cena ', waga: 60, udzial: 60, rodzaj: 'cena' }, { nazwa: '', waga: 1 }, { nazwa: 'Okres gwarancji', waga: '40' }],
    kryteria_sposob: 'procentowo', kryteria_rozne_czesci: true, liczba_czesci: 3,
  });
  assert.equal(d.dostepne, true);
  assert.equal(d.rozne_w_czesciach, true);
  assert.equal(d.liczba_czesci, 3);
  assert.deepEqual(d.kryteria, [
    { nazwa: 'Cena', waga: 60, udzial: 60, rodzaj: 'cena' },
    { nazwa: 'Okres gwarancji', waga: null, udzial: null, rodzaj: 'gwarancja' },
  ]);
});

test('normalizeNotice: kryteria w ogłoszeniu, a „tylko cena” liczone z listy (stary odczyt mylił się tu)', async () => {
  const { normalizeNotice } = await import('../src/services/bzp.js');
  const { parsujKryterium } = await import('../src/lib/ogloszenieMeta.js');
  const html = FIX['2026/BZP 00510826'];
  assert.equal(parsujKryterium(html), 'tylko_cena', 'stary odczyt z okna 600 znaków');
  const n = normalizeNotice({ bzpNumber: '2026/BZP 00510826', orderObject: 'Odbiór odpadów', htmlBody: html });
  assert.equal(n.kryterium_oceny, 'cena_i_jakosc');
  assert.deepEqual(n.kryteria.map((k) => [k.nazwa, k.udzial, k.rodzaj]), [['Cena', 60, 'cena'], ['Czas odbioru Odpadów w sytuacjach awaryjnych', 40, 'reakcja']]);
  assert.equal(n.kryteria_sposob, 'punktowo');
  assert.equal(n.kryteria_rozne_czesci, false);
  const bez = normalizeNotice({ bzpNumber: '2026/BZP 1', orderObject: 'X', htmlBody: '<p>brak</p>' });
  assert.deepEqual([bez.kryteria, bez.kryteria_sposob, bez.kryteria_rozne_czesci], [null, null, false]);
});

test('skrotKryteriow: rodzaje zsumowane, najcięższe najpierw, reszta jako liczba; bez listy null', () => {
  assert.equal(skrotKryteriow({ kryterium_oceny: 'tylko_cena' }), null);
  const s = skrotKryteriow({
    kryteria: [
      { nazwa: 'Cena', udzial: 55, rodzaj: 'cena' },
      { nazwa: 'Parametry techniczne', udzial: 15, rodzaj: 'jakosc' },
      { nazwa: 'Jakość wykonania', udzial: 15.04, rodzaj: 'jakosc' },
      { nazwa: 'Termin dostawy', udzial: 10, rodzaj: 'termin' },
      { nazwa: 'Aspekty społeczne', udzial: 4.96, rodzaj: 'spoleczne' },
    ],
    kryteria_rozne_czesci: true,
  });
  assert.deepEqual(s, { kryteria: [{ rodzaj: 'cena', udzial: 55 }, { rodzaj: 'jakosc', udzial: 30 }, { rodzaj: 'termin', udzial: 10 }], reszta: 1, rozne_w_czesciach: true });
  // Kolejność bez wag (punktowo bez udziału): jak w ogłoszeniu.
  assert.deepEqual(skrotKryteriow({ kryteria: [{ nazwa: 'Cena', waga: null, rodzaj: 'cena' }, { nazwa: 'Gwarancja', rodzaj: 'gwarancja' }] }).kryteria,
    [{ rodzaj: 'cena', udzial: null }, { rodzaj: 'gwarancja', udzial: null }]);
});

test('API: skrót w katalogu z przetargu, w feedzie z kopii w dopasowaniu (stara kopia — null)', () => {
  const lista = [{ nazwa: 'Cena', udzial: 60, rodzaj: 'cena' }, { nazwa: 'Okres gwarancji', udzial: 40, rodzaj: 'gwarancja' }];
  assert.deepEqual(publicTender({ id: 't1', title: 'X', kryteria: lista }).kryteria_skrot.kryteria.map((k) => k.rodzaj), ['cena', 'gwarancja']);
  assert.equal(publicTender({ id: 't2', title: 'X' }).kryteria_skrot, null);
  const skrot = skrotKryteriow({ kryteria: lista });
  assert.deepEqual(publicMatch({ id: 't1', tender_id: 't1', tender_kryteria_skrot: skrot }).tender.kryteria_skrot, skrot);
  assert.equal(publicMatch({ id: 't3', tender_id: 't3' }).tender.kryteria_skrot, null);
});
