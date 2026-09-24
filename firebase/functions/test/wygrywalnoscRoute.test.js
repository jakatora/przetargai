import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/*
 * GET /wygrywalnosc/* — karta „Czy warto startować?" przez realny serwer HTTP.
 *
 * Dwie własności, których nie wolno tu złamać:
 *  1. karta NIGDY nie oddaje prawdopodobieństwa wygranej — tylko czynniki
 *     i kategorię, z jawną wielkością próbki;
 *  2. odczyt jest DARMOWY: żadnego wywołania płatnego AI, bo ta karta ma się
 *     otwierać przy każdym ogłoszeniu, tak jak katalog.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, benchmarkRynku, rozstrzygniecia } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

const ZNAK = `wyg${process.pid}x${Date.now()}`;
let seq = 0;

async function konto() {
  seq++;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `wyg-${process.pid}-${seq}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
    }),
  });
  return (await odp.json()).token;
}
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

async function dodajPrzetarg(nad = {}) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `${ZNAK}-${seq}`,
    title: 'Remont drogi gminnej',
    organization: 'GMINA TESTOWA',
    cpvMain: '45233140-2',
    wojewodztwo: 'PL14',
    rodzaj: 'Works',
    deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    zamawiajacy_nip: `${ZNAK}-nip`,
    ...nad,
  });
  return tender;
}

describe('GET /wygrywalnosc/tender/:id — karta decyzji', () => {
  test('bez tokenu odmawia — to nie jest otwarte proxy na dane', async () => {
    const t = await dodajPrzetarg();
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`);
    assert.equal(odp.status, 401);
  });

  test('bez benchmarku oddaje „za mało danych", a nie pustkę ani błąd', async () => {
    const token = await konto();
    /*
     * Dział CPV i region MUSZĄ być inne niż w pozostałych plikach testowych:
     * emulator ma JEDNĄ bazę na cały przebieg, więc kubełek `cpv:45|14` zapisany
     * przez test benchmarku sprawiłby, że ten przetarg jednak dostaje wniosek —
     * i test „bez benchmarku" mierzyłby cudzy stan zamiast swojego.
     */
    const t = await dodajPrzetarg({
      zamawiajacy_nip: `${ZNAK}-pusty`,
      cpvMain: '98514000-9',
      wojewodztwo: 'PL08',
    });
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`, { headers: auth(token) });
    assert.equal(odp.status, 200);
    const dane = await odp.json();
    assert.equal(dane.stan, 'otwarte');
    assert.equal(dane.karta.werdykt, 'brak_danych');
    assert.equal(dane.karta.zrodloBenchmarku, null);
    assert.ok(dane.karta.czynniki.length >= 5, 'czynniki z ogłoszenia mają działać bez benchmarku');
  });

  test('z benchmarkiem zamawiającego oddaje czynniki z liczbami i próbką', async () => {
    const token = await konto();
    const nip = `${ZNAK}-pelny`;
    await benchmarkRynku.zapisz({
      [`nip:${nip}`]: {
        klucz: `nip:${nip}`, wymiar: 'zamawiajacy', etykieta: 'GMINA TESTOWA', zrodla: ['bzp'],
        probka: { ogloszenia: 12, czesci: 30, od: '2026-01-01', do: '2026-09-01' },
        wystarczajacaProbka: true, powodBrakuWniosku: null,
        oferty: { mediana: 2, min: 1, max: 5, n: 30 },
        cena: { mediana: 120000, min: 50000, max: 300000, n: 25 },
        pozycjaCeny: { mediana: 0.4, min: 0, max: 1, n: 20 },
        uniewaznienia: { czesci: 1, procent: 3 },
        maliWygrywaja: { procent: 70, n: 25 },
      },
    });
    const t = await dodajPrzetarg({ zamawiajacy_nip: nip });

    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`, { headers: auth(token) });
    const { karta } = await odp.json();

    assert.equal(karta.zrodloBenchmarku, 'zamawiajacy');
    assert.equal(karta.probka.czesci, 30);
    const konkurencja = karta.czynniki.find((c) => c.kod === 'konkurencja');
    assert.equal(konkurencja.wartosc, 2);
    assert.equal(konkurencja.probka, 30);
    assert.equal(karta.werdykt, 'sprawdz');
  });

  test('odpowiedź NIE zawiera prawdopodobieństwa wygranej', async () => {
    const token = await konto();
    const t = await dodajPrzetarg();
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`, { headers: auth(token) });
    const tekst = await odp.text();
    assert.ok(!/prawdopodobie|szansa na wygran/i.test(tekst),
      'endpoint obiecuje prawdopodobieństwo wygranej');
    assert.match(tekst, /nie prognoza/);
  });

  test('postępowanie ROZSTRZYGNIĘTE nie dostaje karty — nie ma czego rozważać', async () => {
    const token = await konto();
    const postepowanie = `ocds-${ZNAK}-zamkniete`;
    const t = await dodajPrzetarg({ postepowanie_id: postepowanie });
    await rozstrzygniecia.zapiszWiele([{
      externalId: `${ZNAK}-wynik`,
      tenderId: postepowanie,
      zrodlo: 'bzp',
      opublikowano: '2026-09-10',
      czesci: [{ numer: 1, rozstrzygniecie: 'umowa', uniewaznione: false, cenaWybrana: 99000 }],
    }]);

    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}`, { headers: auth(token) });
    const dane = await odp.json();
    assert.equal(dane.stan, 'rozstrzygniete');
    assert.equal(dane.karta, null);
    assert.equal(dane.rozstrzygniecie.czesci[0].cenaWybrana, 99000);
  });

  test('nieistniejący przetarg to 404, nie pusta karta', async () => {
    const token = await konto();
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/nie-ma-takiego`, { headers: auth(token) });
    assert.equal(odp.status, 404);
  });
});

describe('GET /wygrywalnosc/tender/:id/benchmark — materiał, z którego powstał wniosek', () => {
  test('oddaje trzy kubełki i klucze, po których ich szukano', async () => {
    const token = await konto();
    const t = await dodajPrzetarg({ zamawiajacy_nip: `${ZNAK}-mat` });
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/benchmark`, { headers: auth(token) });
    const dane = await odp.json();

    assert.equal(dane.klucze.zamawiajacy, `nip:${ZNAK}-mat`);
    assert.equal(dane.klucze.dzialRegion, 'cpv:45|14');
    assert.equal(dane.klucze.dzialKraj, 'cpv:45');
    assert.ok('zamawiajacy' in dane.benchmark);
    assert.ok('dzial_region' in dane.benchmark);
    assert.ok('dzial_kraj' in dane.benchmark);
  });

  test('przetarg bez CPV nie dostaje zmyślonych kluczy', async () => {
    const token = await konto();
    const t = await dodajPrzetarg({ cpvMain: null, wojewodztwo: null, zamawiajacy_nip: null });
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/benchmark`, { headers: auth(token) });
    const dane = await odp.json();
    assert.deepEqual(dane.klucze, { zamawiajacy: null, dzialRegion: null, dzialKraj: null });
  });
});

describe('POST /wygrywalnosc/tender/:id/checklista — co musisz mieć na dzień składania', () => {
  test('liczy ważność wobec DNIA SKŁADANIA, nie wobec dzisiaj', async () => {
    const token = await konto();
    const t = await dodajPrzetarg({
      deadline: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    });

    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/checklista`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        wymagania: [{ kod: 'krk', nazwa: 'KRK', obowiazkowe: true }],
        // ważny jeszcze 10 dni — dziś OK, w dniu składania (za 60 dni) już nie
        dokumenty: [{ kod: 'krk', nazwa: 'KRK', wazny_do: new Date(Date.now() + 10 * 86_400_000).toISOString() }],
      }),
    });
    const { checklista, kalendarz } = await odp.json();

    assert.equal(checklista.koszyki.przeterminuje_sie.length, 1);
    assert.equal(checklista.gotowe, false);
    assert.equal(checklista.nastepnyKrok.kod, 'krk');
    assert.ok(kalendarz.pozycje.length === 3, 'obok checklisty idzie kalendarz trzech terminów');
  });

  test('brak wymagań to jawny stan wiedzy, a nie „zero braków"', async () => {
    const token = await konto();
    const t = await dodajPrzetarg();
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/checklista`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({}),
    });
    const { checklista } = await odp.json();
    assert.equal(checklista.gotowe, false);
    assert.equal(checklista.stanWiedzy.znamyWymagania, false);
    assert.equal(checklista.stanWiedzy.znamySejf, false);
  });

  test('odrzuca wejście o złym kształcie zamiast liczyć z byle czego', async () => {
    const token = await konto();
    const t = await dodajPrzetarg();
    const odp = await fetch(`${BAZA}/wygrywalnosc/tender/${t.id}/checklista`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ wymagania: 'nie-tablica' }),
    });
    assert.equal(odp.status, 400);
  });
});
