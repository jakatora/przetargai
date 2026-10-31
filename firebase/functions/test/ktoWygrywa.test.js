import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ktoWygrywa, MIN_CZESCI_Z_UMOWA, czystaNazwaWykonawcy, normNazwa } from '../src/lib/ktoWygrywa.js';

/*
 * „Kto tu wygrywa” (2026-10-31): zwycięzcy zamawiającego po NIP-ie, kwoty tylko ze spójnych części,
 * bez listy zwycięzców z za małej próbki.
 */
const czesc = (zwyciezca, { cena = 100_000, spojne = true, oferty = 3, maly = true, uniewaznione = false } = {}) => (
  uniewaznione ? { uniewaznione: true } : { zwyciezca, cenaWybrana: cena, spojne, liczbaOfert: oferty, wygralMaly: maly, uniewaznione: false }
);
const A = { nazwa: 'Budmax Sp. z o.o.', nip: '1234567890' };
const A2 = { nazwa: 'BUDMAX SPÓŁKA Z O.O.', nip: '123-456-78-90' };
const B = { nazwa: 'Kowalski Usługi', nip: null };

test('zwycięzcy po NIP-ie (różna pisownia i format NIP to jedna firma), kwoty tylko spójne, sortowanie po liczbie wygranych', () => {
  const w = ktoWygrywa([
    { tytul: 'Remont dachu', opublikowano: '2026-10-01', zrodlo: 'bzp', czesci: [czesc(A, { cena: 200_000 })] },
    { tytul: 'Remont elewacji', opublikowano: '2026-10-20', zrodlo: 'bzp', czesci: [czesc(A2, { cena: 300_000 }), czesc(B, { cena: 50_000, spojne: false, maly: true })] },
    { tytul: 'Drogi', opublikowano: '2026-09-15', zrodlo: 'ted', czesci: [czesc(B, { cena: 80_000 }), czesc(null, { uniewaznione: true })] },
  ]);
  assert.equal(w.wystarczajaca, true);
  assert.deepEqual(w.probka, { ogloszenia: 3, czesci_z_umowa: 4, uniewaznione: 1, od: '2026-09-15', do: '2026-10-20' });
  assert.deepEqual(w.zwyciezcy.map((z) => [z.nazwa, z.wygrane, z.wartosc]), [['BUDMAX SPÓŁKA Z O.O.', 2, 500_000], ['Kowalski Usługi', 2, 80_000]]);
  assert.equal(w.zwyciezcy[0].ostatnio, '2026-10-20', 'nazwa i data z ostatniej wygranej');
  assert.deepEqual(w.zrodla, ['bzp', 'ted']);
  assert.deepEqual(w.ostatnie.map((o) => o.tytul), ['Remont elewacji', 'Remont dachu', 'Drogi'], 'od najnowszego');
  assert.equal(w.ostatnie[0].cena, 300_000);
});

test('dane z produkcji 31.10: adres w nazwie ucięty; ta sama firma z NIP-em i bez NIP-u to jedna grupa', () => {
  assert.equal(czystaNazwaWykonawcy('MICRONE Sp. z o.o. pl. Strzelecki 20 50-224 Wrocław'), 'MICRONE Sp. z o.o.');
  assert.equal(czystaNazwaWykonawcy('Budmax, ul. Polna 3, 35-001 Rzeszów'), 'Budmax');
  assert.equal(czystaNazwaWykonawcy('PIXEL Centrum Komputerowe Tomasz Dziedzic'), 'PIXEL Centrum Komputerowe Tomasz Dziedzic');
  assert.equal(normNazwa('ZRD ORFIN SPÓŁKA KOMANDYTOWA'), normNazwa('ZRD Orfin Sp. k.'));
  const orfinZNip = { nazwa: 'ZRD ORFIN SPÓŁKA KOMANDYTOWA', nip: '6340000000' };
  const orfinBez = { nazwa: 'ZRD ORFIN SPÓŁKA KOMANDYTOWA', nip: null };
  const w = ktoWygrywa([
    { tytul: 'A', opublikowano: '2026-10-01', czesci: [czesc(orfinZNip, { cena: 100 }), czesc(orfinBez, { cena: 200 })] },
    { tytul: 'B', opublikowano: '2026-10-02', czesci: [czesc(orfinBez, { cena: 300 }), czesc({ nazwa: 'MICRONE Sp. z o.o. pl. Strzelecki 20 50-224 Wrocław', nip: '8990000000' })] },
  ]);
  assert.deepEqual(w.zwyciezcy.map((z) => [z.nazwa, z.wygrane, z.nip]), [['ZRD ORFIN SPÓŁKA KOMANDYTOWA', 3, '6340000000'], ['MICRONE Sp. z o.o.', 1, '8990000000']]);
  assert.equal(w.ostatnie[0].zwyciezca, 'ZRD ORFIN SPÓŁKA KOMANDYTOWA');
});

test('za mała próbka: brak listy zwycięzców, ale ostatnie rozstrzygnięcia są; całkiem unieważnione oznaczone', () => {
  const w = ktoWygrywa([
    { tytul: 'X', opublikowano: '2026-10-02', czesci: [czesc(A)] },
    { tytul: 'Y', opublikowano: '2026-10-03', czesci: [czesc(null, { uniewaznione: true })] },
  ]);
  assert.ok(MIN_CZESCI_Z_UMOWA > 1);
  assert.equal(w.wystarczajaca, false);
  assert.deepEqual(w.zwyciezcy, []);
  assert.equal(w.ostatnie.length, 2);
  assert.deepEqual([w.ostatnie[0].tytul, w.ostatnie[0].uniewaznione, w.ostatnie[0].zwyciezca], ['Y', true, null]);
  assert.deepEqual(ktoWygrywa(null).probka.ogloszenia, 0);
});
