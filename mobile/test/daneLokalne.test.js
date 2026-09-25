import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KLUCZ_INDEKSU_KONTA, KLUCZ_WLASCICIELA, KLUCZE_KONTA, PREFIKSY_KONTA, KLUCZE_URZADZENIA,
  czyKluczKonta, zarejestrujKlucz, wczytajIndeks, wyczyscDaneKonta, zwiazDaneZKontem,
  przeprowadzWylogowanie,
} from '../src/lib/daneLokalne.js';
import { zapiszKontroleOferty, kluczKontroli } from '../src/lib/kontrolaOferty.js';
import { zapiszSciezke, kluczSciezki } from '../src/lib/sciezkaDoOferty.js';
import { zapiszKontrole, wczytajKontrole } from '../src/lib/poprzetargowaKontrola.js';

/*
 * Dane lokalne konta vs preferencje urządzenia (audyt 2026-09-25).
 *
 * Wspólny telefon w firmie to norma: po wylogowaniu A i zalogowaniu B na urządzeniu
 * zostawał rejestr kontraktów A (bank referencji), checklisty ofert, ścieżki
 * odwołań. SecureStore nie umie wylistować kluczy, więc klucze per przetarg trafiają
 * do indeksu przy zapisie, a wylogowanie kasuje indeks + klucze stałe.
 *
 * Atrapa magazynu oddaje sterowanie między odczytem a zapisem (setImmediate) —
 * inaczej wyścig dwóch rejestracji byłby w teście niewidoczny.
 */

const tick = () => new Promise((r) => setImmediate(r));

