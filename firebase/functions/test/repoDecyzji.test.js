import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders, matches, evaluations, dziennik, warunkiQuota, znacznikMailaSelekcji } = await import('../src/db/repos.js');

let seq = 0;
const user = () => users.create({ email: `rd${process.pid}-${++seq}@t.pl`, passwordHash: 'h' });
async function przetarg(extra = {}) {
  const { tender } = await tenders.upsert({ externalId: `rd-${process.pid}-${++seq}`, title: `Remont dachu ${seq}`,
    organization: 'Gmina', deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'podkarpackie', budget: 1000, ...extra });
  return tender;
}

test('utworzWybrany: dopasowanie z uzasadnieniem + ślad „wybrany”', async () => {
  const u = await user(); const t = await przetarg();
  const w = await matches.utworzWybrany({ userId: u.id, tender: t, score: 80, punkty: ['A', 'B'], scorer: 'ai',
    ocenaBezAi: false, criteriaHash: 'v1', zapiszSlad: true });
  assert.equal(w.created, true);
  const row = await matches.detail(u.id, t.id);
  assert.deepEqual(row.uzasadnienie, ['A', 'B']);
  assert.equal(row.match_reasoning, 'A B');
  assert.equal(row.notified, 0);
  assert.equal((await evaluations.pobierz(u.id, t.id)).decyzja, 'wybrany');
});

