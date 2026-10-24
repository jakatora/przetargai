import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = ''; // features.ai = false → heurystyka decyduje ostatecznie
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, evaluations, dziennik } = await import('../src/db/repos.js');
const { pracujDlaUzytkownika } = await import('../src/services/pracownik.js');
const { dobaWarszawska } = await import('../src/lib/czasPolski.js');

const PUSTE_FORMALNE = { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] };
let seq = 0;
async function przetarg(title, extra = {}) {
  const { tender } = await tenders.upsert({ externalId: `pr-${process.pid}-${++seq}`, title, organization: 'Gmina',
    deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'podkarpackie', ...extra });
  return tender;
}
async function zapiszKarte(id, { regiony = [], wykluczenia = [], wartoscMax = null } = {}) {
  return users.zapiszKarte(id, { companyName: null, keywords: ['dach'], cpvCodes: [], regiony, wartoscMax,
    karta: { opis: null, wykluczenia, wartosc_min: null, min_dni_oferta: 5, formalne: PUSTE_FORMALNE } });
}
async function klient(opcje) {
  const u = await users.create({ email: `pr${process.pid}-${++seq}@t.pl`, passwordHash: 'h', keywords: ['dach'] });
  return zapiszKarte(u.id, opcje);
}
const teraz = () => new Date().toISOString();

test('reguły odrzucają z przyczyną; bez sygnału = licznik „branża” bez dokumentu; dziennik', async () => {
  const u = await klient({ regiony: ['18'], wykluczenia: ['blacharskie'] });
  const pula = [
    await przetarg('Remont dachu szkoły'),
    await przetarg('Remont dachu urzędu', { wojewodztwo: 'mazowieckie' }),
    await przetarg('Roboty blacharskie dachu'),
    await przetarg('Dostawa papieru'),
  ];
  const t = teraz();
  const w = await pracujDlaUzytkownika(u, pula, { teraz: t });
  assert.deepEqual([w.wybrane, w.odrzucone.teren, w.odrzucone.wykluczenie, w.odrzucone.branza, w.przejrzane], [1, 1, 1, 1, 4]);
  assert.equal((await evaluations.pobierz(u.id, pula[1].id)).przyczyna, 'teren');
  assert.equal(await evaluations.pobierz(u.id, pula[3].id), null);
  assert.ok((await matches.detail(u.id, pula[0].id)).uzasadnienie.length > 0);
  const d = await dziennik.pobierz(u.id, dobaWarszawska(t));
  assert.deepEqual([d.przejrzane, d.wybrane, d.odrzucone.teren, d.odrzucone.wykluczenie], [4, 1, 1, 1]);
});

test('Free: najwyżej 5 wybranych na dobę; nadwyżka czeka, nie jest odrzucana', async () => {
  const u = await klient();
  const pula = [];
  for (let i = 0; i < 8; i++) pula.push(await przetarg(`Remont dachu nr ${i}`));
  const w = await pracujDlaUzytkownika(u, pula, { teraz: teraz() });
  assert.deepEqual([w.wybrane, w.oczekuje], [5, 3]);
  const znowu = await pracujDlaUzytkownika(await users.findById(u.id), pula, { teraz: teraz() });
  assert.equal(znowu.wybrane, 0, 'limit doby wyczerpany');
  assert.equal(znowu.oczekuje, 3);
});

test('REVIEW FOCUS 2: drugi przebieg nie ocenia drugi raz; zmiana karty — cały rynek od nowa', async () => {
  const u = await klient({ regiony: ['18'] });
  const poza = await przetarg('Remont dachu w Warszawie', { wojewodztwo: 'mazowieckie' });
  assert.equal((await pracujDlaUzytkownika(u, [poza], { teraz: teraz() })).odrzucone.teren, 1);

  const bezZmian = await pracujDlaUzytkownika(await users.findById(u.id), [poza], { teraz: teraz() });
  assert.deepEqual([bezZmian.przejrzane, bezZmian.odrzucone.teren], [0, 0]);

  const poZmianie = await zapiszKarte(u.id, { regiony: [] });
  const w = await pracujDlaUzytkownika(poZmianie, [poza], { teraz: teraz() });
  assert.deepEqual([w.przejrzane, w.wybrane], [1, 1]);
});

test('klient bez słów i CPV — nic nie robimy (pusty wynik, bez dziennika)', async () => {
  const u = await users.create({ email: `pr${process.pid}-${++seq}@t.pl`, passwordHash: 'h' });
  const w = await pracujDlaUzytkownika(u, [await przetarg('Remont dachu')], { teraz: teraz() });
  assert.equal(w.przejrzane, 0);
});
