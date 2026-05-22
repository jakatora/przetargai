import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore } from '../src/lib/scoring.js';

test('heuristicScore — pełne trafienie słów kluczowych daje 100', () => {
  const company = { keywords: ['remont', 'budowa'], cpv_codes: [] };
  const tender = { title: 'Remont i budowa drogi gminnej', organization: 'Gmina X' };
  const result = heuristicScore(company, tender);
  assert.equal(result.score, 100);
  assert.deepEqual(result.matchedKeywords.sort(), ['budowa', 'remont']);
});

test('heuristicScore — brak trafień daje 0', () => {
  const company = { keywords: ['catering', 'gastronomia'], cpv_codes: [] };
  const tender = { title: 'Budowa mostu', organization: 'GDDKiA' };
  assert.equal(heuristicScore(company, tender).score, 0);
});

test('heuristicScore — premia za zgodny kod CPV', () => {
  const company = { keywords: ['xyz'], cpv_codes: ['45000000'] };
  const tender = { title: 'Inny przedmiot', organization: '', cpv_main: '45233140-2' };
  const result = heuristicScore(company, tender);
  assert.equal(result.cpvMatched, true);
  assert.ok(result.score >= 30, 'premia CPV powinna podnieść wynik');
});

test('heuristicScore — niezgodny kod CPV nie daje premii', () => {
  const company = { keywords: ['xyz'], cpv_codes: ['45300000'] };
  const tender = { title: 'Inny', organization: '', cpv_main: '45233140-2' };
  assert.equal(heuristicScore(company, tender).cpvMatched, false);
});

test('heuristicScore — pusty profil daje 0', () => {
  assert.equal(heuristicScore({ keywords: [], cpv_codes: [] }, { title: 'cokolwiek' }).score, 0);
});
