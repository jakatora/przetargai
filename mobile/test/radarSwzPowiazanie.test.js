import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wstepneDaneRadaru, opisPowiazania, potwierdzonePowiazanie, odczytanePowiazanie,
  powiazIPotwierdz, sprawdzPowiazanie, opisTresciSwz, parametryRadaruZChecklisty,
  podpowiedzPustegoDopasowania, STAN_POWIAZANIA,
} from '../src/lib/radarSwz.js';
import { wymaganiaZDopasowania, opisGotowosci } from '../src/lib/wygrywalnosc.js';

/*
 * PRZETARG → PIERWSZA ANALIZA SWZ → CHECKLISTA (2026-10-03), część aplikacji.
 *
 * Analiza utworzona w Radarze z konkretnego przetargu jest od razu wiązana z tym
 * przetargiem (istniejące API checklisty). Trzy rzeczy nie mogą się zdarzyć:
 *   • fałszywy sukces — „powiązano" bez potwierdzenia serwera,
 *   • fałszywa porażka — „nie powiązano" po błędzie, którego skutku nie znamy
 *     (odpowiedź mogła zaginąć PO zapisie),
 *   • fałszywa pewność — pusta albo heurystyczna lista wymagań pokazana jak komplet.
 */

const KATALOG = path.dirname(fileURLToPath(import.meta.url));
const zrodlo = (wzgledna) => fs.readFileSync(path.resolve(KATALOG, wzgledna), 'utf8');

// ── Identyfikator przetargu w parametrach Radaru ─────────────────────────────

test('wstępne dane: identyfikator przetargu przechodzi tylko, gdy jest prawdziwy', () => {
  assert.equal(wstepneDaneRadaru({ tenderId: 'bzp:1' }).tenderId, 'bzp:1');
  assert.equal(wstepneDaneRadaru({ tenderId: 42 }).tenderId, 42);
  for (const zly of ['', '   ', null, undefined, Number.NaN, {}, [], true]) {
    assert.equal(wstepneDaneRadaru({ tenderId: zly, nazwa: 'X' }).tenderId, null, JSON.stringify(zly));
  }
  // Sam identyfikator (checklista bez tytułu) to nadal wejście z przetargu.
  assert.equal(wstepneDaneRadaru({ tenderId: 'bzp:1' }).zPrzetargu, true);
});

test('Radar z checklisty: identyfikator, tytuł i termin z kalendarza (tylko znany, z ogłoszenia)', () => {
  const kalendarz = { pozycje: [
    { kod: 'pytania', znany: true, at: '2026-11-16T09:00:00.000Z' },
    { kod: 'oferty', znany: true, at: '2026-11-20T09:00:00.000Z' },
    { kod: 'zwiazanie', znany: true, at: '2026-12-19T09:00:00.000Z' },
  ] };
  const params = parametryRadaruZChecklisty({ tenderId: 'bzp:1', tytul: 'Remont drogi', kalendarz });
  assert.deepEqual(params, { tenderId: 'bzp:1', nazwa: 'Remont drogi', termin: '2026-11-20T09:00:00.000Z' });
  // Ogniwo dalej: formularz Radaru dostaje dzień składania, a nie termin pytań.
  assert.deepEqual(wstepneDaneRadaru(params), {
    nazwa: 'Remont drogi', dataOgloszenia: '', termin: '2026-11-20', tenderId: 'bzp:1', zPrzetargu: true,
  });

  // Termin nieznany albo brak kalendarza → bez pola `termin` (formularz zostaje pusty).
  const nieznany = { pozycje: [{ kod: 'oferty', znany: false, at: null }] };
  assert.deepEqual(parametryRadaruZChecklisty({ tenderId: 'bzp:1', tytul: 'Remont drogi', kalendarz: nieznany }), { tenderId: 'bzp:1', nazwa: 'Remont drogi' });
  for (const kal of [undefined, null, {}, { pozycje: 'x' }, { pozycje: [null, { kod: 'oferty', znany: true, at: '' }] }]) {
    assert.deepEqual(parametryRadaruZChecklisty({ tenderId: 'bzp:1', tytul: '  ', kalendarz: kal }), { tenderId: 'bzp:1' });
  }
});

// ── Potwierdzenie zapisu i odczyt stanu ──────────────────────────────────────

