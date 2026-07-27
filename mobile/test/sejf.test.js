import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUSY,
  opisStatusu,
  etykietaLicznika,
  sortujDokumenty,
} from '../src/lib/sejf.js';

/*
 * Sejf dokumentów firmy — panel mobilny (podzadanie 7/7). Czysta logika „status/licznik
 * → słowo" i kolejność listy dokumentów. Bez Reacta — ekran SejfScreen i sekcja
 * dopasowania w RadarSwzScreen tylko renderują to, co tu policzone. Kolory NIE żyją tu
 * (tylko semantyczny `ton`), bo paleta jest w motyw.js i zależy od jasny/ciemny.
 *
 * Backend (`waznoscDokumentow.statusDokumentu`) zwraca status
 * 'gotowy'|'zamow_nowy'|'przeterminowany', a dla dokumentu terminowego BEZ daty
 * wystawienia — null. `dniDoWaznosci` przychodzi z JSON jako liczba albo null
 * (bezterminowy → Infinity zamienione na null; terminowy bez daty → też null).
 */

// ---------------- opisStatusu: status → etykieta + semantyczny ton ----------------

test('opisStatusu: każdy status backendu ma etykietę i ton', () => {
  assert.deepEqual(opisStatusu('gotowy'), STATUSY.gotowy);
  assert.deepEqual(opisStatusu('zamow_nowy'), STATUSY.zamow_nowy);
  assert.deepEqual(opisStatusu('przeterminowany'), STATUSY.przeterminowany);
  // Sedno kontraktu z UI: badge dostaje gotowe słowo i klasę koloru.
  assert.equal(opisStatusu('gotowy').etykieta, 'Gotowy do użycia');
  assert.equal(opisStatusu('zamow_nowy').ton, 'ostrzezenie');
  assert.equal(opisStatusu('przeterminowany').ton, 'danger');
  assert.equal(opisStatusu('gotowy').ton, 'sukces');
});

test('opisStatusu: null/nieznany → „uzupełnij datę" (ton neutralny)', () => {
  assert.deepEqual(opisStatusu(null), STATUSY.nieznany);
  assert.deepEqual(opisStatusu(undefined), STATUSY.nieznany);
  assert.deepEqual(opisStatusu('cokolwiek'), STATUSY.nieznany);
  assert.equal(opisStatusu(null).ton, 'neutral');
});

// ---------------- etykietaLicznika: formatowanie licznika dni ----------------

test('etykietaLicznika: zapas dni → „Ważny jeszcze N …" z poprawną odmianą', () => {
  assert.equal(etykietaLicznika({ status: 'gotowy', dniDoWaznosci: 30 }), 'Ważny jeszcze 30 dni');
  assert.equal(etykietaLicznika({ status: 'zamow_nowy', dniDoWaznosci: 5 }), 'Ważny jeszcze 5 dni');
  assert.equal(etykietaLicznika({ status: 'zamow_nowy', dniDoWaznosci: 1 }), 'Ważny jeszcze 1 dzień');
});

test('etykietaLicznika: ostatni dzień ważności → „dziś"', () => {
  assert.equal(etykietaLicznika({ status: 'zamow_nowy', dniDoWaznosci: 0 }), 'Traci ważność dziś');
});

test('etykietaLicznika: po terminie → „Przeterminowany N … temu"', () => {
  assert.equal(etykietaLicznika({ status: 'przeterminowany', dniDoWaznosci: -5 }), 'Przeterminowany 5 dni temu');
  assert.equal(etykietaLicznika({ status: 'przeterminowany', dniDoWaznosci: -1 }), 'Przeterminowany 1 dzień temu');
});

test('etykietaLicznika: bezterminowy (gotowy bez licznika) → „Bezterminowy"', () => {
  assert.equal(etykietaLicznika({ status: 'gotowy', dniDoWaznosci: null }), 'Bezterminowy');
});

test('etykietaLicznika: terminowy bez daty wystawienia → prośba o datę', () => {
  assert.equal(etykietaLicznika({ status: null, dniDoWaznosci: null }), 'Uzupełnij datę wystawienia');
});

// ---------------- sortujDokumenty: kolejność listy sejfu ----------------

const D = (id, status, dni, typ = 'krk') => ({
  id, status, dniDoWaznosci: dni, typ_dokumentu: typ,
});

test('sortujDokumenty: przeterminowane → zamów nowy → (bez daty) → gotowe', () => {
  const lista = [
    D('a', 'gotowy', 100),
    D('b', 'przeterminowany', -10),
    D('c', 'zamow_nowy', 5),
    D('d', null, null),
  ];
  assert.deepEqual(sortujDokumenty(lista).map((x) => x.id), ['b', 'c', 'd', 'a']);
});

test('sortujDokumenty: w obrębie statusu — najmniej dni do ważności najpierw', () => {
  const lista = [
    D('a', 'gotowy', 200),
    D('b', 'gotowy', 50),
    D('c', 'gotowy', 120),
  ];
  assert.deepEqual(sortujDokumenty(lista).map((x) => x.id), ['b', 'c', 'a']);
});

test('sortujDokumenty: przeterminowane — najdawniej wygasłe najpierw (rosnąco po dniach)', () => {
  const lista = [
    D('a', 'przeterminowany', -5),
    D('b', 'przeterminowany', -30),
  ];
  assert.deepEqual(sortujDokumenty(lista).map((x) => x.id), ['b', 'a']);
});

test('sortujDokumenty: bezterminowy (licznik null) spada na koniec grupy gotowych', () => {
  const lista = [
    D('bezterm', 'gotowy', null),
    D('dated', 'gotowy', 300),
  ];
  assert.deepEqual(sortujDokumenty(lista).map((x) => x.id), ['dated', 'bezterm']);
});

test('sortujDokumenty: przy równym statusie i liczniku — stabilnie po typie', () => {
  const lista = [
    D('a', 'gotowy', 100, 'zus'),
    D('b', 'gotowy', 100, 'krk'),
  ];
  assert.deepEqual(sortujDokumenty(lista).map((x) => x.id), ['b', 'a']); // krk < zus
});

test('sortujDokumenty: NIE mutuje wejścia', () => {
  const lista = [D('a', 'gotowy', 100), D('b', 'przeterminowany', -1)];
  const kopia = JSON.parse(JSON.stringify(lista));
  sortujDokumenty(lista);
  assert.deepEqual(lista, kopia);
});

test('sortujDokumenty: brak danych → pusta tablica', () => {
  assert.deepEqual(sortujDokumenty([]), []);
  assert.deepEqual(sortujDokumenty(undefined), []);
  assert.deepEqual(sortujDokumenty(null), []);
});
