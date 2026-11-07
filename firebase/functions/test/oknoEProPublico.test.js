import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, oknoEpp } = await import('../src/db/repos.js');
const { runOknoEpp } = await import('../src/jobs/oknoEProPublico.js');
const { linkOgloszenia } = await import('../src/services/eProPublico.js');

const LISTA = readFileSync(new URL('./fixtures/epropublico-lista.html', import.meta.url), 'utf8');
const SZCZEGOL = readFileSync(new URL('./fixtures/epropublico-szczegol.html', import.meta.url), 'utf8');
const ZNAK = `${process.pid}${Date.now()}`.slice(-8);
// Unikalne guid-y: ostatnie 8 znaków guid zastępujemy znacznikiem testu.
const listaZ = (termin = null) => {
  let s = LISTA.replace(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4})[0-9a-f]{8}/gi, `$1${ZNAK}`);
  if (termin) s = s.replace('26.10.2026<br />\n              08:00:00', termin).replace(/26\.10\.2026\s*<br \/>\s*08:00:00/, termin);
  return s;
};
const serwer = (opcje = {}) => async (url) => {
  if (/\/Ogloszenia\/Details\//.test(url)) return { ok: true, text: async () => SZCZEGOL };
  const strona = Number((url.match(/page=(\d+)/) || [])[1] || 1);
  return { ok: true, text: async () => (strona === 1 ? (opcje.lista ?? listaZ()) : '<table><tbody></tbody></table>') };
};

test('przebieg: cała lista do pustej strony, 3 nowe ze szczegółem (tryb/rodzaj/data publikacji), ślad przebiegu', async () => {
  const w = await runOknoEpp({ fetchFn: serwer(), odstepMs: 0, teraz: () => '2026-10-25T18:00:00.000Z' });
  assert.equal(w.ok, true);
  assert.equal(w.strony, 1);
  assert.equal(w.nowe, 3);
  assert.equal(w.szczegoly, 3);
  assert.equal(w.zapytania, 2 + 3, '2 strony (druga pusta) + 3 szczegóły');
  const t = await tenders.findById(`epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK}`);
  assert.equal(t.source, 'epropublico');
  assert.equal(t.title, '65-PN-26 Implanty ortopedyczne');
  assert.equal(t.rodzaj, 'Dostawy');
  assert.equal(t.tryb_postepowania, 'Przetarg nieograniczony');
  assert.equal(t.published_at, '2026-09-17T07:04:31.000Z');
  assert.equal(t.deadline, '2026-10-26T07:00:00.000Z');
  assert.ok(t.klucz_dedup);
  assert.equal((await oknoEpp.wczytaj()).ostatni_przebieg.nowe, 3);
});

test('drugi przebieg: bez zmian i bez szczegółów; zmieniony termin na liście → zaktualizowane', async () => {
  const w = await runOknoEpp({ fetchFn: serwer(), odstepMs: 0 });
  assert.deepEqual([w.nowe, w.szczegoly, w.bez_zmian, w.zaktualizowane], [0, 0, 3, 0]);
  const w2 = await runOknoEpp({ fetchFn: serwer({ lista: listaZ('28.10.2026 10:00:00') }), odstepMs: 0 });
  assert.deepEqual([w2.nowe, w2.zaktualizowane, w2.bez_zmian], [0, 1, 2]);
  assert.equal((await tenders.findById(`epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK}`)).deadline, '2026-10-28T09:00:00.000Z');
});

test('rejestr wiodący (BZP) o tym samym kluczu → link poboczny zamiast kopii', async () => {
  const { tender: bzp } = await tenders.upsert({ externalId: `bzp-epp-${ZNAK}`, title: '65-PN-26 Implanty ortopedyczne', organization: 'Szpital Miejski w Gliwicach Sp. z o.o.', deadline: '2026-10-26T07:00:00.000Z', source: 'bzp', url: 'https://ezamowienia.gov.pl/y' });
  const lista = listaZ().replace(/f00f[0-9a-f]{8}/g, `f00f${ZNAK.slice(0, 4)}0000`);
  const w = await runOknoEpp({ fetchFn: serwer({ lista }), odstepMs: 0 });
  assert.equal(w.scalone_z_rejestrem, 1);
  assert.deepEqual([w.nowe, w.bez_zmian], [0, 2], "pozostałe dwa wiersze istnieją z poprzednich testów");
  assert.equal(await tenders.findById(`epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK.slice(0, 4)}0000`), null, 'kopia z e-ProPublico NIE powstała');
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne[0].source, 'epropublico');
});

