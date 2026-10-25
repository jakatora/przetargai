import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porownajWersje, decyzjaAktualizacji, wersjaZOdpowiedzi, KLUCZ_ODLOZONEJ_AKTUALIZACJI } from '../src/lib/aktualizacja.js';
import { pobierzNajnowszaWersje } from '../src/services/aktualizacja.js';
import { KLUCZE_URZADZENIA } from '../src/lib/daneLokalne.js';

test('porownajWersje: człony liczbowe, brakujące = 0, śmieci = 0', () => {
  assert.equal(porownajWersje('1.1.7', '1.1.6'), 1);
  assert.equal(porownajWersje('1.1.6', '1.1.7'), -1);
  assert.equal(porownajWersje('1.2', '1.1.9'), 1);
  assert.equal(porownajWersje('1.1.7', '1.1.7.0'), 0);
  assert.equal(porownajWersje('1.10.0', '1.9.9'), 1);
  assert.equal(porownajWersje('x', '0.0.0'), 0);
});

test('decyzja: nowa wersja na web i Androidzie → baner z właściwą drogą; iOS i stara/równa/odłożona → nic', () => {
  const web = decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '1.1.7', platforma: 'web' });
  assert.equal(web.pokaz, true);
  assert.match(web.komunikat.pl, /1\.1\.7 \(masz 1\.1\.6\).*pobrać ze strony/);
  assert.match(web.komunikat.en, /download from the website/);
  assert.equal(web.url, 'https://przetarg-ai.pl/pobierz');
  const android = decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '1.1.7', platforma: 'android' });
  assert.match(android.komunikat.pl, /Google Play albo pobierz APK/);
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '1.1.7', platforma: 'ios' }).pokaz, false);
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.7', najnowsza: '1.1.7', platforma: 'web' }).pokaz, false);
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.8', najnowsza: '1.1.7', platforma: 'web' }).pokaz, false);
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '1.1.7', platforma: 'web', odlozona: '1.1.7' }).pokaz, false, 'odłożona ta sama wersja');
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '1.1.8', platforma: 'web', odlozona: '1.1.7' }).pokaz, true, 'odłożenie dotyczy tylko tej wersji');
  assert.equal(decyzjaAktualizacji({ biezaca: '—', najnowsza: '1.1.7', platforma: 'web' }).pokaz, false, 'nieznana bieżąca → nic');
  assert.equal(decyzjaAktualizacji({ biezaca: '1.1.6', najnowsza: '<html>', platforma: 'web' }).pokaz, false);
  assert.equal(decyzjaAktualizacji({}).pokaz, false);
});

test('wersjaZOdpowiedzi + pobierzNajnowszaWersje: poprawny JSON → wersja; 404/śmieci/wyjątek → null', async () => {
  assert.equal(wersjaZOdpowiedzi({ wersja: '1.1.7' }), '1.1.7');
  assert.equal(wersjaZOdpowiedzi({ wersja: 'nowa' }), null);
  assert.equal(wersjaZOdpowiedzi(null), null);
  const ok = async () => ({ ok: true, json: async () => ({ wersja: '1.1.9' }) });
  assert.equal(await pobierzNajnowszaWersje({ fetchFn: ok }), '1.1.9');
  assert.equal(await pobierzNajnowszaWersje({ fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }) }), null);
  assert.equal(await pobierzNajnowszaWersje({ fetchFn: async () => { throw new Error('sieć'); } }), null);
  let adres = null;
  await pobierzNajnowszaWersje({ fetchFn: async (u) => { adres = u; return { ok: true, json: async () => ({ wersja: '1.1.7' }) }; }, teraz: 120_000 });
  assert.equal(adres, 'https://przetarg-ai.pl/wersja.json?t=2', 'znacznik czasu omija cache');
});

test('klucz odłożonej aktualizacji jest preferencją urządzenia (zostaje po wylogowaniu)', () => {
  assert.ok(KLUCZE_URZADZENIA.includes(KLUCZ_ODLOZONEJ_AKTUALIZACJI));
});
