import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Testy warstwy danych Firestore (F2) — biegają na EMULATORZE:
 *   npm run test:emu   (emulators:exec ustawia FIRESTORE_EMULATOR_HOST)
 * Bez emulatora ten plik pomija się w całości zamiast dotykać produkcji.
 */


const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, tenders, matches, evaluations, magicLinks, aiUsage, tenderDocId } =
  await import('../src/db/repos.js');


test('users.create — drugi user z tym samym e-mailem odbija się o DUPLICATE_EMAIL', async () => {
  await users.create({ email: 'a@t.pl', passwordHash: 'h', keywords: ['x'] });
  await assert.rejects(
    () => users.create({ email: 'a@t.pl', passwordHash: 'h2' }),
    (err) => err.code === 'DUPLICATE_EMAIL',
  );
});

test('users.create — NIP unikalny, ale DWA konta bez NIP-u nie kolidują', async () => {
  await users.create({ email: 'nip1@t.pl', passwordHash: 'h', companyNip: '1234563218' });
  await assert.rejects(
    () => users.create({ email: 'nip2@t.pl', passwordHash: 'h', companyNip: '1234563218' }),
    (err) => err.code === 'DUPLICATE_NIP',
  );
  const b1 = await users.create({ email: 'beznipa@t.pl', passwordHash: 'h' });
  const b2 = await users.create({ email: 'beznipb@t.pl', passwordHash: 'h' });
  assert.ok(b1.id && b2.id);
  assert.equal(b1.company_nip, null);
});

test('users — findByEmail/updateProfile/setTier działają po porcie', async () => {
  const u = await users.create({ email: 'prof@t.pl', passwordHash: 'h', keywords: ['droga'] });
  const znaleziony = await users.findByEmail('prof@t.pl');
  assert.equal(znaleziony.id, u.id);

  await users.updateProfile(u.id, { companyName: 'Firma X', keywords: ['droga', 'most'], cpvCodes: ['45233000'] });
  const po = await users.findById(u.id);
  assert.deepEqual(po.keywords, ['droga', 'most']);
  assert.equal(po.company_name, 'Firma X');

  await users.setTier(u.id, 'standard');
  assert.equal((await users.findById(u.id)).premium_tier, 'standard');
});

test('tenderDocId — numer BZP ze slashami staje się legalnym docId', () => {
  assert.equal(tenderDocId('2026/BZP 00298765/01'), '2026~BZP_00298765~01');
  assert.ok(!tenderDocId('2026/BZP 00298765/01').includes('/'));
});

test('tenders.upsert — pierwszy raz created:true, drugi raz created:false i te same dane', async () => {
  const t = { externalId: '2026/BZP 00000001/01', title: 'Budowa drogi gminnej', deadline: '2099-01-01T00:00:00.000Z' };
  const pierwszy = await tenders.upsert(t);
  const drugi = await tenders.upsert({ ...t, title: 'INNY TYTUŁ — ma być zignorowany' });
  assert.equal(pierwszy.created, true);
  assert.equal(drugi.created, false);
  assert.equal(drugi.tender.title, 'Budowa drogi gminnej');
  assert.equal(pierwszy.tender.id, tenderDocId(t.externalId));
});

test('tenders.upsert — UZUPEŁNIA brakujące meta na istniejącym przetargu (audyt R12)', async () => {
  const ext = '2026/BZP 00000099/01';
  // Symulacja przetargu zapisanego STARYM kodem — bez pól wadium/kryterium/części.
  const { getFirestore } = await import('firebase-admin/firestore');
  await getFirestore().collection('tenders').doc(tenderDocId(ext)).set({
    bzp_external_id: ext, title: 'Stary przetarg', source: 'bzp', deadline: '2099-01-01T00:00:00.000Z',
  });

  // Dzienne re-pobieranie przynosi te same ogłoszenie, ale już z meta z htmlBody.
  const { tender } = await tenders.upsert({
    externalId: ext, title: 'Stary przetarg', deadline: '2099-01-01T00:00:00.000Z',
    wadium_wymagane: true, wadium_kwota: 7800, kryterium_oceny: 'cena_i_jakosc', liczba_czesci: 3,
  });

  assert.equal(tender.wadium_wymagane, true, 'meta uzupełnione, nie zgubione jak dawniej');
  assert.equal(tender.wadium_kwota, 7800);
  assert.equal(tender.kryterium_oceny, 'cena_i_jakosc');
  assert.equal(tender.liczba_czesci, 3);
  // Potwierdzenie z bazy.
  const zBazy = await tenders.findById(tenderDocId(ext));
  assert.equal(zBazy.wadium_kwota, 7800);
});

