import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, decide, splitKey, visible } from '../src/services/spoinaRules.js';

/*
 * Spoina — uprawnienia ról (services/spoinaRules.js). Czyste funkcje, bez bazy.
 * Pilnujemy dwóch rzeczy: telefon pracownika NIE dostaje cudzych danych ani pieniędzy,
 * a zmiana wysłana z pominięciem aplikacji nie podniesie roli i nie zatwierdzi godzin.
 */

function firma() {
  const docs = {
    'workers/anna': { id: 'anna', name: 'Anna Biuro', phone: '601 000 001', job: 'Biuro', role: 'office', crewId: null, certs: [], docs: [], leaveDaysLeft: 20, ice: '', clothing: '', lang: 'pl', invited: false, pushOn: true },
    'workers/zbyszek': { id: 'zbyszek', name: 'Zbyszek Magazyn', phone: '601 000 002', job: 'Narzędziownia', role: 'toolroom', crewId: null, certs: [], docs: [], leaveDaysLeft: 10, ice: '', clothing: '', lang: 'pl', invited: false, pushOn: true },
    'workers/kowal': { id: 'kowal', name: 'Jan Kowalczyk', phone: '601 000 003', job: 'Brygadzista', role: 'foreman', crewId: 'e1', certs: [], docs: [], leaveDaysLeft: 12, ice: '', clothing: '', lang: 'pl', invited: false, pushOn: true },
    'workers/mazur': { id: 'mazur', name: 'Piotr Mazur', phone: '601 000 004', job: 'Spawacz', role: 'worker', crewId: 'e1', certs: [{ id: 'c1', method: '135' }], docs: [{ kind: 'medical', state: 'valid' }], leaveDaysLeft: 7, ice: 'żona 600 111 222', clothing: 'L', lang: 'pl', invited: true, pushOn: true },
    'workers/pawlak': { id: 'pawlak', name: 'Adam Pawlak', phone: '601 000 005', job: 'Monter', role: 'worker', crewId: null, certs: [], docs: [{ kind: 'medical', state: 'expired' }], leaveDaysLeft: 3, ice: 'matka', clothing: 'XL', lang: 'pl', invited: false, pushOn: true },
    'crews/e1': { id: 'e1', name: 'Ekipa 1', leaderId: 'kowal', vehicle: 'BUS-1' },
    'sites/S1': { id: 'S1', name: 'Rurociąg', place: 'Rotterdam', leadId: 'kowal', toolroomDone: false, rate: 95, laborCost: 60, dietPerDay: 50, lodgingPerDay: 40, transportCost: 3000, otherCost: 100 },
    'sites/S2': { id: 'S2', name: 'Hala', place: 'Gdańsk', leadId: null, toolroomDone: false, rate: 80, laborCost: 55, dietPerDay: 0, lodgingPerDay: 0, transportCost: 0, otherCost: 0 },
    'assignments/a1': { id: 'a1', workerId: 'mazur', siteId: 'S1', roleName: 'Spawacz', status: 'proposed' },
    'assignments/a2': { id: 'a2', workerId: 'kowal', siteId: 'S1', roleName: 'Brygadzista', status: 'accepted' },
    'assignments/a3': { id: 'a3', workerId: 'pawlak', siteId: 'S2', roleName: 'Monter', status: 'accepted' },
    'gear/g1': { id: 'g1', kind: 'Spawarka', state: 'ok', holderId: 'mazur', reservedSiteId: null, faultNote: '', inTransit: true },
    'gear/g2': { id: 'g2', kind: 'Szlifierka', state: 'ok', holderId: null, reservedSiteId: 'S1', faultNote: '', inTransit: false },
    'gear/g3': { id: 'g3', kind: 'Spawarka', state: 'ok', holderId: 'pawlak', reservedSiteId: null, faultNote: '', inTransit: false },
    'handovers/w1': { id: 'w1', workerId: 'mazur', gearIds: ['g1'], out: true, confirmed: false },
    'hours/h1': { id: 'h1', workerId: 'mazur', siteId: 'S1', date: '2026-11-04', startMin: 420, endMin: 960, status: 'draft', cardHours: null, byForeman: false },
    'hours/h2': { id: 'h2', workerId: 'pawlak', siteId: 'S2', date: '2026-11-04', startMin: 420, endMin: 900, status: 'approved', cardHours: 8, byForeman: false },
    'hours/h3': { id: 'h3', workerId: 'mazur', siteId: 'S1', date: '2026-11-03', startMin: 420, endMin: 900, status: 'approved', cardHours: 8, byForeman: false },
    'leaves/l1': { id: 'l1', workerId: 'pawlak', kind: 'vacation', from: '2026-12-01', to: '2026-12-05', status: 'pending' },
    'messages/m1': { id: 'm1', workerId: 'mazur', title: 'Nowy wyjazd', body: '', read: false },
    'messages/m2': { id: 'm2', workerId: 'pawlak', title: 'Zgoda na wolne', body: '', read: false },
    'meta/settings': { companyName: 'Spaw-Tech', marginTarget: 0.2, selfClock: true },
    'absent/2026-11-05|mazur': true,
  };
  return {
    docs,
    get: (k) => docs[k],
    list: (col) => Object.entries(docs).filter(([k]) => k.startsWith(`${col}/`)).map(([k, v]) => [k.slice(col.length + 1), v]),
  };
}

