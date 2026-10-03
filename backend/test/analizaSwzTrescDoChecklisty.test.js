import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * PIERWSZA WKLEJONA SWZ → DOPASOWANIE DOKUMENTÓW → CHECKLISTA (2026-10-03).
 *
 * Do tej pory `POST /postepowania/:id/analiza` oddawało wklejoną SWZ płatnemu AI i jej
 * nie zapisywało. Dopasowanie sejfu czytało treść wyłącznie z wersji opublikowanych
 * (`/odswiez`), więc po pierwszej analizie checklista nie znała żadnych wymagań —
 * a przy awarii albo limicie AI treść przepadała w całości.
 *
 * Pilnujemy tu:
 *   • pierwsza SWZ jest trwale dostępna do dopasowania — także przy 503 i 429 z AI,
 *   • ponowienie i równoległe żądania nie tworzą duplikatów i niczego nie nadpisują,
 *   • istniejąca wersja opublikowana ma pierwszeństwo i nie jest ruszana,
 *   • wklejona treść NIE staje się publikacją zamawiającego (zero wersji, zero zmian),
 *   • cudze postępowanie => 404 i zero zapisu; limit rozmiaru => 413 i zero zapisu,
 *   • kontrakt z checklistą: odpowiedź dopasowania przechodzi przez PRAWDZIWE funkcje
 *     aplikacji i Cloud Functions (bez atrap kształtu).
 *
 * Płatnego AI nie wołamy: klient Anthropic to atrapa sterowana trybem (ok / błąd / brak).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-analiza-tresc-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.PRZETARG_AI_DAILY_LIMIT_PER_USER = '3';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const {
  users, postepowaniaSwz, swzWersje, swzTrescWklejona, pytaniaSwz, zmianySwz,
} = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { ustawKlientaAnthropic } = await import('../src/services/analizaSwz.js');
const { MAKS_ZNAKOW_TRESCI } = await import('../src/lib/limityTresci.js');
const { TYPY_DOKUMENTOW } = await import('../src/config/dokumentyKatalog.js');
// Prawdziwe ogniwa pozostałych pakietów — aplikacja i Cloud Functions.
const { wymaganiaZDopasowania, opisGotowosci } = await import('../../mobile/src/lib/wygrywalnosc.js');
const { zbudujChecklisteOferty, KOSZYKI } = await import('../../firebase/functions/src/lib/checklistaOferty.js');

const SWZ_KRK_ZUS = `
  VIII. Podmiotowe środki dowodowe, jakie złoży wykonawca:
  1) informacja z Krajowego Rejestru Karnego w zakresie niekaralności,
  2) zaświadczenie z ZUS o niezaleganiu w opłacaniu składek na ubezpieczenia społeczne.
`;
const SWZ_OC = 'Wykonawca przedłoży polisę odpowiedzialności cywilnej na kwotę 500 000 zł.';
const SWZ_KRS = 'Wykonawca złoży odpis z Krajowego Rejestru Sądowego albo wydruk z CEIDG.';

