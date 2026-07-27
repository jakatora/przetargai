import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analizaCertyfikatu } from '../src/lib/certyfikatWykonawcy.js';

test('analizaCertyfikatu: częsty wystawca → opłaca się, liczy oszczędność i break-even', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 20,
    godzinNaStart: 8,
    stawkaGodzinowa: 100,
    kosztCertyfikatuRocznie: 3000,
    // godzinNaStartZCertyfikatem domyślnie 20% z 8 = 1.6
  });
  assert.equal(w.kosztObecny, 16000);       // 20 × 8 × 100
  assert.equal(w.kosztZCertyfikatem, 6200); // 20 × 1.6 × 100 + 3000
  assert.equal(w.oszczednosc, 9800);
  assert.equal(w.oplacaSie, true);
  assert.equal(w.ton, 'sukces');
  assert.equal(w.progStartow, 5);           // ceil(3000 / ((8−1.6)×100))
});

test('analizaCertyfikatu: rzadki wystawca → nie opłaca się (neutral)', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 2, godzinNaStart: 8, stawkaGodzinowa: 100, kosztCertyfikatuRocznie: 3000,
  });
  assert.equal(w.oplacaSie, false);
  assert.equal(w.ton, 'neutral');
  assert.ok(w.oszczednosc < 0);
});

test('analizaCertyfikatu: pełna kontrola czasu z certyfikatem (jawny parametr)', () => {
  const w = analizaCertyfikatu({
    startowRocznie: 10, godzinNaStart: 6, stawkaGodzinowa: 80,
    kosztCertyfikatuRocznie: 1000, godzinNaStartZCertyfikatem: 1,
  });
  assert.equal(w.godzinyObecnie, 60);
  assert.equal(w.godzinyZCertyfikatem, 10);
  assert.equal(w.kosztObecny, 4800);        // 60 × 80
  assert.equal(w.kosztZCertyfikatem, 1800); // 10 × 80 + 1000
  assert.equal(w.oszczednosc, 3000);
});

test('analizaCertyfikatu: same zera nie wywalają, break-even null', () => {
  const w = analizaCertyfikatu({});
  assert.equal(w.kosztObecny, 0);
  assert.equal(w.oplacaSie, false);
  assert.equal(w.progStartow, null);
});
