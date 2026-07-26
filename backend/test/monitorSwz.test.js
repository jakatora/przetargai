import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Monitor publikacji zamawiającego (ulepszenie „Radar pytań i odpowiedzi do SWZ",
 * podzadanie 5/7).
 *
 * Cyklicznie i na żądanie dociąga nowe wersje SWZ dla postępowań wciąż w oknie
 * (przed terminem składania) i przy KAŻDEJ nowej wersji: zapisuje ją (`swz_wersja`,
 * dedup po haszu) i puszcza przez silnik różnic → wpis `zmiany_swz`.
 *
 * Płatnego API nie wołamy w testach (brak klucza): logikę monitora pokrywamy z
 * ATRAPĄ `zarejestruj` (nie dotyka AI), a ścieżkę end-to-end endpointu — na realnym
 * `zarejestrujRoznice`, który przy AI wyłączonym gracja: zapisuje zmianę z samym
 * diffem (`opis_skutku = null`), nie gubiąc faktu publikacji nowej wersji.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-monitor-swz-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // AI wyłączone — opis skutku zejdzie na gracja (null)
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { users, postepowaniaSwz, swzWersje, zmianySwz } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const {
  haszTresci, ingestujWersje, odswiezPostepowanie, runSwzMonitor,
} = await import('../src/jobs/monitorSwz.js');

/** Atrapa silnika różnic: nie woła AI, zapamiętuje wywołania, oddaje fikcyjny wpis. */
function fakeZarejestruj() {
  const wywolania = [];
  const fn = async ({ postepowanieId, poprzednia, nowa }) => {
    wywolania.push({ postepowanieId, poprzednia, nowa });
    return { id: `zm-${wywolania.length}`, postepowanie_id: postepowanieId, wersja_swz_id: nowa?.id ?? null };
  };
  fn.wywolania = wywolania;
  return fn;
}

let userId;
let token;
let server;
let base;