test('utworzWybrany na istniejącym: aktualizuje ocenę, nie rusza created_at ani notified', async () => {
  const u = await user(); const t = await przetarg();
  await matches.utworzWybrany({ userId: u.id, tender: t, score: 61, punkty: ['heur'], scorer: 'heuristic', ocenaBezAi: true, criteriaHash: 'v1', zapiszSlad: false });
  const przed = await matches.detail(u.id, t.id);
  assert.equal(await evaluations.pobierz(u.id, t.id), null, 'ocena bez AI nie zostawia śladu');
  await matches.markNotifiedBatch(u.id, [t.id]);
  const w = await matches.utworzWybrany({ userId: u.id, tender: t, score: 90, punkty: ['AI'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v1', zapiszSlad: true });
  assert.equal(w.created, false);
  const po = await matches.detail(u.id, t.id);
  assert.equal(po.created_at, przed.created_at);
  assert.equal(po.notified, 1);
  assert.equal(po.ocena_bez_ai, false);
  assert.deepEqual(po.uzasadnienie, ['AI']);
});

test('odrzucenia: przez klienta i przez selekcję znikają z „wybranych” i „do powiadomienia”', async () => {
  const u = await user(); const a = await przetarg(); const b = await przetarg(); const c = await przetarg();
  for (const t of [a, b, c]) await matches.utworzWybrany({ userId: u.id, tender: t, score: 80, punkty: ['x'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v1', zapiszSlad: true });
  assert.ok(await matches.oznaczOdrzuconyPrzezKlienta(u.id, a.id, { przyczyna: 'teren', komentarz: null }));
  assert.equal(await matches.oznaczOdrzuconyPrzezKlienta(u.id, 'nie-ma', { przyczyna: 'teren' }), null);
  assert.equal(await matches.oznaczOdrzuconyPrzezPracownika(u.id, b.id, { przyczyna: 'warunki', etap: 'warunki', criteriaHash: 'v1',
    szczegol: { pl: 'Obrót', en: 'Turnover' } }), true);
  const od = new Date(Date.now() - 3_600_000).toISOString();
  assert.deepEqual((await matches.wybraneOd(u.id, od)).map((r) => r.id), [c.id]);
  assert.deepEqual((await matches.doPowiadomienia(u.id, od)).map((r) => r.id), [c.id]);
  const ev = await evaluations.pobierz(u.id, b.id);
  assert.deepEqual([ev.decyzja, ev.przyczyna, ev.etap, ev.tytul], ['odrzucony', 'warunki', 'warunki', b.title]);
});

test('cofnijWyborBezAi dotyczy tylko wyborów bez AI', async () => {
  const u = await user(); const h = await przetarg(); const a = await przetarg();
  await matches.utworzWybrany({ userId: u.id, tender: h, score: 61, punkty: ['h'], scorer: 'heuristic', ocenaBezAi: true, criteriaHash: 'v1', zapiszSlad: false });
  await matches.utworzWybrany({ userId: u.id, tender: a, score: 90, punkty: ['a'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v1', zapiszSlad: true });
  assert.equal(await matches.cofnijWyborBezAi(u.id, h.id, { przyczyna: 'branza' }), true);
  assert.equal(await matches.cofnijWyborBezAi(u.id, a.id, { przyczyna: 'branza' }), false);
  assert.equal((await matches.detail(u.id, h.id)).odrzucony_przez_pracownika.przyczyna, 'branza');
});

test('evaluations.odrzucone: od najnowszych, filtr przyczyny, kursor, okno czasu', async () => {
  const u = await user();
  const ts = ['2026-10-20T10:00:00.000Z', '2026-10-21T10:00:00.000Z', '2026-10-22T10:00:00.000Z'];
  for (const [i, teraz] of ts.entries()) {
    const t = await przetarg();
    await evaluations.zapiszDecyzje(u.id, t.id, { decyzja: 'odrzucony', przyczyna: i === 1 ? 'teren' : 'za_duze', etap: 'regula',
      criteriaHash: 'v1', tender: t, teraz, szczegol: { pl: 'x', en: 'x' } });
  }
  const wszystkie = await evaluations.odrzucone(u.id, { od: '2026-10-01T00:00:00.000Z', limit: 2 });
  assert.deepEqual(wszystkie.map((r) => r.evaluated_at), [ts[2], ts[1]]);
  const dalej = await evaluations.odrzucone(u.id, { od: '2026-10-01T00:00:00.000Z', limit: 2, przed: evaluations.kursorZ(wszystkie[1]) });
  assert.deepEqual(dalej.map((r) => r.evaluated_at), [ts[0]]);
  assert.equal((await evaluations.odrzucone(u.id, { od: '2026-10-01T00:00:00.000Z', przyczyna: 'teren' })).length, 1);
  assert.equal((await evaluations.odrzucone(u.id, { od: '2026-10-22T00:00:00.000Z' })).length, 1);
});

test('dziennik: inkrementy z kilku przebiegów, odrzucone sumowane po przyczynie', async () => {
  const u = await user();
  await dziennik.dopisz(u.id, '2026-10-21', { przejrzane: 100, wybrane: 2, oczekuje: 5, odrzucone: { teren: 3, branza: 90 }, aiWywolan: 7, teraz: '2026-10-21T10:00:00.000Z' });
  await dziennik.dopisz(u.id, '2026-10-21', { przejrzane: 10, wybrane: 1, oczekuje: 0, odrzucone: { teren: 1 }, aiWywolan: 1, teraz: '2026-10-21T13:00:00.000Z' });
  const d = await dziennik.pobierz(u.id, '2026-10-21');
  assert.deepEqual([d.przejrzane, d.wybrane, d.oczekuje, d.odrzucone.teren, d.odrzucone.branza, d.ai_wywolan],
    [110, 3, 0, 4, 90, 8]);
  assert.equal(d.przebiegi.length, 2);
  assert.equal(await dziennik.pobierz(u.id, '2026-10-20'), null);
});

test('dziennik: cichy przebieg bez odrzuceń nie zeruje liczników z wcześniejszych przebiegów', async () => {
  // Przegląd 2026-10-24: pusta mapa w set+merge to „jawnie ustaw {}” — wieczorny przebieg bez nowych
  // ogłoszeń kasował licznik odrzuconych z całego dnia (raport w apce i mail Free zaniżone).
  const u = await user();
  await dziennik.dopisz(u.id, '2026-10-22', { przejrzane: 50, odrzucone: { teren: 3, branza: 40 }, teraz: '2026-10-22T10:00:00.000Z' });
  await dziennik.dopisz(u.id, '2026-10-22', { przejrzane: 0, odrzucone: {}, teraz: '2026-10-22T20:00:00.000Z' });
  await dziennik.dopisz(u.id, '2026-10-22', { przejrzane: 0, odrzucone: { teren: 0 }, teraz: '2026-10-22T23:00:00.000Z' });
  const d = await dziennik.pobierz(u.id, '2026-10-22');
  assert.deepEqual(d.odrzucone, { teren: 3, branza: 40 });
});

test('limit porównań warunków i znacznik maila dnia', async () => {
  const u = await user();
  assert.equal(await warunkiQuota.reserve(u.id, 1), true);
  assert.equal(await warunkiQuota.reserve(u.id, 1), false);
  assert.equal(await znacznikMailaSelekcji.zarezerwuj(u.id, '2026-10-21'), true);
  assert.equal(await znacznikMailaSelekcji.zarezerwuj(u.id, '2026-10-21'), false);
  await znacznikMailaSelekcji.zwolnij(u.id, '2026-10-21');
  assert.equal(await znacznikMailaSelekcji.zarezerwuj(u.id, '2026-10-21'), true);
});
