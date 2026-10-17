import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * CICHA AWARIA AI — dlaczego ten plik istnieje.
 *
 * Od 2026-10-12 KAŻDE wywołanie AI w `dailyTenderFetch` (~100 dziennie) kończyło
 * się 400 „credit balance is too low". `scoreTenderMatch` łapał błąd i zwracał
 * null, matching degradował do heurystyki, a `/health` przez 6 dni pokazywał
 * `status: ok`. Nikt się nie dowiedział, bo żaden sygnał nie liczył porażek.
 *
 * Tu testujemy czystą logikę: rozpoznanie rodzaju błędu, licznik przebiegu
 * i decyzję „AI działa / nie działa". Okablowanie z cronem i /health: awariaAi.test.js.
 */

const {
  klasyfikujBladAi, pustyLicznikAi, zbierajStatystykiAi, zglosSukcesAi,
  zglosNiepowodzenieAi, ocenStanAi, bladKrytycznyAi,
} = await import('../src/lib/stanAi.js');

/** Błąd w kształcie, jaki rzuca SDK Anthropica (APIError: status, type, error = ciało odpowiedzi). */
function bladApi(status, typ, komunikat) {
  const cialo = { type: 'error', error: { type: typ, message: komunikat }, request_id: 'req_test' };
  const err = new Error(`${status} ${JSON.stringify(cialo)}`);
  err.status = status;
  err.type = typ;
  err.error = cialo;
  return err;
}

// ---------------- klasyfikacja błędu ----------------

test('KRYTYCZNE: 400 „credit balance is too low" to brak KREDYTÓW, nie zwykły zły request', () => {
  // Dokładnie ten błąd zabił oceny AI 2026-10-12 — status 400, typ invalid_request_error.
  const blad = klasyfikujBladAi(bladApi(400, 'invalid_request_error',
    'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'));
  assert.equal(blad.typ, 'kredyty');
  assert.equal(blad.status, 400);
  assert.match(blad.komunikat, /credit balance is too low/);
  assert.doesNotMatch(blad.komunikat, /request_id/, 'komunikat ma być czytelny dla człowieka, bez surowego JSON-a');
});

test('402 billing_error to też kredyty', () => {
  assert.equal(klasyfikujBladAi(bladApi(402, 'billing_error', 'Billing issue')).typ, 'kredyty');
});

test('401 i 403 to autoryzacja (zły albo odwołany klucz)', () => {
  assert.equal(klasyfikujBladAi(bladApi(401, 'authentication_error', 'invalid x-api-key')).typ, 'autoryzacja');
  assert.equal(klasyfikujBladAi(bladApi(403, 'permission_error', 'no access')).typ, 'autoryzacja');
});

test('429 to limit, 529 przeciążenie, 5xx serwer, inny 4xx zły request', () => {
  assert.equal(klasyfikujBladAi(bladApi(429, 'rate_limit_error', 'slow down')).typ, 'limit');
  assert.equal(klasyfikujBladAi(bladApi(529, 'overloaded_error', 'Overloaded')).typ, 'przeciazenie');
  assert.equal(klasyfikujBladAi(bladApi(500, 'api_error', 'boom')).typ, 'serwer');
  assert.equal(klasyfikujBladAi(bladApi(404, 'not_found_error', 'model: claude-x')).typ, 'zadanie');
  assert.equal(klasyfikujBladAi(bladApi(400, 'invalid_request_error', 'max_tokens too large')).typ, 'zadanie');
});

test('błędy bez statusu: timeout, sieć, reszta', () => {
  assert.equal(klasyfikujBladAi(new Error('Request timed out.')).typ, 'timeout');
  assert.equal(klasyfikujBladAi(new Error('Connection error.')).typ, 'siec');
  assert.equal(klasyfikujBladAi(new Error('ECONNRESET')).typ, 'siec');
  assert.equal(klasyfikujBladAi(new TypeError('cannot read properties of undefined')).typ, 'inny');
  assert.equal(klasyfikujBladAi(undefined).typ, 'inny');
});

test('komunikat jest przycinany — trafia do dokumentu Firestore i do maila', () => {
  const blad = klasyfikujBladAi(new Error('x'.repeat(5000)));
  assert.ok(blad.komunikat.length <= 300);
});

// ---------------- licznik przebiegu ----------------