before(() => {
  migrate();
  userId = users.create({ companyNip: null, companyName: null, email: `monitor-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  token = signToken(userId);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Część 1: helpery i okno monitoringu (repo) ───────────────────────────────

test('haszTresci — deterministyczny SHA-256, różne treści => różne hasze', () => {
  assert.equal(haszTresci('SWZ v1'), haszTresci('SWZ v1'), 'ta sama treść => ten sam hasz');
  assert.notEqual(haszTresci('SWZ v1'), haszTresci('SWZ v2'), 'różna treść => różny hasz');
  assert.match(haszTresci('x'), /^[0-9a-f]{64}$/, 'hex SHA-256');
  assert.equal(haszTresci(null), haszTresci(''), 'null traktujemy jak pusty tekst');
});

test('postepowaniaSwz.doMonitoringu — bierze przed terminem i bez terminu, pomija po terminie', () => {
  const teraz = '2026-07-26T00:00:00.000Z';
  const przed = postepowaniaSwz.create({ userId, nazwa: 'W oknie', terminSkladaniaOfert: '2026-12-01T10:00:00.000Z' }).id;
  const bez = postepowaniaSwz.create({ userId, nazwa: 'Bez terminu' }).id;
  const po = postepowaniaSwz.create({ userId, nazwa: 'Po terminie', terminSkladaniaOfert: '2026-01-01T10:00:00.000Z' }).id;

  const ids = new Set(postepowaniaSwz.doMonitoringu(teraz).map((p) => p.id));
  assert.ok(ids.has(przed), 'termin w przyszłości => monitorujemy');
  assert.ok(ids.has(bez), 'brak terminu => monitorujemy (nie wiemy, kiedy koniec)');
  assert.ok(!ids.has(po), 'termin minął => poza oknem, nie monitorujemy');
});

// ── Część 2: ingestujWersje (atrapa zarejestruj — bez AI) ────────────────────

test('ingestujWersje — pierwsza wersja to baza (bez zmiany), druga tworzy zmianę', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Wersjonowanie' });
  const zarejestruj = fakeZarejestruj();

  const w1 = await ingestujWersje({
    postepowanie: p, zarejestruj,
    kandydaci: [{ tresc: 'Termin realizacji: 60 dni', dataPublikacji: '2026-07-02T00:00:00.000Z' }],
  });
  assert.equal(w1.noweWersje, 1);
  assert.equal(w1.zmiany, 0, 'pierwsza wersja nie ma z czym się porównać');
  assert.equal(zarejestruj.wywolania.length, 0);

  const w2 = await ingestujWersje({
    postepowanie: p, zarejestruj,
    kandydaci: [{ tresc: 'Termin realizacji: 45 dni', dataPublikacji: '2026-07-10T00:00:00.000Z' }],
  });
  assert.equal(w2.noweWersje, 1);
  assert.equal(w2.zmiany, 1, 'zmiana treści względem poprzedniej wersji => wpis zmiany');
  assert.equal(zarejestruj.wywolania.length, 1);
  assert.match(zarejestruj.wywolania[0].poprzednia.tresc, /60 dni/, 'silnik różnic dostał poprzednią wersję');
  assert.match(zarejestruj.wywolania[0].nowa.tresc, /45 dni/, '...i nową');
  assert.equal(swzWersje.count(p.id), 2);
});

test('ingestujWersje — dedup po haszu: znana wersja nie tworzy duplikatu ani zmiany', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Dedup' });
  const zarejestruj = fakeZarejestruj();
  const kand = [{ tresc: 'Ta sama treść SWZ' }];

  const a = await ingestujWersje({ postepowanie: p, zarejestruj, kandydaci: kand });
  assert.equal(a.noweWersje, 1);
  const b = await ingestujWersje({ postepowanie: p, zarejestruj, kandydaci: kand });
  assert.equal(b.noweWersje, 0, 'ten sam hasz => brak nowej wersji');
  assert.equal(b.zmiany, 0);
  assert.equal(swzWersje.count(p.id), 1, 'wciąż jedna wersja');
});

test('ingestujWersje — kilku kandydatów w jednym przebiegu tworzy łańcuch wersji i zmian', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Łańcuch' });
  const zarejestruj = fakeZarejestruj();
  const wynik = await ingestujWersje({
    postepowanie: p, zarejestruj,
    kandydaci: [{ tresc: 'v1: 60 dni' }, { tresc: 'v2: 45 dni' }, { tresc: 'v3: 30 dni' }],
  });
  assert.equal(wynik.noweWersje, 3);
  assert.equal(wynik.zmiany, 2, 'v1→v2 i v2→v3 (v1 to baza)');
  assert.equal(zarejestruj.wywolania.length, 2);
  assert.match(zarejestruj.wywolania[1].poprzednia.tresc, /v2/, 'trzeci kandydat porównany z drugim, nie z pierwszym');
});

test('ingestujWersje — kandydat bez treści i bez hasza jest pomijany (brak czym deduplikować)', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Bezhaszowy' });
  const zarejestruj = fakeZarejestruj();
  const wynik = await ingestujWersje({ postepowanie: p, zarejestruj, kandydaci: [{ sciezka: '/swz/plik.pdf' }] });
  assert.equal(wynik.noweWersje, 0, 'sama ścieżka bez hasza => pomijamy');
  assert.equal(swzWersje.count(p.id), 0);

  // Ta sama ścieżka, ale z jawnym haszem — już wersjonujemy.
  const wynik2 = await ingestujWersje({ postepowanie: p, zarejestruj, kandydaci: [{ sciezka: '/swz/plik.pdf', hash: 'jawny-hash' }] });
  assert.equal(wynik2.noweWersje, 1);
});

// ── Część 3: runSwzMonitor (cykliczny przebieg, atrapa zarejestruj) ──────────

test('runSwzMonitor — przetwarza tylko postępowania w oknie i agreguje wynik', async () => {
  const teraz = '2026-07-26T00:00:00.000Z';
  const wOknie = postepowaniaSwz.create({ userId, nazwa: 'Monitor-w-oknie', terminSkladaniaOfert: '2026-12-01T10:00:00.000Z' }).id;
  const bezTerminu = postepowaniaSwz.create({ userId, nazwa: 'Monitor-bez-terminu' }).id;
  const poTerminie = postepowaniaSwz.create({ userId, nazwa: 'Monitor-po-terminie', terminSkladaniaOfert: '2026-01-01T10:00:00.000Z' }).id;

  const mapa = {
    [wOknie]: [{ tresc: 'SWZ A v1' }, { tresc: 'SWZ A v2' }], // 2 wersje, 1 zmiana
    [bezTerminu]: [{ tresc: 'SWZ B v1' }],                    // 1 wersja, 0 zmian
    [poTerminie]: [{ tresc: 'SWZ C v1' }, { tresc: 'SWZ C v2' }], // poza oknem — nie tknięte
  };
  const zarejestruj = fakeZarejestruj();
  const wynik = await runSwzMonitor({
    teraz,
    zarejestruj,
    pobierzPublikacje: async (p) => mapa[p.id] ?? [], // nieznane (z innych testów) => nic nowego
  });

  assert.equal(wynik.ok, true);
  assert.equal(wynik.noweWersje, 3, '2 (w oknie) + 1 (bez terminu); po terminie pominięte');
  assert.equal(wynik.zmiany, 1, 'tylko A v1→v2');
  assert.equal(wynik.zmienione, 2, 'dwa postępowania dostały nowe wersje');
  assert.equal(wynik.bledy, 0);
  assert.equal(swzWersje.count(poTerminie), 0, 'postępowanie po terminie nie było dociągane');
  assert.equal(swzWersje.count(wOknie), 2);
});

test('runSwzMonitor — błąd źródła jednego postępowania nie przerywa reszty', async () => {
  const teraz = '2026-07-26T00:00:00.000Z';
  const pechowy = postepowaniaSwz.create({ userId, nazwa: 'Pechowy', terminSkladaniaOfert: '2026-12-01T10:00:00.000Z' }).id;
  const zdrowy = postepowaniaSwz.create({ userId, nazwa: 'Zdrowy', terminSkladaniaOfert: '2026-12-01T10:00:00.000Z' }).id;

  const zarejestruj = fakeZarejestruj();
  const wynik = await runSwzMonitor({
    teraz,
    zarejestruj,
    pobierzPublikacje: async (p) => {
      if (p.id === pechowy) throw new Error('platforma zamawiającego niedostępna');
      if (p.id === zdrowy) return [{ tresc: 'SWZ Z v1 — jedyna nowa treść tego przebiegu' }];
      return [];
    },
  });

  assert.equal(wynik.bledy, 1, 'jeden rekord padł');
  assert.ok(wynik.noweWersje >= 1, 'zdrowe postępowanie i tak przetworzone');
  assert.equal(swzWersje.count(zdrowy), 1, 'mimo błędu sąsiada zdrowe dostało wersję');
});

// ── Część 4: odswiezPostepowanie + endpoint (realny zarejestrujRoznice, AI off) ─

test('odswiezPostepowanie — wersja pchnięta ręcznie zapisuje zmianę z samym diffem (AI off => opis null)', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Ręczne odświeżenie' });
  const r1 = await odswiezPostepowanie({ postepowanie: p, pchnietaWersja: { tresc: 'Termin realizacji: 60 dni' } });
  assert.equal(r1.noweWersje, 1);
  assert.equal(r1.zmiany, 0, 'pierwsza wersja — brak porównania');

  const r2 = await odswiezPostepowanie({ postepowanie: p, pchnietaWersja: { tresc: 'Termin realizacji: 45 dni' } });
  assert.equal(r2.noweWersje, 1);
  assert.equal(r2.zmiany, 1);
  assert.equal(r2.zmiany_wpisy[0].opis_skutku, null, 'AI wyłączone => zapis bez opisu, ale z diffem');
  assert.match(r2.zmiany_wpisy[0].diff, /-.*60 dni[\s\S]*\+.*45 dni/, 'diff pokazuje 60→45');
});

async function postOdswiez(tok, id, body) {
  const res = await fetch(`${base}/api/przetarg/swz/postepowania/${id}/odswiez`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST odswiez — bez tokenu => 401', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Auth' }).id;
  const { status } = await postOdswiez(null, p, { tresc: 'x' });
  assert.equal(status, 401);
});

test('POST odswiez — cudze/nieistniejące postępowanie => 404', async () => {
  const nieistnieje = await postOdswiez(token, 'nie-ma-takiego', { tresc: 'x' });
  assert.equal(nieistnieje.status, 404, JSON.stringify(nieistnieje.json));

  const obcy = users.create({ companyNip: null, companyName: null, email: `obcy-mon-${process.pid}@t.pl`, passwordHash: 'h' }).id;
  const cudze = postepowaniaSwz.create({ userId: obcy, nazwa: 'Cudze' }).id;
  const wynik = await postOdswiez(token, cudze, { tresc: 'x' });
  assert.equal(wynik.status, 404, 'cudze postępowanie => 404, nie 200');
});

test('POST odswiez — wgranie kolejnej wersji tworzy wpis zmiany (diff), dedup nie dubluje', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Endpoint E2E' }).id;

  const v1 = await postOdswiez(token, p, { tresc: 'Gwarancja: 24 miesiące\nTermin: 60 dni', dataPublikacji: '2026-07-02T00:00:00.000Z' });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  assert.equal(v1.json.nowe_wersje, 1);
  assert.equal(v1.json.zmiany, 0, 'pierwsza wersja — baza');

  const v2 = await postOdswiez(token, p, { tresc: 'Gwarancja: 24 miesiące\nTermin: 45 dni', dataPublikacji: '2026-07-10T00:00:00.000Z' });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  assert.equal(v2.json.nowe_wersje, 1);
  assert.equal(v2.json.zmiany, 1, 'zmiana treści => wpis zmiany');
  assert.equal(v2.json.zmiany_wpisy[0].opis_skutku, null, 'AI off => bez opisu');

  // Ta sama treść drugi raz — dedup, nic nowego.
  const powtorka = await postOdswiez(token, p, { tresc: 'Gwarancja: 24 miesiące\nTermin: 45 dni' });
  assert.equal(powtorka.json.nowe_wersje, 0, 'znana treść => brak nowej wersji');
  assert.equal(powtorka.json.zmiany, 0);

  // Stan w bazie: dwie wersje, jedna zmiana.
  assert.equal(swzWersje.count(p), 2);
  const zmiany = zmianySwz.listForPostepowanie(p);
  assert.equal(zmiany.length, 1);
  assert.match(zmiany[0].diff, /45 dni/, 'zapisany diff niesie nową treść');
});

test('POST odswiez — puste body odpytuje źródło (stub) i nie tworzy wersji', async () => {
  const p = postepowaniaSwz.create({ userId, nazwa: 'Puste body' }).id;
  const { status, json } = await postOdswiez(token, p, {});
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.nowe_wersje, 0, 'brak treści i brak wpiętego źródła => nic nowego');
  assert.equal(json.zmiany, 0);
});
