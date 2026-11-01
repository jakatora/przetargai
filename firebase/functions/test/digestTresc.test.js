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

test('budujDigest: sekcja „co wygrali Twoi konkurenci” (bez niej — bez sekcji), znaki HTML bezpieczne', async () => {
  const { budujDigest } = await import('../src/lib/digestTresc.js');
  const z = budujDigest({ liczba: 2, tytuly: ['A'], konkurenci: [{ nazwa: 'Budmax <Sp. z o.o.>', tytul: 'Remont drogi', zamawiajacy: 'Gmina X', cena: 1_234_000 }] });
  assert.ok(z.text.includes('Co w tym tygodniu wygrali Twoi konkurenci:\n• Budmax <Sp. z o.o.> — Remont drogi · Gmina X · 1,23 mln zł'));
  assert.match(z.html, /<b>Budmax &lt;Sp\. z o\.o\.&gt;<\/b>/);
  const bez = budujDigest({ liczba: 2, tytuly: ['A'] });
  assert.ok(!/konkurenci/.test(bez.text));
});

test('budujDigest: sekcja wygasających umów (do 3) w tekście i HTML, z ucieczką znaków', () => {
  const umowy = [
    { tytul: 'Ochrona <obiektów>', zamawiajacy: 'Szpital Wojewódzki', koniec: '2026-12-31', wartosc: 480000 },
    { tytul: 'Sprzątanie', zamawiajacy: 'Gmina', koniec: '2027-01-15', wartosc: null },
    { tytul: 'Paliwo', zamawiajacy: 'Powiat', koniec: '2027-02-01' },
    { tytul: 'Czwarta', zamawiajacy: 'X', koniec: '2027-03-01' },
  ];
  const d = budujDigest({ liczba: 2, tytuly: [], umowy });
  assert.match(d.text, /wkrótce się kończą — ten przetarg zaraz wróci:\n• Ochrona <obiektów> — Szpital Wojewódzki · koniec 31\.12\.2026 · 480 tys\. zł/);
  assert.ok(!d.text.includes('Czwarta'));
  assert.match(d.html, /<b>Ochrona &lt;obiektów&gt;<\/b>/);
  assert.ok(!budujDigest({ liczba: 1 }).text.includes('wkrótce się kończą'));
});

test('budujDigest: umowa z już ogłoszonym następcą — „nowy przetarg już ogłoszony, oferty do …” (czas warszawski)', () => {
  const umowy = [
    { tytul: 'Ochrona obiektów', zamawiajacy: 'Szpital', koniec: '2026-12-31', wartosc: 480000, nastepca: { deadline: '2026-11-12T23:00:00.000Z', pewny: true } },
    { tytul: 'Sprzątanie', zamawiajacy: 'Gmina', koniec: '2027-01-15', nastepca: { deadline: '2026-11-20T09:00:00.000Z', pewny: false } },
    { tytul: 'Paliwo', zamawiajacy: 'Powiat', koniec: '2027-02-01', nastepca: null },
  ];
  const d = budujDigest({ liczba: 2, tytuly: [], umowy });
  assert.match(d.text, /wkrótce się kończą — część przetargów już ogłoszono:\n• Ochrona obiektów — Szpital · koniec 31\.12\.2026 · 480 tys\. zł · nowy przetarg już ogłoszony, oferty do 13\.11\.2026\n/);
  assert.match(d.text, /• Sprzątanie — Gmina · koniec 15\.01\.2027 · podobny przetarg już ogłoszony, oferty do 20\.11\.2026/);
  assert.match(d.text, /• Paliwo — Powiat · koniec 01\.02\.2027$/m);
  assert.match(d.html, /część przetargów już ogłoszono/);
});
