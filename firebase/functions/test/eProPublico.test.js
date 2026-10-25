import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsujListe, parsujSzczegol, normalizujOgloszenieEpp, terminNaUtc, adresListy, pobierzStrone, ZRODLO } from '../src/services/eProPublico.js';

const LISTA = readFileSync(new URL('./fixtures/epropublico-lista.html', import.meta.url), 'utf8');
const SZCZEGOL = readFileSync(new URL('./fixtures/epropublico-szczegol.html', import.meta.url), 'utf8');

test('parsujListe: 3 wiersze (guid, sygnatura, temat odkodowany, zamawiający, termin, status)', () => {
  const { pozycje, odrzucone } = parsujListe(LISTA);
  assert.equal(pozycje.length, 3);
  assert.equal(odrzucone, 0);
  assert.equal(pozycje[0].id, '418b6e4f-0f4b-4eca-b635-f00f1df221ea');
  assert.equal(pozycje[0].sygnatura, '65-PN-26');
  assert.equal(pozycje[0].tytul, '65-PN-26 Implanty ortopedyczne');
  assert.equal(pozycje[0].zamawiajacy, 'Szpital Miejski w Gliwicach Sp. z o.o.');
  assert.equal(pozycje[0].termin, '26.10.2026 08:00:00');
  assert.equal(pozycje[0].status, 'Składanie ofert');
  assert.match(pozycje[1].tytul, /^Zbiornik dwupłaszczowy na paliwo, w ramach zadania "zapewnienie ciągłości dostaw"/, 'encje &#x142; i &quot; odkodowane');
  assert.deepEqual(parsujListe(''), { pozycje: [], odrzucone: 0 });
});

test('terminNaUtc: format listy i szczegółu, czas polski → UTC (26.10.2026 po zmianie czasu: +1 h)', () => {
  assert.equal(terminNaUtc('26.10.2026 08:00:00'), '2026-10-26T07:00:00.000Z');
  assert.equal(terminNaUtc('2026-10-26 08:00:00'), '2026-10-26T07:00:00.000Z');
  assert.equal(terminNaUtc('15.07.2026 12:00'), '2026-07-15T10:00:00.000Z');
  assert.equal(terminNaUtc('2027-01-23'), '2027-01-23T22:59:59.999Z');
  assert.equal(terminNaUtc('x'), null);
});

test('normalizujOgloszenieEpp: kształt pod tenders.upsert; zły guid → null', () => {
  const t = normalizujOgloszenieEpp(parsujListe(LISTA).pozycje[0]);
  assert.deepEqual(t, {
    externalId: 'epp:418b6e4f-0f4b-4eca-b635-f00f1df221ea', title: '65-PN-26 Implanty ortopedyczne', organization: 'Szpital Miejski w Gliwicach Sp. z o.o.',
    cpvMain: null, budget: null, currency: null, deadline: '2026-10-26T07:00:00.000Z', publishedAt: null,
    url: 'https://e-propublico.pl/Ogloszenia/Details/418b6e4f-0f4b-4eca-b635-f00f1df221ea', source: ZRODLO, numer: '65-PN-26', wojewodztwo: null,
  });
  assert.equal(normalizujOgloszenieEpp({ id: 'x', tytul: 'y' }), null);
});

test('parsujSzczegol: tryb, rodzaj, terminy, data publikacji, status', () => {
  const sz = parsujSzczegol(SZCZEGOL);
  assert.equal(sz.tryb, 'Przetarg nieograniczony');
  assert.equal(sz.rodzaj, 'Dostawy');
  assert.equal(sz.termin, '2026-10-26T07:00:00.000Z');
  assert.equal(sz.opublikowano, '2026-09-17T07:04:31.000Z');
  assert.equal(sz.zwiazanie, '2027-01-23');
  assert.equal(sz.status, 'Składanie ofert');
  assert.deepEqual(parsujSzczegol(''), { tryb: null, rodzaj: null, termin: null, opublikowano: null, zwiazanie: null, status: null });
});

test('adresListy i pobierzStrone: strona 1 bez parametru, UA PrzetargAI, błąd HTTP = wyjątek', async () => {
  assert.equal(adresListy(1), 'https://e-propublico.pl/Ogloszenia');
  assert.equal(adresListy(7), 'https://e-propublico.pl/Ogloszenia?page=7');
  let zadanie = null;
  const w = await pobierzStrone(2, { fetchFn: async (url, opcje) => { zadanie = { url, opcje }; return { ok: true, text: async () => LISTA }; } });
  assert.equal(w.pozycje.length, 3);
  assert.equal(zadanie.url, adresListy(2));
  assert.match(zadanie.opcje.headers['User-Agent'], /PrzetargAI/);
  await assert.rejects(pobierzStrone(1, { fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }) }), /503/);
});