/** Atrapa klienta Anthropic sterowana trybem; liczy wywołania. */
const ai = {
  tryb: 'ok',
  wywolania: 0,
  messages: {
    create: async () => {
      ai.wywolania += 1;
      if (ai.tryb === 'blad') throw new Error('upstream 529 overloaded');
      return {
        content: [{ type: 'text', text: JSON.stringify({ pytania: [
          { tresc: 'Czy dopuszczają Państwo rozwiązania równoważne?', fragment: 'Rozdz. III', kategoria: 'niejasnosc' },
          { tresc: 'Jaki jest wymagany okres gwarancji?', fragment: 'Rozdz. V', kategoria: 'brak_parametru' },
        ] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  },
};
/** Ustawia zachowanie AI na czas jednego testu: 'ok' | 'blad' | 'brak' (klient = null). */
function trybAi(tryb) {
  ai.tryb = tryb;
  ustawKlientaAnthropic(tryb === 'brak' ? null : ai);
}

let server;
let base;
let licznik = 0;

before(() => {
  migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  ustawKlientaAnthropic(null);
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

/** Nowy użytkownik z jednym postępowaniem (osobna pula dobowego limitu AI). */
function nowy(nazwa = 'u') {
  licznik += 1;
  const u = users.create({
    companyNip: null, companyName: null, email: `tresc-${nazwa}-${licznik}-${process.pid}@t.pl`, passwordHash: 'h',
  });
  const termin = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const post = postepowaniaSwz.create({ userId: u.id, nazwa: `Postępowanie ${licznik}`, terminSkladaniaOfert: termin });
  return { id: u.id, token: signToken(u.id), postId: post.id, termin };
}

async function zadanie(metoda, sciezka, u, cialo) {
  const res = await fetch(`${base}${sciezka}`, {
    method: metoda,
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: cialo === undefined ? undefined : JSON.stringify(cialo),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const analiza = (u, postId, cialo) => zadanie('POST', `/api/przetarg/swz/postepowania/${postId}/analiza`, u, cialo);
const odswiez = (u, postId, cialo) => zadanie('POST', `/api/przetarg/swz/postepowania/${postId}/odswiez`, u, cialo);
const detal = (u, postId) => zadanie('GET', `/api/przetarg/swz/postepowania/${postId}`, u);
const dopasuj = (u, postId, cialo = {}) => zadanie('POST', `/api/przetarg/sejf/dopasowanie/${postId}`, u, cialo);

const hasz = (t) => createHash('sha256').update(t).digest('hex');
const wklejoneWiersze = (postId) => db.prepare('SELECT * FROM swz_tresc_wklejona WHERE postepowanie_id = ?').all(postId);

/** Stan „żadnej publikacji zamawiającego": zero wersji, zero zmian, bramka czysta. */
function bezPublikacji(postId) {
  assert.equal(swzWersje.count(postId), 0, 'wklejona treść nie tworzy wersji opublikowanej');
  assert.equal(zmianySwz.listForPostepowanie(postId).length, 0, 'ani wpisu opublikowanej zmiany');
}

// ── Pierwsza SWZ ─────────────────────────────────────────────────────────────

test('pierwsza wklejona SWZ: zapisana, a dopasowanie bez body zna wymagania', async () => {
  trybAi('ok');
  const u = nowy('pierwsza');

  const przed = await dopasuj(u, u.postId);
  assert.equal(przed.json.zrodlo_swz, 'brak');
  assert.deepEqual(przed.json.wymagane_typy, []);

  const a = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.liczba, 2);
  assert.equal(a.json.tresc_swz.zrodlo, 'wklejona');
  assert.ok(a.json.tresc_swz.zapisana_at);

  const wiersze = wklejoneWiersze(u.postId);
  assert.equal(wiersze.length, 1);
  assert.equal(wiersze[0].tresc, SWZ_KRK_ZUS, 'treść zapisana wiernie, bez przycinania');
  assert.equal(wiersze[0].hash, hasz(SWZ_KRK_ZUS));
  bezPublikacji(u.postId);

  const d = await dopasuj(u, u.postId);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.deepEqual(d.json.wymagane_typy, ['krk', 'zus']);
  assert.equal(d.json.zrodlo_swz, 'wklejona');
  assert.equal(d.json.wymagania_heurystyczne, true, 'lista z parsera fraz to pomoc, nie komplet');

  const panel = await detal(u, u.postId);
  assert.equal(panel.json.tresc_swz.zrodlo, 'wklejona');
  assert.equal(panel.json.zmiany.length, 0);
  assert.equal(panel.json.checklista.do_odznaczenia, 0);
  assert.equal(panel.json.bramka.poziom, 'ok', 'wklejenie SWZ nie blokuje bramki przedwysyłkowej');
  assert.equal('tresc' in panel.json.tresc_swz, false, 'panel nie dostaje samej treści');
});

test('analiza samej umowy (bez SWZ) niczego nie zapamiętuje', async () => {
  trybAi('ok');
  const u = nowy('umowa');
  const a = await analiza(u, u.postId, { umowa: 'Kara umowna 0,5% za każdy dzień zwłoki.' });
  assert.equal(a.status, 201);
  assert.equal(a.json.tresc_swz.zrodlo, 'brak');
  assert.equal(wklejoneWiersze(u.postId).length, 0);
});

// ── Awaria i limit AI ────────────────────────────────────────────────────────

test('AI 503 (błąd modelu): treść zostaje i dopasowanie działa', async () => {
  trybAi('blad');
  const u = nowy('503');
  const przedAi = ai.wywolania;

  const a = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(a.status, 503, JSON.stringify(a.json));
  assert.equal(ai.wywolania, przedAi + 1, 'model był wołany i zawiódł');
  assert.equal(a.json.error.details.tresc_swz.zrodlo, 'wklejona', 'odpowiedź błędu mówi, że treść jest zapisana');

  assert.equal(wklejoneWiersze(u.postId).length, 1);
  assert.equal(pytaniaSwz.listForPostepowanie(u.postId).length, 0, 'bez AI nie ma szkiców pytań');
  bezPublikacji(u.postId);

  const d = await dopasuj(u, u.postId);
  assert.deepEqual(d.json.wymagane_typy, ['krk', 'zus']);
  assert.equal(d.json.zrodlo_swz, 'wklejona');
});

test('AI 503 (brak konfiguracji AI): treść zostaje i dopasowanie działa', async () => {
  trybAi('brak');
  const u = nowy('brak-ai');
  const a = await analiza(u, u.postId, { swz: SWZ_OC });
  assert.equal(a.status, 503);
  assert.equal(a.json.error.details.tresc_swz.zrodlo, 'wklejona');
  assert.deepEqual((await dopasuj(u, u.postId)).json.wymagane_typy, ['polisa_oc']);
  bezPublikacji(u.postId);
});

test('AI 429 (dobowy limit użytkownika): treść zostaje, modelu nie wołamy', async () => {
  trybAi('ok');
  const u = nowy('429');
  // Zużywamy limit (3) analizami samej umowy — one nie zapisują SWZ.
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await analiza(u, u.postId, { umowa: `Wzór umowy ${i}` })).status, 201);
  }
  assert.equal(wklejoneWiersze(u.postId).length, 0);
  const przedAi = ai.wywolania;

  const a = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(a.status, 429, JSON.stringify(a.json));
  assert.equal(a.json.error.code, 'LIMIT_AI_DZIENNY');
  assert.equal(a.json.error.details.tresc_swz.zrodlo, 'wklejona');
  assert.equal(ai.wywolania, przedAi, 'limit zatrzymał żądanie przed płatnym wywołaniem');

  const d = await dopasuj(u, u.postId);
  assert.deepEqual(d.json.wymagane_typy, ['krk', 'zus']);
  bezPublikacji(u.postId);
});

// ── Ponowienie i współbieżność ───────────────────────────────────────────────

test('ponowienie po awarii: jeden wiersz treści, szkice pytań bez duplikatów', async () => {
  const u = nowy('ponow');
  trybAi('blad');
  assert.equal((await analiza(u, u.postId, { swz: SWZ_KRK_ZUS })).status, 503);
  const pierwszy = wklejoneWiersze(u.postId)[0];

  trybAi('ok');
  const drugie = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(drugie.status, 201);
  assert.equal(drugie.json.liczba, 2);

  const trzecie = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(trzecie.status, 201);
  assert.equal(trzecie.json.liczba, 0, 'te same pytania nie są dopisywane drugi raz');

  const wiersze = wklejoneWiersze(u.postId);
  assert.equal(wiersze.length, 1);
  assert.equal(wiersze[0].created_at, pierwszy.created_at, 'ponowienie nie rusza pierwszego zapisu');
  assert.equal(pytaniaSwz.listForPostepowanie(u.postId).length, 2);
  bezPublikacji(u.postId);
});

test('druga analiza z INNĄ treścią nie nadpisuje pierwszej', async () => {
  trybAi('ok');
  const u = nowy('inna');
  await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  const drugie = await analiza(u, u.postId, { swz: SWZ_OC });
  assert.equal(drugie.status, 201);

  const wiersze = wklejoneWiersze(u.postId);
  assert.equal(wiersze.length, 1);
  assert.equal(wiersze[0].hash, hasz(SWZ_KRK_ZUS));
  assert.deepEqual((await dopasuj(u, u.postId)).json.wymagane_typy, ['krk', 'zus']);
  bezPublikacji(u.postId);
});

test('równoległe analizy różnych treści: dokładnie jeden zapis, żadnych wersji ani zmian', async () => {
  trybAi('ok');
  const u = nowy('wyscig');
  const tresci = Array.from({ length: 8 }, (_, i) => `${SWZ_KRK_ZUS}\nWariant ${i}`);

  const odpowiedzi = await Promise.all(tresci.map((swz) => analiza(u, u.postId, { swz })));
  // Część żądań odbija się od dobowego limitu (3) — to też ma zostawić spójny stan.
  assert.ok(odpowiedzi.every((o) => o.status === 201 || o.status === 429), JSON.stringify(odpowiedzi.map((o) => o.status)));

  const wiersze = wklejoneWiersze(u.postId);
  assert.equal(wiersze.length, 1);
  assert.ok(tresci.map(hasz).includes(wiersze[0].hash), 'zapisana jest jedna z wysłanych treści, w całości');
  assert.equal(wiersze[0].hash, hasz(wiersze[0].tresc), 'treść i hasz należą do tego samego żądania');
  bezPublikacji(u.postId);
  const tresciPytan = pytaniaSwz.listForPostepowanie(u.postId).map((p) => p.tresc);
  assert.equal(new Set(tresciPytan).size, tresciPytan.length, 'bez zdublowanych szkiców');
});

test('repozytorium: zapis jest idempotentny i zwraca treść już zapisaną', () => {
  const u = nowy('repo');
  const a = swzTrescWklejona.zapiszPierwsza({ postepowanieId: u.postId, hash: hasz('A'), tresc: 'A' });
  const b = swzTrescWklejona.zapiszPierwsza({ postepowanieId: u.postId, hash: hasz('B'), tresc: 'B' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.wiersz.tresc, 'A');
  assert.equal(wklejoneWiersze(u.postId).length, 1);
});

// ── Istniejąca wersja opublikowana ───────────────────────────────────────────

test('istniejąca wersja opublikowana: analiza jej nie rusza i niczego nie dopisuje', async () => {
  trybAi('ok');
  const u = nowy('wersja');
  const o = await odswiez(u, u.postId, { tresc: SWZ_KRS });
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const wersjaPrzed = swzWersje.latestForPostepowanie(u.postId);

  const a = await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(a.status, 201);
  assert.equal(a.json.tresc_swz.zrodlo, 'wersja');

  assert.equal(wklejoneWiersze(u.postId).length, 0, 'przy istniejącej wersji wklejonej treści nie zapisujemy');
  assert.equal(swzWersje.count(u.postId), 1);
  assert.deepEqual(swzWersje.latestForPostepowanie(u.postId), wersjaPrzed, 'wersja zamawiającego nietknięta');
  assert.equal(zmianySwz.listForPostepowanie(u.postId).length, 0, 'analiza nie jest opublikowaną zmianą');

  const d = await dopasuj(u, u.postId);
  assert.equal(d.json.zrodlo_swz, 'wersja');
  assert.deepEqual(d.json.wymagane_typy, ['wpis_rejestr'], 'wymagania z wersji zamawiającego, nie z analizy');
});

test('wklejona treść, potem publikacje: pierwsza publikacja to baza, zmianę tworzy dopiero druga', async () => {
  trybAi('ok');
  const u = nowy('potem');
  await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });

  // Pierwsza prawdziwa publikacja NIE jest porównywana z wklejoną treścią.
  const pierwsza = await odswiez(u, u.postId, { tresc: SWZ_KRS });
  assert.equal(pierwsza.json.nowe_wersje, 1);
  assert.equal(pierwsza.json.zmiany, 0, 'brak fałszywej „opublikowanej zmiany" względem wklejonej treści');
  assert.equal(zmianySwz.listForPostepowanie(u.postId).length, 0);

  // Nowsza wersja zamawiającego ma pierwszeństwo przed wklejoną.
  const d = await dopasuj(u, u.postId);
  assert.equal(d.json.zrodlo_swz, 'wersja');
  assert.deepEqual(d.json.wymagane_typy, ['wpis_rejestr']);
  assert.equal(wklejoneWiersze(u.postId).length, 1, 'wklejona treść zostaje w bazie, tylko nie jest już używana');

  // Spóźnione ponowienie starej analizy niczego nie cofa.
  await analiza(u, u.postId, { swz: SWZ_OC });
  assert.equal((await dopasuj(u, u.postId)).json.zrodlo_swz, 'wersja');
  assert.equal(wklejoneWiersze(u.postId)[0].hash, hasz(SWZ_KRK_ZUS));

  // Dopiero różnica MIĘDZY publikacjami jest zmianą.
  const druga = await odswiez(u, u.postId, { tresc: `${SWZ_KRS}\nTermin realizacji: 45 dni.` });
  assert.equal(druga.json.nowe_wersje, 1);
  assert.equal(zmianySwz.listForPostepowanie(u.postId).length, 1);
});

test('body `swz` w dopasowaniu nadal ma pierwszeństwo, a jawna lista typów jest oznaczona', async () => {
  trybAi('ok');
  const u = nowy('body');
  await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });

  const zBody = await dopasuj(u, u.postId, { swz: SWZ_OC });
  assert.equal(zBody.json.zrodlo_swz, 'zadanie');
  assert.deepEqual(zBody.json.wymagane_typy, ['polisa_oc']);

  const zListy = await dopasuj(u, u.postId, { wymagane_typy: ['us'] });
  assert.equal(zListy.json.zrodlo_swz, 'lista');
  assert.equal(zListy.json.wymagania_heurystyczne, false);
  assert.deepEqual(zListy.json.wymagane_typy, ['us']);
});

// ── Izolacja właściciela i walidacja ─────────────────────────────────────────

test('obcy właściciel: 404 na analizie, panelu i dopasowaniu — i zero zapisu', async () => {
  trybAi('ok');
  const a = nowy('wlasciciel');
  const b = nowy('obcy');
  const przedAi = ai.wywolania;

  const obca = await analiza(b, a.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(obca.status, 404);
  assert.equal(ai.wywolania, przedAi, 'cudze postępowanie nie dochodzi do płatnego AI');
  assert.equal(wklejoneWiersze(a.postId).length, 0, 'obcy nie zapisze treści w cudzym postępowaniu');

  // Właściciel zapisuje swoją treść; obcy jej nie widzi ani nie podmieni.
  assert.equal((await analiza(a, a.postId, { swz: SWZ_KRK_ZUS })).status, 201);
  assert.equal((await analiza(b, a.postId, { swz: SWZ_OC })).status, 404);
  assert.equal(wklejoneWiersze(a.postId)[0].hash, hasz(SWZ_KRK_ZUS));

  assert.equal((await detal(b, a.postId)).status, 404);
  assert.equal((await dopasuj(b, a.postId)).status, 404);
  assert.equal((await analiza(null, a.postId, { swz: SWZ_OC })).status, 401);

  // Postępowanie obcego nie „dziedziczy" treści właściciela.
  const uObcego = await dopasuj(b, b.postId);
  assert.equal(uObcego.json.zrodlo_swz, 'brak');
  assert.deepEqual(uObcego.json.wymagane_typy, []);
});

test('treść ponad limit: 413, nic nie zapisane, AI niewołane', async () => {
  trybAi('ok');
  const u = nowy('limit');
  const przedAi = ai.wywolania;
  const a = await analiza(u, u.postId, { swz: 'x'.repeat(MAKS_ZNAKOW_TRESCI + 1) });
  assert.equal(a.status, 413, JSON.stringify(a.json?.error));
  assert.equal(a.json.error.code, 'ZA_DLUGA_TRESC');
  assert.equal(wklejoneWiersze(u.postId).length, 0);
  assert.equal(ai.wywolania, przedAi);
});

test('puste i nieprawidłowe body: 400 i nic nie zapisane', async () => {
  trybAi('ok');
  const u = nowy('puste');
  assert.equal((await analiza(u, u.postId, {})).status, 400);
  assert.equal((await analiza(u, u.postId, { swz: '   ' })).status, 400);
  assert.equal((await analiza(u, u.postId, { swz: 123 })).status, 400);
  assert.equal(wklejoneWiersze(u.postId).length, 0);
});

test('usunięcie postępowania zabiera wklejoną treść (kaskada)', async () => {
  trybAi('ok');
  const u = nowy('kaskada');
  await analiza(u, u.postId, { swz: SWZ_KRK_ZUS });
  assert.equal(wklejoneWiersze(u.postId).length, 1);
  db.prepare('DELETE FROM postepowanie_swz WHERE id = ?').run(u.postId);
  assert.equal(wklejoneWiersze(u.postId).length, 0);
});

// ── Kontrakt analizy z checklistą ────────────────────────────────────────────

test('KONTRAKT: analiza (AI padło) → dopasowanie → wymagania w aplikacji → checklista w Functions', async () => {
  trybAi('blad');
  const u = nowy('kontrakt');
  assert.equal((await analiza(u, u.postId, { swz: SWZ_KRK_ZUS })).status, 503);

  // Użytkownik ma w sejfie świeże KRK; zaświadczenia z ZUS nie ma.
  const dzis = new Date().toISOString().slice(0, 10);
  const dodany = await zadanie('POST', '/api/przetarg/sejf/dokumenty', u, { typ: 'krk', data_wystawienia: dzis });
  assert.equal(dodany.status, 201, JSON.stringify(dodany.json));

  // Dokładnie te dwa wywołania robi ekran checklisty (ChecklistaOfertyScreen.wczytaj).
  const dopasowanie = (await dopasuj(u, u.postId, {})).json;
  const sejf = (await zadanie('GET', '/api/przetarg/sejf/dokumenty', u)).json;

  const katalog = TYPY_DOKUMENTOW.map((t) => ({ id: t.id, nazwa: t.nazwa }));
  const { stan, wymagania } = wymaganiaZDopasowania(dopasowanie, katalog);
  assert.equal(stan, 'znane');
  assert.deepEqual(wymagania.map((w) => w.kod), ['krk', 'zus']);

  const checklista = zbudujChecklisteOferty({
    tender: { id: 't-kontrakt', source: 'bzp', deadline: u.termin },
    wymagania,
    dokumenty: sejf.dokumenty,
    teraz: Date.now(),
  });
  assert.equal(checklista.stanWiedzy.znamyWymagania, true);
  assert.deepEqual(checklista.koszyki[KOSZYKI.MASZ].map((p) => p.kod), ['krk']);
  assert.deepEqual(checklista.koszyki[KOSZYKI.BRAKUJE].map((p) => p.kod), ['zus']);
  assert.equal(checklista.nastepnyKrok.kod, 'zus', 'następny krok: brakujący dokument obowiązkowy');

  // Wymagania z parsera fraz to heurystyka — ekran nie może ogłosić kompletu.
  assert.equal(dopasowanie.wymagania_heurystyczne, true);
  const gotowosc = opisGotowosci(checklista, 'pl', { wymagania: stan, sejf: 'ok', wykryte: wymagania.length });
  assert.match(gotowosc.tekst, /może być niepełna/);
  assert.notEqual(gotowosc.ton, 'sukces');
});