test('zapis jest potwierdzony tylko, gdy serwer oddał TĘ analizę', () => {
  assert.equal(potwierdzonePowiazanie({ powiazanie: { postepowanie_id: 'p-1' } }, 'p-1'), true);
  assert.equal(potwierdzonePowiazanie({ powiazanie: { postepowanie_id: 'p-2' } }, 'p-1'), false, 'inna analiza');
  assert.equal(potwierdzonePowiazanie({ powiazanie: null }, 'p-1'), false, 'brak rekordu');
  assert.equal(potwierdzonePowiazanie({}, 'p-1'), false);
  assert.equal(potwierdzonePowiazanie(null, 'p-1'), false);
  assert.equal(potwierdzonePowiazanie(undefined, undefined), false);
  assert.equal(potwierdzonePowiazanie({ powiazanie: { postepowanie_id: '' } }, ''), false);
});

test('odczyt: tylko jawne `powiazanie: null` znaczy „brak"; nieczytelna odpowiedź to „nie wiemy"', () => {
  assert.equal(odczytanePowiazanie({ powiazanie: { postepowanie_id: 'p-1' } }, 'p-1'), 'ta');
  assert.equal(odczytanePowiazanie({ powiazanie: { postepowanie_id: 'p-2' } }, 'p-1'), 'inna');
  assert.equal(odczytanePowiazanie({ powiazanie: null }, 'p-1'), 'brak');
  const nieczytelne = [
    undefined, null, '', 'OK', 0, {}, [], { ok: true }, { powiazanie: {} },
    { powiazanie: { postepowanie_id: '' } }, { powiazanie: { postepowanie_id: 7 } }, { powiazanie: 'p-1' },
  ];
  for (const odpowiedz of nieczytelne) {
    assert.equal(odczytanePowiazanie(odpowiedz, 'p-1'), 'nieznany', JSON.stringify(odpowiedz));
  }
});

/** Atrapa API powiązania: zapis i odczyt o zadanym zachowaniu, z rejestrem wywołań. */
function atrapaApi({ zapis, odczyt }) {
  const wywolania = [];
  const wykonaj = (co) => {
    if (co instanceof Error) throw co;
    return typeof co === 'function' ? co() : co;
  };
  return {
    wywolania,
    powiaz: async (tenderId, postepowanieId) => {
      wywolania.push(['PUT', tenderId, postepowanieId]);
      return wykonaj(zapis);
    },
    odczytaj: async (tenderId) => {
      wywolania.push(['GET', tenderId]);
      return wykonaj(odczyt);
    },
  };
}
const powiazane = (id) => ({ powiazanie: { postepowanie_id: id } });
const proba = (api) => powiazIPotwierdz({
  powiaz: api.powiaz, odczytaj: api.odczytaj, tenderId: 't-1', postepowanieId: 'p-1',
});
const OK = { stan: 'ok', postepowanieId: 'p-1', komunikat: null, odczyt: null };

test('zapis potwierdzony: OK bez dodatkowego odczytu', async () => {
  const api = atrapaApi({ zapis: powiazane('p-1'), odczyt: new Error('odczyt nie powinien być wołany') });
  assert.deepEqual(await proba(api), OK);
  assert.deepEqual(api.wywolania, [['PUT', 't-1', 'p-1']]);
});

test('UTRATA ODPOWIEDZI: zapis rzucił, ale odczyt potwierdza tę analizę → OK, nie błąd', async () => {
  const api = atrapaApi({
    zapis: new Error('Brak połączenia z serwerem. Sprawdź internet.'),
    odczyt: powiazane('p-1'),
  });
  assert.deepEqual(await proba(api), OK);
  assert.deepEqual(api.wywolania, [['PUT', 't-1', 'p-1'], ['GET', 't-1']], 'po błędzie zapisu pytamy o stan faktyczny');
});

test('zapis rzucił i odczyt też: skutek NIEZNANY, z powodem pierwszego błędu', async () => {
  const api = atrapaApi({
    zapis: new Error('Moduł analizy SWZ jest chwilowo niedostępny.'),
    odczyt: new Error('timeout'),
  });
  assert.deepEqual(await proba(api), {
    stan: 'blad', postepowanieId: 'p-1', komunikat: 'Moduł analizy SWZ jest chwilowo niedostępny.', odczyt: 'nieznany',
  });
});

test('zapis rzucił, odczyt mówi „brak powiązania": porażka potwierdzona przez serwer', async () => {
  const api = atrapaApi({ zapis: new Error('502'), odczyt: { powiazanie: null } });
  assert.deepEqual(await proba(api), { stan: 'blad', postepowanieId: 'p-1', komunikat: '502', odczyt: 'brak' });
});

