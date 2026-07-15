import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUSY, normalizujStatus, podsumujStatusy, oczyscNotatke, STATUS_DOMYSLNY,
} from '../src/lib/statusPrzetargu.js';

/*
 * Warsztat przetargu (życzenie usera 2026-07-14 „dodaj rzeczy przydatne podczas
 * przetargów"): zapisany przetarg dostaje ETAP pracy (pipeline) i własną NOTATKĘ.
 * Wykonawca prowadzi kilka przetargów naraz i musi wiedzieć, gdzie każdy stoi.
 * Czysta logika — lista etapów, normalizacja, podsumowanie tablicy, czyszczenie notatki.
 */

test('STATUSY: pięć etapów w kolejności pracy, aktywne oddzielone od zakończonych', () => {
  assert.deepEqual(STATUSY.map((s) => s.wartosc),
    ['rozwazam', 'przygotowuje', 'zlozona', 'wygrana', 'przegrana']);
  // aktywne = wciąż „w grze"; zakończone = rozstrzygnięte
  assert.deepEqual(STATUSY.filter((s) => s.aktywny).map((s) => s.wartosc),
    ['rozwazam', 'przygotowuje', 'zlozona']);
  assert.ok(STATUSY.every((s) => s.etykieta && s.etykieta.length > 2), 'każdy ma etykietę PL');
});

test('STATUS_DOMYSLNY to „rozwazam"', () => {
  assert.equal(STATUS_DOMYSLNY, 'rozwazam');
});

test('normalizujStatus: znane przechodzą, śmieci wracają do domyślnego', () => {
  assert.equal(normalizujStatus('zlozona'), 'zlozona');
  assert.equal(normalizujStatus('wygrana'), 'wygrana');
  assert.equal(normalizujStatus('cokolwiek'), 'rozwazam');
  assert.equal(normalizujStatus(null), 'rozwazam');
  assert.equal(normalizujStatus(''), 'rozwazam');
});

test('podsumujStatusy: liczy po etapach + zbiorczo aktywne/zakończone', () => {
  const zapisane = [
    { status: 'rozwazam' }, { status: 'rozwazam' },
    { status: 'przygotowuje' },
    { status: 'zlozona' },
    { status: 'wygrana' },
    { status: 'przegrana' },
    { }, // brak statusu = domyślny „rozwazam"
  ];
  const p = podsumujStatusy(zapisane);
  assert.equal(p.rozwazam, 3, 'dwa jawne + jeden bez pola');
  assert.equal(p.przygotowuje, 1);
  assert.equal(p.zlozona, 1);
  assert.equal(p.wygrana, 1);
  assert.equal(p.przegrana, 1);
  assert.equal(p.aktywne, 5, 'rozwazam+przygotowuje+zlozona');
  assert.equal(p.zakonczone, 2, 'wygrana+przegrana');
  assert.equal(p.razem, 7);
});

test('podsumujStatusy: pusta lista = same zera', () => {
  const p = podsumujStatusy([]);
  assert.equal(p.razem, 0);
  assert.equal(p.aktywne, 0);
  assert.equal(p.zakonczone, 0);
});

test('oczyscNotatke: przycina białe znaki i długość, znosi puste', () => {
  assert.equal(oczyscNotatke('  zebrane: KRS, referencje  '), 'zebrane: KRS, referencje');
  assert.equal(oczyscNotatke(''), '');
  assert.equal(oczyscNotatke('   '), '');
  assert.equal(oczyscNotatke(null), '');
  assert.ok(oczyscNotatke('x'.repeat(5000)).length <= 2000, 'twardy limit długości');
});