test('bliźniak z BZP bez zgodnego klucza (znak sprawy w tytule, inna pisownia zamawiającego) → link poboczny zamiast kopii', async () => {
  const { tender: bzp } = await tenders.upsert({ externalId: `bzp-epp-bl-${ZNAK}`, title: 'Implanty ortopedyczne', organization: 'SZPITAL MIEJSKI W GLIWICACH SPÓŁKA Z O.O.', deadline: '2026-10-29T10:00:00.000Z', source: 'bzp' });
  const lista = listaZ('29.10.2026 11:00:00').replace(/f00f[0-9a-f]{8}/g, `f00f${ZNAK.slice(0, 4)}1111`);
  const w = await runOknoEpp({ fetchFn: serwer({ lista }), odstepMs: 0 });
  assert.equal(w.scalone_z_rejestrem, 1);
  assert.equal(await tenders.findById(`epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK.slice(0, 4)}1111`), null);
  assert.deepEqual((await tenders.findById(bzp.id)).zrodla_alternatywne.map((z) => z.source), ['epropublico']);
});

test('pozycja raz podpięta do BZP, a termin zmienił się tu wcześniej niż w BZP → dalej link, bez kopii (prod 4–6.11: 3 duplikaty)', async () => {
  // BZP ze STARYM terminem i inną pisownią: ani klucz, ani szukanie bliźniaka po terminie go nie znajdą.
  const { tender: bzp } = await tenders.upsert({ externalId: `bzp-epp-link-${ZNAK}`, title: 'Implanty ortopedyczne (65-PN-26)', organization: 'SZPITAL MIEJSKI GLIWICE', deadline: '2026-10-20T07:00:00.000Z', source: 'bzp' });
  const zPrzyrostkiem = (p) => listaZ('31.10.2026 09:00:00').replace(/f00f[0-9a-f]{8}/g, `f00f${ZNAK.slice(0, 4)}${p}`);
  // Kontrola: bez podpięcia ta pozycja zakłada osobny wpis — tak powstały duplikaty.
  const bez = await runOknoEpp({ fetchFn: serwer({ lista: zPrzyrostkiem('3333') }), odstepMs: 0 });
  assert.equal(bez.nowe, 1);
  assert.ok(await tenders.findById(`epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK.slice(0, 4)}3333`));
  // Pozycja podpięta wcześniej (jak przy publikacji, gdy terminy były zgodne).
  const id = `epp:418b6e4f-0f4b-4eca-b635-f00f${ZNAK.slice(0, 4)}2222`;
  await tenders.dodajZrodloAlternatywne(bzp.id, { source: 'epropublico', externalId: id, url: linkOgloszenia(id.replace(/^epp:/, '')) });
  const w = await runOknoEpp({ fetchFn: serwer({ lista: zPrzyrostkiem('2222') }), odstepMs: 0 });
  assert.equal(w.nowe, 0);
  assert.equal(w.scalone_z_rejestrem, 1);
  assert.equal(await tenders.findById(id), null, 'kopia NIE powstała');
  assert.equal((await tenders.findById(bzp.id)).zrodla_alternatywne.length, 1, 'link się nie dubluje');
});

test('wiodacePoZrodleAlternatywnym: zastąpiona wersja przegrywa z aktualną; inne źródło i obce pozycje pominięte', async () => {
  const id = `epp:wybor-${ZNAK}`;
  const url = linkOgloszenia(`wybor-${ZNAK}`);
  const { tender: stary } = await tenders.upsert({ externalId: `ted-stary-${ZNAK}`, title: 'A', organization: 'B', deadline: '2026-11-20T10:00:00.000Z', source: 'ted' });
  const { tender: nowy } = await tenders.upsert({ externalId: `ted-nowy-${ZNAK}`, title: 'A', organization: 'B', deadline: '2026-11-27T10:00:00.000Z', source: 'ted' });
  for (const t of [stary, nowy]) await tenders.dodajZrodloAlternatywne(t.id, { source: 'epropublico', externalId: id, url });
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('tenders').doc(stary.id).update({ zastapiony_przez: nowy.id });
  const m = await tenders.wiodacePoZrodleAlternatywnym('epropublico', [{ externalId: id, url }, { externalId: `epp:obca-${ZNAK}`, url: 'x' }]);
  assert.deepEqual([...m.keys()], [id]);
  assert.equal(m.get(id).id, nowy.id);
  assert.equal(m.get(id).source, 'ted');
  assert.equal((await tenders.wiodacePoZrodleAlternatywnym('platformazakupowa', [{ externalId: id, url }])).size, 0, 'inne źródło');
});

test('503 ze źródła: ok=false ze śladem', async () => {
  const w = await runOknoEpp({ fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }), odstepMs: 0 });
  assert.equal(w.ok, false);
  assert.match(w.error, /503/);
});
