import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Unieważnienie z ogłoszenia o wyniku (2026-11-01). Fałszywe unieważnienie chowa żywy przetarg, więc oznaczamy tylko
 * pewne przypadki: wszystkie wyniki postępowania z samymi unieważnieniami, znana liczba części pokryta przez wyniki,
 * przetarg opublikowany przed wynikiem. Pierwsza wersja anulowała przetargi z nieznaną liczbą części (TED, starsze BZP).
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, saved } = await import('../src/db/repos.js');
const { runUniewaznioneZWyniku, pewnieUniewazniony, liczbaCzesciPrzetargu } = await import('../src/jobs/uniewaznioneZWyniku.js');
const { getFirestore } = await import('firebase-admin/firestore');

const ZNAK = `uw${process.pid}x${Date.now()}`;
const zaDni = (d) => new Date(Math.ceil((Date.now() + d * 86_400_000) / 3_600_000) * 3_600_000).toISOString();
const U = (numer) => ({ numer, uniewaznione: true });

test('pewność: znana liczba części pokryta, wszystkie wyniki unieważnione, przetarg sprzed wyniku', () => {
  const bzp = { source: 'bzp', liczba_czesci: 2, published_at: '2026-10-01T00:00:00Z' };
  assert.equal(pewnieUniewazniony(bzp, [{ czesci: [U(1), U(2)], opublikowano: '2026-10-20' }]), true);
  assert.equal(pewnieUniewazniony(bzp, [{ czesci: [U(1)], opublikowano: '2026-10-20' }]), false, 'wynik dla 1 z 2 części');
  assert.equal(pewnieUniewazniony(bzp, [{ czesci: [U(1)], opublikowano: '2026-10-20' }, { czesci: [U(2)], opublikowano: '2026-10-25' }]), true, 'dwa wyniki po częściach');
  assert.equal(pewnieUniewazniony(bzp, [{ czesci: [U(1), U(2)] }, { czesci: [{ numer: 2, uniewaznione: false }] }]), false, 'inny wynik rozstrzyga część');
  assert.equal(pewnieUniewazniony({ ...bzp, liczba_czesci: null }, [{ czesci: [U(1)] }]), false, 'liczba części nieznana');
  assert.equal(pewnieUniewazniony({ ...bzp, published_at: '2026-10-21T00:00:00Z' }, [{ czesci: [U(1), U(2)], opublikowano: '2026-10-20' }]), false, 'ogłoszony po wyniku');
  assert.equal(pewnieUniewazniony(bzp, []), false);

  const ted = (n) => ({ source: 'ted', raw_data: JSON.stringify({ 'deadline-receipt-tender-date-lot': Array(n).fill('2026-11-04+01:00') }) });
  assert.equal(liczbaCzesciPrzetargu(ted(4)), 4);
  assert.equal(liczbaCzesciPrzetargu({ source: 'ted', raw_data: '{zły json' }), null);
  assert.equal(pewnieUniewazniony(ted(4), [{ czesci: [U(1)] }]), false, 'TED: wynik dla jednej z czterech części');
  assert.equal(pewnieUniewazniony(ted(1), [{ czesci: [U(1)] }]), true);
});

test('job na emulatorze: oznacza tylko pewne; przypomnienie wyłączone; powtórka nic nie robi', async () => {
  const db = getFirestore();
  const uid = `${ZNAK}-konto`;
  await db.collection('users').doc(uid).set({ email: `${uid}@test.pl` });
  const baza = { organization: 'Gmina Olszanka', source: 'bzp', deadline: zaDni(5), publishedAt: '2026-10-01T08:00:00Z' };
  const { tender: pewny } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/1`, title: 'Kredyt długoterminowy', postepowanie_id: `ocds-${ZNAK}-1`, liczba_czesci: 1 });
  const { tender: nieznane } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/n`, title: 'Dostawa gazu', postepowanie_id: `ocds-${ZNAK}-n` });
  const { tender: czesc } = await tenders.upsert({ ...baza, externalId: `${ZNAK}/3`, title: 'Dostawy żywności', postepowanie_id: `ocds-${ZNAK}-3`, liczba_czesci: 3 });
  await saved.add(uid, { tender_id: pewny.id, tender_title: pewny.title, tender_deadline: pewny.deadline, tender_source: 'bzp' });
  await saved.setReminder(uid, pewny.id, true);

  const wynikiWBazie = {
    [`ocds-${ZNAK}-1`]: [{ czesci: [U(1)], opublikowano: '2026-10-20' }],
    [`ocds-${ZNAK}-n`]: [{ czesci: [U(1)], opublikowano: '2026-10-20' }],
    [`ocds-${ZNAK}-3`]: [{ czesci: [U(1)], opublikowano: '2026-10-20' }],
  };
  const repoWynikow = {
    wszystkieDlaPostepowania: async (pid) => wynikiWBazie[pid] ?? [],
    strona: async () => ({ pozycje: Object.entries(wynikiWBazie).map(([pid, [w]]) => ({ postepowanie_id: pid, ...w })), koniec: true, kursor: null }),
  };
  const wyniki = Object.keys(wynikiWBazie).map((pid) => ({ tenderId: pid, czesci: [U(1)] }));
  const w = await runUniewaznioneZWyniku({ wyniki, repoWynikow });
  assert.deepEqual([w.postepowan, w.przetargow, w.oznaczone, w.niepewne, w.ok], [3, 3, 1, 2, true]);
  assert.equal((await tenders.findById(pewny.id)).anulowany, true);
  assert.notEqual((await tenders.findById(nieznane.id)).anulowany, true, 'nieznana liczba części — zostaje');
  assert.notEqual((await tenders.findById(czesc.id)).anulowany, true, 'wynik objął 1 z 3 części — zostaje');
  const kopia = (await db.doc(`users/${uid}/saved/${pewny.id}`).get()).data();
  assert.deepEqual([kopia.tender_anulowany, kopia.reminder_enabled], [true, false]);

  assert.equal((await runUniewaznioneZWyniku({ wyniki, repoWynikow })).oznaczone, 0, 'powtórka');
  assert.equal((await runUniewaznioneZWyniku({ repoWynikow })).oznaczone, 0, 'uzupełnianie wstecz — ta sama reguła');
});
