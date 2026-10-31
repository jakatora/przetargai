import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kartaKryteriow, pytaniaOKryteria, procentCenyZaPunkt, RODZAJE_KRYTERIOW } from '../src/lib/kryteriaOceny.js';
import { podpowiedziPytan, PODPOWIEDZI_PYTAN, MAKS_DLUGOSC_PYTANIA } from '../src/lib/zapytajSwz.js';

// Kształt odpowiedzi `GET /wygrywalnosc/tender/:id/kryteria` — dane jak w 2026/BZP 00510580.
const CENA_GWARANCJA = {
  dostepne: true,
  sposob: 'procentowo',
  rozne_w_czesciach: false,
  kryteria: [
    { nazwa: 'Cena', waga: 60, udzial: 60, rodzaj: 'cena' },
    { nazwa: 'Gwarancja i rękojmia', waga: 40, udzial: 40, rodzaj: 'gwarancja' },
  ],
};

test('karta: brak listy → null; cena + gwarancja → wiersze z udziałem i wskazówką', () => {
  assert.equal(kartaKryteriow(null), null);
  assert.equal(kartaKryteriow({ dostepne: false, powod: 'brak_listy' }), null);
  const k = kartaKryteriow(CENA_GWARANCJA);
  assert.equal(k.tylkoCena, false);
  assert.deepEqual(k.wiersze.map((w) => [w.nazwa, w.udzial, w.rodzaj]), [['Cena', '60%', 'cena'], ['Gwarancja i rękojmia', '40%', 'gwarancja']]);
  assert.match(k.wiersze[1].wskazowka.pl, /najdłuższą gwarancję/);
  assert.equal(k.udzialCeny, 60);
  assert.equal(k.procentZaPunkt, 1.7, '1/(60−1) = 1,69%');
});

test('punkty zamiast procentów, nieznany rodzaj → „inne”, udział z przecinkiem', () => {
  const k = kartaKryteriow({
    dostepne: true, sposob: 'punktowo', kryteria: [
      { nazwa: 'Cena', waga: 60, udzial: 53.6, rodzaj: 'cena' },
      { nazwa: 'Organizacja nadzoru', waga: 36, udzial: null, rodzaj: 'koncepcja' },
      { nazwa: 'Coś nowego', waga: 8, udzial: null, rodzaj: 'kosmos' },
    ],
  });
  assert.deepEqual(k.wiersze.map((w) => w.udzial), ['53,6%', '36 pkt', '8 pkt']);
  assert.equal(k.wiersze[2].rodzaj, 'inne');
  assert.equal(k.wiersze[2].wskazowka, RODZAJE_KRYTERIOW.inne.wskazowka);
});

test('tylko cena; cena punktu milczy przy rabacie jako drugiej cenie, przy 100% i bez udziału', () => {
  const sama = kartaKryteriow({ dostepne: true, sposob: 'procentowo', rozne_w_czesciach: true, kryteria: [{ nazwa: 'Cena', waga: 100, udzial: 100, rodzaj: 'cena' }] });
  assert.deepEqual([sama.tylkoCena, sama.procentZaPunkt, sama.rozneWCzesciach], [true, null, true]);
  assert.equal(procentCenyZaPunkt([{ rodzaj: 'cena', udzial: 60 }, { rodzaj: 'cena', udzial: 40 }]), null);
  assert.equal(procentCenyZaPunkt([{ rodzaj: 'cena', udzial: null }, { rodzaj: 'termin', udzial: null }]), null);
  assert.equal(procentCenyZaPunkt([{ rodzaj: 'cena', udzial: 80 }, { rodzaj: 'termin', udzial: 20 }]), 1.3);
});

test('wskazówki są w obu językach dla każdego rodzaju z serwera', () => {
  const rodzajeSerwera = ['cena', 'gwarancja', 'platnosc', 'umowa', 'reakcja', 'termin', 'spoleczne', 'srodowisko', 'certyfikat', 'koncepcja', 'doswiadczenie', 'dodatkowe', 'dostepnosc', 'jakosc', 'inne'];
  for (const r of rodzajeSerwera) {
    const d = RODZAJE_KRYTERIOW[r];
    assert.ok(d?.pl && d?.en && d.wskazowka?.pl && d.wskazowka?.en, r);
  }
});

test('pytania do „Zapytaj SWZ”: pozacenowe od najcięższego, nie dłuższe niż limit, i trafiają na początek podpowiedzi', () => {
  const dane = {
    dostepne: true, sposob: 'procentowo', kryteria: [
      { nazwa: 'Cena', udzial: 60, rodzaj: 'cena' },
      { nazwa: 'Termin dostawy', udzial: 10, rodzaj: 'termin' },
      { nazwa: 'x'.repeat(400), udzial: 30, rodzaj: 'jakosc' },
    ],
  };
  const p = pytaniaOKryteria(dane);
  assert.equal(p.length, 2);
  assert.match(p[0].pl, /^Jak punktowane jest kryterium „x+…”/);
  assert.match(p[1].pl, /„Termin dostawy”/);
  assert.ok(p.every((q) => q.pl.length <= MAKS_DLUGOSC_PYTANIA && q.en.length <= MAKS_DLUGOSC_PYTANIA));
  assert.deepEqual(pytaniaOKryteria({ dostepne: true, kryteria: [{ nazwa: 'Cena', udzial: 100, rodzaj: 'cena' }] }), []);

  const podp = podpowiedziPytan(p);
  assert.deepEqual(podp.slice(0, 2), p);
  assert.ok(!podp.some((q) => /kryteria oceny/i.test(q.pl)), 'ogólne pytanie o kryteria znika');
  assert.deepEqual(podpowiedziPytan([]), [...PODPOWIEDZI_PYTAN]);
});
