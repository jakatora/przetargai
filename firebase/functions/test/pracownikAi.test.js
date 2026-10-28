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

test('kandydat z platformazakupowa.pl: przed oceną AI dociągany szczegół (cache przy ogłoszeniu, budżet na przebieg, błąd nie blokuje)', async () => {
  const u = await klient();
  const pz = await przetarg('Remont dachu przedszkola (platforma)', { source: 'platformazakupowa' });
  const widzianePrzezAi = [];
  let pobran = 0;
  const szczegolPz = async (id) => { pobran++; assert.equal(id, pz.bzp_external_id.replace(/^pz:/, '')); return { tryb: 'Tryb podstawowy', rodzaj: 'Robota budowlana', wymagania: 'Dach 1200 m²', zalaczniki: [] }; };
  const w = await pracujDlaUzytkownika(u, [pz], { teraz: teraz(), szczegolPz, ocen: async (_u, t) => { widzianePrzezAi.push(t.pz_szczegol?.tryb ?? null); return biore(['Pasuje'])(); } });
  assert.equal(w.wybrane, 1);
  assert.deepEqual(widzianePrzezAi, ['Tryb podstawowy'], 'AI widzi tryb ze szczegółu');
  assert.equal(pobran, 1);
  assert.equal((await tenders.findById(pz.id)).pz_szczegol.tryb, 'Tryb podstawowy', 'cache przy ogłoszeniu');

  // Błąd platformy: ocena idzie dalej bez szczegółu.
  const pz2 = await przetarg('Remont dachu żłobka (platforma)', { source: 'platformazakupowa' });
  const u2 = await klient();
  const w2 = await pracujDlaUzytkownika(u2, [pz2], { teraz: teraz(), szczegolPz: async () => { throw new Error('403'); }, ocen: async () => biore(['Pasuje'])() });
  assert.equal(w2.wybrane, 1);

  // Budżet 0 → bez żądania.
  const u3 = await klient();
  let pobran3 = 0;
  await pracujDlaUzytkownika(u3, [await przetarg('Remont dachu szkoły (platforma)', { source: 'platformazakupowa' })], { teraz: teraz(), szczegolPz: async () => { pobran3++; return null; }, budzetSzczegolowPz: { pozostalo: 0 }, ocen: async () => biore(['Pasuje'])() });
  assert.equal(pobran3, 0);
});

test('wybrany z BZP: po wyborze dociągane dokumenty z e-Zamówień (SWZ z linkiem) — cache przy ogłoszeniu, budżet, błąd nie blokuje, bez postepowanie_id bez żądania', async () => {
  const ID = `ocds-148610-16f1c19e-be85-4853-82f5-${String(process.pid).padStart(12, '0').slice(-12)}`;
  const DOK = [{ id: `${ID}_2`, nazwa: 'Specyfikacja Warunków Zamówienia', plik: 'SWZ.pdf', rozszerzenie: 'pdf', url: `https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/${ID}/${ID}_2`, opublikowano: null }];
  const u = await klient();
  const bzp = await przetarg('Remont dachu urzędu (BZP)', { source: 'bzp', postepowanie_id: ID });
  // Z PRAWDZIWEJ puli (projekcja POLA_PULI), nie z pełnego dokumentu — 27.10 na produkcji pula nie niosła
  // `postepowanie_id` i dokumenty nigdy nie były dociągane.
  const zPuli = (await tenders.openPool()).filter((t) => t.id === bzp.id);
  assert.equal(zPuli.length, 1, 'ogłoszenie jest w puli');
  assert.equal(zPuli[0].postepowanie_id, ID, 'pula niesie postepowanie_id');
  const wywolania = [];
  const w = await pracujDlaUzytkownika(u, zPuli, { teraz: teraz(), dokumentyEz: async (id) => { wywolania.push(id); return DOK; }, ocen: biore(['Pasuje']) });
  assert.equal(w.wybrane, 1);
  assert.deepEqual(wywolania, [ID]);
  assert.equal(w.dokumentyEz, 1);
  assert.equal((await tenders.findById(bzp.id)).ez_dokumenty[0].plik, 'SWZ.pdf', 'cache przy ogłoszeniu');

  // Błąd portalu: wybór zostaje, dokumenty dociągnie później przycisk na ekranie.
  const u2 = await klient();
  const w2 = await pracujDlaUzytkownika(u2, [await przetarg('Remont dachu biblioteki (BZP)', { source: 'bzp', postepowanie_id: ID })], { teraz: teraz(), dokumentyEz: async () => { throw new Error('403'); }, ocen: biore(['Pasuje']) });
  assert.equal(w2.wybrane, 1);
  assert.equal(w2.dokumentyEz ?? 0, 0);

  // To samo ogłoszenie z puli u kolejnego klienta po nieudanym pobraniu — bez ponownego żądania w tym przebiegu.
  const wspolne = await przetarg('Remont dachu ratusza (BZP)', { source: 'bzp', postepowanie_id: ID });
  let proby = 0;
  const pada = async () => { proby++; throw new Error('This operation was aborted'); };
  await pracujDlaUzytkownika(await klient(), [wspolne], { teraz: teraz(), dokumentyEz: pada, ocen: biore(['Pasuje']) });
  await pracujDlaUzytkownika(await klient(), [wspolne], { teraz: teraz(), dokumentyEz: pada, ocen: biore(['Pasuje']) });
  assert.equal(proby, 1, 'drugi klient nie ponawia nieudanego pobrania');

  // Bez identyfikatora postępowania i przy budżecie 0 — zero żądań.
  let pobran3 = 0;
  const u3 = await klient();
  await pracujDlaUzytkownika(u3, [await przetarg('Remont dachu szkoły (BZP, stare ogłoszenie)', { source: 'bzp' })], { teraz: teraz(), dokumentyEz: async () => { pobran3++; return DOK; }, ocen: biore(['Pasuje']) });
  const u4 = await klient();
  await pracujDlaUzytkownika(u4, [await przetarg('Remont dachu hali (BZP)', { source: 'bzp', postepowanie_id: ID })], { teraz: teraz(), dokumentyEz: async () => { pobran3++; return DOK; }, budzetDokumentowEz: { pozostalo: 0 }, ocen: biore(['Pasuje']) });
  assert.equal(pobran3, 0);
});
