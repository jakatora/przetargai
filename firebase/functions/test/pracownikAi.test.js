import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow'; // features.ai = true; ocena i tak wstrzyknięta
process.env.AI_BUDGET_SOFT_USD = '1000000';
process.env.AI_BUDGET_HARD_USD = '2000000';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, evaluations, aiQuota } = await import('../src/db/repos.js');
const { pracujDlaUzytkownika } = await import('../src/services/pracownik.js');
const { zbudujSygnal } = await import('../src/lib/sygnaly.js');

let seq = 0;
async function przetarg(title, extra = {}) {
  const { tender } = await tenders.upsert({ externalId: `pa-${process.pid}-${++seq}`, title, organization: 'Gmina',
    deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'podkarpackie', ...extra });
  return tender;
}
async function klient(formalne = { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] }) {
  const u = await users.create({ email: `pa${process.pid}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  return users.zapiszKarte(u.id, { companyName: null, keywords: ['dach'], cpvCodes: [], regiony: [], wartoscMax: null,
    karta: { opis: 'Dachy', wykluczenia: [], wartosc_min: null, min_dni_oferta: 5, formalne } });
}
const teraz = () => new Date().toISOString();
const biore = (punkty = ['Dachy']) => async () => ({ decyzja: 'biore', przyczyna: null, punkty, score: 85 });
const odrzucam = (przyczyna) => async () => ({ decyzja: 'odrzucam', przyczyna, punkty: ['Nie ten zakres'], score: 20 });

test('AI bierze → wybrany z punktami AI; AI odrzuca → odrzucony z przyczyną AI', async () => {
  const u = await klient();
  const a = await przetarg('Remont dachu A');
  const b = await przetarg('Remont dachu B');
  const ocen = (_u, tender) => (tender.id === a.id ? biore(['Pasuje: dachy'])() : odrzucam('za_duze')());
  const w = await pracujDlaUzytkownika(u, [a, b], { teraz: teraz(), ocen });
  assert.deepEqual([w.wybrane, w.odrzucone.za_duze, w.aiCalls], [1, 1, 2]);
  assert.deepEqual((await matches.detail(u.id, a.id)).uzasadnienie, ['Pasuje: dachy']);
  assert.equal((await evaluations.pobierz(u.id, b.id)).etap, 'ai');
});

test('awaria AI: wybór tymczasowy bez śladu; późniejsze „odrzucam” zdejmuje go z wybranych', async () => {
  const u = await klient();
  const t = await przetarg('Remont dachu C');
  assert.equal((await pracujDlaUzytkownika(u, [t], { teraz: teraz(), ocen: async () => null })).wybrane, 1);
  assert.equal((await matches.detail(u.id, t.id)).ocena_bez_ai, true);
  assert.equal(await evaluations.pobierz(u.id, t.id), null);

  const w2 = await pracujDlaUzytkownika(await users.findById(u.id), [t], { teraz: teraz(), ocen: odrzucam('branza') });
  assert.equal(w2.odrzucone.branza, 1);
  assert.equal((await matches.detail(u.id, t.id)).odrzucony_przez_pracownika.przyczyna, 'branza');
});

test('dzienny limit AI wyczerpany → czeka, bez wyboru na samej heurystyce', async () => {
  const u = await klient();
  for (let i = 0; i < 10; i++) await aiQuota.reserve(u.id, 10);
  let wolano = 0;
  const w = await pracujDlaUzytkownika(u, [await przetarg('Remont dachu D')], {
    teraz: teraz(), ocen: async () => { wolano++; return null; } });
  assert.deepEqual([wolano, w.oczekuje, w.wybrane], [0, 1, 0]);
});

test('Standard z kartą formalną: „nie spełniasz” warunków → odrzucony z przyczyną warunki', async () => {
  const u0 = await klient({ obrot_roczny: 800_000, referencja_kwota: null, referencja_opis: null, uprawnienia: [] });
  await users.setTier(u0.id, 'standard');
  const u = await users.findById(u0.id);
  const t = await przetarg('Remont dachu E', { warunki_udzialu: { tekst: 'Obrót min. 2 mln zł', zrodlo: 'ogloszenie' } });
  const porownaj = async () => ({ werdykt: 'nie_spelniasz',
    wymagania: [{ rodzaj: 'obrot', wymog: 'Obrót 2 mln zł', status: 'brak', komentarz: '' }] });
  const w = await pracujDlaUzytkownika(u, [t], { teraz: teraz(), ocen: biore(), porownaj });
  assert.deepEqual([w.wybrane, w.odrzucone.warunki], [0, 1]);
  const row = await matches.detail(u.id, t.id);
  assert.equal(row.odrzucony_przez_pracownika.przyczyna, 'warunki');
  assert.equal(row.warunki.werdykt, 'nie_spelniasz');
});

test('Free nie porównuje warunków (to funkcja Standard)', async () => {
  const u = await klient({ obrot_roczny: 1, referencja_kwota: null, referencja_opis: null, uprawnienia: [] });
  let wolano = 0;
  const t = await przetarg('Remont dachu G', { warunki_udzialu: { tekst: 'Obrót', zrodlo: 'ogloszenie' } });
  await pracujDlaUzytkownika(u, [t], { teraz: teraz(), ocen: biore(), porownaj: async () => { wolano++; return null; } });
  assert.equal(wolano, 0);
});

test('przykłady z sygnałów klienta trafiają do oceny AI', async () => {
  const u0 = await klient();
  await users.dodajSygnal(u0.id, zbudujSygnal({ typ: 'odrzucenie', tenderId: 'x', tytul: 'Odśnieżanie dachów', przyczyna: 'branza', teraz: teraz() }));
  let przyklady = null;
  await pracujDlaUzytkownika(await users.findById(u0.id), [await przetarg('Remont dachu F')], {
    teraz: teraz(), ocen: async (_u, _t, p) => { przyklady = p; return null; } });
  assert.deepEqual(przyklady.odrzucone, [{ tytul: 'Odśnieżanie dachów', przyczyna: 'branza' }]);
});
