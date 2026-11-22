import { test, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * „Wyślij szefowi do decyzji” (2026-11-12): pracownik bierze link z API, szef bez logowania widzi przetarg
 * i odpowiada. „Startujemy” = zapis + przypomnienie + etap + alert dla pracownika. Link przypięty do jednego
 * dopasowania jednego konta.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { tenders, matches, saved, alerty } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
after(() => serwer.close());

let seq = 0;
const ZNAK = `${process.pid}x${Date.now()}`;
async function konto() {
  const odp = await fetch(`${BAZA}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `dsz${ZNAK}-${++seq}@t.pl`, password: 'tajnehaslo123' }) });
  const { token, user } = await odp.json();
  return { id: user.id, h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}
async function wybrany(userId, tytul = 'Remont dachu <szkoły>') {
  const { tender } = await tenders.upsert({ externalId: `dsz-${ZNAK}-${++seq}`, title: tytul, organization: 'Gmina Rymanów',
    deadline: '2099-01-10T09:00:00.000Z', budget: 250000, url: 'https://ezamowienia.gov.pl/x' });
  await matches.utworzWybrany({ userId, tender, score: 80, punkty: ['Dachy — Twój zakres'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  return tender.id;
}
// Link z API wskazuje APP_URL (produkcyjny host) — w teście bierzemy samą ścieżkę z parametrami.
const sciezka = (url) => { const u = new URL(url); return `${BAZA}/maile/decyzja${u.search}`; };
const form = (decyzja) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `decyzja=${decyzja}` });

test('link → strona z przetargiem (bez logowania) → „Startujemy”: zapis, przypomnienie, etap, alert', async () => {
  const k = await konto();
  const id = await wybrany(k.id);
  assert.equal((await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST' })).status, 401, 'link tworzy tylko zalogowany');
  const odp = await (await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  assert.match(odp.url, /\/maile\/decyzja\?token=[^&]{20,}&m=/);
  assert.match(odp.wiadomosc, /^Do decyzji: Remont dachu <szkoły>\nZamawiający: Gmina Rymanów\nTermin ofert: 10 stycznia 2099/);

  const get = await fetch(sciezka(odp.url));
  assert.equal(get.status, 200);
  const html = await get.text();
  assert.match(html, /Remont dachu &lt;szkoły&gt;/, 'tytuł z rejestru tylko przez esc()');
  assert.match(html, /Dachy — Twój zakres/);
  assert.match(html, /250[\s ]000 PLN/);
  assert.match(html, />Startujemy<\/button>/);
  assert.match(html, /Zostało<\/td><td[^>]*>\d+ dni</, 'ile dni do terminu');
  assert.equal((await saved.list(k.id)).length, 0, 'GET niczego nie zmienia');

  const post = await fetch(sciezka(odp.url), form('tak'));
  assert.equal(post.status, 200);
  assert.match(await post.text(), /Zapisane: startujemy/);
  const [wpis] = await saved.list(k.id);
  assert.deepEqual([wpis.tender_id ?? wpis.id, wpis.status, wpis.reminder_enabled], [id, 'przygotowuje', true]);
  const a = await alerty.lista(k.id);
  assert.equal(a.length, 1);
  assert.match(a[0].tytul.pl, /^Szef: startujemy — Remont dachu/);
  const m = (await (await fetch(`${BAZA}/matches/${id}`, { headers: k.h })).json()).match;
  assert.equal(m.decyzja_szefa.decyzja, 'tak');

  // Ta sama decyzja drugi raz — bez drugiego alertu; zmiana zdania — nowy alert, przetarg zostaje w Zapisanych.
  await fetch(sciezka(odp.url), form('tak'));
  assert.equal((await alerty.lista(k.id)).length, 1);
  await new Promise((r) => { setTimeout(r, 1100); });
  assert.match(await (await fetch(sciezka(odp.url), form('nie'))).text(), /Zapisane: nie startujemy/);
  const po = await alerty.lista(k.id);
  assert.equal(po.length, 2);
  assert.ok(po.some((x) => /^Szef: nie startujemy/.test(x.tytul.pl)));
  assert.equal((await saved.list(k.id)).length, 1);
});

test('granice: link jest przypięty do jednego dopasowania; zły token, zła decyzja, cudze dopasowanie', async () => {
  const k = await konto();
  const a = await wybrany(k.id, 'Przetarg A');
  const b = await wybrany(k.id, 'Przetarg B');
  const { url } = await (await fetch(`${BAZA}/matches/${a}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  const token = new URL(url).searchParams.get('token');

  const podmiana = await fetch(`${BAZA}/maile/decyzja?token=${token}&m=${encodeURIComponent(b)}`);
  assert.equal(podmiana.status, 400, 'token dla A nie otwiera B');
  assert.doesNotMatch(await podmiana.text(), /Przetarg B/);
  assert.equal((await fetch(`${BAZA}/maile/decyzja?token=${token}&m=${encodeURIComponent(b)}`, form('tak'))).status, 400);
  assert.equal((await fetch(`${BAZA}/maile/decyzja?token=zly&m=${encodeURIComponent(a)}`)).status, 400);
  assert.equal((await fetch(`${BAZA}/maile/decyzja?m=${encodeURIComponent(a)}`)).status, 400);
  assert.equal((await fetch(sciezka(url), form('moze'))).status, 400);
  assert.equal((await saved.list(k.id)).length, 0, 'nieudane próby niczego nie zapisały');

  const inny = await konto();
  assert.equal((await fetch(`${BAZA}/matches/${a}/do-decyzji`, { method: 'POST', headers: inny.h })).status, 404, 'cudze dopasowanie');
});

test('strona i wiadomość: dni do terminu, wartość i wadium (seria 2 runda 4)', async () => {
  const { zostaloDni, opisWadium, wiadomoscDoSzefa } = await import('../src/services/decyzjaSzefa.js');
  const teraz = Date.parse('2026-11-12T08:00:00Z');
  assert.equal(zostaloDni('2026-11-17T09:00:00Z', teraz), '5 dni');
  assert.equal(zostaloDni('2026-11-13T09:00:00Z', teraz), 'termin jutro');
  assert.equal(zostaloDni('2026-11-12T15:00:00Z', teraz), 'termin dziś');
  // QA 13.11: dni kalendarzowe w Polsce — wieczorem termin jutro rano to „jutro”, a 47 h to 2 dni.
  assert.equal(zostaloDni('2026-11-13T09:00:00Z', Date.parse('2026-11-12T19:00:00Z')), 'termin jutro');
  assert.equal(zostaloDni('2026-11-14T18:00:00Z', Date.parse('2026-11-12T19:00:00Z')), '2 dni');
  assert.equal(zostaloDni('2026-11-11T09:00:00Z', teraz), null);
  assert.equal(zostaloDni(null, teraz), null);
  assert.equal(opisWadium({ tender_wadium_kwota: 20000 }).replace(/\u00a0/g, ' '), '20 000 zł');
  assert.match(opisWadium({ tender_wadium_kwota: 5000, tender_wadium_wiele_czesci: true }), /łącznie za części/);
  assert.equal(opisWadium({ tender_wadium_wymagane: true }), 'wymagane — kwota w SWZ');
  assert.equal(opisWadium({ tender_wadium_wymagane: false }), 'bez wadium');
  assert.equal(opisWadium({}), null);
  const w = wiadomoscDoSzefa({ row: { tender_title: 'Remont', tender_budget: 250000, tender_wadium_wymagane: false, tender_deadline: '2099-01-10T09:00:00.000Z' }, url: 'https://x/y' });
  assert.match(w.replace(/\u00a0/g, ' '), /Wartość: 250 000 PLN\nWadium: bez wadium\nStartujemy\?/);
});

test('notatka szefa: trafia do alertu i do apki, przycięta do 140 znaków, bez znaków sterujących (seria 2 runda 9)', async () => {
  const k = await konto();
  const id = await wybrany(k.id, 'Remont mostu');
  const { url } = await (await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  assert.match(await (await fetch(sciezka(url))).text(), /name="komentarz" maxlength="140"/);
  const dluga = `cena do 2,5 mln\nzł ${'x'.repeat(200)}`;
  const post = await fetch(sciezka(url), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `decyzja=tak&komentarz=${encodeURIComponent(dluga)}` });
  assert.equal(post.status, 200);
  const [a] = await alerty.lista(k.id);
  assert.match(a.tresc.pl, /^Notatka: „cena do 2,5 mln zł x+”\. Decyzja z linku/);
  const m = (await (await fetch(`${BAZA}/matches/${id}`, { headers: k.h })).json()).match;
  assert.equal(m.decyzja_szefa.komentarz.length, 140);
  assert.ok(!/[\n\r]/.test(m.decyzja_szefa.komentarz));
  // Ta sama decyzja z inną notatką to nowa informacja — nowy alert.
  await new Promise((r) => { setTimeout(r, 1100); });
  await fetch(sciezka(url), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'decyzja=tak&komentarz=jednak+do+3+mln' });
  assert.equal((await alerty.lista(k.id)).length, 2);
});

