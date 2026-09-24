import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wyjaśnienie dopasowania w API (P1-4) + dwa nowe pola profilu, bez których
 * sygnały „region" i „skala zamówienia" nie mają się do czego odnieść.
 *
 * Pola `regiony` i `wartosc_max` świadomie NIE wchodzą do scoringu: zmiana
 * silnika dopasowań to inna decyzja i inne ryzyko. Służą wyłącznie do tego,
 * żeby wyjaśnienie mówiło prawdę o kontekście ogłoszenia — i żeby podpowiedź
 * przy pustym feedzie miała co zaproponować.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, matches } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto({ keywords = [], cpv = [] } = {}) {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `wyj-${process.pid}-${seq}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords,
      cpv_codes: cpv,
    }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const ja = async (t) => (await (await fetch(`${BAZA}/auth/me`, { headers: auth(t) })).json()).user;

const ZNAK = `wyjx${process.pid}x${Date.now()}`;
const zaDni = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

async function dopasowanie(token, nad = {}) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `${ZNAK}-${seq}`,
    title: nad.title ?? `${ZNAK} Przebudowa drogi gminnej z chodnikiem`,
    organization: 'Gmina Zielonka',
    source: 'bzp',
    cpvMain: nad.cpvMain ?? '45233222-1 (Roboty w zakresie układania chodników)',
    budget: nad.budget ?? 800000,
    deadline: zaDni(14),
    wojewodztwo: nad.wojewodztwo ?? 'PL14',
  });
  const uid = (await ja(token)).id;
  await matches.create({ userId: uid, tenderId: tender.id, score: 85, reasoning: 'x', scorer: 'heuristic', tender });
  return tender;
}

test('KRYTYCZNE: karta dopasowania niesie sygnały z konkretnymi kodami i słowami', async () => {
  const token = await konto({ keywords: ['droga', 'chodnik'], cpv: ['45233000'] });
  await dopasowanie(token);

  const dane = await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(token) })).json();
  const wpis = dane.matches.find((m) => m.tender.title.startsWith(ZNAK));
  assert.ok(wpis, 'dopasowanie musi być na liście');

  const cpv = wpis.wyjasnienie.sygnaly.find((s) => s.typ === 'cpv');
  assert.equal(cpv.sila, 'mocny');
  assert.match(cpv.szczegol.pl, /45233222/);
  const slowa = wpis.wyjasnienie.sygnaly.find((s) => s.typ === 'slowa');
  assert.deepEqual(slowa.wartosci.sort(), ['chodnik', 'droga']);
  assert.equal(wpis.wyjasnienie.zrodlo, 'heurystyka', 'wyjaśnienie nie może kosztować wywołania AI');
});

test('szczegóły dopasowania też niosą wyjaśnienie', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  const tender = await dopasowanie(token);

  const dane = await (await fetch(`${BAZA}/matches/${tender.id}`, { headers: auth(token) })).json();
  assert.equal(dane.match.wyjasnienie.sygnaly.length, 4);
  assert.ok(dane.match.wyjasnienie.podsumowanie.en);
});

test('KRYTYCZNE: pusty feed dostaje KONKRETNY następny krok, nie „zajrzyj później"', async () => {
  const token = await konto();
  const dane = await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(token) })).json();

  assert.equal(dane.count, 0);
  assert.equal(dane.podpowiedz.kod, 'uzupelnij_profil');
  assert.ok(dane.podpowiedz.tytul.pl && dane.podpowiedz.tytul.en);
  assert.equal(dane.podpowiedz.pole, 'keywords');
});

test('feed z treścią nie dostaje podpowiedzi profilowej', async () => {
  const token = await konto({ keywords: ['droga', 'chodnik', 'most'], cpv: ['45233000'] });
  await fetch(`${BAZA}/auth/me`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ regiony: ['14'] }),
  });
  await dopasowanie(token);

  const dane = await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(token) })).json();
  assert.ok(dane.count > 0);
  assert.equal(dane.podpowiedz, null);
});

test('podpowiedź przy kolejnych stronach nie wraca — dotyczy tylko pierwszej', async () => {
  const token = await konto();
  const dane = await (await fetch(`${BAZA}/matches?limit=50&before=cokolwiek`, { headers: auth(token) })).json();
  assert.equal(dane.podpowiedz, null, 'podpowiedź to stan pustego feedu, nie końca listy');
});

test('profil przyjmuje województwa i największą obsługiwaną wartość', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  const odp = await fetch(`${BAZA}/auth/me`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ regiony: ['PL14', 'małopolskie'], wartosc_max: 1500000 }),
  });
  assert.equal(odp.status, 200);
  const { user } = await odp.json();
  assert.deepEqual(user.regiony, ['14', '12'], 'kody TERYT i nazwy sprowadzone do jednego formatu');
  assert.equal(user.wartosc_max, 1500000);

  assert.deepEqual((await ja(token)).regiony, ['14', '12'], 'zapis jest trwały');
});

test('nierozpoznane województwo jest odrzucane, nie zapisywane', async () => {
  const token = await konto({ keywords: ['droga'] });
  const { user } = await (await fetch(`${BAZA}/auth/me`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ regiony: ['PL14', 'Berlin'] }),
  })).json();
  assert.deepEqual(user.regiony, ['14']);
});

test('wartosc_max można wyzerować, podając null', async () => {
  const token = await konto({ keywords: ['droga'] });
  await fetch(`${BAZA}/auth/me`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ wartosc_max: 900000 }) });
  const { user } = await (await fetch(`${BAZA}/auth/me`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ wartosc_max: null }),
  })).json();
  assert.equal(user.wartosc_max, null);
});

test('zapisane województwo zmienia sygnał regionu w wyjaśnieniu', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  const tender = await dopasowanie(token, { wojewodztwo: 'PL14' });

  const przed = await (await fetch(`${BAZA}/matches/${tender.id}`, { headers: auth(token) })).json();
  assert.equal(przed.match.wyjasnienie.sygnaly.find((s) => s.typ === 'region').sila, 'informacja');

  await fetch(`${BAZA}/auth/me`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ regiony: ['12'] }) });
  const po = await (await fetch(`${BAZA}/matches/${tender.id}`, { headers: auth(token) })).json();
  assert.equal(po.match.wyjasnienie.sygnaly.find((s) => s.typ === 'region').sila, 'brak');
});

test('zadeklarowana skala firmy oznacza zamówienie ponad możliwości', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  const tender = await dopasowanie(token, { budget: 8_000_000 });
  await fetch(`${BAZA}/auth/me`, { method: 'PATCH', headers: auth(token), body: JSON.stringify({ wartosc_max: 1_000_000 }) });

  const dane = await (await fetch(`${BAZA}/matches/${tender.id}`, { headers: auth(token) })).json();
  const wartosc = dane.match.wyjasnienie.sygnaly.find((s) => s.typ === 'wartosc');
  assert.equal(wartosc.sila, 'brak');
  assert.match(wartosc.szczegol.pl, /powyżej/i);
});

test('zapisane przetargi też niosą wyjaśnienie — to ta sama karta', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  const tender = await dopasowanie(token);
  await fetch(`${BAZA}/matches/${tender.id}/save`, { method: 'PUT', headers: auth(token), body: '{}' });

  const dane = await (await fetch(`${BAZA}/matches/saved`, { headers: auth(token) })).json();
  const wpis = dane.saved.find((s) => s.tender.id === tender.id);
  assert.ok(wpis, 'przetarg musi być na liście zapisanych');
  assert.equal(wpis.wyjasnienie.sygnaly.length, 4);
});

test('KRYTYCZNE: karta feedu zna zrodlo pierwotne i czas synchronizacji', async () => {
  const token = await konto({ keywords: ['droga'], cpv: ['45233000'] });
  await dopasowanie(token);

  const dane = await (await fetch(`${BAZA}/matches?limit=50`, { headers: auth(token) })).json();
  const wpis = dane.matches.find((m) => m.tender.title.startsWith(ZNAK));
  assert.equal(wpis.tender.zrodlo.kod, 'bzp');
  assert.ok(wpis.tender.zrodlo.etykieta.pl && wpis.tender.zrodlo.etykieta.en);
  assert.ok(
    Object.hasOwn(wpis.tender.zrodlo, 'zsynchronizowano_o'),
    'bez czasu synchronizacji "brak nowych przetargow" jest nieodroznialne od awarii pobierania',
  );
  assert.ok(wpis.tender.zrodlo.rejestr, 'karta musi wiedziec, dokad prowadzi wyjscie awaryjne');
});
