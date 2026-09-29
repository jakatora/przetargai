import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Harmonogram `remindDeadlines` uruchamia DWA niezależne przebiegi: przypomnienia
 * o terminie składania i o terminie pytań do SWZ (review 2026-09-29). Wyjątek
 * jednego nie może zablokować drugiego, a porażka któregokolwiek musi dotrzeć do
 * Schedulera (ok:false → handler rzuca → ponowienie).
 */

const { uruchomPrzypomnienia } = await import('../src/jobs/harmonogramPrzypomnien.js');

const ok = (bledy = 0) => async () => ({ ok: bledy === 0, bledy, sent: 1 });
const rzuca = (komunikat) => async () => { throw new Error(komunikat); };

function zLicznikiem(fn) {
  const licznik = { wywolania: 0 };
  return [async () => { licznik.wywolania += 1; return fn(); }, licznik];
}

test('oba przebiegi OK → ok:true, oba uruchomione', async () => {
  const [terminy, lt] = zLicznikiem(ok());
  const [pytania, lp] = zLicznikiem(ok());
  const wynik = await uruchomPrzypomnienia({ terminy, pytania });
  assert.equal(wynik.ok, true);
  assert.equal(wynik.bledy, 0);
  assert.deepEqual([lt.wywolania, lp.wywolania], [1, 1]);
});

test('pierwszy rzuca → drugi i tak się uruchamia, wynik ok:false z przyczyną', async () => {
  const [pytania, lp] = zLicznikiem(ok());
  const wynik = await uruchomPrzypomnienia({ terminy: rzuca('Firestore niedostępny'), pytania });
  assert.equal(lp.wywolania, 1);
  assert.equal(wynik.ok, false);
  assert.equal(wynik.pytania.ok, true);
  assert.match(wynik.terminy.blad, /Firestore niedostępny/);
  assert.ok(wynik.bledy >= 1);
});

test('drugi rzuca → pierwszy wykonany, wynik ok:false z przyczyną', async () => {
  const [terminy, lt] = zLicznikiem(ok());
  const wynik = await uruchomPrzypomnienia({ terminy, pytania: rzuca('brak indeksu') });
  assert.equal(lt.wywolania, 1);
  assert.equal(wynik.ok, false);
  assert.equal(wynik.terminy.ok, true);
  assert.match(wynik.pytania.blad, /brak indeksu/);
});

test('oba FAIL (wyjątek + ok:false z błędami wpisów) → ok:false, błędy zsumowane', async () => {
  const wynik = await uruchomPrzypomnienia({ terminy: ok(2), pytania: rzuca('awaria') });
  assert.equal(wynik.ok, false);
  assert.equal(wynik.bledy, 3, '2 wpisy + 1 przebieg, który rzucił');
});
