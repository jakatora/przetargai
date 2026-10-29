import { test } from 'node:test';
import assert from 'node:assert/strict';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { strazZdrowia, alarmZdrowia } = await import('../src/db/repos.js');
const { powodyAlarmu, runStrazZdrowia, pobierzHealth } = await import('../src/jobs/strazZdrowia.js');

/*
 * Strażnik zdrowia (2026-10-29): 27.10 cykl dzienny nie odbył się, /health przez dobę zwracał 503, a alarm
 * nie przyszedł, bo alarmy wysyłał SAM cykl. Testy pilnują, że strażnik czyta prawdziwy kształt /health,
 * nie alarmuje o jednorazowym mrugnięciu, wysyła raz na dobę i ponawia przy nieudanej wysyłce.
 */
const zdrowe = () => ({ status: 200, cialo: { status: 'ok', db: true, cron: { ok: true, godzin_temu: 7.1, ostatni_przebieg: 'x', zrodla_z_bledem: [], slad_sprzed_naprawy: false }, ai: { ok: true }, push: { ok: true }, auto_swz: { ok: true } } });
const zMartwymCyklem = () => { const h = zdrowe(); h.status = 503; h.cialo.status = 'degraded'; h.cialo.cron = { ok: false, godzin_temu: 31.5, ostatni_przebieg: 'x', zrodla_z_bledem: [] }; return h; };

test('powodyAlarmu: zdrowo → brak; martwy cykl, push, AI, błąd źródła, brak API → konkretne kody', () => {
  assert.deepEqual(powodyAlarmu(zdrowe()), []);
  assert.deepEqual(powodyAlarmu(zMartwymCyklem()).map((p) => p.kod), ['cykl']);
  const h = zdrowe(); h.cialo.push = { ok: false, ostatni_blad: 'InvalidCredentials' }; h.cialo.ai = { ok: false, bledy_wg_typu: { brak_kredytow: 3 } };
  h.cialo.cron.zrodla_z_bledem = ['bzp'];
  assert.deepEqual(powodyAlarmu(h).map((p) => p.kod), ['zrodla', 'ai', 'push']);
  assert.match(powodyAlarmu(h).find((p) => p.kod === 'push').opis, /InvalidCredentials/);
  assert.deepEqual(powodyAlarmu({ status: null, cialo: null, blad: 'fetch failed' }).map((p) => p.kod), ['api']);
  const nieznane = zdrowe(); nieznane.status = 503; nieznane.cialo.status = 'degraded';
  assert.deepEqual(powodyAlarmu(nieznane).map((p) => p.kod), ['status'], '503 bez rozpoznanego powodu też alarmuje');
  const stary = zdrowe(); stary.cialo.cron.zrodla_z_bledem = ['ted']; stary.cialo.cron.slad_sprzed_naprawy = true;
  assert.deepEqual(powodyAlarmu(stary), [], 'residuum sprzed naprawy nie alarmuje (jak w /health)');
});

test('pobierzHealth: nie-JSON i wyjątek sieci → błąd zamiast rzucania', async () => {
  const a = await pobierzHealth({ url: 'http://x', fetchFn: async () => ({ status: 502, json: async () => { throw new Error('x'); } }) });
  assert.equal(a.cialo, null); assert.match(a.blad, /502/);
  const b = await pobierzHealth({ url: 'http://x', fetchFn: async () => { throw new Error('ECONNRESET'); } });
  assert.match(b.blad, /ECONNRESET/);
});

test('runStrazZdrowia: alarm dopiero przy DRUGIM pomiarze z tym samym powodem, raz na dobę; po wyzdrowieniu cisza', async () => {
  await strazZdrowia.zapisz({ powody: [], sprawdzono_o: 'start' });
  const maile = [];
  const wyslij = async (m) => { maile.push(m); return { sent: true, id: `e${maile.length}` }; };
  const T = '2026-10-29T10:45:00.000Z';
  const r1 = await runStrazZdrowia({ teraz: T, pobierz: async () => zMartwymCyklem(), wyslij });
  assert.deepEqual([r1.powody, r1.trwale, r1.wyslano], [['cykl'], [], false], 'pierwszy pomiar — jeszcze bez alarmu');
  const r2 = await runStrazZdrowia({ teraz: '2026-10-29T11:45:00.000Z', pobierz: async () => zMartwymCyklem(), wyslij });
  assert.equal(r2.wyslano, true);
  assert.equal(maile.length, 1);
  assert.match(maile[0].subject, /cykl/);
  assert.match(maile[0].text, /cykl dzienny nie odbył się od 32 h|cykl dzienny nie odbył się od 31 h/);
  const r3 = await runStrazZdrowia({ teraz: '2026-10-29T12:45:00.000Z', pobierz: async () => zMartwymCyklem(), wyslij });
  assert.equal(r3.wyslano, false); assert.equal(r3.powod, 'juz_wyslany_dzis');
  const r4 = await runStrazZdrowia({ teraz: '2026-10-29T13:45:00.000Z', pobierz: async () => zdrowe(), wyslij });
  assert.deepEqual([r4.powody, r4.wyslano], [[], false]);
  assert.equal(maile.length, 1);
});

test('runStrazZdrowia: nieudana wysyłka zwalnia znacznik — kolejny pomiar wysyła ponownie', async () => {
  await strazZdrowia.zapisz({ powody: [{ kod: 'push', opis: 'x' }], sprawdzono_o: 'start' });
  const pushPada = () => { const h = zdrowe(); h.cialo.push = { ok: false, ostatni_blad: 'InvalidCredentials' }; return h; };
  const T = '2026-11-03T09:45:00.000Z';
  const r1 = await runStrazZdrowia({ teraz: T, pobierz: async () => pushPada(), wyslij: async () => ({ sent: false, error: 'Resend 500' }) });
  assert.equal(r1.ok, false);
  const maile = [];
  const r2 = await runStrazZdrowia({ teraz: '2026-11-03T10:45:00.000Z', pobierz: async () => pushPada(), wyslij: async (m) => { maile.push(m); return { sent: true }; } });
  assert.equal(r2.wyslano, true);
  assert.match(maile[0].text, /InvalidCredentials/);
  assert.equal((await alarmZdrowia.wczytaj()).stan, 'wyslany');
});
