import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Usługa regulaminu zakupowego (ulepszenie „Radar zamówień podprogowych — poniżej
 * 170 tys. zł", podzadanie 5/7).
 *
 * Dla znaleziska: lokalizuje i pobiera z BIP regulamin zakupowy + streszcza
 * mini-procedurę przez Claude → zapisuje `regulamin_url` + `regulamin_streszczenie`.
 *
 * Płatnego API nie wołamy w testach (zakaz + brak klucza): pokrywamy
 *   • czyste funkcje (znajdzLinkRegulaminu, parsujStreszczenie, budujPromptStreszczenia),
 *   • streszMiniProcedure z ATRAPĄ klienta (sukces + księgowanie, brak klienta, błąd),
 *   • uzupelnijRegulamin end-to-end na temp DB (zapis obu pól; gracja gdy AI down /
 *     brak regulaminu),
 *   • BRAMKĘ BUDŻETU — jako OSTATNI blok (poisonuje wspólną pulę ai_usage).
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-regulamin-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = ''; // brak realnego klienta — wstrzykujemy atrapę
process.env.RESEND_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { env } = await import('../src/config/env.js');
const { aiUsage } = await import('../src/db/repos.js');
const { createPodprogoweRepo } = await import('../src/db/podprogoweRepo.js');
const {
  znajdzLinkRegulaminu, parsujStreszczenie, budujPromptStreszczenia,
  streszMiniProcedure, lokalizujRegulamin, uzupelnijRegulamin, ustawKlientaAnthropic,
} = await import('../src/services/regulaminZakupowy.js');

/** Atrapa klienta Anthropic: oddaje zadane streszczenie i zapamiętuje wywołania. */
function fakeKlient(streszczenie) {
  const wywolania = [];
  return {
    wywolania,
    messages: {
      create: async (arg) => {
        wywolania.push(arg);
        return {
          content: [{ type: 'text', text: JSON.stringify({ streszczenie }) }],
          usage: { input_tokens: 40, output_tokens: 20 },
        };
      },
    },
  };
}

/** Transport HTML sterowany mapą url→html; nieznany url rzuca (jak realny 404). */
function fakeStrony(mapa) {
  return async (url) => {
    if (Object.hasOwn(mapa, url)) return mapa[url];
    throw new Error(`404 ${url}`);
  };
}

let repo;
before(() => {
  migrate();
  repo = createPodprogoweRepo(db);
});
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

// ── Część 1: czysta lokalizacja linku regulaminu ─────────────────────────────

test('znajdzLinkRegulaminu — kotwica z kontekstem zakupowym => bezwzględny URL', () => {
  const html = `
    <a href="/kontakt">Kontakt</a>
    <a href="https://bip.gmina.pl/regulamin-zamowien.pdf">Regulamin udzielania zamówień</a>
    <a href="/bip">Strona BIP</a>`;
  assert.equal(
    znajdzLinkRegulaminu(html, 'https://bip.gmina.pl/ogloszenie/1'),
    'https://bip.gmina.pl/regulamin-zamowien.pdf',
  );
});

test('znajdzLinkRegulaminu — link względny rozwijany względem bazy', () => {
  const html = '<a href="regulamin-zakupowy.pdf">Regulamin zakupowy jednostki</a>';
  assert.equal(
    znajdzLinkRegulaminu(html, 'https://bip.szpital.pl/dokumenty'),
    'https://bip.szpital.pl/dokumenty/regulamin-zakupowy.pdf',
  );
});

test('znajdzLinkRegulaminu — bez kontekstu: fallback do dokumentu „regulamin.pdf"', () => {
  const html = '<a href="/pliki/regulamin.pdf">Regulamin</a>';
  assert.equal(znajdzLinkRegulaminu(html, 'https://bip.gmina.pl'), 'https://bip.gmina.pl/pliki/regulamin.pdf');
});

test('znajdzLinkRegulaminu — „regulamin serwisu" bez kontekstu/dokumentu => null', () => {
  assert.equal(znajdzLinkRegulaminu('<a href="/regulamin-serwisu">Regulamin serwisu BIP</a>', 'https://bip.pl'), null);
  assert.equal(znajdzLinkRegulaminu('<a href="/kontakt">Kontakt</a>', 'https://bip.pl'), null, 'brak kotwicy „regulamin" => null');
  assert.equal(znajdzLinkRegulaminu('', 'https://bip.pl'), null, 'pusty HTML => null');
  assert.equal(znajdzLinkRegulaminu('<a href="mailto:x@bip.pl">Regulamin zamówień</a>', 'https://bip.pl'), null, 'mailto pomijane');
});

// ── Część 2: parsowanie i budowanie promptu (bez AI) ─────────────────────────

test('parsujStreszczenie — czyta {"streszczenie":...} i przycina', () => {
  assert.equal(
    parsujStreszczenie(JSON.stringify({ streszczenie: '  Oferty składa się mailowo do 10 dni; bez wadium.  ' })),
    'Oferty składa się mailowo do 10 dni; bez wadium.',
  );
});

test('parsujStreszczenie — radzi sobie z ogrodzeniem ```json i prozą', () => {
  const text = 'Proszę bardzo:\n```json\n{"streszczenie":"Kryterium: cena 100%."}\n```\nGotowe.';
  assert.equal(parsujStreszczenie(text), 'Kryterium: cena 100%.');
});

test('parsujStreszczenie — śmieci / puste => null (nie rzuca)', () => {
  assert.equal(parsujStreszczenie('brak json'), null);
  assert.equal(parsujStreszczenie(''), null);
  assert.equal(parsujStreszczenie('{zepsuty'), null);
  assert.equal(parsujStreszczenie(JSON.stringify({ streszczenie: '   ' })), null, 'puste streszczenie => null');
});

test('budujPromptStreszczenia — pakuje regulamin w <regulamin>, przycina, dokleja zamawiającego', () => {
  const p = budujPromptStreszczenia({ tresc: 'Oferty do 7 dni.', zamawiajacy: 'Gmina Nowa' });
  assert.match(p, /Zamawiający: Gmina Nowa/);
  assert.match(p, /<regulamin>[\s\S]*Oferty do 7 dni\.[\s\S]*<\/regulamin>/);

  const dlugie = budujPromptStreszczenia({ tresc: 'x'.repeat(20000) });
  const wciete = dlugie.match(/<regulamin>\n([\s\S]*?)\n<\/regulamin>/)[1];
  assert.ok(wciete.length <= 12000, `treść przycięta do limitu tokenów (jest ${wciete.length})`);
  assert.match(budujPromptStreszczenia({}), /<regulamin>\s*\(brak treści\)\s*<\/regulamin>/, 'brak treści => „(brak treści)"');
});

// ── Część 3: streszMiniProcedure z atrapą klienta ────────────────────────────

test('streszMiniProcedure — atrapa: zwraca streszczenie, woła priced model i księguje koszt', async () => {
  const klient = fakeKlient('Oferty składa się mailowo w 10 dni; bez wadium; kryterium cena 100%.');
  ustawKlientaAnthropic(klient);
  const przed = aiUsage.monthCallCount();

  const s = await streszMiniProcedure({ tresc: 'Regulamin: oferty w 10 dni...', zamawiajacy: 'Gmina X' });

  assert.equal(s, 'Oferty składa się mailowo w 10 dni; bez wadium; kryterium cena 100%.');
  assert.equal(klient.wywolania.length, 1, 'dokładnie jedno wywołanie modelu');
  assert.equal(klient.wywolania[0].model, env.AI_MATCH_MODEL, 'używa zweryfikowanego cenowo modelu PrzetargAI');
  assert.match(klient.wywolania[0].messages[0].content, /<regulamin>[\s\S]*oferty w 10 dni/i);
  assert.equal(aiUsage.monthCallCount(), przed + 1, 'koszt zaksięgowany do wspólnej puli ai_usage');
});

test('streszMiniProcedure — brak klienta (AI wyłączone) => 503', async () => {
  ustawKlientaAnthropic(null);
  await assert.rejects(
    () => streszMiniProcedure({ tresc: 'cokolwiek' }),
    (err) => err.status === 503 && /AI|Anthropic/i.test(err.message),
  );
});

test('streszMiniProcedure — błąd wywołania modelu => 503 (czytelny komunikat)', async () => {
  ustawKlientaAnthropic({ messages: { create: async () => { throw new Error('network down'); } } });
  await assert.rejects(
    () => streszMiniProcedure({ tresc: 'cokolwiek' }),
    (err) => err.status === 503,
  );
});

// ── Część 4: orkiestrator uzupelnijRegulamin → zapis do zamowienia_podprogowe ─

test('uzupelnijRegulamin — lokalizuje regulamin, streszcza i zapisuje oba pola na rekordzie', async () => {
  ustawKlientaAnthropic(fakeKlient('Oferty mailowo w 7 dni roboczych; bez wadium; jedyne kryterium cena.'));

  const zn = repo.upsert({
    zrodlo: 'bip', id_zewnetrzny: '1', tytul: 'Dostawa materiałów biurowych',
    zamawiajacy: 'Gmina Testowa', link: 'https://bip.gmina.pl/ogloszenie/1',
    hash_dedup: 'reg-e2e-1', flagi: { bez_wadium: true }, latwiejszy_start: true,
  }).rekord;
  assert.equal(zn.regulamin_url, null, 'przed uzupełnieniem brak URL regulaminu');

  const pobierzStrone = fakeStrony({
    'https://bip.gmina.pl/ogloszenie/1':
      '<a href="/kontakt">Kontakt</a><a href="https://bip.gmina.pl/regulamin-zamowien.pdf">Regulamin udzielania zamówień do 170 tys.</a>',
    'https://bip.gmina.pl/regulamin-zamowien.pdf':
      '<html><body>Ofertę składa się e-mailem w terminie 7 dni. Nie wymaga się wadium. Kryterium: cena.</body></html>',
  });

  const wynik = await uzupelnijRegulamin({ znalezisko: zn, repo, pobierzStrone });

  assert.equal(wynik.regulamin_url, 'https://bip.gmina.pl/regulamin-zamowien.pdf', 'zapisany URL regulaminu');
  assert.equal(wynik.regulamin_streszczenie, 'Oferty mailowo w 7 dni roboczych; bez wadium; jedyne kryterium cena.');

  // Faktycznie trafiło do tabeli (nie tylko echo zwrotu).
  const wTabeli = repo.byHash('reg-e2e-1');
  assert.equal(wTabeli.regulamin_url, wynik.regulamin_url);
  assert.equal(wTabeli.regulamin_streszczenie, wynik.regulamin_streszczenie);
});

test('uzupelnijRegulamin — AI niedostępne => zapis samego regulamin_url (streszczenie null, gracja)', async () => {
  ustawKlientaAnthropic(null); // symulacja braku AI — streszczenie best-effort

  const zn = repo.upsert({
    zrodlo: 'bip', tytul: 'Usługa sprzątania', zamawiajacy: 'Szpital Miejski',
    regulamin_url: 'https://bip.szpital.pl/regulamin-zakupowy.pdf', // URL już znany z adaptera
    hash_dedup: 'reg-e2e-2', flagi: {},
  }).rekord;

  const pobierzStrone = fakeStrony({
    'https://bip.szpital.pl/regulamin-zakupowy.pdf': '<p>Zamówienia do 170 tys. — oferta pisemna, bez odwołań do KIO.</p>',
  });

  const wynik = await uzupelnijRegulamin({ znalezisko: zn, repo, pobierzStrone });

  assert.equal(wynik.regulamin_url, 'https://bip.szpital.pl/regulamin-zakupowy.pdf', 'URL zapisany mimo braku AI');
  assert.equal(wynik.regulamin_streszczenie, null, 'brak streszczenia, bo AI niedostępne');
  assert.equal(repo.byHash('reg-e2e-2').regulamin_streszczenie, null, 'w tabeli też null');
});

test('uzupelnijRegulamin — brak regulaminu na stronie => rekord bez zmian, nic nie wołamy', async () => {
  let wywolanoAi = false;
  ustawKlientaAnthropic({ messages: { create: async () => { wywolanoAi = true; return { content: [], usage: {} }; } } });

  const zn = repo.upsert({
    zrodlo: 'platformazakupowa', tytul: 'Naprawa dachu', zamawiajacy: 'Spółka Komunalna',
    link: 'https://platformazakupowa.pl/transakcja/9', hash_dedup: 'reg-e2e-3', flagi: {},
  }).rekord;

  const pobierzStrone = fakeStrony({
    'https://platformazakupowa.pl/transakcja/9': '<a href="/kontakt">Kontakt</a><a href="/pomoc">Pomoc</a>',
  });

  const wynik = await uzupelnijRegulamin({ znalezisko: zn, repo, pobierzStrone });

  assert.equal(wynik.regulamin_url, null, 'nie znaleziono regulaminu => URL nadal null');
  assert.equal(wywolanoAi, false, 'bez regulaminu nie wołamy płatnego AI');
  assert.equal(repo.byHash('reg-e2e-3').regulamin_url, null, 'w tabeli bez zmian');
});

// ── Część 5 (ostatnia — poisonuje budżet): bramka budżetu ────────────────────

test('streszMiniProcedure — po przekroczeniu twardego budżetu AI => 503 BEZ wywołania modelu', async () => {
  aiUsage.record({ operation: 'test', model: 'claude-haiku-4-5', inputTokens: 0, outputTokens: 0, costUsd: 500 });

  let wywolano = false;
  ustawKlientaAnthropic({ messages: { create: async () => { wywolano = true; return { content: [], usage: {} }; } } });

  await assert.rejects(
    () => streszMiniProcedure({ tresc: 'Regulamin...' }),
    (err) => err.status === 503 && /budżet|limit/i.test(err.message),
  );
  assert.equal(wywolano, false, 'bramka budżetu odcina PRZED płatnym wywołaniem');
});

test('uzupelnijRegulamin — budżet wyczerpany => zapis samego regulamin_url (gracja, bez wywołania modelu)', async () => {
  let wywolano = false;
  ustawKlientaAnthropic({ messages: { create: async () => { wywolano = true; return { content: [], usage: {} }; } } });

  const zn = repo.upsert({
    zrodlo: 'bip', tytul: 'Remont chodnika', zamawiajacy: 'Gmina Y',
    regulamin_url: 'https://bip.gminay.pl/regulamin-zamowien.pdf',
    hash_dedup: 'reg-e2e-4', flagi: {},
  }).rekord;
  const pobierzStrone = fakeStrony({
    'https://bip.gminay.pl/regulamin-zamowien.pdf': '<p>Oferta pisemna, termin 5 dni, bez wadium.</p>',
  });

  const wynik = await uzupelnijRegulamin({ znalezisko: zn, repo, pobierzStrone });

  assert.equal(wynik.regulamin_url, 'https://bip.gminay.pl/regulamin-zamowien.pdf', 'URL zapisany mimo wyczerpanego budżetu');
  assert.equal(wynik.regulamin_streszczenie, null, 'budżet wyczerpany => brak streszczenia (gracja)');
  assert.equal(wywolano, false, 'bramka budżetu odcięła płatne wywołanie');
});
