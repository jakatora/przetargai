import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsujSzczegol, pobierzSzczegolHtml, pobierzSzczegol, sloikCiasteczek } from '../src/services/platformaZakupowa.js';

const FIXTURE = readFileSync(new URL('./fixtures/platformazakupowa-szczegol.html', import.meta.url), 'utf8');

test('parsujSzczegol: tryb, rodzaj, daty (czas polski → UTC), wymagania bez tagów, załączniki z linkami', () => {
  const sz = parsujSzczegol(FIXTURE);
  assert.equal(sz.tryb, 'Zapytanie ofertowe');
  assert.equal(sz.rodzaj, 'Usługa');
  assert.equal(sz.opublikowano, '2026-10-20T19:33:00.000Z');
  assert.equal(sz.termin, '2026-10-25T20:00:00.000Z');
  assert.match(sz.wymagania, /^Szanowni Państwo, informujemy o postępowaniu/);
  assert.ok(!/<[a-z]/.test(sz.wymagania), 'bez tagów');
  assert.ok(sz.wymagania.length <= 3000);
  assert.equal(sz.zalaczniki.length, 1);
  assert.deepEqual(sz.zalaczniki[0], {
    nazwa: 'COR Chrzest promu Bursztyn - PLAN SYTUACYJNY.pdf', rozszerzenie: 'pdf', rozmiar_kb: 13862,
    opublikowano: '2026-10-20T19:33:16.000Z', url: 'https://platformazakupowa.pl/file/get_new/06aae921c588fb93b956dd8ec2a703e9.pdf',
  });
});

test('parsujSzczegol: śmieci → same null i pusta lista', () => {
  assert.deepEqual(parsujSzczegol(''), { tryb: null, rodzaj: null, opublikowano: null, termin: null, wymagania: null, zalaczniki: [] });
  assert.deepEqual(parsujSzczegol(null).zalaczniki, []);
});

test('sloikCiasteczek: zbiera Set-Cookie (nazwa=wartość, bez atrybutów), nadpisuje po nazwie', () => {
  const s = sloikCiasteczek();
  s.zbierz({ headers: { getSetCookie: () => ['a=1; Path=/; HttpOnly', 'b=2; Secure'] } });
  s.zbierz({ headers: { getSetCookie: () => ['a=3; Path=/'] } });
  assert.equal(s.naglowek(), 'a=3; b=2');
  assert.equal(s.rozmiar(), 2);
  s.zbierz({ headers: {} });
  assert.equal(s.rozmiar(), 2);
});

/** Atrapa serwera: meta refresh → SSO 302 → powrót 302 → 200 z ciasteczkiem; bez ciasteczka wciąż refresh. */
function atrapaSso(wywolania) {
  const META = `<html><head><meta http-equiv="refresh" content="0;url='https://accounts.opennexus.com/sso/v1/oauth/authorize?client_id=x&amp;prompt=none'" /></head></html>`;
  return async (url, opcje) => {
    wywolania.push({ url, cookie: opcje?.headers?.Cookie ?? null, redirect: opcje?.redirect });
    const naglowki = (m = {}) => ({ get: (k) => m[k.toLowerCase()] ?? null, getSetCookie: () => m['set-cookie'] ?? [] });
    if (url.startsWith('https://accounts.opennexus.com/')) {
      return { ok: false, status: 302, headers: naglowki({ location: 'https://platformazakupowa.pl/sso/authorize?error=login_required&state=s' }), text: async () => '' };
    }
    if (url.startsWith('https://platformazakupowa.pl/sso/authorize')) {
      return { ok: false, status: 302, headers: naglowki({ location: '/transakcja/1395208', 'set-cookie': ['PHPSESSID=abc; Path=/; HttpOnly'] }), text: async () => '' };
    }
    if (url === 'https://platformazakupowa.pl/transakcja/1395208') {
      const zalogowany = /PHPSESSID=abc/.test(opcje?.headers?.Cookie ?? '');
      return { ok: true, status: 200, headers: naglowki(), text: async () => (zalogowany ? FIXTURE : META) };
    }
    return { ok: false, status: 404, headers: naglowki(), text: async () => '' };
  };
}

test('pobierzSzczegolHtml: przechodzi łańcuch cichego SSO z jednym słoikiem ciasteczek i oddaje pełną stronę', async () => {
  const wywolania = [];
  const html = await pobierzSzczegolHtml('1395208', { fetchFn: atrapaSso(wywolania) });
  assert.equal(html, FIXTURE);
  assert.equal(wywolania[0].url, 'https://platformazakupowa.pl/transakcja/1395208');
  assert.equal(wywolania[0].redirect, 'manual');
  assert.ok(wywolania.some((w) => w.url.startsWith('https://accounts.opennexus.com/')), 'wejście w SSO');
  assert.ok(wywolania.some((w) => w.url.startsWith('https://platformazakupowa.pl/sso/authorize')), 'powrót z SSO');
  const ostatnie = wywolania[wywolania.length - 1];
  assert.equal(ostatnie.url, 'https://platformazakupowa.pl/transakcja/1395208');
  assert.match(ostatnie.cookie, /PHPSESSID=abc/);
  const sz = await pobierzSzczegol('1395208', { fetchFn: atrapaSso([]) });
  assert.equal(sz.tryb, 'Zapytanie ofertowe');
});

test('pobierzSzczegolHtml: 403 i wieczny refresh = wyjątek, nie pusta odpowiedź', async () => {
  await assert.rejects(pobierzSzczegolHtml('1', { fetchFn: async () => ({ ok: false, status: 403, headers: { get: () => null, getSetCookie: () => [] }, text: async () => '' }) }), /403/);
  const META = `<html><head><meta http-equiv="refresh" content="0;url='https://accounts.opennexus.com/sso?x=1'" /></head></html>`;
  const wieczny = async (url) => (url.startsWith('https://accounts.opennexus.com/')
    ? { ok: true, status: 200, headers: { get: () => null, getSetCookie: () => [] }, text: async () => '' }
    : { ok: true, status: 200, headers: { get: () => null, getSetCookie: () => [] }, text: async () => META });
  await assert.rejects(pobierzSzczegolHtml('1', { fetchFn: wieczny }), /SSO/);
});