const jako = (state, workerId) => buildContext(state, { workerId, role: state.get(`workers/${workerId}`).role });
const widzi = (ctx, key) => visible(ctx, key, ctx.state.get(key));
const zmiana = (ctx, key, change) => decide(ctx, key, ctx.state.get(key), change);

test('klucz: tylko znane kolekcje i rozsądne id', () => {
  assert.deepEqual(splitKey('workers/anna'), { col: 'workers', id: 'anna' });
  assert.deepEqual(splitKey('absent/2026-11-05|mazur'), { col: 'absent', id: '2026-11-05|mazur' });
  assert.equal(splitKey('users/anna'), null);
  assert.equal(splitKey('workers/'), null);
  assert.equal(splitKey('workers/a/b'), null);
  assert.equal(splitKey('workers'), null);
});

test('pracownik widzi siebie w całości, a kolegów tylko z imienia i telefonu', () => {
  const ctx = jako(firma(), 'mazur');
  assert.equal(widzi(ctx, 'workers/mazur').ice, 'żona 600 111 222');
  const kolega = widzi(ctx, 'workers/pawlak');
  assert.equal(kolega.name, 'Adam Pawlak');
  assert.equal(kolega.phone, '601 000 005');
  assert.deepEqual(kolega.docs, []);
  assert.equal(kolega.ice, '');
  assert.equal(kolega.leaveDaysLeft, 0);
});

test('pracownik widzi tylko swoje budowy i nigdy pieniędzy', () => {
  const ctx = jako(firma(), 'mazur');
  const s1 = widzi(ctx, 'sites/S1');
  assert.equal(s1.place, 'Rotterdam');
  for (const f of ['rate', 'laborCost', 'dietPerDay', 'lodgingPerDay', 'transportCost', 'otherCost']) assert.equal(s1[f], 0);
  assert.equal(widzi(ctx, 'sites/S2'), undefined);
  assert.ok(widzi(ctx, 'assignments/a2'), 'skład własnej budowy jest widoczny');
  assert.equal(widzi(ctx, 'assignments/a3'), undefined);
  assert.equal(widzi(ctx, 'meta/settings').marginTarget, undefined);
  assert.equal(widzi(ctx, 'meta/settings').selfClock, true);
});

test('pracownik widzi wyłącznie własne godziny, wiadomości, sprzęt i wnioski', () => {
  const ctx = jako(firma(), 'mazur');
  assert.ok(widzi(ctx, 'hours/h1'));
  assert.equal(widzi(ctx, 'hours/h2'), undefined);
  assert.ok(widzi(ctx, 'messages/m1'));
  assert.equal(widzi(ctx, 'messages/m2'), undefined);
  assert.ok(widzi(ctx, 'gear/g1'));
  assert.equal(widzi(ctx, 'gear/g3'), undefined);
  assert.equal(widzi(ctx, 'leaves/l1'), undefined);
  assert.ok(widzi(ctx, 'absent/2026-11-05|mazur'));
});