test('MYLĄCY WYNIK: zapis bez wyjątku, ale odpowiedź nie oddaje tej analizy → rozstrzyga odczyt', async () => {
  // 200 bez rekordu — a na serwerze powiązanie jednak jest.
  const pustaOdpowiedz = atrapaApi({ zapis: {}, odczyt: powiazane('p-1') });
  assert.deepEqual(await proba(pustaOdpowiedz), OK);
  assert.equal(pustaOdpowiedz.wywolania.length, 2);

  // 200 z INNĄ analizą, co odczyt potwierdza → nie ogłaszamy sukcesu.
  const inna = atrapaApi({ zapis: powiazane('p-9'), odczyt: powiazane('p-9') });
  assert.deepEqual(await proba(inna), {
    stan: 'blad', postepowanieId: 'p-1', komunikat: 'serwer nie potwierdził zapisu', odczyt: 'inna',
  });

  // 200 z nieczytelnym ciałem i nieczytelny odczyt → nie wiemy.
  const smieci = atrapaApi({ zapis: 'OK', odczyt: { ok: true } });
  assert.deepEqual(await proba(smieci), {
    stan: 'blad', postepowanieId: 'p-1', komunikat: 'serwer nie potwierdził zapisu', odczyt: 'nieznany',
  });
});

test('błąd bez komunikatu nie daje pustego powodu', async () => {
  const api = atrapaApi({ zapis: () => { throw {}; }, odczyt: new Error('x') });
  assert.equal((await proba(api)).komunikat, 'żądanie nie powiodło się');
});

test('„Sprawdź powiązanie": sam odczyt, bez ponownego zapisu; powód poprzedniej próby zostaje', async () => {
  const sprawdz = (api, komunikat) => sprawdzPowiazanie({
    odczytaj: api.odczytaj, tenderId: 't-1', postepowanieId: 'p-1', komunikat,
  });

  const potwierdza = atrapaApi({ odczyt: powiazane('p-1') });
  assert.deepEqual(await sprawdz(potwierdza, 'Brak połączenia'), OK);
  assert.deepEqual(potwierdza.wywolania, [['GET', 't-1']]);

  const dalejNieWiemy = atrapaApi({ odczyt: new Error('timeout odczytu') });
  assert.deepEqual(await sprawdz(dalejNieWiemy, 'Brak połączenia'), {
    stan: 'blad', postepowanieId: 'p-1', komunikat: 'Brak połączenia', odczyt: 'nieznany',
  });
  assert.equal((await sprawdz(atrapaApi({ odczyt: new Error('timeout odczytu') }))).komunikat, 'timeout odczytu');
  assert.equal((await sprawdz(atrapaApi({ odczyt: { powiazanie: null } }))).odczyt, 'brak');
});

// ── Karta powiązania ─────────────────────────────────────────────────────────

const karta = (powiazanie, postepowanieId = 'p-1') => opisPowiazania({ tenderId: 't-1', postepowanieId, powiazanie });

test('Radar bez przetargu (katalog narzędzi): karty powiązania nie ma', () => {
  assert.equal(opisPowiazania({ tenderId: null, postepowanieId: 'p-1', powiazanie: null }), null);
  assert.equal(opisPowiazania({ tenderId: 't-1', postepowanieId: null, powiazanie: null }), null);
  assert.equal(opisPowiazania(), null);
});

test('sukces: tylko dla potwierdzonej analizy — z wejściem do checklisty', () => {
  const k = karta({ stan: STAN_POWIAZANIA.OK, postepowanieId: 'p-1' });
  assert.equal(k.ton, 'sukces');
  assert.deepEqual(k.akcje, ['checklista']);
  assert.match(k.tekst, /jest powiązana/);
});

test('sukces innej analizy NIE przenosi się na oglądaną', () => {
  const k = karta({ stan: STAN_POWIAZANIA.OK, postepowanieId: 'p-1' }, 'p-2');
  assert.notEqual(k.ton, 'sukces');
  assert.deepEqual(k.akcje, ['powiaz']);
  assert.doesNotMatch(k.tekst, /jest powiązana/);
});