function atrapa(poczatek = {}) {
  const m = new Map(Object.entries(poczatek));
  const log = [];
  return {
    m,
    log,
    async getItem(k) { log.push(`get:${k}`); await tick(); return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { log.push(`set:${k}`); await tick(); m.set(k, v); },
    async deleteItem(k) { log.push(`del:${k}`); await tick(); m.delete(k); },
  };
}

const KLUCZ_SECURESTORE = /^[\w.-]+$/;

// ---------- klasyfikacja ----------

test('listy kluczy są rozłączne i każdy klucz jest poprawnym kluczem SecureStore', () => {
  const konta = new Set(KLUCZE_KONTA);
  for (const k of KLUCZE_URZADZENIA) assert.ok(!konta.has(k), `„${k}" jest naraz kontem i urządzeniem`);
  for (const k of [...KLUCZE_KONTA, ...KLUCZE_URZADZENIA, ...PREFIKSY_KONTA]) {
    assert.match(k, KLUCZ_SECURESTORE, `„${k}" odrzuci SecureStore`);
  }
  assert.ok(konta.has(KLUCZ_INDEKSU_KONTA), 'indeks sam jest daną konta');
  assert.ok(konta.has(KLUCZ_WLASCICIELA), 'znacznik właściciela sam jest daną konta');
  for (const p of PREFIKSY_KONTA) {
    for (const k of KLUCZE_URZADZENIA) assert.ok(!k.startsWith(p), `prefiks „${p}" połyka preferencję „${k}"`);
  }
});

test('czyKluczKonta: stałe i per przetarg → tak; preferencje i obce → nie', () => {
  assert.equal(czyKluczKonta('przetargai.bankReferencji'), true);
  assert.equal(czyKluczKonta('przetargai_token'), true);
  assert.equal(czyKluczKonta(kluczKontroli('ted:1-2026')), true);
  assert.equal(czyKluczKonta(kluczSciezki('BZP-7')), true);
  assert.equal(czyKluczKonta('przetargai.motyw'), false);
  assert.equal(czyKluczKonta('przetargai.jezyk'), false);
  assert.equal(czyKluczKonta('cos.innego'), false);
  assert.equal(czyKluczKonta(''), false);
  assert.equal(czyKluczKonta(null), false);
});

// ---------- rejestr kluczy per przetarg ----------

test('zarejestrujKlucz dopisuje klucz do indeksu raz (idempotentnie)', async () => {
  const s = atrapa();
  const k = kluczKontroli('A-1');
  await zarejestrujKlucz(s, k);
  await zarejestrujKlucz(s, k);
  assert.deepEqual(await wczytajIndeks(s), [k]);
});

test('równoległe rejestracje różnych kluczy nie gubią się nawzajem', async () => {
  const s = atrapa();
  const klucze = ['1', '2', '3', '4', '5'].map((id) => kluczSciezki(id));
  await Promise.all(klucze.map((k) => zarejestrujKlucz(s, k)));
  assert.deepEqual([...(await wczytajIndeks(s))].sort(), [...klucze].sort());
});

test('uszkodzony indeks nie blokuje rejestracji — zaczynamy od nowa', async () => {
  const s = atrapa({ [KLUCZ_INDEKSU_KONTA]: '{to nie json' });
  const k = kluczKontroli('X');
  await zarejestrujKlucz(s, k);
  assert.deepEqual(await wczytajIndeks(s), [k]);

  const s2 = atrapa({ [KLUCZ_INDEKSU_KONTA]: JSON.stringify({ nie: 'tablica' }) });
  assert.deepEqual(await wczytajIndeks(s2), []);
});

test('zarejestrujKlucz odrzuca preferencję urządzenia, klucz spoza klasyfikacji i klucz, którego nie przyjmie SecureStore', async () => {
  const s = atrapa();
  await assert.rejects(() => zarejestrujKlucz(s, 'przetargai.motyw'), /urządzenia|konta/);
  await assert.rejects(() => zarejestrujKlucz(s, 'przetargai.cos-nowego'), /klasyfik/);
  await assert.rejects(() => zarejestrujKlucz(s, 'kontrola:ABC'), /SecureStore|klasyfik/);
  await assert.rejects(() => zarejestrujKlucz(s, ''), /SecureStore|klasyfik/);
  assert.equal(s.m.has(KLUCZ_INDEKSU_KONTA), false);
});

test('zapisy per przetarg z libów trafiają do indeksu PRZED danymi', async () => {
  const s = atrapa();
  await zapiszKontroleOferty(s, 'ted:1-2026', new Set(['podpis']));
  await zapiszSciezke(s, 'BZP/9', new Set(['swz']));
  await zapiszKontrole(s, { postepowanieId: 'BZP-2026/1' });

  const indeks = await wczytajIndeks(s);
  assert.ok(indeks.includes(kluczKontroli('ted:1-2026')));
  assert.ok(indeks.includes(kluczSciezki('BZP/9')));
  const kluczPoprzetargowej = indeks.find((k) => k.startsWith('przetargai.kontrola-poprzetargowa.'));
  assert.ok(kluczPoprzetargowej, 'kontrola poprzetargowa nie trafiła do indeksu');
  assert.match(kluczPoprzetargowej, KLUCZ_SECURESTORE);

  // Kolejność: wpis w indeksie zanim dane trafią na dysk — przerwany zapis zostawia
  // najwyżej pusty wpis indeksu, nigdy dane, o których wylogowanie nie wie.
  const k = kluczKontroli('ted:1-2026');
  const zapisIndeksu = s.log.indexOf(`set:${KLUCZ_INDEKSU_KONTA}`);
  assert.ok(zapisIndeksu >= 0 && zapisIndeksu < s.log.indexOf(`set:${k}`));

  // Round-trip kontroli poprzetargowej nadal działa pod nowym kluczem.
  const wczytana = await wczytajKontrole(s, 'BZP-2026/1');
  assert.equal(wczytana.postepowanieId, 'BZP-2026/1');
});

// ---------- czyszczenie przy wylogowaniu ----------

test('wyczyscDaneKonta kasuje klucze stałe konta, wszystko z indeksu i sam indeks — preferencje zostają', async () => {
  const s = atrapa({
    przetargai_token: 'jwt',
    przetargai_user: '{"id":"A"}',
    'przetargai.bankReferencji': '[{"nazwa":"Most"}]',
    'przetargai.wezwanie': '{}',
    'przetargai.przewodnik-startu': '[]',
    'przetargai.onboarding_pominiety': '1',
    'przetargai.feed_ostatnia_wizyta': '123',
    [KLUCZ_WLASCICIELA]: 'A',
    'przetargai.motyw': 'ciemny',
    'przetargai.jezyk': 'en',
    'przetargai.katalog_filtry': '{}',
    'obcy.klucz': 'x',
  });
  await zapiszKontroleOferty(s, 'T1', new Set(['a']));
  await zapiszSciezke(s, 'T2', new Set(['b']));
  await zapiszKontrole(s, { postepowanieId: 'T3' });

  const raport = await wyczyscDaneKonta(s);

  assert.deepEqual([...s.m.keys()].sort(), ['obcy.klucz', 'przetargai.jezyk', 'przetargai.katalog_filtry', 'przetargai.motyw']);
  assert.deepEqual(raport.nieudane, []);
  assert.ok(raport.usuniete.includes(kluczKontroli('T1')));
  // Indeks kasowany NA KOŃCU — przerwane czyszczenie da się powtórzyć.
  const dele = s.log.filter((w) => w.startsWith('del:'));
  assert.equal(dele[dele.length - 1], `del:${KLUCZ_INDEKSU_KONTA}`);
  // Token znika jako pierwszy — najważniejszy klucz nie czeka na resztę.
  assert.equal(dele[0], 'del:przetargai_token');
});

test('wyczyscDaneKonta nie skasuje preferencji urządzenia, nawet gdy ktoś wpisał ją do indeksu', async () => {
  const s = atrapa({
    'przetargai.motyw': 'ciemny',
    [KLUCZ_INDEKSU_KONTA]: JSON.stringify(['przetargai.motyw', 'przetargai.sciezka.X']),
    'przetargai.sciezka.X': '[]',
  });
  await wyczyscDaneKonta(s);
  assert.equal(s.m.get('przetargai.motyw'), 'ciemny');
  assert.equal(s.m.has('przetargai.sciezka.X'), false);
});

test('błąd kasowania jednego klucza nie zatrzymuje reszty, a nieusunięty klucz zostaje w indeksie do ponowienia', async () => {
  const s = atrapa();
  await zapiszSciezke(s, 'ZLY', new Set(['a']));
  await zapiszSciezke(s, 'DOBRY', new Set(['a']));
  s.m.set('przetargai.bankReferencji', '[]');
  const zly = kluczSciezki('ZLY');
  const zwykleDelete = s.deleteItem;
  s.deleteItem = async (k) => {
    if (k === zly) throw new Error('keystore zablokowany');
    return zwykleDelete(k);
  };

  const raport = await wyczyscDaneKonta(s);
  assert.deepEqual(raport.nieudane, [zly]);
  assert.equal(s.m.has(kluczSciezki('DOBRY')), false);
  assert.equal(s.m.has('przetargai.bankReferencji'), false);
  assert.deepEqual(await wczytajIndeks(s), [zly]);

  // Drugie podejście (np. przy następnym wylogowaniu) domyka sprawę.
  s.deleteItem = zwykleDelete;
  const drugi = await wyczyscDaneKonta(s);
  assert.deepEqual(drugi.nieudane, []);
  assert.equal(s.m.has(zly), false);
  assert.equal(s.m.has(KLUCZ_INDEKSU_KONTA), false);
});

test('wyczyscDaneKonta({ zachowaj }) oszczędza wskazane klucze (sesja przy zmianie właściciela w trakcie startu)', async () => {
  const s = atrapa({ przetargai_token: 'jwt', przetargai_user: '{}', 'przetargai.bankReferencji': '[]' });
  await wyczyscDaneKonta(s, { zachowaj: ['przetargai_token', 'przetargai_user'] });
  assert.deepEqual([...s.m.keys()].sort(), ['przetargai_token', 'przetargai_user']);
});

// ---------- właściciel danych (wygaśnięcie sesji ≠ wylogowanie) ----------

test('zwiazDaneZKontem: to samo konto → dane zostają', async () => {
  const s = atrapa({ [KLUCZ_WLASCICIELA]: 'A', 'przetargai.bankReferencji': '[1]' });
  const w = await zwiazDaneZKontem(s, 'A');
  assert.equal(w.wyczyszczono, false);
  assert.equal(s.m.get('przetargai.bankReferencji'), '[1]');
});

test('zwiazDaneZKontem: inne konto → dane poprzedniego znikają, właścicielem zostaje nowe', async () => {
  const s = atrapa({ [KLUCZ_WLASCICIELA]: 'A', 'przetargai.bankReferencji': '[1]', 'przetargai.motyw': 'ciemny' });
  await zapiszSciezke(s, 'T', new Set(['x']));
  const w = await zwiazDaneZKontem(s, 'B');
  assert.equal(w.wyczyszczono, true);
  assert.equal(s.m.has('przetargai.bankReferencji'), false);
  assert.equal(s.m.has(kluczSciezki('T')), false);
  assert.equal(s.m.get(KLUCZ_WLASCICIELA), 'B');
  assert.equal(s.m.get('przetargai.motyw'), 'ciemny');
});

test('zwiazDaneZKontem: brak znacznika przy logowaniu → dane nieznanego właściciela znikają', async () => {
  const s = atrapa({ 'przetargai.bankReferencji': '[1]' });
  const w = await zwiazDaneZKontem(s, 42);
  assert.equal(w.wyczyszczono, true);
  assert.equal(s.m.has('przetargai.bankReferencji'), false);
  assert.equal(s.m.get(KLUCZ_WLASCICIELA), '42');
});

test('zwiazDaneZKontem: brak znacznika przy odtworzeniu sesji (aktualizacja apki) → dane przejmuje zalogowane konto', async () => {
  const s = atrapa({ przetargai_token: 'jwt', 'przetargai.bankReferencji': '[1]' });
  const w = await zwiazDaneZKontem(s, 'A', { przyjmijNieznane: true, zachowaj: ['przetargai_token'] });
  assert.equal(w.wyczyszczono, false);
  assert.equal(s.m.get('przetargai.bankReferencji'), '[1]');
  assert.equal(s.m.get(KLUCZ_WLASCICIELA), 'A');
});

test('zwiazDaneZKontem: inne konto przy odtworzeniu sesji → czyści, ale oszczędza sesję', async () => {
  const s = atrapa({ [KLUCZ_WLASCICIELA]: 'A', przetargai_token: 'jwt', 'przetargai.wezwanie': '{}' });
  const w = await zwiazDaneZKontem(s, 'B', { przyjmijNieznane: true, zachowaj: ['przetargai_token'] });
  assert.equal(w.wyczyszczono, true);
  assert.equal(s.m.get('przetargai_token'), 'jwt');
  assert.equal(s.m.has('przetargai.wezwanie'), false);
  assert.equal(s.m.get(KLUCZ_WLASCICIELA), 'B');
});

test('zwiazDaneZKontem bez id konta nie zgaduje — czyści i nie zapisuje właściciela', async () => {
  const s = atrapa({ [KLUCZ_WLASCICIELA]: 'A', 'przetargai.wezwanie': '{}' });
  const w = await zwiazDaneZKontem(s, null);
  assert.equal(w.wyczyszczono, true);
  assert.equal(s.m.has(KLUCZ_WLASCICIELA), false);
});

// ---------- przebieg wylogowania ----------

test('wylogowanie: token push wyrejestrowany PRZED skasowaniem tokenu sesji, potem dane konta', async () => {
  const s = atrapa({ przetargai_token: 'jwt', 'przetargai.bankReferencji': '[]', 'przetargai.motyw': 'jasny' });
  const kolejnosc = [];
  const wynik = await przeprowadzWylogowanie({
    storage: s,
    usunPushToken: async () => { kolejnosc.push('push'); assert.equal(s.m.get('przetargai_token'), 'jwt'); },
    anulujPowiadomienia: async () => { kolejnosc.push('lokalne'); },
  });
  assert.deepEqual(kolejnosc, ['push', 'lokalne']);
  assert.equal(wynik.push, 'ok');
  assert.equal(s.m.has('przetargai_token'), false);
  assert.equal(s.m.has('przetargai.bankReferencji'), false);
  assert.equal(s.m.get('przetargai.motyw'), 'jasny');
});

test('wylogowanie: błąd sieci / 404 przy wyrejestrowaniu push nie blokuje wylogowania', async () => {
  const s = atrapa({ przetargai_token: 'jwt' });
  const wynik = await przeprowadzWylogowanie({
    storage: s,
    usunPushToken: async () => { throw Object.assign(new Error('Not found'), { status: 404 }); },
    anulujPowiadomienia: () => { throw new Error('brak modułu'); },
  });
  assert.equal(wynik.push, 'blad');
  assert.equal(s.m.has('przetargai_token'), false);
});

test('wylogowanie: zawieszone łącze przy wyrejestrowaniu push — po limicie czasu i tak wylogowujemy', async () => {
  const s = atrapa({ przetargai_token: 'jwt' });
  const start = Date.now();
  const wynik = await przeprowadzWylogowanie({
    storage: s,
    usunPushToken: () => new Promise(() => {}), // nigdy się nie kończy
    limitMs: 30,
  });
  assert.equal(wynik.push, 'limit');
  assert.ok(Date.now() - start < 2000);
  assert.equal(s.m.has('przetargai_token'), false);
});

test('wylogowanie bez wyrejestrowania push (usunięte konto) — nic nie wołamy, dane i tak znikają', async () => {
  const s = atrapa({ przetargai_token: 'jwt', 'przetargai.wezwanie': '{}' });
  const wynik = await przeprowadzWylogowanie({ storage: s });
  assert.equal(wynik.push, 'pominieto');
  assert.equal(s.m.size, 0);
});
