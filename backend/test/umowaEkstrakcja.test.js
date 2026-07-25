import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Util `ekstrahuj_i_normalizuj` — ekstrakcja surowego tekstu z PDF-a oraz
 * normalizacja (usunięcie zbędnych spacji/łamań, ujednolicenie). Podzadanie
 * 2/12 ulepszenia „pilnowanie waloryzacji i pułapek w umowie".
 *
 * Testy jednostkowe (bez serwera): normalizacja jest czysta i synchroniczna,
 * a ekstrakcja z PDF-a sprawdzana na PRAWDZIWYM, budowanym w locie pliku PDF
 * (nie na mocku) — dzięki czemu test faktycznie przechodzi przez pdfjs.
 */

import { budujPdf } from './helpers/buildPdf.js';

const {
  normalizujTekst,
  ekstrahujZPdf,
  ekstrahuj_i_normalizuj,
} = await import('../src/lib/umowaEkstrakcja.js');

/* ---------- normalizujTekst ---------- */

test('normalizujTekst — zwija wielokrotne spacje, taby i łamania w pojedynczą spację', () => {
  assert.equal(
    normalizujTekst('Kara   umowna\t\tza\n\n\nzwłokę'),
    'Kara umowna za zwłokę',
  );
});

test('normalizujTekst — twardą spację (NBSP) traktuje jak zwykłą', () => {
  assert.equal(normalizujTekst('art. 455 Pzp'), 'art. 455 Pzp');
});

test('normalizujTekst — scala słowo przełamane myślnikiem na końcu wiersza', () => {
  assert.equal(normalizujTekst('waloryza-\ncja wynagrodzenia'), 'waloryzacja wynagrodzenia');
});

test('normalizujTekst — zachowuje polskie znaki i wielkość liter (nie jest to stemmer)', () => {
  const out = normalizujTekst('Waloryzacja wynagrodzenia — ŻÓŁĆ, gęślą jaźń');
  assert.equal(out, 'Waloryzacja wynagrodzenia — ŻÓŁĆ, gęślą jaźń');
  assert.match(out, /Waloryzacja/); // NIE zlowercase'owane
  assert.match(out, /ŻÓŁĆ/);        // diakrytyki i wielkość liter nienaruszone
});

test('normalizujTekst — usuwa niewidoczne znaki (zero-width, BOM, miękki dywiz)', () => {
  assert.equal(normalizujTekst('﻿walory­zac​ja'), 'waloryzacja');
});

test('normalizujTekst — pusty/undefined wchodzi w pusty łańcuch', () => {
  assert.equal(normalizujTekst(''), '');
  assert.equal(normalizujTekst(undefined), '');
  assert.equal(normalizujTekst(null), '');
});

/* ---------- ekstrahujZPdf ---------- */

test('ekstrahujZPdf — wyciąga tekst z prawdziwego PDF-a', async () => {
  const b64 = budujPdf('Klauzula waloryzacyjna art. 439 ustawy Pzp');
  const surowy = await ekstrahujZPdf(b64);
  assert.match(surowy, /waloryzacyjna/);
  assert.match(surowy, /439/);
});

test('ekstrahujZPdf — uszkodzony/niepdfowy base64 zwraca pusty łańcuch (bez wyjątku)', async () => {
  // Ten sam „PDF-śmieć", którym karmiony jest endpoint w teście szkieletu 1/12.
  const out = await ekstrahujZPdf('JVBERi0xLjQKJXVkbXktcGRmLWJ5dGVz');
  assert.equal(out, '');
});

test('ekstrahujZPdf — akceptuje prefiks data-URL', async () => {
  const b64 = budujPdf('Kary umowne oraz ich limit');
  const surowy = await ekstrahujZPdf(`data:application/pdf;base64,${b64}`);
  assert.match(surowy, /Kary umowne/);
});

/* ---------- ekstrahuj_i_normalizuj (wejście endpointu) ---------- */

test('ekstrahuj_i_normalizuj — dla `tekst` zwraca znormalizowaną treść', async () => {
  const out = await ekstrahuj_i_normalizuj({ tekst: 'Umowa   na roboty\n\nbudowlane' });
  assert.equal(out, 'Umowa na roboty budowlane');
});

test('ekstrahuj_i_normalizuj — dla `pdf_base64` ekstrahuje i normalizuje', async () => {
  const out = await ekstrahuj_i_normalizuj({ pdf_base64: budujPdf('Odbiory czesciowe i podwykonawcy') });
  assert.match(out, /Odbiory czesciowe i podwykonawcy/);
});

test('ekstrahuj_i_normalizuj — `tekst` ma priorytet nad `pdf_base64`, gdy niesie treść', async () => {
  const out = await ekstrahuj_i_normalizuj({
    tekst: 'Treść z pola tekst',
    pdf_base64: budujPdf('Tekst z PDF-a'),
  });
  assert.equal(out, 'Treść z pola tekst');
});

test('ekstrahuj_i_normalizuj — brak treści => pusty łańcuch', async () => {
  assert.equal(await ekstrahuj_i_normalizuj({}), '');
  assert.equal(await ekstrahuj_i_normalizuj({ tekst: '   \n\t ' }), '');
  assert.equal(await ekstrahuj_i_normalizuj(undefined), '');
});