test('błąd o NIEZNANYM skutku: brak potwierdzenia, a nie twierdzenie, że checklista analizy nie widzi', () => {
  const k = karta({
    stan: STAN_POWIAZANIA.BLAD, postepowanieId: 'p-1', odczyt: 'nieznany',
    komunikat: 'Brak połączenia z serwerem. Sprawdź internet.',
  });
  assert.equal(k.ton, 'danger');
  assert.deepEqual(k.akcje, ['sprawdz', 'ponow'], 'najpierw odczyt stanu, potem ponowienie');
  assert.match(k.tekst, /Nie mamy potwierdzenia/);
  assert.match(k.tekst, /mogło się zapisać mimo błędu/);
  assert.match(k.tekst, /Brak połączenia z serwerem/);
  assert.match(k.tekst, /Analiza jest zapisana w Radarze/);
  // Zdania z poprzedniej wersji były nieprawdziwe, gdy odpowiedź zaginęła PO zapisie.
  assert.doesNotMatch(k.tekst, /jeszcze jej nie widzi/);
  assert.doesNotMatch(k.tekst, /Nie udało się powiązać/);
  assert.doesNotMatch(k.tekst, /nie jest powiązana/);

  // Stan bez pola `odczyt` traktujemy tak samo ostrożnie.
  const bezOdczytu = karta({ stan: STAN_POWIAZANIA.BLAD, postepowanieId: 'p-1', komunikat: '  ' });
  assert.deepEqual(bezOdczytu.akcje, ['sprawdz', 'ponow']);
  assert.match(bezOdczytu.tekst, /Nie mamy potwierdzenia/);
  assert.doesNotMatch(bezOdczytu.tekst, /\(\s*\)/);
});

test('błąd POTWIERDZONY odczytem: wolno powiedzieć, że powiązania nie ma', () => {
  const k = karta({ stan: STAN_POWIAZANIA.BLAD, postepowanieId: 'p-1', odczyt: 'brak', komunikat: '502' });
  assert.equal(k.ton, 'danger');
  assert.deepEqual(k.akcje, ['ponow', 'sprawdz']);
  assert.match(k.tekst, /serwer potwierdza, że ten przetarg nie ma jeszcze powiązanej analizy/);
  assert.doesNotMatch(k.tekst, /mogło się zapisać/);
});

test('powiązana INNA analiza: ostrzeżenie i możliwość przepięcia, nie sukces', () => {
  const k = karta({ stan: STAN_POWIAZANIA.BLAD, postepowanieId: 'p-1', odczyt: 'inna', komunikat: null });
  assert.equal(k.ton, 'ostrzezenie');
  assert.deepEqual(k.akcje, ['ponow', 'sprawdz']);
  assert.match(k.tekst, /powiązana inna analiza/);
});

test('w toku: bez akcji i bez obietnicy wyniku', () => {
  const k = karta({ stan: STAN_POWIAZANIA.TRWA, postepowanieId: 'p-1' });
  assert.equal(k.wToku, true);
  assert.deepEqual(k.akcje, []);
  assert.notEqual(k.ton, 'sukces');
});

test('stan nieznany: propozycja powiązania bez twierdzenia o stanie na serwerze', () => {
  for (const powiazanie of [null, undefined, { stan: STAN_POWIAZANIA.BRAK, postepowanieId: null }]) {
    const k = karta(powiazanie);
    assert.deepEqual(k.akcje, ['powiaz']);
    assert.doesNotMatch(k.tekst, /nie jest (jeszcze )?powiązana/);
  }
});

test('ogniwa razem: wynik próby powiązania trafia na kartę bez przeróbek', async () => {
  const utrata = atrapaApi({ zapis: new Error('Brak połączenia'), odczyt: powiazane('p-1') });
  assert.equal(karta(await proba(utrata)).ton, 'sukces');

  const nieznany = atrapaApi({ zapis: new Error('Brak połączenia'), odczyt: new Error('Brak połączenia') });
  const k = karta(await proba(nieznany));
  assert.deepEqual(k.akcje, ['sprawdz', 'ponow']);
  assert.match(k.tekst, /Nie mamy potwierdzenia/);
});

// ── Stan treści SWZ ──────────────────────────────────────────────────────────

