import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Zmiana terminu składania ofert z „ogłoszenia o zmianie ogłoszenia” BZP (2026-11-01). Fixture: pięć prawdziwych
 * ogłoszeń z 30.10 — wzorcowe (30.10 → 4.11), z dwukropkiem po „Termin składania ofert:”, dwie zmiany jednego
 * przetargu tego samego dnia (3.11 → 13.11, potem 13.11 → 9.11) i zmiana ogłoszenia o wykonaniu umowy (bez terminu).
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, tenderDocId, saved, alerty, historiaZmian } = await import('../src/db/repos.js');
const { getFirestore } = await import('firebase-admin/firestore');
const { zmianaTerminu, najnowszeZmiany, alertZmianyTerminu, tekstOgloszenia } = await import('../src/lib/zmianaTerminuBzp.js');
const { runZmianyTerminowBzp } = await import('../src/jobs/zmianyTerminowBzp.js');

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/bzp-zmiany-ogloszen.json', import.meta.url), 'utf8'));
const TERAZ = Date.parse('2026-10-30T12:00:00Z');

test('parser: numer zmienianego i termin przed/po (czas polski → UTC); zmiana bez terminu → null', () => {
  const [wzorcowe, dwukropek, pierwsza, bezTerminu, druga] = FIXTURE.map(zmianaTerminu);
  assert.deepEqual(wzorcowe, {
    numerZmienianego: '2026/BZP 00500202', postepowanieId: 'ocds-148610-2e4714b9-37a5-4c28-a4c9-6e01f4017ce7',
    staryTermin: '2026-10-30T09:00:00.000Z', nowyTermin: '2026-11-04T09:00:00.000Z',
    opublikowano: '2026-10-30T06:01:46.8659041Z', numer: '2026/BZP 00510617/01',
  });
  assert.deepEqual([dwukropek.numerZmienianego, dwukropek.nowyTermin], ['2026/BZP 00503120', '2026-11-05T11:00:00.000Z']);
  assert.deepEqual([pierwsza.nowyTermin, druga.nowyTermin], ['2026-11-13T10:00:00.000Z', '2026-11-09T07:00:00.000Z']);
  assert.equal(bezTerminu, null);
});

test('parser: „godz. 9:00”, encje HTML i brak numeru zmienianego', () => {
  const html = '<h3>3.2.) Numer zmienianego ogłoszenia w BZP: 2026/BZP 00412345</h3><p>8.1. Termin składania ofert</p><p>Przed zmian&#261;: 2026-11-02 godz. 9:00</p><p>Po zmianie:&nbsp;2026-11-05 godz. 10:00</p>';
  assert.match(tekstOgloszenia(html), /Przed zmianą: 2026-11-02/);
  const z = zmianaTerminu({ htmlBody: html, publicationDate: '2026-10-31T08:00:00Z' });
  assert.deepEqual([z.numerZmienianego, z.staryTermin, z.nowyTermin], ['2026/BZP 00412345', '2026-11-02T08:00:00.000Z', '2026-11-05T09:00:00.000Z']);
  assert.equal(zmianaTerminu({ htmlBody: '<p>8.1. Termin składania ofert Przed zmianą: 2026-11-02 10:00 Po zmianie: 2026-11-05 10:00</p>' }), null);
});

test('najnowsza zmiana na ogłoszenie wygrywa; alert: wcześniej = ostrzeżenie, klucz przetarg × nowy termin', () => {
  const najnowsze = najnowszeZmiany(FIXTURE.map(zmianaTerminu));
  assert.equal(najnowsze.length, 3);
  assert.equal(najnowsze.find((z) => z.numerZmienianego === '2026/BZP 00490611').nowyTermin, '2026-11-09T07:00:00.000Z');

  const tender = { id: '2026~BZP_00490611', title: 'Dostawa paliw', organization: 'Gmina Krasne' };
  const a = alertZmianyTerminu({ tender, staryTermin: '2026-11-13T10:00:00.000Z', nowyTermin: '2026-11-09T07:00:00.000Z' });
  assert.equal(a.typ, 'zmiany');
  assert.equal(a.ton, 'ostrzezenie');
  assert.equal(a.klucz, 'termin_2026~BZP_00490611_2026-11-09T07_00');
  assert.equal(a.tytul.pl, 'Termin ofert WCZEŚNIEJ: Dostawa paliw');
  assert.equal(a.tresc.pl, 'Gmina Krasne zmienił termin składania ofert: 09.11.2026, 08:00 (było 13.11.2026, 11:00). Przypomnienie ustawiliśmy na nowy termin.');
  const pozniej = alertZmianyTerminu({ tender, staryTermin: '2026-10-30T09:00:00.000Z', nowyTermin: '2026-11-04T09:00:00.000Z' });
  assert.deepEqual([pozniej.ton, pozniej.tytul.pl.startsWith('Nowy termin ofert:')], ['neutral', true]);
});