test('brygadzista widzi godziny i sprzęt ekipy, którą prowadzi — i nic poza nią', () => {
  const ctx = jako(firma(), 'kowal');
  assert.ok(ctx.team.has('mazur'));
  assert.ok(!ctx.team.has('pawlak'));
  assert.ok(widzi(ctx, 'hours/h1'));
  assert.equal(widzi(ctx, 'hours/h2'), undefined);
  assert.ok(widzi(ctx, 'gear/g1'), 'sprzęt u członka ekipy');
  assert.ok(widzi(ctx, 'gear/g2'), 'sprzęt dobrany na prowadzoną budowę');
  assert.equal(widzi(ctx, 'gear/g3'), undefined);
  assert.equal(widzi(ctx, 'sites/S1').rate, 0);
});

test('narzędziownia widzi sprzęt i budowy bez pieniędzy, nie widzi cudzych godzin ani badań', () => {
  const ctx = jako(firma(), 'zbyszek');
  assert.ok(widzi(ctx, 'gear/g3'));
  assert.equal(widzi(ctx, 'sites/S2').rate, 0);
  assert.equal(widzi(ctx, 'hours/h1'), undefined);
  assert.deepEqual(widzi(ctx, 'workers/pawlak').docs, []);
  assert.equal(widzi(ctx, 'messages/m1'), undefined);
});

test('biuro widzi wszystko bez zmian', () => {
  const state = firma();
  const ctx = jako(state, 'anna');
  assert.equal(widzi(ctx, 'sites/S1'), state.get('sites/S1'));
  assert.equal(widzi(ctx, 'workers/pawlak'), state.get('workers/pawlak'));
});

test('pracownik nie podniesie sobie roli ani nie zmieni telefonu', () => {
  const ctx = jako(firma(), 'mazur');
  assert.ok(zmiana(ctx, 'workers/mazur', { p: { role: 'office' } }).reject);
  assert.ok(zmiana(ctx, 'workers/mazur', { p: { phone: '601 000 001' } }).reject);
  assert.ok(zmiana(ctx, 'workers/mazur', { p: { leaveDaysLeft: 99 } }).reject);
  assert.ok(zmiana(ctx, 'workers/pawlak', { p: { lang: 'uk' } }).reject);
  assert.ok(zmiana(ctx, 'workers/nowy', { v: { id: 'nowy', name: 'X Y', phone: '1', role: 'office' } }).reject);
  assert.ok(zmiana(ctx, 'workers/mazur', null).reject);
});

test('pracownik zmienia własny język, kontakt awaryjny i potwierdza pierwsze logowanie', () => {
  const ctx = jako(firma(), 'mazur');
  const d = zmiana(ctx, 'workers/mazur', { p: { lang: 'uk', invited: false, ice: 'brat' } });
  assert.equal(d.next.lang, 'uk');
  assert.equal(d.next.invited, false);
  assert.equal(d.next.role, 'worker');
  assert.ok(zmiana(jako(firma(), 'pawlak'), 'workers/pawlak', { p: { invited: true } }).reject);
});

test('godziny: pracownik pisze swoje, nie zatwierdza i nie rusza zatwierdzonych', () => {
  const ctx = jako(firma(), 'mazur');
  assert.equal(zmiana(ctx, 'hours/h1', { p: { status: 'sent' } }).next.status, 'sent');
  assert.ok(zmiana(ctx, 'hours/h1', { p: { status: 'approved' } }).reject);
  assert.ok(zmiana(ctx, 'hours/h1', { p: { cardHours: 12 } }).reject);
  assert.ok(zmiana(ctx, 'hours/h1', { p: { workerId: 'pawlak' } }).reject);
  assert.ok(zmiana(ctx, 'hours/h3', { p: { endMin: 1200 } }).reject, 'zatwierdzony wpis jest zamknięty');
  assert.ok(zmiana(ctx, 'hours/h3', null).reject);
  assert.ok(zmiana(ctx, 'hours/h2', { p: { endMin: 1200 } }).reject, 'cudzy wpis');
  const nowy = { id: 'h9', workerId: 'mazur', siteId: 'S1', date: '2026-11-05', startMin: 400, endMin: null, status: 'open', cardHours: null, byForeman: false };
  assert.ok(zmiana(ctx, 'hours/h9', { v: nowy }).next);
  assert.ok(zmiana(ctx, 'hours/h9', { v: { ...nowy, workerId: 'pawlak' } }).reject);
  assert.ok(zmiana(ctx, 'hours/h9', { v: { ...nowy, status: 'approved' } }).reject);
});

