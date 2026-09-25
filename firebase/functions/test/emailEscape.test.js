import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * HTML e-maili bez escape (P1, 2026-09-25).
 *
 * `company_name` podaje sam użytkownik przy rejestracji / w profilu, a szablony
 * wklejały go do HTML bez ucieczki: `welcomeEmail('<a href="https://evil.example">')`
 * renderował w skrzynce działający link z nadawcą PrzetargAI — gotowy phishing
 * wysyłany naszą zweryfikowaną domeną. Każde pole w HTML przechodzi przez `esc()`.
 */

const { welcomeEmail, subscriptionActiveEmail, resetPasswordEmail, weeklyDigestEmail } =
  await import('../src/services/email.js');
const { esc } = await import('../src/lib/html.js');

const ZLOSLIWA = '<a href="https://evil.example">Kliknij</a>\'"&';

test('esc: ucieka wszystkie znaki znaczące w HTML (także apostrof)', () => {
  assert.equal(esc(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

for (const [nazwa, szablon] of [
  ['welcomeEmail', () => welcomeEmail(ZLOSLIWA)],
  ['subscriptionActiveEmail', () => subscriptionActiveEmail(ZLOSLIWA)],
  ['weeklyDigestEmail', () => weeklyDigestEmail({ companyName: ZLOSLIWA, liczba: 2, tytuly: [ZLOSLIWA] })],
]) {
  test(`${nazwa}: nazwa firmy NIE renderuje się jako HTML`, () => {
    const { html } = szablon();
    assert.ok(!html.includes('<a href'), `${nazwa} wstrzyknął link: ${html}`);
    assert.ok(html.includes('&lt;a href=&quot;https://evil.example&quot;&gt;'), 'treść zostaje, tylko rozbrojona');
  });
}

test('resetPasswordEmail: kod w HTML też przechodzi przez escape', () => {
  const { html, text } = resetPasswordEmail('<b>kod</b>');
  assert.ok(!html.includes('<b>kod</b>'));
  assert.ok(html.includes('&lt;b&gt;kod&lt;/b&gt;'));
  assert.ok(text.includes('<b>kod</b>'), 'wersja tekstowa nie jest HTML — bez encji');
});
