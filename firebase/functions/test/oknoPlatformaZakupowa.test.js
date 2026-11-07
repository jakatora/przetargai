import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, oknoPz } = await import('../src/db/repos.js');
const { runOknoPz } = await import('../src/jobs/oknoPlatformaZakupowa.js');

const FIXTURE = readFileSync(new URL('./fixtures/platformazakupowa-lista.html', import.meta.url), 'utf8');
const ZNAK = `${process.pid}${Date.now()}`.slice(-7);
// Unikalne id w emulatorze (test współdzieli bazę z innymi plikami).
const fixtureZ = (przesuniecie = 0, termin = null) => FIXTURE
  .replace(/\/transakcja\/(\d+)/g, (_, id) => `/transakcja/${ZNAK}${Number(id) + przesuniecie}`)
  .replace(/countdown-(\d+)/g, (_, id) => `countdown-${ZNAK}${Number(id) + przesuniecie}`)
  .replace(/\(ID (\d+)\)/g, (_, id) => `(ID ${ZNAK}${Number(id) + przesuniecie})`)
  .replace(/25-10-2026 15:52:00/g, termin ?? '25-10-2026 15:52:00');
// Strona „pełna" = 100 pozycji; próbka ma 3, więc symulujemy koniec listy po pierwszej stronie.

test('przebieg: 3 nowe ogłoszenia z listy, kursor wraca na 1 po niepełnej stronie, ślad przebiegu zapisany', async () => {
  await oknoPz.zapisz({ nastepna_strona: 5 });
  const zadania = [];
  const fetchFn = async (url) => { zadania.push(url); return { ok: true, text: async () => fixtureZ() }; };
  const w = await runOknoPz({ fetchFn, odstepMs: 0, teraz: () => '2026-10-25T16:00:00.000Z' });
  assert.equal(w.ok, true);
  assert.deepEqual(w.strony, [5], 'niepełna strona kończy przebieg');
  assert.equal(w.nowe, 3);
  assert.equal(w.nastepna_strona, 1);
  assert.equal(w.zapytania, 1);
  assert.match(zadania[0], /page=5&limit=100/);
  const t = await tenders.findById(`pz:${ZNAK}1390256`);
  assert.equal(t.source, 'platformazakupowa');
  assert.equal(t.title, 'Fartuchy foliowe do branży spożywczej');
  assert.equal(t.deadline, '2026-10-25T14:52:00.000Z');
  assert.equal(t.url, `https://platformazakupowa.pl/transakcja/${ZNAK}1390256`);
  assert.equal((await oknoPz.wczytaj()).nastepna_strona, 1);
  assert.equal((await oknoPz.wczytaj()).ostatni_przebieg.nowe, 3);
});

test('drugi przebieg: bez zmian nic nie zapisuje; przedłużony termin dociąga zaktualizujZeZrodla', async () => {
  const bezZmian = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ() }), odstepMs: 0 });
  assert.deepEqual([bezZmian.nowe, bezZmian.zaktualizowane, bezZmian.bez_zmian], [0, 0, 3]);
  const przedluzony = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ(0, '30-10-2026 10:00:00') }), odstepMs: 0 });
  assert.deepEqual([przedluzony.nowe, przedluzony.zaktualizowane], [0, 1]);
  assert.equal((await tenders.findById(`pz:${ZNAK}1390256`)).deadline, '2026-10-30T09:00:00.000Z');
});

test('403 ze źródła: przebieg ok=false, kursor zostaje, ślad z błędem', async () => {
  await oknoPz.zapisz({ nastepna_strona: 3 });
  const w = await runOknoPz({ fetchFn: async () => ({ ok: false, status: 403, text: async () => '' }), odstepMs: 0 });
  assert.equal(w.ok, false);
  assert.match(w.error, /403/);
  assert.equal(w.nastepna_strona, 3);
  assert.equal((await oknoPz.wczytaj()).nastepna_strona, 3);
});

test('przetarg obecny już w BZP (ten sam tytuł, zamawiający, dzień terminu): bez kopii, link platformy dopisany do wpisu BZP', async () => {
  const { tender: bzp } = await tenders.upsert({ externalId: `bzp-pz-${ZNAK}`, title: 'Fartuchy foliowe do branży spożywczej', organization: 'Zakłady Mięsne Skiba S.A.', deadline: '2026-10-25T14:00:00.000Z', source: 'bzp', url: 'https://ezamowienia.gov.pl/x' });
  await oknoPz.zapisz({ nastepna_strona: 1 });
  const w = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ(5000) }), odstepMs: 0 });
  assert.equal(w.ok, true);
  assert.equal(w.scalone_z_rejestrem, 1, 'fartuchy = kopia wpisu BZP');
  assert.equal(w.nowe, 2, 'pozostałe dwie pozycje wchodzą normalnie');
  assert.equal(await tenders.findById(`pz:${ZNAK}${1390256 + 5000}`), null, 'kopia z platformy NIE powstała');
  const poZmianie = await tenders.findById(bzp.id);
  assert.deepEqual(poZmianie.zrodla_alternatywne.map((z) => z.source), ['platformazakupowa']);
  assert.equal(poZmianie.zrodla_alternatywne[0].url, `https://platformazakupowa.pl/transakcja/${ZNAK}${1390256 + 5000}`);
  // Drugi przebieg nie dubluje linku.
  await oknoPz.zapisz({ nastepna_strona: 1 });
  await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ(5000) }), odstepMs: 0 });
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne.length, 1);
});