test('godziny: brygadzista wpisuje za swoją ekipę, ale nie za obcych', () => {
  const ctx = jako(firma(), 'kowal');
  assert.ok(zmiana(ctx, 'hours/h1', { p: { endMin: 930, byForeman: true } }).next);
  assert.ok(zmiana(ctx, 'hours/h2', { p: { endMin: 930 } }).reject);
  assert.equal(zmiana(ctx, 'absent/2026-11-05|mazur', null).next, null);
  assert.equal(zmiana(ctx, 'absent/2026-11-06|mazur', { v: true }).next, true);
  assert.ok(zmiana(ctx, 'absent/2026-11-06|pawlak', { v: true }).reject);
  assert.equal(zmiana(ctx, 'attendanceOk/2026-11-05|e1', { v: true }).next, true);
  assert.ok(zmiana(jako(firma(), 'mazur'), 'attendanceOk/2026-11-05|e1', { v: true }).reject);
});

test('wyjazd: pracownik odpowiada tylko na własny przydział i tylko statusem', () => {
  const ctx = jako(firma(), 'mazur');
  assert.equal(zmiana(ctx, 'assignments/a1', { p: { status: 'accepted' } }).next.status, 'accepted');
  assert.ok(zmiana(ctx, 'assignments/a1', { p: { siteId: 'S2' } }).reject);
  assert.ok(zmiana(ctx, 'assignments/a2', { p: { status: 'declined' } }).reject);
  assert.ok(zmiana(ctx, 'assignments/a1', null).reject);
});

test('sprzęt: pracownik zgłasza usterkę i potwierdza odbiór tylko swojego egzemplarza', () => {
  const ctx = jako(firma(), 'mazur');
  assert.equal(zmiana(ctx, 'gear/g1', { p: { state: 'fault', faultNote: 'iskrzy' } }).next.state, 'fault');
  assert.equal(zmiana(ctx, 'gear/g1', { p: { inTransit: false } }).next.inTransit, false);
  assert.ok(zmiana(ctx, 'gear/g1', { p: { holderId: null } }).reject);
  assert.ok(zmiana(ctx, 'gear/g1', { p: { state: 'service' } }).reject);
  assert.ok(zmiana(ctx, 'gear/g3', { p: { state: 'fault' } }).reject);
  assert.equal(zmiana(ctx, 'handovers/w1', { p: { confirmed: true } }).next.confirmed, true);
  const f = { id: 'f1', gearId: 'g1', workerId: 'mazur', kind: 'iskrzy', resolved: false };
  assert.ok(zmiana(ctx, 'faults/f1', { v: f }).next);
  assert.ok(zmiana(ctx, 'faults/f1', { v: { ...f, gearId: 'g3' } }).reject, 'cudzy sprzęt');
  assert.ok(zmiana(ctx, 'faults/f1', { v: { ...f, workerId: 'pawlak' } }).reject);
});

test('wolne i wiadomości: własny wniosek i własne „przeczytane"', () => {
  const ctx = jako(firma(), 'mazur');
  const l = { id: 'l9', workerId: 'mazur', kind: 'vacation', from: '2026-12-10', to: '2026-12-12', status: 'pending' };
  assert.ok(zmiana(ctx, 'leaves/l9', { v: l }).next);
  assert.ok(zmiana(ctx, 'leaves/l9', { v: { ...l, status: 'approved' } }).reject);
  assert.ok(zmiana(ctx, 'leaves/l1', null).reject, 'cudzy wniosek');
  assert.equal(zmiana(ctx, 'messages/m1', { p: { read: true } }).next.read, true);
  assert.ok(zmiana(ctx, 'messages/m1', { p: { title: 'x' } }).reject);
  assert.ok(zmiana(ctx, 'messages/m2', { p: { read: true } }).reject);
  assert.ok(zmiana(ctx, 'messages/m9', { v: { id: 'm9', workerId: 'pawlak', title: 'spam' } }).reject);
});

