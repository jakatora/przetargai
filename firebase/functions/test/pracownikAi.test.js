import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'sk-ant-atrapa-do-testow'; // features.ai = true; ocena i tak wstrzyknięta
process.env.AI_BUDGET_SOFT_USD = '1000000';
process.env.AI_BUDGET_HARD_USD = '2000000';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, evaluations, aiQuota, saved } = await import('../src/db/repos.js');
const { pracujDlaUzytkownika, BUDZET_PRZELICZENIA_MS } = await import('../src/services/pracownik.js');
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

test('zmiana karty: odrzucony za warunki (te same dane formalne) nie wraca i nie jest oceniany w kółko', async () => {
  // Przegląd 2026-10-24: gałąź „dopasowanie już istnieje” czyściła odrzucenie za warunki po każdej zmianie karty.
  const formalne = { obrot_roczny: 800_000, referencja_kwota: null, referencja_opis: null, uprawnienia: [] };
  const u0 = await klient(formalne);
  await users.setTier(u0.id, 'standard');
  const t = await przetarg('Remont dachu H', { warunki_udzialu: { tekst: 'Obrót min. 2 mln zł', zrodlo: 'ogloszenie' } });
  const porownaj = async () => ({ werdykt: 'nie_spelniasz',
    wymagania: [{ rodzaj: 'obrot', wymog: 'Obrót 2 mln zł', status: 'brak', komentarz: '' }] });
  await pracujDlaUzytkownika(await users.findById(u0.id), [t], { teraz: teraz(), ocen: biore(), porownaj });

  const po = await users.zapiszKarte(u0.id, { companyName: null, keywords: ['dach'], cpvCodes: [], regiony: ['18'], wartoscMax: null,
    karta: { opis: 'Dachy', wykluczenia: [], wartosc_min: null, min_dni_oferta: 5, formalne } });
  const w = await pracujDlaUzytkownika(po, [t], { teraz: teraz(), ocen: biore(), porownaj });
  assert.deepEqual([w.wybrane, w.odrzucone.warunki], [0, 1]);
  assert.equal((await matches.detail(u0.id, t.id)).odrzucony_przez_pracownika?.przyczyna, 'warunki');
  assert.equal((await evaluations.pobierz(u0.id, t.id)).przyczyna, 'warunki');

  let ocen = 0;
  await pracujDlaUzytkownika(await users.findById(u0.id), [t], { teraz: teraz(), ocen: async (...a) => { ocen++; return biore()(...a); }, porownaj });
  assert.equal(ocen, 0, 'decyzja zapisana przy nowej wersji karty — bez ponownego pytania AI');
});

test('zmiana karty: wcześniejsze dopasowanie odrzucone przy ponownej ocenie schodzi z listy, zapisane zostaje', async () => {
  // Przegląd 2026-10-24: odrzucenie przy pełnym przeglądzie zapisywało tylko ślad — dopasowanie
  // zostawało w „Wcześniej” i jednocześnie w „Odrzuconych”.
  const u = await klient();
  const a = await przetarg('Remont dachu szkoly I');
  const b = await przetarg('Remont dachu szkoly J');
  const c = await przetarg('Remont dachu urzedu K');
  await pracujDlaUzytkownika(u, [a, b, c], { teraz: teraz(), ocen: biore() });
  await saved.add(u.id, await matches.detail(u.id, b.id));

  const po = await users.zapiszKarte(u.id, { companyName: null, keywords: ['dach'], cpvCodes: [], regiony: [], wartoscMax: null,
    karta: { opis: 'Dachy', wykluczenia: ['szkoly'], wartosc_min: null, min_dni_oferta: 5,
      formalne: { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] } } });
  const w = await pracujDlaUzytkownika(po, [a, b, c], { teraz: teraz(), ocen: async (_u, t, ...r) => (t.id === c.id ? odrzucam('branza')() : biore()()) });
  assert.equal(w.odrzucone.wykluczenie, 2);
  assert.equal((await matches.detail(u.id, a.id)).odrzucony_przez_pracownika?.przyczyna, 'wykluczenie');
  assert.equal((await matches.detail(u.id, b.id)).odrzucony_przez_pracownika ?? null, null, 'zapisany — klient nad nim pracuje');
  assert.equal((await matches.detail(u.id, c.id)).odrzucony_przez_pracownika?.przyczyna, 'branza', 'odrzucony przez AI po zmianie karty');
});

test('bezpiecznik AI: po 3 kolejnych awariach reszta czeka — bez palenia limitu, także u kolejnych klientów przebiegu', async () => {
  // Przegląd 2026-10-24: przy awarii Anthropic każdy przebieg co 3 h zjadał limit dobowy na nieudane wywołania.
  const u1 = await klient();
  const u2 = await klient();
  const pula = [];
  for (let i = 0; i < 6; i++) pula.push(await przetarg(`Remont dachu awaria ${i}`));
  let wolano = 0;
  const awaria = async () => { wolano++; return null; };
  const stanAi = { kolejneBledy: 0 };
  const w1 = await pracujDlaUzytkownika(u1, pula, { teraz: teraz(), ocen: awaria, stanAi });
  assert.equal(wolano, 3);
  assert.equal(await aiQuota.used(u1.id), 3, 'limit zarezerwowany tylko na 3 próby');
  assert.ok(w1.oczekuje >= 3);
  await pracujDlaUzytkownika(u2, pula, { teraz: teraz(), ocen: awaria, stanAi });
  assert.equal(wolano, 3, 'ten sam przebieg — AI nie jest pytane u kolejnego klienta');
  assert.equal(await aiQuota.used(u2.id), 0);
});

test('przeliczenie interaktywne ma budżet czasu: po nim kandydaci czekają na przebieg, bez AI', async () => {
  // Przegląd 2026-10-24: konto w próbie = Standard, więc rejestracja czekała na ~30 wywołań AI (60+ s, limit apki 60 s).
  assert.ok(BUDZET_PRZELICZENIA_MS <= 25_000, 'rejestracja i zapis karty muszą zmieścić się z zapasem w limicie aplikacji');
  const u = await klient();
  const pula = [await przetarg('Remont dachu budzet A'), await przetarg('Remont dachu budzet B')];
  let wolano = 0;
  const w = await pracujDlaUzytkownika(u, pula, { teraz: teraz(), ocen: async (...x) => { wolano++; return biore()(...x); }, budzetMs: 0 });
  assert.deepEqual([wolano, w.wybrane, w.oczekuje], [0, 0, 2]);
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
