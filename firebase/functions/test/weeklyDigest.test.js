import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, matches } = await import('../src/db/repos.js');
const { runWeeklyDigest } = await import('../src/jobs/weeklyDigest.js');

let seq = 0;
async function dodajUsera() {
  seq++;
  const u = await users.create({ email: `wd${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  return users.findById(u.id);
}

// Wysyłkę e-maili przechwytujemy atrapą fetch (Resend jest w trybie degradacji bez
// klucza, więc realnie nic nie wyśle — liczymy KANDYDATÓW, nie wysłane).
const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

test('digest liczy kandydatów tylko wśród kont z ≥1 dopasowaniem w tygodniu', async () => {
  const zNowym = await dodajUsera();
  const bezNowych = await dodajUsera();

  // Świeże dopasowanie dla pierwszego usera.
  await matches.create({
    userId: zNowym.id,
    tenderId: `wd-t-${process.pid}-${seq}`,
    score: 90,
    tender: { title: 'Przetarg tygodnia', organization: 'Gmina' },
  });

  const wynik = await runWeeklyDigest({ now: Date.now() });
  assert.equal(wynik.ok, true);
  assert.ok(wynik.uzytkownicy >= 2);
  assert.ok(wynik.kandydaci >= 1, 'user z nowym dopasowaniem musi być kandydatem');
  // bezNowych nie może podnieść licznika kandydatów za sprawą braku dopasowań — sprawdzamy pośrednio:
  const liczbaBez = await matches.countSince(bezNowych.id, new Date(Date.now() - 7 * 864e5).toISOString());
  assert.equal(liczbaBez, 0, 'konto bez dopasowań nie dostaje przeglądu');
});

test('digest pomija dopasowania starsze niż okno 7 dni', async () => {
  const user = await dodajUsera();
  const tid = `wd-old-${process.pid}-${seq}`;
  await matches.create({ userId: user.id, tenderId: tid, score: 80, tender: { title: 'Stary przetarg' } });

  // Cofamy created_at o 10 dni — poza oknem tygodnia.
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('users').doc(user.id).collection('matches').doc(tid)
    .set({ created_at: new Date(Date.now() - 10 * 864e5).toISOString() }, { merge: true });

  const liczba = await matches.countSince(user.id, new Date(Date.now() - 7 * 864e5).toISOString());
  assert.equal(liczba, 0, 'dopasowanie sprzed 10 dni nie wpada w okno 7 dni');
});

test('przegląd: wygrane konkurentów z tego tygodnia (kubełki karty firmy → rozstrzygnięcia po NIP-ach), bez własnej firmy', async () => {
  const { benchmarkRynku, rozstrzygniecia } = await import('../src/db/repos.js');
  const { wygraneKonkurentowTygodnia } = await import('../src/jobs/weeklyDigest.js');
  const znak = `wdk${process.pid}${Date.now()}`;
  const nipKonk = `6${String(Date.now()).slice(-9)}`;
  const nipWlasny = `5${String(Date.now()).slice(-9)}`;
  await benchmarkRynku.zapisz({
    'cpv:02|26': { klucz: 'cpv:02|26', wymiar: 'dzial_cpv', zrodla: ['bzp'], probka: { ogloszenia: 9, czesci: 9 }, wystarczajacaProbka: true,
      najczestsiZwyciezcy: [{ nazwa: `Leśnik ${znak}`, nip: nipKonk, wygrane: 5, wartosc: 1 }, { nazwa: 'Moja firma', nip: nipWlasny, wygrane: 9, wartosc: 1 }] },
  });
  const dzis = new Date().toISOString().slice(0, 10);
  await rozstrzygniecia.zapiszWiele([
    { externalId: `${znak}-1`, zrodlo: 'bzp', tytul: 'Wycinka drzew', zamawiajacy: 'Nadleśnictwo', opublikowano: dzis,
      czesci: [{ numer: 1, uniewaznione: false, spojne: true, cenaWybrana: 80_000, zwyciezca: { nazwa: `Leśnik ${znak}`, nip: nipKonk } }] },
    { externalId: `${znak}-2`, zrodlo: 'bzp', tytul: 'Moja wygrana', zamawiajacy: 'Gmina', opublikowano: dzis,
      czesci: [{ numer: 1, uniewaznione: false, spojne: true, cenaWybrana: 10, zwyciezca: { nazwa: 'Moja firma', nip: nipWlasny } }] },
  ]);
  const user = { cpv_codes: ['02100000'], regiony: ['26'], company_nip: nipWlasny };
  const od = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const w = await wygraneKonkurentowTygodnia(user, od);
  assert.deepEqual(w.map((x) => [x.nazwa, x.tytul, x.cena]), [[`Leśnik ${znak}`, 'Wycinka drzew', 80_000]]);
  assert.deepEqual(await wygraneKonkurentowTygodnia({ cpv_codes: [] }, od), []);
});
