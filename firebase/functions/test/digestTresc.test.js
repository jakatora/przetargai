import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budujDigest, odmienPrzetargi } from '../src/lib/digestTresc.js';

test('odmiana: 1/2-4/5+ przetarg(i/ów) z wyjątkiem 12-14', () => {
  assert.equal(odmienPrzetargi(1), 'przetarg');
  assert.equal(odmienPrzetargi(2), 'przetargi');
  assert.equal(odmienPrzetargi(4), 'przetargi');
  assert.equal(odmienPrzetargi(5), 'przetargów');
  assert.equal(odmienPrzetargi(12), 'przetargów');
  assert.equal(odmienPrzetargi(22), 'przetargi');
  assert.equal(odmienPrzetargi(0), 'przetargów');
});

test('budujDigest: temat i treść zawierają liczbę i firmę', () => {
  const d = budujDigest({ companyName: 'ACME Sp. z o.o.', liczba: 3, tytuly: ['Budowa drogi', 'Dostawa sprzętu'] });
  assert.match(d.subject, /3 przetargi/);
  assert.match(d.html, /ACME/);
  assert.match(d.text, /Budowa drogi/);
  assert.match(d.html, /<li>Budowa drogi<\/li>/);
});

test('budujDigest: bez tytułów pomija sekcję przykładów', () => {
  const d = budujDigest({ liczba: 1, tytuly: [] });
  assert.match(d.subject, /1 przetarg$/);
  assert.doesNotMatch(d.html, /Na przykład/);
});

test('budujDigest: tytuły z HTML są zescape\'owane (dane z rejestrów)', () => {
  const d = budujDigest({ liczba: 1, tytuly: ['<script>alert(1)</script> & "cudzysłów"'] });
  assert.doesNotMatch(d.html, /<script>/);
  assert.match(d.html, /&lt;script&gt;/);
  assert.match(d.html, /&amp;/);
});

test('budujDigest: max 5 tytułów', () => {
  const d = budujDigest({ liczba: 9, tytuly: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  const wystapienia = (d.html.match(/<li>/g) || []).length;
  assert.equal(wystapienia, 5);
});