test('tenders.openPool — otwarty i bezterminowy wchodzą, po terminie odpada', async () => {
  await tenders.upsert({ externalId: 'pool-otwarty', title: 'Otwarty', deadline: '2099-01-01T00:00:00.000Z' });
  await tenders.upsert({ externalId: 'pool-bez', title: 'Bez terminu', deadline: null });
  await tenders.upsert({ externalId: 'pool-po', title: 'Po terminie', deadline: '2020-01-01T00:00:00.000Z' });

  const pula = await tenders.openPool();
  const ids = pula.map((t) => t.id);
  assert.ok(ids.includes('pool-otwarty'));
  assert.ok(ids.includes('pool-bez'), 'brak terminu nie może wykluczać z puli');
  assert.ok(!ids.includes('pool-po'));
});

test('matches — duplikat niemożliwy, countToday liczy, feed sortuje od najnowszych', async () => {
  const u = await users.create({ email: 'match@t.pl', passwordHash: 'h', keywords: ['x'] });
  const { tender } = await tenders.upsert({ externalId: 'm-1', title: 'Przetarg A', deadline: null });

  const pierwszy = await matches.create({ userId: u.id, tenderId: tender.id, score: 80, reasoning: 'ok', scorer: 'heuristic', tender });
  const duplikat = await matches.create({ userId: u.id, tenderId: tender.id, score: 90, reasoning: 'dup', scorer: 'heuristic', tender });
  assert.equal(pierwszy.created, true);
  assert.equal(duplikat.created, false);

  assert.equal(await matches.countToday(u.id), 1);
  assert.equal(await matches.exists(u.id, tender.id), true);

  const feed = await matches.listForUser(u.id, 10, 0);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].tender_title, 'Przetarg A', 'feed niesie zdenormalizowany tytuł — bez JOIN-a');

  const detal = await matches.detail(u.id, tender.id);
  assert.equal(detal.confidence_score, 80);
  assert.equal(detal.tender_title, 'Przetarg A', 'szczegóły niosą zdenormalizowane pola przetargu');
  // Optymalizacja 2026-07-29: detail NIE dociąga już całego tenderu (raw_data ~700 KB)
  // po nieużywane `tender_raw` — 1 odczyt Firestore zamiast 2.
  assert.equal(detal.tender_raw, undefined, 'detail nie może dociągać zbędnego tender_raw');
});

test('tenders.countSince — liczy przetargi pobrane od danej chwili (dowód społeczny na logowaniu)', async () => {
  await tenders.upsert({ externalId: `cs-${process.pid}-${Date.now()}`, title: 'Świeży przetarg', deadline: null });
  const godzineTemu = new Date(Date.now() - 3600_000).toISOString();
  const zaGodzine = new Date(Date.now() + 3600_000).toISOString();
  assert.ok((await tenders.countSince(godzineTemu)) >= 1, 'świeżo pobrany przetarg liczy się od godziny temu');
  assert.equal(await tenders.countSince(zaGodzine), 0, 'nic nie zostało pobrane „w przyszłości"');
});

test('matches — izolacja userów: cudze dopasowanie niewidoczne (IDOR z konstrukcji)', async () => {
  const a = await users.create({ email: 'iso-a@t.pl', passwordHash: 'h', keywords: ['x'] });
  const b = await users.create({ email: 'iso-b@t.pl', passwordHash: 'h', keywords: ['x'] });
  const { tender } = await tenders.upsert({ externalId: 'iso-t', title: 'Izolacja', deadline: null });
  await matches.create({ userId: a.id, tenderId: tender.id, score: 70, scorer: 'heuristic', tender });

  assert.equal(await matches.detail(b.id, tender.id), null, 'user B nie widzi dopasowania usera A');
  assert.equal((await matches.listForUser(b.id)).length, 0);
});

