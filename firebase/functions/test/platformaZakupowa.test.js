import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsujListe, normalizujOgloszeniePz, terminZListy, adresListy, pobierzStrone, ZRODLO } from '../src/services/platformaZakupowa.js';
import { planStron, kursorPo } from '../src/jobs/oknoPlatformaZakupowa.js';

const FIXTURE = readFileSync(new URL('./fixtures/platformazakupowa-lista.html', import.meta.url), 'utf8');

test('parsujListe: trzy pozycje z próbki (id, tytuł bez „(ID …)”, zamawiający, termin), numer ostatniej strony', () => {
  const { pozycje, odrzucone, stron } = parsujListe(FIXTURE);
  assert.equal(pozycje.length, 3);
  assert.equal(odrzucone, 0);
  assert.equal(stron, 2);
  assert.deepEqual(pozycje[0], { id: '1390256', tytul: 'Fartuchy foliowe do branży spożywczej', zamawiajacy: 'Zakłady Mięsne Skiba S.A.', termin: '25-10-2026 15:52:00' });
  assert.equal(pozycje[1].id, '1395208');
  assert.match(pozycje[1].tytul, /^Wprowadzenie i utrzymanie czasowej organizacji ruchu/);
  assert.ok(!/\(ID \d+\)/.test(pozycje[1].tytul));
  assert.match(pozycje[1].zamawiajacy, /Żegluga Szczecińska/);
});

test('parsujListe: śmieci i pozycje bez tytułu nie wysypują parsera', () => {
  assert.deepEqual(parsujListe(''), { pozycje: [], odrzucone: 0, stron: null });
  assert.deepEqual(parsujListe(null).pozycje, []);
  const bezTytulu = '<div class="col-md-12 auction-row"><a href="/transakcja/1" class="gray-link auction-title"> (ID 1) </a></b><br/>Gmina<br/>';
  assert.deepEqual(parsujListe(bezTytulu), { pozycje: [], odrzucone: 1, stron: null });
});

test('terminZListy: czas polski z listy → UTC (25.10.2026 15:52 = ostatni dzień czasu letniego? nie — zmiana była o 3:00, więc +1 h)', () => {
  // 25.10.2026 to niedziela zmiany czasu (CEST→CET o 03:00), więc 15:52 czasu polskiego = 14:52 UTC.
  assert.equal(terminZListy('25-10-2026 15:52:00'), '2026-10-25T14:52:00.000Z');
  // Lato: 15.07 12:00 CEST = 10:00 UTC.
  assert.equal(terminZListy('15-07-2026 12:00:00'), '2026-07-15T10:00:00.000Z');
  assert.equal(terminZListy('x'), null);
  assert.equal(terminZListy(null), null);
});

test('normalizujOgloszeniePz: kształt pod tenders.upsert, bez CPV/województwa/wartości; brak id lub tytułu → null', () => {
  const t = normalizujOgloszeniePz({ id: '1395208', tytul: 'Remont dachu', zamawiajacy: 'Gmina Testowa', termin: '26-10-2026 09:00:00' });
  assert.deepEqual(t, {
    externalId: 'pz:1395208', title: 'Remont dachu', organization: 'Gmina Testowa', cpvMain: null, budget: null, currency: null,
    deadline: '2026-10-26T08:00:00.000Z', publishedAt: null, url: 'https://platformazakupowa.pl/transakcja/1395208',
    source: ZRODLO, numer: 'ID 1395208', wojewodztwo: null,
  });
  assert.equal(normalizujOgloszeniePz({ id: '', tytul: 'x' }), null);
  assert.equal(normalizujOgloszeniePz({ id: '1', tytul: '' }), null);
  assert.equal(normalizujOgloszeniePz({ id: '1', tytul: 'Bez zamawiającego', zamawiajacy: '', termin: null }).organization, null);
});

test('adresListy i pobierzStrone: limit 100, User-Agent PrzetargAI, błąd HTTP = wyjątek', async () => {
  assert.equal(adresListy(3), 'https://platformazakupowa.pl/all?page=3&limit=100&query=');
  assert.equal(adresListy('x'), 'https://platformazakupowa.pl/all?page=1&limit=100&query=');
  let zadanie = null;
  const fetchFn = async (url, opcje) => { zadanie = { url, opcje }; return { ok: true, text: async () => FIXTURE }; };
  const w = await pobierzStrone(2, { fetchFn });
  assert.equal(w.pozycje.length, 3);
  assert.equal(zadanie.url, adresListy(2));
  assert.match(zadanie.opcje.headers['User-Agent'], /PrzetargAI/);
  await assert.rejects(pobierzStrone(1, { fetchFn: async () => ({ ok: false, status: 403, text: async () => '' }) }), /403/);
});

test('planStron/kursorPo: kursor z checkpointu, po niepełnej stronie wracamy na 1', () => {
  assert.deepEqual(planStron({ checkpoint: null }), [1, 2]);
  assert.deepEqual(planStron({ checkpoint: { nastepna_strona: 7 }, stronNaPrzebieg: 3 }), [7, 8, 9]);
  assert.deepEqual(planStron({ checkpoint: { nastepna_strona: 'x' } }), [1, 2]);
  assert.equal(kursorPo({ strony: [7, 8], ostatniaPelna: true }), 9);
  assert.equal(kursorPo({ strony: [47, 48], ostatniaPelna: false }), 1);
});
