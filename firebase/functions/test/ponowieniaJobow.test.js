import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Ponowienia jobów harmonogramu (2026-09-25).
 *
 * Komentarze w index.js obiecywały, że rzucenie wyjątku „uruchomi ponowienie" Cloud
 * Schedulera — ale żaden job nie miał `retryCount`, a domyślnie Scheduler NIE ponawia.
 * Ponowienie jest włączone wyłącznie dla jobów IDEMPOTENTNYCH (znacznik wysyłki,
 * rezerwacja etapu, checkpoint, deterministyczny klucz) — dla pozostałych powtórka
 * byłaby drugim mailem/pushem.
 *
 * W firebase-functions v2 opcja to `retryCount` na PIERWSZYM poziomie opcji
 * `onSchedule` (node_modules/firebase-functions/lib/v2/providers/scheduler.js
 * składa z niej `retryConfig`), nie zagnieżdżone `retryConfig: {...}`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8').replace(/\r\n/g, '\n');

/** Blok opcji i ciało handlera danego joba. */
function job(nazwa) {
  const start = INDEX.indexOf(`export const ${nazwa} = onSchedule(`);
  assert.ok(start >= 0, `brak joba ${nazwa} w index.js`);
  const koniec = INDEX.indexOf('\n);\n', start);
  return INDEX.slice(start, koniec);
}

const IDEMPOTENTNE = [
  'weeklyDigest', // znacznik users/{id}/meta/digest_<tydzień ISO>
  'remindDeadlines', // transakcyjna rezerwacja etapu przed wysyłką
  'bzpOknoFetch', // checkpoint dób + docId = identyfikator BZP
  'bkOknoFetch', // checkpoint ogłoszeń + docId = bk:<id>
  'monitorWyszukiwan', // alert z deterministycznym docId, checkpoint po wysyłce
  'dailyTenderFetch', // dopasowanie docId = tenderId, push tylko dla nowo utworzonych
];

for (const nazwa of IDEMPOTENTNE) {
  test(`${nazwa}: ponawiany przez Cloud Scheduler (retryCount w opcjach onSchedule)`, () => {
    const kod = job(nazwa);
    assert.match(kod, /\.\.\.PONOWIENIA_IDEMPOTENTNE/, `${nazwa} musi mieć ponowienia — inaczej obietnica z komentarza jest fałszywa`);
    assert.doesNotMatch(kod, /retryConfig\s*:/, 'retryConfig zagnieżdżony jest w v2 IGNOROWANY');
  });
}

test('stała ponowień ma poprawną składnię v2 (retryCount na pierwszym poziomie)', () => {
  const blok = INDEX.match(/const PONOWIENIA_IDEMPOTENTNE = \{([\s\S]*?)\};/);
  assert.ok(blok, 'brak stałej PONOWIENIA_IDEMPOTENTNE');
  assert.match(blok[1], /retryCount:\s*2\b/);
});

test('weeklyDigest i remindDeadlines rzucają przy ok:false (bez tego ponowienie nigdy nie ruszy)', () => {
  for (const nazwa of ['weeklyDigest', 'remindDeadlines']) {
    assert.match(job(nazwa), /if \(!wynik\.ok\)[\s\S]*throw new Error/, `${nazwa} musi zgłosić porażkę Schedulerowi`);
  }
});
