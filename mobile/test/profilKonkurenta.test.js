import { test } from 'node:test';
import assert from 'node:assert/strict';
import { czyMoznaOtworzycProfil, parametryProfilu, opisNajnizszejCeny, opisWygranych, etykietaRodzaju } from '../src/lib/profilKonkurenta.js';

const t = (pl) => pl;

test('profil otwiera się po NIP-ie albo nazwie; zapytanie bez URLSearchParams', () => {
  assert.equal(czyMoznaOtworzycProfil({ nip: '813-000-00-01' }), true);
  assert.equal(czyMoznaOtworzycProfil({ nazwa: 'Budmax' }), true);
  assert.equal(czyMoznaOtworzycProfil({ nazwa: 'ab', nip: '12' }), false);
  assert.equal(parametryProfilu({ nip: '813-000-00-01', nazwa: 'Budmax & Syn Sp. z o.o.' }), 'nip=8130000001&nazwa=Budmax%20%26%20Syn%20Sp.%20z%20o.o.');
  assert.equal(parametryProfilu({ nip: '12', nazwa: 'x' }), '');
});

test('opisy po polsku: odmiana „wygrane/wygranych”, najniższa cena dopiero od 3 części', () => {
  assert.deepEqual([1, 2, 5, 12, 22, 25].map((n) => opisWygranych(n, t)), ['1 wygrana', '2 wygrane', '5 wygranych', '12 wygranych', '22 wygrane', '25 wygranych']);
  assert.equal(opisNajnizszejCeny({ razy: 1, z: 2 }, t), null);
  assert.equal(opisNajnizszejCeny({ razy: 3, z: 4 }, t), 'Najniższą ceną wygrał 3 z 4 razy');
  assert.equal(etykietaRodzaju('Works', t), 'roboty budowlane');
  assert.equal(etykietaRodzaju('Inne', t), 'Inne');
});
