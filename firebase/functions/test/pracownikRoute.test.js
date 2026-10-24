import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { createApp } = await import('../src/app.js');
const { users, tenders, matches, evaluations, magicLinks } = await import('../src/db/repos.js');
const { zbudujSygnal } = await import('../src/lib/sygnaly.js');
const { getFirestore } = await import('firebase-admin/firestore');
const app = await createApp();
const serwer = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto({ plan = 'proba' } = {}) {
  const odp = await fetch(`${BAZA}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `prt-${process.pid}-${++seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['dach'] }) });
  const { token, user } = await odp.json();
  if (plan === 'free') await getFirestore().collection('users').doc(user.id).update({ proba_do: null });
  if (plan === 'standard') await users.setTier(user.id, 'standard');
  return { token, id: user.id, h: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}
async function wybrany(userId, extra = {}) {
  const { tender } = await tenders.upsert({ externalId: `prt-t-${process.pid}-${++seq}`, title: `Remont dachu ${seq}`,
    deadline: '2099-01-01T00:00:00.000Z', wojewodztwo: 'podkarpackie', budget: 100_000, ...extra });
  await matches.utworzWybrany({ userId, tender, score: 80, punkty: ['Dachy'], scorer: 'ai', ocenaBezAi: false, criteriaHash: 'v', zapiszSlad: true });
  return tender;
}
const get = (k, sciezka) => fetch(`${BAZA}${sciezka}`, { headers: k.h }).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (k, sciezka, body = {}) => fetch(`${BAZA}${sciezka}`, { method: 'POST', headers: k.h, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test('bez tokenu → 401', async () => {
  assert.equal((await fetch(`${BAZA}/pracownik/dzien`)).status, 401);
});

test('GET /pracownik/dzien: nowe konto w próbie = Standard, raport, braki karty', async () => {
  const k = await konto();
  const t = await wybrany(k.id);
  const { status, body } = await get(k, '/pracownik/dzien');
  assert.equal(status, 200);
  assert.equal(body.plan, 'standard');
  assert.equal(body.proba.aktywna, true);
  assert.ok(body.raport.nastepny_przebieg_o);
  assert.ok(body.braki_karty.includes('opis'));
  // Rejestracja sama przelicza pulę (słowo „dach”), więc lista może mieć też inne przetargi z emulatora.
  const nasz = body.wybrane.find((m) => m.id === t.id);
  assert.ok(nasz, 'dzisiejszy wybór jest na liście');
  assert.deepEqual(nasz.uzasadnienie, ['Dachy']);
  assert.equal(body.odrzucone.lista_dostepna, true);
});

test('PUT /pracownik/karta: walidacja „od ≤ do” i zapis', async () => {
  const k = await konto();
  const zle = await fetch(`${BAZA}/pracownik/karta`, { method: 'PUT', headers: k.h, body: JSON.stringify({ wartosc_min: 10, wartosc_max: 5 }) });
  assert.equal(zle.status, 400);
  const ok = await fetch(`${BAZA}/pracownik/karta`, { method: 'PUT', headers: k.h,
    body: JSON.stringify({ opis: 'Dachy', wykluczenia: ['drogi'], regiony: ['podkarpackie'], wartosc_max: 1e6, min_dni_oferta: 7 }) });
  assert.equal(ok.status, 200);
  const { karta, braki } = await ok.json();
  assert.deepEqual([karta.opis, karta.regiony[0], karta.min_dni_oferta], ['Dachy', '18', 7]);
  assert.ok(!braki.includes('opis'));
});

test('POST /pracownik/odrzuc: sygnał, znika z /matches; zła przyczyna 400; cudze/nieistniejące 404', async () => {
  const k = await konto();
  const inny = await konto();
  const t = await wybrany(k.id);
  assert.equal((await post(k, `/pracownik/odrzuc/${t.id}`, { przyczyna: 'wykluczenie' })).status, 400);
  assert.equal((await post(inny, `/pracownik/odrzuc/${t.id}`, { przyczyna: 'teren' })).status, 404);
  assert.equal((await post(k, `/pracownik/odrzuc/${t.id}`, { przyczyna: 'teren', komentarz: 'za daleko' })).status, 200);
  const lista = await get(k, '/matches');
  assert.ok(!lista.body.matches.some((m) => m.id === t.id));
  assert.equal((await users.findById(k.id)).pracownik_sygnaly[0].przyczyna, 'teren');
});

test('GET /pracownik/odrzucone: Free → powód plan; Standard → lista', async () => {
  const free = await konto({ plan: 'free' });
  assert.equal((await get(free, '/pracownik/odrzucone')).body.powod, 'plan');
  const std = await konto({ plan: 'standard' });
  const { tender } = await tenders.upsert({ externalId: `prt-o-${process.pid}`, title: 'Odrzucony dach', deadline: '2099-01-01T00:00:00.000Z' });
  await evaluations.zapiszDecyzje(std.id, tender.id, { decyzja: 'odrzucony', przyczyna: 'teren', etap: 'regula', criteriaHash: 'v', tender,
    szczegol: { pl: 'Poza terenem', en: 'Outside' } });
  const { body } = await get(std, '/pracownik/odrzucone');
  assert.equal(body.odrzucone[0].tytul, 'Odrzucony dach');
  assert.equal(body.odrzucone[0].przyczyna, 'teren');
});

test('POST /pracownik/przywroc: Standard przywraca; Free 403', async () => {
  const std = await konto({ plan: 'standard' });
  const { tender } = await tenders.upsert({ externalId: `prt-p-${process.pid}`, title: 'Przywracany dach', deadline: '2099-01-01T00:00:00.000Z' });
  await evaluations.zapiszDecyzje(std.id, tender.id, { decyzja: 'odrzucony', przyczyna: 'branza', etap: 'ai', criteriaHash: 'v', tender });
  assert.equal((await post(std, `/pracownik/przywroc/${tender.id}`)).status, 200);
  assert.equal((await matches.detail(std.id, tender.id)).scorer, 'klient');
  assert.equal((await evaluations.pobierz(std.id, tender.id)).decyzja, 'wybrany');
  const free = await konto({ plan: 'free' });
  assert.equal((await post(free, `/pracownik/przywroc/${tender.id}`)).status, 403);
});

test('propozycje: pojawiają się w /dzien, „nie teraz” je chowa, nieznany klucz 404', async () => {
  const k = await konto();
  const teraz = new Date().toISOString();
  for (const t of ['A', 'B', 'C']) {
    await users.dodajSygnal(k.id, zbudujSygnal({ typ: 'odrzucenie', tenderId: t, tytul: `Dach ${t}`, przyczyna: 'za_duze', wartosc: 2e6, teraz }));
  }
  const [p] = (await get(k, '/pracownik/dzien')).body.propozycje;
  assert.equal(p.pole, 'wartosc_max');
  assert.equal((await post(k, '/pracownik/propozycje/nieznany', { akcja: 'przyjmij' })).status, 404);
  assert.equal((await post(k, `/pracownik/propozycje/${p.klucz}`, { akcja: 'nie_teraz' })).status, 200);
  assert.equal((await get(k, '/pracownik/dzien')).body.propozycje.length, 0);
});

test('propozycja „przyjmij” zmienia kartę', async () => {
  const k = await konto();
  const teraz = new Date().toISOString();
  for (const t of ['A', 'B', 'C']) {
    await users.dodajSygnal(k.id, zbudujSygnal({ typ: 'odrzucenie', tenderId: t, tytul: `Dach ${t}`, przyczyna: 'za_duze', wartosc: 2e6, teraz }));
  }
  const [p] = (await get(k, '/pracownik/dzien')).body.propozycje;
  assert.equal((await post(k, `/pracownik/propozycje/${p.klucz}`, { akcja: 'przyjmij' })).body.karta.wartosc_max, 2e6);
});

test('GET /matches/:id/warunki: Free → plan; Standard bez tekstu → brak_tekstu; z tekstem bez karty → brak_karty', async () => {
  const free = await konto({ plan: 'free' });
  const tf = await wybrany(free.id);
  assert.equal((await get(free, `/matches/${tf.id}/warunki`)).body.powod, 'plan');
  const std = await konto({ plan: 'standard' });
  const bez = await wybrany(std.id);
  assert.equal((await get(std, `/matches/${bez.id}/warunki`)).body.powod, 'brak_tekstu');
  const z = await wybrany(std.id, { warunki_udzialu: { tekst: 'Obrót 2 mln zł', zrodlo: 'ogloszenie' } });
  const odp = (await get(std, `/matches/${z.id}/warunki`)).body;
  assert.deepEqual([odp.powod, odp.tekst], ['brak_karty', 'Obrót 2 mln zł']);
});

test('GET /matches/:id: termin pytań do SWZ; GET /auth/me: plan i próba', async () => {
  const k = await konto();
  const t = await wybrany(k.id, { deadline: '2099-01-20T10:00:00.000Z' });
  const { body } = await get(k, `/matches/${t.id}`);
  assert.ok(body.match.termin_pytan === null || typeof body.match.termin_pytan === 'string');
  const me = (await get(k, '/auth/me')).body.user;
  assert.deepEqual([me.plan, me.proba.aktywna, me.powiadomienia_pracownik_email], ['standard', true, true]);
});

test('wypis z maili: GET niczego nie zmienia, POST wypisuje, drugi POST 400', async () => {
  const k = await konto();
  const { token } = await magicLinks.create({ userId: k.id, purpose: 'wypisz_pracownik', ttlMinutes: 60 });
  const strona = await fetch(`${BAZA}/pracownik/wypisz?token=${token}`);
  assert.equal(strona.status, 200);
  assert.match(await strona.text(), /<form method="post"/);
  assert.notEqual((await users.findById(k.id)).powiadomienia_pracownik_email, false);
  assert.equal((await fetch(`${BAZA}/pracownik/wypisz?token=${token}`, { method: 'POST' })).status, 200);
  assert.equal((await users.findById(k.id)).powiadomienia_pracownik_email, false);
  assert.equal((await fetch(`${BAZA}/pracownik/wypisz?token=${token}`, { method: 'POST' })).status, 400);
});
