import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * NIP firmy w koncie i „Twoje umowy” (2026-11-01) przez realny serwer HTTP na emulatorze.
 *
 *  1. PUT /auth/me/nip — ta sama rezerwacja unikalności co rejestracja: zajęty NIP → 409,
 *     zmiana NIP-u zwalnia stary, `null` usuwa.
 *  2. GET /wygrywalnosc/umowy-wygasajace — firma widzi SWOJE kończące się umowy z następcą.
 *  3. runTwojeUmowy — alert „Twoja umowa wraca do przetargu” idzie raz, kolejny dzień go nie powtarza.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, rozstrzygniecia, alerty } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { runTwojeUmowy } = await import('../src/jobs/umowyWygasajace.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `tu${process.pid}x${Date.now()}`;
let seq = 0;

/** Poprawny NIP z 9 cyfr (suma kontrolna); prefiks z reszty 10 przesuwa ostatnią cyfrę. */
function nip(dziewiec) {
  for (let d = Number(dziewiec); ; d++) {
    const cyfry = String(d).padStart(9, '0').split('').map(Number);
    const reszta = [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce((s, w, i) => s + w * cyfry[i], 0) % 11;
    if (reszta !== 10) return `${cyfry.join('')}${reszta}`;
  }
}
const losowy = () => nip(String(100_000_000 + Math.floor(Math.random() * 800_000_000)));

async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `tu-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123' }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const ustawNip = (t, wartosc) => fetch(`${BAZA}/auth/me/nip`, { method: 'PUT', headers: auth(t), body: JSON.stringify({ company_nip: wartosc }) });

test('PUT /auth/me/nip: zły NIP 400, zajęty 409, zmiana zwalnia stary, null usuwa', async () => {
  const [a, b] = [await konto(), await konto()];
  const [n1, n2] = [losowy(), losowy()];
  assert.equal((await ustawNip(a, '1234567890')).status, 400);
  const ok = await ustawNip(a, `PL ${n1.slice(0, 3)}-${n1.slice(3)}`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user.company_nip, n1);
  assert.equal((await ustawNip(a, n1)).status, 200, 'ten sam NIP drugi raz — bez zmian');
  const zajety = await ustawNip(b, n1);
  assert.equal(zajety.status, 409);
  assert.match((await zajety.json()).error.message, /inne konto/);
  assert.equal((await ustawNip(a, n2)).status, 200);
  assert.equal((await ustawNip(b, n1)).status, 200, 'stary NIP konta A jest wolny');
  const usun = await ustawNip(a, null);
  assert.equal((await usun.json()).user.company_nip, null);
  assert.equal((await ustawNip(b, n2)).status, 200, 'usunięty NIP też jest wolny');
  assert.equal((await fetch(`${BAZA}/auth/me/nip`, { method: 'PUT', body: '{}' })).status, 401);
});

test('Twoje umowy: radar pokazuje własną kończącą się umowę z następcą; alert idzie raz', async () => {
  const t = await konto();
  const nipFirmy = losowy();
  const nipZam = losowy();
  assert.equal((await ustawNip(t, nipFirmy)).status, 200);
  const dzien = (dni) => new Date(Date.now() + dni * 86_400_000).toISOString().slice(0, 10);
  const wynik = (id, tytul, koniec) => ({
    externalId: `tu-${id}-${ZNAK}`, tenderId: `ocds-tu-${id}-${ZNAK}`, zrodlo: 'bzp', tytul, zamawiajacy: 'Gmina Testowa',
    zamawiajacyNip: nipZam, cpv: ['90910000-9'], wojewodztwo: '18', rodzaj: 'Services', opublikowano: dzien(-300),
    czesci: [{ numer: 1, uniewaznione: false, dataUmowy: dzien(-310), okresUmowy: '12 miesięcy', koniecUmowy: koniec, wartoscUmowy: 90_000, zwyciezca: { nazwa: 'Moja Firma', nip: nipFirmy } }],
  });
  await rozstrzygniecia.zapiszWiele([
    wynik('sp', `Sprzątanie budynków urzędu ${ZNAK}`, dzien(45)),
    wynik('od', `Odbiór odpadów z cmentarza ${ZNAK}`, dzien(90)),
    wynik('st', `Stara umowa ${ZNAK}`, dzien(-5)),
  ]);
  const { tender: nowy } = await tenders.upsert({
    externalId: `tu-nowy-${ZNAK}`, title: `Sprzątanie budynków urzędu ${ZNAK} w 2027 roku`, organization: 'Gmina Testowa',
    deadline: new Date(Date.now() + 12 * 86_400_000).toISOString(), publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
    source: 'bzp', cpvMain: '90910000-9', zamawiajacy_nip: nipZam,
  });

  const d = await (await fetch(`${BAZA}/wygrywalnosc/umowy-wygasajace`, { headers: auth(t) })).json();
  assert.equal(d.dostepne, false, 'bez CPV w karcie radar branży jest niedostępny…');
  assert.deepEqual(d.twoje.map((u) => [u.id, u.nastepca?.tender_id ?? null]), [[`tu-sp-${ZNAK}`, nowy.id], [`tu-od-${ZNAK}`, null]], '…ale własne umowy są, ogłoszone pierwsze');
  const bezNip = await (await fetch(`${BAZA}/wygrywalnosc/umowy-wygasajace`, { headers: auth(await konto()) })).json();
  assert.equal(bezNip.twoje, null, 'konto bez NIP-u: null, ekran podpowiada wpisanie NIP-u');

  const push = [];
  const email = [];
  const otwarte = await tenders.otwarteZNipem();
  const fakePush = async (token, tresc) => { push.push(tresc); return { sent: 1 }; };
  const fakeEmail = async (m) => { email.push(m); };
  const pierwszy = await runTwojeUmowy({ otwarte, wyslijPush: fakePush, wyslijEmail: fakeEmail });
  assert.ok(pierwszy.alerty >= 1 && pierwszy.ok);
  const moje = email.filter((m) => m.subject.includes(ZNAK));
  assert.equal(moje.length, 1, 'konto bez tokenu push dostaje e-mail');
  assert.match(moje[0].subject, /^Twoja umowa wraca do przetargu: Sprzątanie budynków urzędu/);
  assert.match(moje[0].text, /Gmina Testowa: nowy przetarg już ogłoszony, a Twoja umowa kończy się/);
  const drugi = await runTwojeUmowy({ otwarte, wyslijPush: fakePush, wyslijEmail: fakeEmail });
  assert.equal(email.filter((m) => m.subject.includes(ZNAK)).length, 1, 'następny dzień nie powtarza alertu');
  assert.equal(drugi.bledy, 0);

  const me = await (await fetch(`${BAZA}/auth/me`, { headers: auth(t) })).json();
  const wpisy = await alerty.lista(me.user.id);
  assert.deepEqual(wpisy.map((a) => [a.typ, a.tender_id]), [['umowa_nastepca', nowy.id]]);
});

test('GET /wygrywalnosc/karta-z-wygranych: bez NIP-u niedostępna; z NIP-em kody CPV i regiony z wygranych', async () => {
  const t = await konto();
  const bez = await (await fetch(`${BAZA}/wygrywalnosc/karta-z-wygranych`, { headers: auth(t) })).json();
  assert.deepEqual(bez, { dostepne: false, powod: 'brak_nip' });
  const nipFirmy = losowy();
  assert.equal((await ustawNip(t, nipFirmy)).status, 200);
  await rozstrzygniecia.zapiszWiele([1, 2, 3].map((i) => ({
    externalId: `kw-${i}-${ZNAK}`, tenderId: `ocds-kw-${i}-${ZNAK}`, zrodlo: 'bzp', tytul: `Remont drogi gminnej nr ${i}`, zamawiajacy: `Gmina ${i}`,
    zamawiajacyNip: losowy(), cpv: ['45233120-6', '45000000-7'], wojewodztwo: '12', rodzaj: 'Works', opublikowano: '2026-10-0' + i,
    czesci: [{ numer: 1, uniewaznione: false, dataUmowy: '2026-10-10', zwyciezca: { nazwa: 'Drogbud', nip: nipFirmy } }],
  })));
  const k = await (await fetch(`${BAZA}/wygrywalnosc/karta-z-wygranych`, { headers: auth(t) })).json();
  assert.deepEqual([k.dostepne, k.wygrane, k.cpv_codes, k.regiony, k.zamawiajacych], [true, 3, ['45233120-6'], ['12'], 3]);
  assert.equal((await fetch(`${BAZA}/wygrywalnosc/karta-z-wygranych`)).status, 401);
});
