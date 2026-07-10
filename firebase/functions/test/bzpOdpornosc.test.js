import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';

/*
 * Audyt 2026-07-10: pobieranie z BZP nie miało ponowień. Jednorazowa usterka sieci
 * albo chwilowe 503 oznaczały, że użytkownicy nie dostają TEGO DNIA żadnych nowych
 * przetargów — cykl uruchamia się raz na dobę.
 */

const { searchNotices, normalizeNotice } = await import('../src/services/bzp.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

function odpowiedz(dane, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => dane,
    text: async () => JSON.stringify(dane),
  };
}

const OGLOSZENIE = { bzpNumber: '2026/BZP 001/01', orderObject: 'Budowa drogi', cpvCode: '45233000-9' };

test('BZP: chwilowe 503 jest ponawiane i kończy się sukcesem', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    return wywolania < 3 ? odpowiedz({}, 503) : odpowiedz([OGLOSZENIE]);
  };

  const notices = await searchNotices({ size: 1 });
  assert.equal(wywolania, 3, 'dwa razy 503, trzecia próba udana');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'Budowa drogi');
});

test('BZP: błąd sieci jest ponawiany', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    if (wywolania === 1) throw new Error('ECONNRESET');
    return odpowiedz([OGLOSZENIE]);
  };

  const notices = await searchNotices({ size: 1 });
  assert.equal(wywolania, 2);
  assert.equal(notices.length, 1);
});

test('BZP: 404 NIE jest ponawiane (to nasza wina, nie awaria BZP)', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; return odpowiedz({ blad: 'nie ma' }, 404); };

  await assert.rejects(() => searchNotices({ size: 1 }), /404/);
  assert.equal(wywolania, 1, 'ponawianie 404 tylko marnuje czas');
});

test('BZP: po wyczerpaniu prób rzucamy — cron odnotuje niepowodzenie', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; throw new Error('sieć padła'); };

  await assert.rejects(() => searchNotices({ size: 1 }), /sieć padła/);
  assert.equal(wywolania, 3, 'trzy próby, potem poddajemy się');
});

// ---------------- odporność na zmianę schematu ----------------

test('normalizeNotice: ogłoszenie bez identyfikatora jest odrzucane, nie zapisywane jako "undefined"', () => {
  assert.equal(normalizeNotice({ orderObject: 'Coś tam' }), null);
  assert.equal(normalizeNotice(null), null);
  assert.equal(normalizeNotice('tekst'), null);
});

test('normalizeNotice: brak tytułu daje czytelny zastępnik, nie "undefined"', () => {
  const n = normalizeNotice({ bzpNumber: 'X/1' });
  assert.equal(n.title, 'Bez tytułu');
  assert.equal(n.externalId, 'X/1');
  assert.notEqual(n.title, 'undefined');
});

test('normalizeNotice: rozpoznaje alternatywne nazwy pól BZP', () => {
  const n = normalizeNotice({ noticeNumber: 'Y/2', title: 'Remont mostu', mainCpv: '45221000' });
  assert.equal(n.externalId, 'Y/2');
  assert.equal(n.title, 'Remont mostu');
  assert.equal(n.cpvMain, '45221000');
});

test('normalizeNotice: htmlBody NIE trafia do zapisywanych danych surowych', () => {
  // Pole bywa ogromne; przy 500 ogłoszeniach zabiłoby limit dokumentu Firestore.
  const n = normalizeNotice({ bzpNumber: 'Z/3', orderObject: 'X', htmlBody: 'x'.repeat(50_000) });
  assert.equal(n.raw.htmlBody, undefined);
});