test('narzędziownia: sprzęt i wydania tak, dane budowy i ludzi nie', () => {
  const ctx = jako(firma(), 'zbyszek');
  assert.equal(zmiana(ctx, 'gear/g2', { p: { holderId: 'mazur', inTransit: true } }).next.holderId, 'mazur');
  assert.equal(zmiana(ctx, 'sites/S1', { p: { toolroomDone: true } }).next.toolroomDone, true);
  assert.ok(zmiana(ctx, 'sites/S1', { p: { rate: 1 } }).reject);
  assert.ok(zmiana(ctx, 'sites/S1', { p: { name: 'x' } }).reject);
  assert.ok(zmiana(ctx, 'workers/mazur', { p: { role: 'office' } }).reject);
  assert.ok(zmiana(ctx, 'hours/h1', { p: { status: 'approved' } }).reject);
  assert.ok(zmiana(ctx, 'messages/m9', { v: { id: 'm9', workerId: 'mazur', title: 'Sprzęt gotowy' } }).next);
  assert.equal(zmiana(ctx, 'shortages/S1|Spawarka', { v: true }).next, true);
});

test('biuro: wszystko, ale firma nie zostaje bez biura', () => {
  const ctx = jako(firma(), 'anna');
  assert.equal(zmiana(ctx, 'hours/h1', { p: { status: 'approved' } }).next.status, 'approved');
  assert.equal(zmiana(ctx, 'sites/S1', { p: { rate: 110 } }).next.rate, 110);
  assert.ok(zmiana(ctx, 'workers/anna', { p: { role: 'worker' } }).reject);
  assert.ok(zmiana(ctx, 'workers/anna', null).reject);
  assert.equal(zmiana(ctx, 'workers/mazur', { p: { role: 'office' } }).next.role, 'office');
});

test('kształt: id zgodne z kluczem, znana rola, zbiory tylko true', () => {
  const ctx = jako(firma(), 'anna');
  assert.ok(zmiana(ctx, 'sites/S9', { v: { id: 'inne', name: 'x' } }).reject);
  assert.ok(zmiana(ctx, 'sites/S9', { v: 'napis' }).reject);
  assert.ok(zmiana(ctx, 'workers/n', { v: { id: 'n', name: 'A B', phone: '1', role: 'admin' } }).reject);
  assert.ok(zmiana(ctx, 'shortages/x', { v: 1 }).reject);
  assert.ok(zmiana(ctx, 'meta/inne', { v: {} }).reject);
  assert.ok(zmiana(ctx, 'sites/S1', { x: 1 }).reject);
  assert.equal(zmiana(ctx, 'sites/nie-ma', null).next, null);
});

test('wypadek: zgłasza każdy, widzi zgłaszający, brygadzista i biuro, przyjmuje biuro', () => {
  const state = firma();
  const i = { id: 'i1', workerId: 'mazur', siteId: 'S1', at: '2026-11-05T10:42:00.000', injury: true, note: 'upadek z rusztowania', handled: false };
  const mazur = jako(state, 'mazur');
  assert.ok(zmiana(mazur, 'incidents/i1', { v: i }).next);
  assert.ok(zmiana(mazur, 'incidents/i1', { v: { ...i, workerId: 'pawlak' } }).reject, 'nie w cudzym imieniu');
  assert.ok(zmiana(mazur, 'incidents/i1', { v: { ...i, handled: true } }).reject);
  assert.ok(zmiana(jako(state, 'zbyszek'), 'incidents/i2', { v: { ...i, id: 'i2', workerId: 'zbyszek' } }).next, 'narzędziownia też może zgłosić');

  state.docs['incidents/i1'] = i;
  assert.ok(widzi(jako(state, 'mazur'), 'incidents/i1'));
  assert.ok(widzi(jako(state, 'kowal'), 'incidents/i1'), 'brygadzista ekipy');
  assert.ok(widzi(jako(state, 'anna'), 'incidents/i1'));
  assert.equal(widzi(jako(state, 'pawlak'), 'incidents/i1'), undefined);
  assert.equal(widzi(jako(state, 'zbyszek'), 'incidents/i1'), undefined);

  assert.ok(zmiana(jako(state, 'mazur'), 'incidents/i1', { p: { handled: true } }).reject);
  assert.ok(zmiana(jako(state, 'kowal'), 'incidents/i1', { p: { handled: true } }).reject);
  assert.equal(zmiana(jako(state, 'anna'), 'incidents/i1', { p: { handled: true } }).next.handled, true);
  assert.equal(zmiana(jako(state, 'mazur'), 'incidents/i1', null).next, null, 'cofnięcie własnej pomyłki');
  state.docs['incidents/i1'] = { ...i, handled: true };
  assert.ok(zmiana(jako(state, 'mazur'), 'incidents/i1', null).reject, 'przyjętego zgłoszenia nie da się usunąć');
});
