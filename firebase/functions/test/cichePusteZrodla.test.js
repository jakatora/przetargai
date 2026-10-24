import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Alarm „źródło cicho puste" (2026-10-24): BZP/TED bez surowych ogłoszeń w dzień roboczy
 * mimo cyklu `ok`. Mail najwyżej raz na dobę (ten sam znacznik co alarm AI, osobny dokument);
 * nieudana wysyłka zwalnia znacznik; weekend i źródła z danymi nie alarmują.
 */

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { alarmujCichePusteZrodla } = await import('../src/jobs/alarmZrodla.js');
const { alarmZrodlaEmail } = await import('../src/services/email.js');
const { alarmZrodla } = await import('../src/db/repos.js');
const { getFirestore } = await import('firebase-admin/firestore');

after(async () => {
  await getFirestore().collection('_health').doc('alarm_zrodla').delete();
});

const CZWARTEK = new Date('2026-10-22T10:05:00.000Z');
const SOBOTA = new Date('2026-10-24T10:05:00.000Z');
const ZERO_BZP = { ok: true, zrodla: { bzp: { fetched: 0, surowe: 0 }, ted: { fetched: 1631, surowe: 1631 }, baza_konkurencyjnosci: { fetched: 0, surowe: 1085 } } };

function skrzynka(sent = true) {
  const wyslane = [];
  return { wyslane, wyslij: async (msg) => { wyslane.push(msg); return { sent, id: sent ? 'email-1' : null, error: sent ? null : 'resend down' }; } };
}

test('BZP cicho puste w czwartek → jeden mail dziś, drugi przebieg tego samego dnia nic nie wysyła', async () => {
  const s = skrzynka();
  const r1 = await alarmujCichePusteZrodla({ wynik: ZERO_BZP, zakonczonoIso: CZWARTEK.toISOString() }, { wyslij: s.wyslij, teraz: CZWARTEK });
  assert.deepEqual(r1, { wyslano: true, zrodla: ['bzp'] });
  assert.equal(s.wyslane.length, 1);
  assert.match(s.wyslane[0].subject, /BZP nie dało dziś ANI JEDNEGO/);
  assert.match(s.wyslane[0].text, /ezamowienia\.gov\.pl/);
  const r2 = await alarmujCichePusteZrodla({ wynik: ZERO_BZP, zakonczonoIso: CZWARTEK.toISOString() }, { wyslij: s.wyslij, teraz: CZWARTEK });
  assert.equal(r2.powod, 'juz_wyslany_dzis');
  assert.equal(s.wyslane.length, 1);
  const znacznik = await alarmZrodla.wczytaj();
  assert.equal(znacznik.stan, 'wyslany');
  assert.equal(znacznik.typ, 'bzp');
});

test('nieudana wysyłka zwalnia znacznik — następny dzień wysyła ponownie, a ten sam dzień ponawia', async () => {
  await getFirestore().collection('_health').doc('alarm_zrodla').delete();
  const zla = skrzynka(false);
  const r = await alarmujCichePusteZrodla({ wynik: ZERO_BZP, zakonczonoIso: CZWARTEK.toISOString() }, { wyslij: zla.wyslij, teraz: CZWARTEK });
  assert.equal(r.powod, 'wysylka_nieudana');
  const dobra = skrzynka(true);
  const r2 = await alarmujCichePusteZrodla({ wynik: ZERO_BZP, zakonczonoIso: CZWARTEK.toISOString() }, { wyslij: dobra.wyslij, teraz: CZWARTEK });
  assert.equal(r2.wyslano, true, 'po zwolnieniu znacznika ponowienie dosyła');
});

test('sobota albo źródła z danymi → bez maila i bez znacznika', async () => {
  await getFirestore().collection('_health').doc('alarm_zrodla').delete();
  const s = skrzynka();
  assert.equal((await alarmujCichePusteZrodla({ wynik: ZERO_BZP, zakonczonoIso: SOBOTA.toISOString() }, { wyslij: s.wyslij, teraz: SOBOTA })).powod, 'zrodla_maja_dane');
  const pelne = { ok: true, zrodla: { bzp: { fetched: 400, surowe: 541 }, ted: { fetched: 10, surowe: 10 } } };
  assert.equal((await alarmujCichePusteZrodla({ wynik: pelne, zakonczonoIso: CZWARTEK.toISOString() }, { wyslij: s.wyslij, teraz: CZWARTEK })).powod, 'zrodla_maja_dane');
  assert.equal(s.wyslane.length, 0);
  assert.equal(await alarmZrodla.wczytaj(), null);
});

test('treść maila: nazwa źródła, co zrobić, link do /health; dwa źródła w temacie', () => {
  const m = alarmZrodlaEmail({ zrodla: ['bzp', 'ted'], healthUrl: 'https://x/health' });
  assert.match(m.subject, /BZP, TED/);
  assert.match(m.text, /Co zrobić/);
  assert.match(m.html, /https:\/\/x\/health/);
});
