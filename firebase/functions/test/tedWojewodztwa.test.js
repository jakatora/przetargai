import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Województwa TED wstecz (2026-11-07): otwarte TED bez województwa dostają kod z NUTS (przetarg i kopie w feedach),
 * „kilka województw” (null) zostaje bez zmian, a konta z terenem dostają pełny przegląd w najbliższym przebiegu.
 */
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { getFirestore } = await import('firebase-admin/firestore');
const { tenders, users, matches } = await import('../src/db/repos.js');
const { runTedWojewodztwa } = await import('../src/jobs/tedWojewodztwa.js');
const { pobierzWojewodztwaTed } = await import('../src/services/ted.js');

const Z = `${process.pid}${Date.now()}`.slice(-6);

test('pobierzWojewodztwaTed: jedno województwo z NUTS, kilka = null; złe numery pomijane', async () => {
  const pytania = [];
  const fetchFn = async (_url, opcje) => {
    pytania.push(JSON.parse(opcje.body).query);
    return { ok: true, json: async () => ({ notices: [
      { 'publication-number': '707289-2026', 'place-of-performance-subdiv-lot': ['PL417'], 'buyer-country-sub': ['PL417'] },
      { 'publication-number': '1-2026', 'place-of-performance-subdiv-lot': ['PL424', 'PL633'], 'buyer-country-sub': ['PL911'] },
    ] }) };
  };
  const w = await pobierzWojewodztwaTed(['707289-2026', '1-2026', 'zly numer'], { fetchFn });
  assert.deepEqual(pytania, ['publication-number IN (707289-2026 1-2026)']);
  assert.deepEqual([w.get('707289-2026'), w.get('1-2026')], ['30', null]);
});

test('runTedWojewodztwa: uzupełnia przetarg i kopię w feedzie, wymusza przegląd kont z terenem', async () => {
  const { tender: t1 } = await tenders.upsert({ externalId: `ted:9${Z}1-2094`, title: 'Dostawa paliwa', organization: 'Szpital', deadline: '2094-01-01T00:00:00.000Z', source: 'ted' });
  const { tender: t2 } = await tenders.upsert({ externalId: `ted:9${Z}2-2094`, title: 'Drogi krajowe', organization: 'GDDKiA', deadline: '2094-01-01T00:00:00.000Z', source: 'ted' });
  const u = await users.create({ email: `tw${Z}@t.pl`, passwordHash: 'h', keywords: ['paliwo'] });
  await users.zapiszKarte(u.id, { companyName: null, keywords: ['paliwo'], cpvCodes: [], regiony: ['32'], wartoscMax: null,
    karta: { opis: null, wykluczenia: [], wartosc_min: null, min_dni_oferta: 5, formalne: { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] } } });
  await getFirestore().doc(`users/${u.id}`).update({ pracownik_wersja: 'v-bez-zmian', pracownik_ostatni_przebieg: '2094-01-01T00:00:00.000Z' });
  await matches.utworzWybrany({ userId: u.id, tender: t1, score: 80, punkty: ['Paliwo'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: false });

  const w = await runTedWojewodztwa({ teraz: '2093-12-01T00:00:00.000Z', pobierz: async (numery) => new Map(numery.map((n) => [n, n.startsWith(`9${Z}1`) ? '30' : null])) });
  assert.ok(w.uzupelnione >= 1 && w.konta_do_przegladu >= 1);
  assert.equal((await tenders.findById(t1.id)).wojewodztwo, '30');
  assert.equal((await tenders.findById(t2.id)).wojewodztwo ?? null, null, 'kilka województw — bez zmian');
  assert.equal((await getFirestore().doc(`users/${u.id}/matches/${t1.id}`).get()).get('tender_wojewodztwo'), '30');
  assert.equal((await users.findById(u.id)).pracownik_wersja, 'przeglad-terenu');
});