test('treść SWZ: opis tylko z potwierdzenia serwera; starszy backend → nic nie twierdzimy', () => {
  assert.equal(opisTresciSwz(undefined), null);
  assert.equal(opisTresciSwz(null), null);
  assert.equal(opisTresciSwz({ zrodlo: 'cos-nowego' }), null);

  const wklejona = opisTresciSwz({ zrodlo: 'wklejona', zapisana_at: '2026-10-03T10:00:00.000Z' });
  assert.equal(wklejona.ton, 'sukces');
  assert.match(wklejona.tekst, /zapisana/);
  assert.match(wklejona.tekst, /gdy analiza AI się nie uda/);

  assert.match(opisTresciSwz({ zrodlo: 'wersja' }).tekst, /Sprawdź publikacje zamawiającego/);

  const brak = opisTresciSwz({ zrodlo: 'brak' });
  assert.equal(brak.ton, 'neutral');
  assert.match(brak.tekst, /nie ma jeszcze treści SWZ/);
});

// ── Podpowiedzi przy pustym dopasowaniu ──────────────────────────────────────

test('puste dopasowanie: „brak treści" i „nic nie rozpoznano" to dwie różne podpowiedzi', () => {
  const brak = podpowiedzPustegoDopasowania('brak');
  assert.match(brak, /nie ma jeszcze treści SWZ/);
  assert.match(brak, /Wygeneruj pytania/);

  for (const zrodloSwz of ['wklejona', 'wersja', 'zadanie']) {
    const tekst = podpowiedzPustegoDopasowania(zrodloSwz);
    assert.match(tekst, /nie znaczy, że SWZ ich nie wymaga/);
    assert.doesNotMatch(tekst, /Wklej/, 'treść już jest — nie każemy wklejać jej ponownie');
  }
});

test('puste dopasowanie ze starszego backendu: nie odsyłamy do pola, które treści nie zapisuje', () => {
  for (const nieznane of [undefined, null, '', 'cos']) {
    const tekst = podpowiedzPustegoDopasowania(nieznane);
    assert.match(tekst, /Sprawdź publikacje zamawiającego/);
    assert.doesNotMatch(tekst, /Wygeneruj pytania/);
    assert.match(tekst, /nie znaczy, że SWZ niczego nie wymaga/);
  }
});

// ── Checklista: niepełność i brak treści ─────────────────────────────────────

const TYPY = [{ id: 'krk', nazwa: 'Zaświadczenie z KRK' }, { id: 'zus', nazwa: 'Zaświadczenie ZUS' }];

test('wymagania: pusta lista z `zrodlo_swz: brak` to „brak treści", nie „brak wymagań"', () => {
  assert.equal(wymaganiaZDopasowania({ wymagane_typy: [], zrodlo_swz: 'brak' }, TYPY).stan, 'brak_tresci');
  assert.equal(wymaganiaZDopasowania({ wymagane_typy: [], zrodlo_swz: 'wklejona' }, TYPY).stan, 'brak_wymagan');
  assert.equal(wymaganiaZDopasowania({ wymagane_typy: [] }, TYPY).stan, 'brak_wymagan', 'starszy backend bez pola');
  // Lista niepusta: źródło nie zmienia stanu.
  const znane = wymaganiaZDopasowania({ wymagane_typy: ['krk'], zrodlo_swz: 'wklejona', wymagania_heurystyczne: true }, TYPY);
  assert.equal(znane.stan, 'znane');
  assert.deepEqual(znane.wymagania, [{ kod: 'krk', nazwa: 'Zaświadczenie z KRK', obowiazkowe: true }]);
});

test('gotowość: brak treści i heurystyka nigdy nie dają tonu sukcesu', () => {
  const pusta = { stanWiedzy: { znamyWymagania: false, znamySejf: true, znamyTermin: true }, koszyki: {}, gotowe: false };
  const brakTresci = opisGotowosci(pusta, 'pl', { wymagania: 'brak_tresci', sejf: 'ok' });
  assert.equal(brakTresci.ton, 'ostrzezenie');
  assert.match(brakTresci.tekst, /nie ma jeszcze treści SWZ/);
  assert.match(brakTresci.tekst, /Gotowość nieustalona/);
  assert.match(opisGotowosci(pusta, 'en', { wymagania: 'brak_tresci', sejf: 'ok' }).tekst, /Readiness unknown/);

  // Wszystkie WYKRYTE dokumenty są ważne — a i tak nie mówimy „komplet".
  const wszystkoMasz = {
    stanWiedzy: { znamyWymagania: true, znamySejf: true, znamyTermin: true },
    koszyki: { masz: [{ kod: 'krk' }], przeterminuje_sie: [], brakuje: [] },
    gotowe: true,
  };
  const heurystyka = opisGotowosci(wszystkoMasz, 'pl', { wymagania: 'znane', sejf: 'ok', wykryte: 1 });
  assert.notEqual(heurystyka.ton, 'sukces');
  assert.match(heurystyka.tekst, /nie potwierdzenie kompletności/);
});