test('bliźniak z BZP (2026-11-03): numer BZP w tytule albo termin + tytuł + podobny zamawiający — bez kopii, link do wpisu BZP', async () => {
  const nr = `0${ZNAK}`;
  const { tender: poNumerze } = await tenders.upsert({ externalId: `2026/BZP ${nr}`, title: 'Fartuchy ochronne jednorazowe', organization: 'ZM SKIBA', deadline: '2026-11-30T10:00:00.000Z', source: 'bzp' });
  const tytulSzczecin = 'Wprowadzenie i utrzymanie czasowej organizacji ruchu w zakresie oznakowania pionowego i poziomego na terenie miasta Szczecin na potrzeby przeprowadzenia wydarzenia w dniach 9-15.11.2026';
  const { tender: poTytule } = await tenders.upsert({ externalId: `bzp-tyt-${ZNAK}`, title: tytulSzczecin, organization: 'ŻEGLUGA SZCZECIŃSKA TURYSTYKA', deadline: '2026-10-25T20:00:00.000Z', source: 'bzp' });
  await oknoPz.zapisz({ nastepna_strona: 1 });
  const html = fixtureZ(6000).replace('Fartuchy foliowe do branży spożywczej', `2026/BZP ${nr} (ZP.1.2026) Fartuchy foliowe ${ZNAK}`)
    .replace(tytulSzczecin, `ZOR.2.2026 ${tytulSzczecin}`);
  const w = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => html }), odstepMs: 0 });
  assert.deepEqual([w.scalone_z_rejestrem, w.nowe], [2, 1]);
  assert.equal(await tenders.findById(`pz:${ZNAK}${1390256 + 6000}`), null);
  assert.equal(await tenders.findById(`pz:${ZNAK}${1395208 + 6000}`), null);
  assert.deepEqual((await tenders.findById(poNumerze.id)).zrodla_alternatywne.map((z) => z.url), [`https://platformazakupowa.pl/transakcja/${ZNAK}${1390256 + 6000}`]);
  assert.equal((await tenders.findById(poTytule.id)).zrodla_alternatywne.length, 1);
});

test('pozycja raz podpięta do BZP, a termin zmienił się na platformie wcześniej niż w BZP → dalej link, bez kopii (2026-11-07)', async () => {
  // BZP z innym tytułem, zamawiającym i STARYM terminem — łączy go z pozycją tylko wcześniejsze podpięcie.
  const { tender: bzp } = await tenders.upsert({ externalId: `bzp-pz-link-${ZNAK}`, title: 'Odzież ochronna dla zakładu', organization: 'SKIBA ZM', deadline: '2026-10-21T10:00:00.000Z', source: 'bzp' });
  const id = `pz:${ZNAK}${1390256 + 9000}`;
  await tenders.dodajZrodloAlternatywne(bzp.id, { source: 'platformazakupowa', externalId: id, url: `https://platformazakupowa.pl/transakcja/${ZNAK}${1390256 + 9000}` });
  await oknoPz.zapisz({ nastepna_strona: 1 });
  const w = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => fixtureZ(9000, '29-10-2026 12:00:00') }), odstepMs: 0 });
  assert.equal(w.ok, true);
  assert.ok(w.scalone_z_rejestrem >= 1, 'podpięta pozycja zostaje przy BZP');
  assert.equal(await tenders.findById(id), null, 'kopia NIE powstała');
  assert.ok(await tenders.findById(`pz:${ZNAK}${1393682 + 9000}`), 'pozycja bez podpięcia i bez bliźniaka wchodzi normalnie');
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne.length, 1);
});

test('kopia przetargu z TED (termin z samą datą): bez kopii, TED dostaje godzinę składania ofert z platformy', async () => {
  const tytul = 'Szacowanie wartości zamówienia - Dostawa krzeseł i foteli Akademii Marynarki Wojennej (FERS.03.01-IP.08-0177/24-00)';
  const { tender: ted } = await tenders.upsert({ externalId: `ted:${ZNAK}-amw`, title: `${tytul} ${ZNAK}`, organization: 'AKADEMIA MARYNARKI WOJENNEJ', deadline: '2026-10-25T22:59:59.999Z', source: 'ted' });
  await oknoPz.zapisz({ nastepna_strona: 1 });
  const html = fixtureZ(7000).replace(tytul, `${tytul} ${ZNAK}`);
  const w = await runOknoPz({ fetchFn: async () => ({ ok: true, text: async () => html }), odstepMs: 0 });
  assert.equal(w.ok, true);
  assert.equal(await tenders.findById(`pz:${ZNAK}${1393682 + 7000}`), null, 'kopia nie powstała');
  const poZmianie = await tenders.findById(ted.id);
  assert.deepEqual(poZmianie.zrodla_alternatywne.map((z) => z.source), ['platformazakupowa']);
  assert.equal(poZmianie.deadline, '2026-10-25T21:58:00.000Z');
});