test('AUDYT: paginacja kursorem nie gubi dopasowań z identycznym created_at', async () => {
  /*
   * Cykl zapisuje dopasowania seriami — `nowIso()` ma rozdzielczość milisekundy,
   * więc 200 kolejnych wywołań daje zaledwie kilka różnych znaczników. Kursor po
   * samym czasie przeskakiwałby całe grupy albo pokazywał je dwukrotnie.
   */
  const u = await users.create({ email: `pag${process.pid}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  const ILE = 7;

  for (let i = 0; i < ILE; i++) {
    const { tender } = await tenders.upsert({ externalId: `pag-${process.pid}-${i}`, title: `Przetarg ${i}`, deadline: null });
    await matches.createWithEvaluation({
      userId: u.id, tenderId: tender.id, score: 70, scorer: 'heuristic', tender, criteriaHash: 'h',
    });
  }

  // Wymuszamy KOLIZJĘ: wszystkie dopasowania dostają ten sam znacznik czasu.
  const wszystkie = await matches.listForUser(u.id, 50);
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore();
  for (const m of wszystkie) {
    await db.collection('users').doc(u.id).collection('matches').doc(m.id)
      .set({ created_at: '2026-07-10T12:00:00.000Z' }, { merge: true });
  }

  // Przechodzimy feed stronami po 3 i zbieramy identyfikatory.
  const zebrane = [];
  let kursor = null;
  for (let strona = 0; strona < 10; strona++) {
    const rows = await matches.listForUser(u.id, 3, kursor);
    if (!rows.length) break;
    zebrane.push(...rows.map((r) => r.id));
    if (rows.length < 3) break;
    kursor = matches.kursorZ(rows[rows.length - 1]);
  }

  assert.equal(zebrane.length, ILE, `paginacja zwróciła ${zebrane.length} z ${ILE} dopasowań`);
  assert.equal(new Set(zebrane).size, ILE, 'żadne dopasowanie nie może się powtórzyć');
});

test('AUDYT: gdy dopasowanie już istnieje, ślad oceny MIMO TO się zapisuje', async () => {
  /*
   * `batch.create` na istniejącym dokumencie wywraca CAŁY batch — także zapis
   * śladu. Bez śladu `idsAmong` nie odsieje kandydata i nazajutrz zapłacimy AI
   * za ten sam przetarg. Zdarza się po zmianie kryteriów: nowy odcisk unieważnia
   * stary ślad, a dopasowanie z poprzedniego profilu wciąż istnieje.
   */
  const u = await users.create({ email: `dup${process.pid}@t.pl`, passwordHash: 'h', keywords: ['x'] });
  const { tender } = await tenders.upsert({ externalId: `dup-${process.pid}`, title: 'Przetarg', deadline: null });

  const pierwszy = await matches.createWithEvaluation({
    userId: u.id, tenderId: tender.id, score: 80, reasoning: 'ok', scorer: 'ai', tender, criteriaHash: 'stary',
  });
  assert.equal(pierwszy.created, true);

  // Drugie podejście z NOWYM odciskiem kryteriów — dopasowanie już jest.
  const drugi = await matches.createWithEvaluation({
    userId: u.id, tenderId: tender.id, score: 85, reasoning: 'ok2', scorer: 'ai', tender, criteriaHash: 'nowy',
  });
  assert.equal(drugi.created, false, 'dopasowanie nie może się zdublować');

  const podNowym = await evaluations.idsAmong(u.id, [tender.id], 'nowy');
  assert.ok(podNowym.has(tender.id), 'ślad musi powstać także wtedy, gdy dopasowanie już istniało');
});

test('evaluations — idsAmong zwraca dokładnie oceniane, resztę pomija', async () => {
  const u = await users.create({ email: 'eval@t.pl', passwordHash: 'h', keywords: ['x'] });
  await evaluations.record(u.id, 'ev-1', { score: 30, scorer: 'heuristic' });
  await evaluations.record(u.id, 'ev-2', { score: 45, scorer: 'ai' });

  const ocenione = await evaluations.idsAmong(u.id, ['ev-1', 'ev-2', 'ev-3']);
  assert.deepEqual([...ocenione].sort(), ['ev-1', 'ev-2']);
  assert.deepEqual([...await evaluations.idsAmong(u.id, [])], []);
});

test('magicLinks — link działa DOKŁADNIE raz, przeterminowany odpada', async () => {
  const u = await users.create({ email: 'magic@t.pl', passwordHash: 'h' });
  const { token } = await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: 10 });

  assert.equal(await magicLinks.consume(token, 'upgrade'), u.id);
  assert.equal(await magicLinks.consume(token, 'upgrade'), null, 'drugie zużycie musi odpaść');
  assert.equal(await magicLinks.consume('nie-istnieje', 'upgrade'), null);

  const { token: przeterminowany } = await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: -1 });
  assert.equal(await magicLinks.consume(przeterminowany, 'upgrade'), null);
});

test('magicLinks.peek — waliduje BEZ zużywania (ścieżka pieniędzy /upgrade)', async () => {
  /*
   * Runda 30: peek to walidacja przed utworzeniem sesji Stripe — zużycie następuje
   * dopiero PO sukcesie, inaczej przejściowy błąd Stripe paliłby jednorazowy token.
   */
  const u = await users.create({ email: `peek-${process.pid}@t.pl`, passwordHash: 'h' });
  const { token } = await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: 10 });

  assert.equal(await magicLinks.peek(token, 'upgrade'), u.id);
  assert.equal(await magicLinks.peek(token, 'upgrade'), u.id, 'peek NIE zużywa — drugi odczyt też działa');
  assert.equal(await magicLinks.consume(token, 'upgrade'), u.id, 'po peek consume wciąż możliwe');

  assert.equal(await magicLinks.peek(token, 'upgrade'), null, 'zużyty link odpada');
  assert.equal(await magicLinks.peek('nie-istnieje', 'upgrade'), null);

  const { token: innyCel } = await magicLinks.create({ userId: u.id, purpose: 'login', ttlMinutes: 10 });
  assert.equal(await magicLinks.peek(innyCel, 'upgrade'), null, 'niewłaściwy purpose odpada');

  const { token: martwy } = await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: -1 });
  assert.equal(await magicLinks.peek(martwy, 'upgrade'), null, 'przeterminowany odpada');
});

test('magicLinks.consume z expectedUserId — cudze user_id NIE pali tokenu ofiary', async () => {
  const u = await users.create({ email: `own-${process.pid}@t.pl`, passwordHash: 'h' });
  const { token } = await magicLinks.create({ userId: u.id, purpose: 'upgrade', ttlMinutes: 10 });

  assert.equal(await magicLinks.consume(token, 'upgrade', { expectedUserId: 'napastnik' }), null,
    'niedopasowany właściciel = odmowa');
  assert.equal(await magicLinks.consume(token, 'upgrade', { expectedUserId: u.id }), u.id,
    'token MUSI przetrwać cudzą próbę — inaczej ofiara traci możliwość ulepszenia planu');
});

test('aiUsage — agregat miesięczny sumuje koszty i liczbę wywołań', async () => {
  const przed = await aiUsage.monthCostUsd();
  await aiUsage.record({ operation: 'match', model: 'claude-haiku-4-5', inputTokens: 1000, outputTokens: 100, costUsd: 0.0015 });
  await aiUsage.record({ operation: 'match', model: 'claude-haiku-4-5', inputTokens: 2000, outputTokens: 200, costUsd: 0.003 });
  const po = await aiUsage.monthCostUsd();
  assert.ok(Math.abs(po - przed - 0.0045) < 1e-9, `agregat: ${przed} → ${po}`);
});