test('QA 13.11: błąd po drodze nie gubi alertu — ponowne kliknięcie powiadamia pracownika', async () => {
  const k = await konto();
  const id = await wybrany(k.id, 'Remont hali');
  const { url } = await (await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  const oryginal = alerty.dodaj;
  alerty.dodaj = async () => { throw new Error('Firestore UNAVAILABLE'); };
  let pierwszy;
  try { pierwszy = await fetch(sciezka(url), form('tak')); } finally { alerty.dodaj = oryginal; }
  assert.equal(pierwszy.status, 500);
  assert.equal((await alerty.lista(k.id)).length, 0);
  const drugi = await fetch(sciezka(url), form('tak'));
  assert.equal(drugi.status, 200);
  assert.equal((await alerty.lista(k.id)).length, 1, 'alert doszedł przy ponowieniu');
  // Dwa równoległe kliknięcia tej samej decyzji = nadal jeden alert (klucz z numerem zmiany).
  await Promise.all([fetch(sciezka(url), form('nie')), fetch(sciezka(url), form('nie'))]);
  assert.equal((await alerty.lista(k.id)).length, 2);
});

test('QA 13.11: stan przetargu — po terminie bez formularza i 409; odrzucony wraca na listę; złożona oferta zostaje złożona; alert mówi prawdę', async () => {
  const { getFirestore } = await import('firebase-admin/firestore');
  const k = await konto();
  // 1) termin minął
  const stary = await wybrany(k.id, 'Stary przetarg');
  const l1 = await (await fetch(`${BAZA}/matches/${stary}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  await getFirestore().collection('users').doc(k.id).collection('matches').doc(stary).update({ tender_deadline: '2020-01-01T09:00:00.000Z' });
  const strona = await (await fetch(sciezka(l1.url))).text();
  assert.match(strona, /Termin składania ofert już minął/);
  assert.doesNotMatch(strona, /<form/);
  assert.equal((await fetch(sciezka(l1.url), form('tak'))).status, 409);
  assert.equal((await saved.list(k.id)).length, 0);

  // 2) odrzucony „Nie dla nas” → „Startujemy” zdejmuje odrzucenie
  const odrz = await wybrany(k.id, 'Odrzucony przetarg');
  const l2 = await (await fetch(`${BAZA}/matches/${odrz}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  await matches.oznaczOdrzuconyPrzezKlienta(k.id, odrz, { przyczyna: 'teren' });
  assert.equal((await fetch(sciezka(l2.url), form('tak'))).status, 200);
  const lista = await (await fetch(`${BAZA}/matches`, { headers: k.h })).json();
  assert.ok(lista.matches.some((m) => m.id === odrz), 'przetarg znów widoczny na liście');

  // 3) oferta już złożona → etap zostaje, alert nie obiecuje etapu ani przypomnień
  const zloz = await wybrany(k.id, 'Złożona oferta');
  await fetch(`${BAZA}/matches/${zloz}/save`, { method: 'PUT', headers: k.h });
  await fetch(`${BAZA}/matches/${zloz}/status`, { method: 'PUT', headers: k.h, body: JSON.stringify({ status: 'zlozona' }) });
  await fetch(`${BAZA}/matches/${zloz}/reminder`, { method: 'PUT', headers: k.h, body: JSON.stringify({ enabled: false }) });
  const l3 = await (await fetch(`${BAZA}/matches/${zloz}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  assert.equal((await fetch(sciezka(l3.url), form('tak'))).status, 200);
  assert.equal((await saved.pobierz(k.id, zloz)).status, 'zlozona');
  const a = (await alerty.lista(k.id)).find((x) => /Złożona oferta/.test(x.tytul.pl));
  assert.match(a.tresc.pl, /Przetarg jest w Zapisanych\.$/);
  assert.doesNotMatch(a.tresc.pl, /przypomnieniami|Przygotowuję/);
});

test('QA 13.11: dobowy limit linków do decyzji i etap w panelu dnia po decyzji', async () => {
  const { limitLinkowDecyzji } = await import('../src/db/repos.js');
  const { LIMIT_LINKOW_DECYZJI_DZIENNIE } = await import('../src/routes/matches.js');
  const k = await konto();
  const id = await wybrany(k.id, 'Limit linków');
  const { url } = await (await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST', headers: k.h })).json();
  await fetch(sciezka(url), form('tak'));
  const dzien = await (await fetch(`${BAZA}/pracownik/dzien`, { headers: k.h })).json();
  const m = dzien.wybrane.find((x) => x.id === id);
  assert.deepEqual([m.zapisany, m.status, m.decyzja_szefa.decyzja], [true, 'przygotowuje', 'tak'], 'panel dnia zna etap po odświeżeniu');
  for (let i = 0; i < LIMIT_LINKOW_DECYZJI_DZIENNIE; i++) await limitLinkowDecyzji.zarezerwuj(k.id, LIMIT_LINKOW_DECYZJI_DZIENNIE);
  const ponad = await fetch(`${BAZA}/matches/${id}/do-decyzji`, { method: 'POST', headers: k.h });
  assert.equal(ponad.status, 429);
});