test('licznik zbiera sukcesy i porażki TYLKO wewnątrz przebiegu', async () => {
  const licznik = pustyLicznikAi();
  zglosSukcesAi(); // poza przebiegiem (np. wyjaśnienie z API) — nie może trafić do licznika crona

  await zbierajStatystykiAi(licznik, async () => {
    zglosSukcesAi();
    zglosNiepowodzenieAi({ typ: 'kredyty', status: 400, komunikat: 'credit balance is too low' });
    zglosNiepowodzenieAi({ typ: 'timeout', status: null, komunikat: 'Request timed out.' });
  });

  assert.equal(licznik.udane, 1);
  assert.equal(licznik.nieudane, 2);
  assert.deepEqual(licznik.bledy_wg_typu, { kredyty: 1, timeout: 1 });
  assert.equal(licznik.ostatni_blad.typ, 'timeout', 'ostatni błąd = ostatnio zgłoszony');
  assert.ok(licznik.ostatni_blad.o, 'błąd musi mieć znacznik czasu');
  assert.ok(licznik.ostatni_sukces_o);
});

test('licznik przeżywa równoległe porcje użytkowników (Promise.all) i nie miesza przebiegów', async () => {
  const a = pustyLicznikAi();
  const b = pustyLicznikAi();
  const porcja = (n) => Promise.all(Array.from({ length: n }, async () => {
    await new Promise((r) => setTimeout(r, 1));
    zglosNiepowodzenieAi({ typ: 'kredyty', status: 400, komunikat: 'x' });
  }));

  await Promise.all([zbierajStatystykiAi(a, () => porcja(5)), zbierajStatystykiAi(b, () => porcja(2))]);
  assert.equal(a.nieudane, 5);
  assert.equal(b.nieudane, 2);
});

test('wyjątek w przebiegu nie kasuje zebranych liczb (wołający trzyma licznik)', async () => {
  const licznik = pustyLicznikAi();
  await assert.rejects(zbierajStatystykiAi(licznik, async () => {
    zglosNiepowodzenieAi({ typ: 'serwer', status: 500, komunikat: 'boom' });
    throw new Error('cykl dopasowań padł');
  }));
  assert.equal(licznik.nieudane, 1);
});

// ---------------- decyzja: czy AI działa ----------------

test('ocenStanAi: brak wywołań = brak podstaw do oceny (null), nie alarm', () => {
  assert.equal(ocenStanAi(undefined), null);
  assert.equal(ocenStanAi(pustyLicznikAi()), null);
});

test('KRYTYCZNE ocenStanAi: większość porażek = AI NIE działa', () => {
  assert.equal(ocenStanAi({ udane: 0, nieudane: 97, bledy_wg_typu: { kredyty: 97 } }), false);
  assert.equal(ocenStanAi({ udane: 10, nieudane: 40, bledy_wg_typu: { timeout: 40 } }), false);
});

test('ocenStanAi: pojedyncze porażki przy przewadze sukcesów to wciąż działające AI', () => {
  assert.equal(ocenStanAi({ udane: 90, nieudane: 7, bledy_wg_typu: { timeout: 7 } }), true);
  assert.equal(ocenStanAi({ udane: 5, nieudane: 5, bledy_wg_typu: { limit: 5 } }), true);
});

test('ocenStanAi: jeden przypadkowy timeout przy jednym wywołaniu nie zapala alarmu na dobę', () => {
  assert.equal(ocenStanAi({ udane: 0, nieudane: 1, bledy_wg_typu: { timeout: 1 } }), true);
  assert.equal(ocenStanAi({ udane: 0, nieudane: 3, bledy_wg_typu: { timeout: 3 } }), false);
});

test('ocenStanAi: brak kredytów albo autoryzacji alarmuje od PIERWSZEGO wywołania — samo nie przejdzie', () => {
  assert.equal(ocenStanAi({ udane: 0, nieudane: 1, bledy_wg_typu: { kredyty: 1 } }), false);
  assert.equal(ocenStanAi({ udane: 0, nieudane: 1, bledy_wg_typu: { autoryzacja: 1 } }), false);
});

test('bladKrytycznyAi: tylko kredyty i autoryzacja wymagają człowieka (mail)', () => {
  assert.equal(bladKrytycznyAi({ bledy_wg_typu: { kredyty: 3 } }), 'kredyty');
  assert.equal(bladKrytycznyAi({ bledy_wg_typu: { timeout: 2, autoryzacja: 1 } }), 'autoryzacja');
  assert.equal(bladKrytycznyAi({ bledy_wg_typu: { limit: 50, serwer: 10, budzet: 5 } }), null,
    'limit/serwer mijają same, a budżet ma własny alarm w Error Reporting');
  assert.equal(bladKrytycznyAi(undefined), null);
});