// ── Ekrany: to, czego nie złapie czysta logika ───────────────────────────────

test('Radar SWZ: po utworzeniu analizy z przetargu wiąże ją i potwierdza wynik z serwera', () => {
  const ekran = zrodlo('../src/screens/RadarSwzScreen.js');
  // Automatycznie po utworzeniu — w tej samej funkcji, po otwarciu nowej analizy.
  const utworz = ekran.slice(ekran.indexOf('async function utworz()'), ekran.indexOf('async function analizuj()'));
  assert.match(utworz, /otworz\(postepowanie\.id\);[\s\S]*await powiazZPrzetargiem\(postepowanie\.id\);/);

  // Wynik zapisu rozstrzyga `powiazIPotwierdz` (potwierdzenie + odczyt po błędzie) —
  // ekran sam niczego o powodzeniu nie orzeka.
  const powiaz = ekran.slice(ekran.indexOf('async function powiazZPrzetargiem'), ekran.indexOf('async function sprawdzStanPowiazania'));
  assert.match(powiaz, /setPowiazanie\(await powiazIPotwierdz\(\{\s*powiaz: api\.powiazSwz, odczytaj: api\.powiazanieSwz, tenderId: wstepne\.tenderId, postepowanieId,\s*\}\)\);/);
  assert.doesNotMatch(powiaz, /STAN_POWIAZANIA\.(OK|BLAD)/, 'ekran nie ustawia wyniku ręcznie');
  // Bez przetargu w kontekście nic nie wiążemy.
  assert.match(powiaz, /if \(wstepne\.tenderId === null \|\| !postepowanieId\) return;/);

  // Odczyt stanu i ponowienie są na ekranie; sprawdzenie nie zapisuje ponownie.
  assert.match(ekran, /title="Sprawdź powiązanie"[^\n]*onPress=\{\(\) => sprawdzStanPowiazania\(wybraneId\)\}/);
  assert.match(ekran, /title="Ponów powiązanie"[^\n]*onPress=\{\(\) => powiazZPrzetargiem\(wybraneId\)\}/);
  const sprawdz = ekran.slice(ekran.indexOf('async function sprawdzStanPowiazania'), ekran.indexOf('function otworzCheckliste'));
  assert.match(sprawdz, /sprawdzPowiazanie\(\{/);
  assert.doesNotMatch(sprawdz, /api\.powiazSwz/);
});

test('Radar SWZ: stara podpowiedź odsyłająca do pola bez zapisu zniknęła', () => {
  const ekran = zrodlo('../src/screens/RadarSwzScreen.js');
  assert.doesNotMatch(ekran, /„Wygeneruj pytania" albo „Sprawdź publikacje" powyżej i spróbuj ponownie/);
  assert.match(ekran, /podpowiedzPustegoDopasowania\(dopasowanie\.zrodlo_swz\)/);
  assert.match(ekran, /lista może być niepełna/, 'koszyki sejfu w Radarze też mówią o heurystyce');
  // Po nieudanej analizie panel jest odczytywany ponownie — stan treści pochodzi z serwera.
  const analizuj = ekran.slice(ekran.indexOf('async function analizuj()'), ekran.indexOf('async function odswiez()'));
  assert.match(analizuj, /catch \(err\) \{[\s\S]*odswiezDetalCicho\(wybraneId\)/);
});

test('checklista: Radar otwierany z kontekstem przetargu, niepełność wymagań na ekranie', () => {
  const ekran = zrodlo('../src/screens/ChecklistaOfertyScreen.js');
  assert.doesNotMatch(ekran, /navigate\('RadarSwz'\)/, 'Radar bez kontekstu nie powiąże analizy');
  assert.match(ekran, /navigation\.navigate\('RadarSwz', parametryRadaruZChecklisty\(\{ tenderId, tytul, kalendarz: dane\?\.kalendarz \}\)\)/);
  assert.match(ekran, /lista może być niepełna/);
  assert.match(ekran, /zrodla\.wymagania === 'brak_tresci'/);
  assert.match(ekran, /useFocusEffect\(useCallback\(\(\) => \{ wczytaj\(\); \}, \[wczytaj\]\)\)/, 'powrót z Radaru odświeża checklistę');
});
