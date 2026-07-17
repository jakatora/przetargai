import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * 🚨 REGRESJA CZASU CYKLU (2026-07-17) — konsekwencja naprawy paginacji BZP.
 *
 * `dailyTenderFetch` ma TWARDY limit 540 s (funkcja zdarzeniowa 2. generacji);
 * po nim platforma ZABIJA ją w połowie pętli dopasowań.
 * Po przejściu na pobieranie dzień-po-dniu pobieranie urosło z ~21 s do ~134 s
 * (zmierzone na żywym BZP). Przy STAŁYM budżecie dopasowań 440 s dawało to
 * 134 + 440 = 574 s > 540 s → egzekucja w połowie roboty, po cichu.
 * Dlatego budżet dopasowań musi być POMNIEJSZANY o czas zużyty na pobieranie.
 */

const { pozostalyBudzetMs, BUDZET_PRZEBIEGU_MS } = await import('../src/jobs/fetchTenders.js');

const TWARDY_LIMIT_MS = 540_000; // limit platformy dla dailyTenderFetch

test('budżet całego przebiegu mieści się pod twardym limitem 540 s (z zapasem)', () => {
  assert.ok(BUDZET_PRZEBIEGU_MS < TWARDY_LIMIT_MS,
    'musi zostać zapas na zapis śladu cyklu i raport');
  assert.ok(TWARDY_LIMIT_MS - BUDZET_PRZEBIEGU_MS >= 30_000,
    'zapas < 30 s to proszenie się o egzekucję na zamknięciu');
});

test('KLUCZOWE: budżet dopasowań maleje o czas zużyty na pobieranie', () => {
  assert.equal(pozostalyBudzetMs(0), BUDZET_PRZEBIEGU_MS, 'nic nie zużyte = pełny budżet');
  assert.equal(pozostalyBudzetMs(134_000), BUDZET_PRZEBIEGU_MS - 134_000,
    'realny czas pobierania dzień-po-dniu (zmierzony) odjęty');
});

test('KLUCZOWE: pobieranie + dopasowania NIGDY nie przekraczają twardego limitu', () => {
  /*
   * Dopóki samo pobieranie mieści się w budżecie przebiegu — suma musi zostać
   * pod limitem platformy. (Przypadek, w którym samo pobieranie przekracza budżet,
   * jest nierozwiązywalny arytmetyką — patrz osobny test niżej.)
   */
  for (const zuzyte of [0, 21_000, 134_000, 300_000, 470_000]) {
    const suma = zuzyte + pozostalyBudzetMs(zuzyte);
    assert.ok(suma <= TWARDY_LIMIT_MS,
      `pobieranie ${zuzyte}ms + dopasowania ${pozostalyBudzetMs(zuzyte)}ms = ${suma}ms przekracza limit`);
  }
});

test('gdy samo pobieranie przejadło budżet — dopasowania dostają 0, nie liczbę ujemną', () => {
  /*
   * Uczciwe ograniczenie: jeśli pobieranie samo przekroczy budżet, żadna arytmetyka
   * tego nie odkręci — funkcja zginie już na pobieraniu. Jedyne, co możemy
   * zagwarantować: NIE dokładamy do tego jeszcze cyklu dopasowań.
   */
  assert.equal(pozostalyBudzetMs(600_000), 0, 'żadnych dopasowań — nie dokładamy do przekroczenia');
  assert.equal(pozostalyBudzetMs(999_999), 0, 'zero, nie liczba ujemna');
});