function atrapy({ stan }) {
  const aktualizacje = [];
  const dodane = new Set();
  const push = [];
  return {
    aktualizacje, push,
    deps: {
      teraz: TERAZ,
      pobierzDzien: async (dzien) => (dzien === '2026-10-30' ? FIXTURE : []),
      przetargi: {
        polaWielu: async (ids) => ids.map((id) => stan[id] && { id, ...stan[id] }).filter(Boolean),
        zaktualizujZeZrodla: async (t) => { aktualizacje.push(t); return { zmienione: true }; },
      },
      zapisane: { otwarteWszystkich: async () => [{ userId: 'u1', tenderId: '2026~BZP_00500202' }], zaangazowaneWszystkich: async () => [{ userId: 'u2', tenderId: '2026~BZP_00500202' }] },
      konta: { findById: async (id) => ({ id, push_token: `tok-${id}` }) },
      alertyRepo: { dodaj: async (uid, a) => { const k = `${uid}/${a.klucz}`; const nowy = !dodane.has(k); dodane.add(k); return { nowy }; } },
      wyslijPush: async (token, tresc) => { push.push([token, tresc.data.type]); return { sent: 1 }; },
      wyslijEmail: async () => {},
    },
  };
}

test('job: aktualizuje tylko inny termin; zmiana starsza od zastosowanej nie cofa; alert do zaangażowanych raz', async () => {
  const stan = {
    '2026~BZP_00500202': { deadline: '2026-10-30T09:00:00.000Z', title: 'Dostawa sprzętu komputerowego', organization: 'PUW' },
    '2026~BZP_00503120': { deadline: '2026-11-05T11:00:00.000Z' },
    '2026~BZP_00490611': { deadline: '2026-11-20T09:00:00.000Z', termin_zmiana_o: '2026-10-31T09:00:00Z' },
  };
  const { deps, aktualizacje, push } = atrapy({ stan });
  const w = await runZmianyTerminowBzp(deps);
  assert.deepEqual([w.dob, w.ogloszen, w.zmian_terminu, w.w_bazie, w.zaktualizowane, w.alerty, w.ok], [2, 5, 3, 3, 1, 2, true]);
  assert.deepEqual(aktualizacje, [{ externalId: '2026/BZP 00500202', deadline: '2026-11-04T09:00:00.000Z', termin_zmiana_o: '2026-10-30T06:01:46.8659041Z', termin_zmiana_numer: '2026/BZP 00510617/01' }]);
  assert.deepEqual(push, [['tok-u1', 'zmiany'], ['tok-u2', 'zmiany']]);
  // Powtórka po zapisie: termin już ten sam — nic.
  stan['2026~BZP_00500202'].deadline = '2026-11-04T09:00:00.000Z';
  const w2 = await runZmianyTerminowBzp(deps);
  assert.deepEqual([w2.zaktualizowane, w2.alerty], [0, 0]);
});

test('job na emulatorze: przetarg, kopia w Zapisanych z przypomnieniem, historia „termin” i alert', async () => {
  const db = getFirestore();
  const uid = `zt${process.pid}x${Date.now()}`;
  await db.collection('users').doc(uid).set({ email: `${uid}@test.pl` });
  // Przypomnienia liczą się od prawdziwego „teraz” — terminy względem bieżącej chwili, pełne godziny.
  const godzina = (dni) => Math.ceil((Date.now() + dni * 86_400_000) / 3_600_000) * 3_600_000;
  const polski = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
  const [stary, nowy] = [godzina(2), godzina(12)];
  const numer = `2026/BZP ${String(Date.now()).slice(-8)}`;
  const ogloszenie = {
    noticeNumber: '2026/BZP 99999999/01', publicationDate: new Date().toISOString(),
    htmlBody: `<p>3.2.) Numer zmienianego ogłoszenia w BZP: ${numer}</p><p>8.1. Termin składania ofert Przed zmianą: ${polski(stary)} Po zmianie: ${polski(nowy)}</p>`,
  };
  const { tender } = await tenders.upsert({ externalId: numer, title: 'Dostawa sprzętu komputerowego i monitorów', organization: 'PODKARPACKI URZĄD WOJEWÓDZKI W RZESZOWIE', deadline: new Date(stary).toISOString(), source: 'bzp' });
  assert.equal(tender.id, tenderDocId(numer));
  await saved.add(uid, { tender_id: tender.id, tender_title: tender.title, tender_deadline: tender.deadline, tender_source: 'bzp' });
  assert.equal((await saved.setReminder(uid, tender.id, true)).reminder_enabled, true);
  const push = [];
  const w = await runZmianyTerminowBzp({
    dni: 1, pobierzDzien: async () => [ogloszenie],
    wyslijPush: async () => ({ sent: 1 }), wyslijEmail: async (m) => { push.push(m.subject); },
  });
  assert.equal(w.zaktualizowane, 1);
  const t = await tenders.findById(tender.id);
  assert.deepEqual([t.deadline, t.termin_zmiana_numer], [new Date(nowy).toISOString(), '2026/BZP 99999999/01']);
  const kopia = (await db.doc(`users/${uid}/saved/${tender.id}`).get()).data();
  assert.equal(kopia.tender_deadline, new Date(nowy).toISOString());
  assert.ok(kopia.remind_at > new Date(stary).toISOString(), 'przypomnienie liczone od nowego terminu');
  assert.ok((await historiaZmian.lista(tender.id)).some((z) => z.typ === 'termin'));
  assert.ok((await alerty.lista(uid)).some((a) => a.typ === 'zmiany' && a.tender_id === tender.id));
  assert.deepEqual(push, ['Nowy termin ofert: Dostawa sprzętu komputerowego i monitorów'], 'konto bez pushu dostaje e-mail');
});
