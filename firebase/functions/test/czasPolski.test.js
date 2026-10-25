import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dobaWarszawska, godzinaMinutaWarszawska, ciszaNocna, nastepnyPrzebieg, poczatekDobyWarszawskiej,
} from '../src/lib/czasPolski.js';

// Październik 2026 do 25.10 = czas letni, UTC+2.
test('doba warszawska przeskakuje o północy czasu polskiego, nie UTC', () => {
  assert.equal(dobaWarszawska('2026-10-23T21:59:59.000Z'), '2026-10-23');
  assert.equal(dobaWarszawska('2026-10-23T22:00:00.000Z'), '2026-10-24');
});

test('godzina warszawska', () => {
  assert.deepEqual(godzinaMinutaWarszawska('2026-10-23T10:05:00.000Z'), { h: 12, m: 5 });
});

test('cisza nocna 21:00–7:00 czasu polskiego', () => {
  assert.equal(ciszaNocna('2026-10-23T18:59:00.000Z'), false); // 20:59
  assert.equal(ciszaNocna('2026-10-23T19:00:00.000Z'), true);  // 21:00
  assert.equal(ciszaNocna('2026-10-24T04:59:00.000Z'), true);  // 6:59
  assert.equal(ciszaNocna('2026-10-24T05:00:00.000Z'), false); // 7:00
});

test('następny przebieg Free: najbliższa 12:00 czasu polskiego', () => {
  assert.equal(nastepnyPrzebieg('2026-10-23T09:00:00.000Z', 'free'), '2026-10-23T10:00:00.000Z');
  assert.equal(nastepnyPrzebieg('2026-10-23T10:05:00.000Z', 'free'), '2026-10-24T10:00:00.000Z');
});

test('następny przebieg Standard: siatka co 3 h + 12:00, ściśle po teraz', () => {
  assert.equal(nastepnyPrzebieg('2026-10-23T10:05:00.000Z', 'standard'), '2026-10-23T12:10:00.000Z'); // 12:05 → 14:10
  assert.equal(nastepnyPrzebieg('2026-10-23T10:00:00.000Z', 'standard'), '2026-10-23T12:10:00.000Z'); // dokładnie 12:00 → następny
});

test('początek doby warszawskiej w UTC', () => {
  assert.equal(poczatekDobyWarszawskiej('2026-10-23T10:00:00.000Z'), '2026-10-22T22:00:00.000Z');
});
