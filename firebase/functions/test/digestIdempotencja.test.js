import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Idempotencja cotygodniowego przeglądu (P2, 2026-09-25).
 *
 * Cloud Scheduler potrafi odpalić job dwa razy, a ponowienie (retryCount w index.js)
 * uruchamia go jeszcze raz po błędzie. Bez znacznika „wysłano w tym tygodniu"
 * każde z nich to drugi e-mail do każdego użytkownika.
 *
 * Resend jest „skonfigurowany" kluczem-atrapą, a fetch przechwycony — nic nie wychodzi
 * do sieci, a my liczymy wysyłki per adres.
 */

process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = 're_test_atrapa_bez_sieci';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches } = await import('../src/db/repos.js');
const { runWeeklyDigest, kluczTygodniaIso } = await import('../src/jobs/weeklyDigest.js');

const oryginalnyFetch = globalThis.fetch;
let wyslane;
let awarie;
let proby;
let odrzucaAdres;
let odrzucaNadawce;
beforeEach(() => {
  wyslane = new Map(); awarie = new Set(); proby = new Map(); odrzucaAdres = new Set(); odrzucaNadawce = new Set();
});
// Prawdziwe ciało odpowiedzi Resend 422 z produkcji (2026-09-28, adres @example.com).
const odpowiedz422 = (pole) => new Response(JSON.stringify({
  statusCode: 422,
  name: 'validation_error',
  message: `Invalid \`${pole}\` field. Please use our testing email address instead of domains like \`example.com\`. See our documentation for more information.`,
}), { status: 422, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.resend.com')) {
    throw new Error(`Nieoczekiwane wyjście do sieci w teście: ${url}`);
  }
  const cialo = JSON.parse(opts.body);
  const do_ = [].concat(cialo.to)[0];
  proby.set(do_, (proby.get(do_) ?? 0) + 1);
  if (odrzucaAdres.has(do_)) return odpowiedz422('to');
  if (odrzucaNadawce.has(do_)) return odpowiedz422('from');
  if (awarie.has(do_)) {
    return new Response(JSON.stringify({ name: 'application_error', message: 'awaria atrapy' }), { status: 500 });
  }
  wyslane.set(do_, (wyslane.get(do_) ?? 0) + 1);
  return new Response(JSON.stringify({ id: `em_${do_}` }), { status: 200, headers: { 'content-type': 'application/json' } });
};
after(() => { globalThis.fetch = oryginalnyFetch; });

let seq = 0;
async function userZDopasowaniem() {
  seq++;
  const u = await users.create({ email: `di${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  await matches.create({
    userId: u.id, tenderId: `di-t-${process.pid}-${seq}`, score: 90,
    tender: { title: 'Przetarg tygodnia', organization: 'Gmina' },
  });
  return users.findById(u.id);
}

test('kluczTygodniaIso: tydzień ISO 8601 (także na przełomie roku)', () => {
  assert.equal(kluczTygodniaIso(Date.UTC(2026, 8, 21, 6)), '2026-W39'); // poniedziałek
  assert.equal(kluczTygodniaIso(Date.UTC(2026, 8, 27, 23)), '2026-W39'); // niedziela tego tygodnia
  assert.equal(kluczTygodniaIso(Date.UTC(2026, 8, 28, 0)), '2026-W40');
  assert.equal(kluczTygodniaIso(Date.UTC(2027, 0, 1)), '2026-W53'); // piątek → ostatni tydzień 2026
  assert.equal(kluczTygodniaIso(Date.UTC(2021, 0, 3)), '2020-W53'); // niedziela → tydzień 2020
});

test('dwa przebiegi w tym samym tygodniu → JEDEN e-mail na użytkownika', async () => {
  const user = await userZDopasowaniem();
  const teraz = Date.now();

  const pierwszy = await runWeeklyDigest({ now: teraz });
  const drugi = await runWeeklyDigest({ now: teraz + 60_000 });

  assert.equal(wyslane.get(user.email), 1, 'podwójne odpalenie Schedulera nie może wysłać drugiego maila');
  assert.equal(pierwszy.ok, true);
  assert.ok(drugi.juzWyslane >= 1, 'drugi przebieg raportuje pominięte jako już wysłane');
});

test('nieudana wysyłka zwalnia znacznik: ponowienie dosyła brakujący, bez dubla u pozostałych', async () => {
  const pechowy = await userZDopasowaniem();
  const szczesliwy = await userZDopasowaniem();
  awarie.add(pechowy.email);
  const teraz = Date.now();

  const pierwszy = await runWeeklyDigest({ now: teraz });
  assert.equal(pierwszy.ok, false, 'błąd wysyłki → job zgłasza porażkę, żeby Cloud Scheduler go ponowił');
  assert.ok(pierwszy.bledy >= 1);
  assert.equal(wyslane.get(pechowy.email) ?? 0, 0);
  assert.equal(wyslane.get(szczesliwy.email), 1);

  awarie.clear();
  await runWeeklyDigest({ now: teraz + 60_000 });
  assert.equal(wyslane.get(pechowy.email), 1, 'ponowienie MUSI dosłać przegląd, którego nie udało się wysłać');
  assert.equal(wyslane.get(szczesliwy.email), 1, 'ponowienie NIE MOŻE wysłać drugi raz tym, którzy już dostali');
});

/*
 * 2026-09-28 na produkcji: jedno konto testowe z adresem @example.com (Resend 422
 * „Invalid `to` field") oznaczało CAŁY przebieg jako nieudany, a Scheduler ponawiał
 * go trzy razy — za każdym razem z tym samym, nie do naprawienia odrzuceniem.
 */
test('adres odrzucony przez Resend (422 `to`) → przebieg OK i bez ponawiania tego adresu', async () => {
  const odrzucony = await userZDopasowaniem();
  const zwykly = await userZDopasowaniem();
  odrzucaAdres.add(odrzucony.email);
  const teraz = Date.now();

  const pierwszy = await runWeeklyDigest({ now: teraz });
  assert.equal(pierwszy.ok, true, 'odrzucony adres to nie awaria — Scheduler nie ma czego ponawiać');
  assert.equal(pierwszy.bledy, 0);
  assert.ok(pierwszy.odrzucone >= 1, 'odrzucony adres jest policzony osobno');
  assert.equal(wyslane.get(zwykly.email), 1);

  await runWeeklyDigest({ now: teraz + 60_000 });
  assert.equal(proby.get(odrzucony.email), 1, 'ten sam tydzień: odrzuconego adresu nie próbujemy drugi raz');
});

test('odrzucony NADAWCA (422 `from`) to błąd konfiguracji → przebieg nieudany i do ponowienia', async () => {
  const user = await userZDopasowaniem();
  odrzucaNadawce.add(user.email);
  const teraz = Date.now();

  const pierwszy = await runWeeklyDigest({ now: teraz });
  assert.equal(pierwszy.ok, false, 'zły nadawca dotyczy wszystkich — musi być widoczną awarią');
  assert.ok(pierwszy.bledy >= 1);

  odrzucaNadawce.clear();
  await runWeeklyDigest({ now: teraz + 60_000 });
  assert.equal(wyslane.get(user.email), 1, 'po naprawie konfiguracji ponowienie dosyła przegląd');
});

test('równoległe przebiegi (dwa wyzwolenia naraz) → nadal jeden e-mail', async () => {
  const user = await userZDopasowaniem();
  const teraz = Date.now();
  await Promise.all([runWeeklyDigest({ now: teraz }), runWeeklyDigest({ now: teraz })]);
  assert.equal(wyslane.get(user.email), 1);
});
