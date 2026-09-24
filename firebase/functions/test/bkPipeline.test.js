import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * BAZA KONKURENCYJNOŚCI W GŁÓWNYM PIPELINE (etap 3) — test integracyjny.
 *
 * Adapter, checkpoint i deduplikacja mają własne testy jednostkowe. Tutaj sprawdzamy
 * to, czego żaden z nich nie widzi: czy BK jest PEŁNOPRAWNYM źródłem cyklu, czyli
 *  • czy jego ogłoszenia realnie lądują w bazie z poprawnym `source`,
 *  • czy jego awaria degraduje cykl zamiast go wywracać (i odwrotnie: czy nie
 *    znika po cichu, gdy padnie),
 *  • czy ten sam przetarg z BZP i z BK trafia do użytkownika RAZ, z linkiem do
 *    rejestru pierwotnego,
 *  • czy ślad cyklu niesie rekonsyliację: pobrane / zapisane / odrzucone / duplikaty.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');
const { tenders, tenderDocId } = await import('../src/db/repos.js');

let seq = 0;
const ogloszenie = (zrodlo, over = {}) => {
  seq += 1;
  return {
    externalId: `${zrodlo}:pipe-${process.pid}-${seq}`,
    title: `Przebudowa świetlicy wiejskiej ${process.pid}-${seq}`,
    organization: 'Gmina Testowa',
    deadline: '2099-01-01T00:00:00.000Z',
    source: zrodlo,
    url: `https://${zrodlo}.test/${seq}`,
    ...over,
  };
};

const zrodlo = (nazwa, ogloszenia) => ({ nazwa, pobierz: async () => ogloszenia });

test('ogłoszenie z BK ląduje w bazie z własnym źródłem (a nie jako „bzp")', async () => {
  const bk = ogloszenie('baza_konkurencyjnosci', { budget: 84_000, cpvMain: '45000000-7' });

  const wynik = await runTenderFetch({ zrodla: [zrodlo('baza_konkurencyjnosci', [bk])] });

  assert.equal(wynik.ok, true);
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.fetched, 1);
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.newTenders, 1);

  const zapisany = await tenders.findById(tenderDocId(bk.externalId));
  assert.equal(zapisany.source, 'baza_konkurencyjnosci');
  assert.equal(zapisany.budget, 84_000);
  assert.equal(zapisany.url, bk.url, 'link musi prowadzić do ogłoszenia w BK');
});

test('awaria BK degraduje cykl, ale NIE zatrzymuje BZP', async () => {
  const wynik = await runTenderFetch({
    zrodla: [
      zrodlo('bzp', [ogloszenie('bzp')]),
      { nazwa: 'baza_konkurencyjnosci', pobierz: async () => { throw new Error('BK niedostępne'); } },
    ],
  });

  assert.equal(wynik.ok, true, 'jedno żywe źródło wystarczy, żeby cykl miał sens');
  assert.equal(wynik.zrodla.bzp.newTenders, 1);
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.error, 'BK niedostępne');
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.fetched, 0,
    'padnięte źródło musi mieć JAWNE zero, a nie brak wpisu — inaczej /health go nie zobaczy');
});

test('KRYTYCZNE: ten sam przetarg z BZP i z BK zapisuje się RAZ, z linkiem do BK obok', async () => {
  const wspolny = {
    title: `Budowa placu zabaw ${process.pid}-dup`,
    organization: 'Gmina Testowa',
    deadline: '2099-02-01T10:00:00.000Z',
  };
  const zBzp = ogloszenie('bzp', { ...wspolny, url: 'https://ezamowienia.test/dup', budget: null });
  const zBk = ogloszenie('baza_konkurencyjnosci', { ...wspolny, url: 'https://bk.test/dup', budget: 120_000 });

  const wynik = await runTenderFetch({
    zrodla: [zrodlo('bzp', [zBzp]), zrodlo('baza_konkurencyjnosci', [zBk])],
  });

  assert.equal(wynik.zduplikowane_miedzy_zrodlami, 1);
  assert.equal(await tenders.findById(tenderDocId(zBk.externalId)), null,
    'duplikat z rejestru pobocznego nie zakłada drugiego dokumentu');

  const zapisany = await tenders.findById(tenderDocId(zBzp.externalId));
  assert.equal(zapisany.source, 'bzp', 'wpis wiodący to rejestr urzędowy');
  assert.equal(zapisany.budget, 120_000, 'wartość znana tylko BK uzupełnia brak w BZP');
  assert.deepEqual(zapisany.zrodla_alternatywne, [
    { source: 'baza_konkurencyjnosci', externalId: zBk.externalId, url: 'https://bk.test/dup' },
  ], 'wykonawca musi wiedzieć, że sprawa toczy się też w BK');
});

test('duplikat jest policzony przy ŹRÓDLE, z którego go scalono (audyt musi wiedzieć, kto wnosi kopie)', async () => {
  const wspolny = {
    title: `Remont chodnika ${process.pid}-dup2`,
    organization: 'Gmina Testowa',
    deadline: '2099-03-01T10:00:00.000Z',
  };
  const wynik = await runTenderFetch({
    zrodla: [
      zrodlo('bzp', [ogloszenie('bzp', wspolny)]),
      zrodlo('baza_konkurencyjnosci', [ogloszenie('baza_konkurencyjnosci', wspolny)]),
    ],
  });

  assert.equal(wynik.zrodla.baza_konkurencyjnosci.fetched, 1, '`fetched` to nadal to, co oddało źródło');
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.newTenders, 0, 'ale nowego dokumentu nie założyło');
  assert.equal(wynik.zrodla.baza_konkurencyjnosci.zduplikowane_miedzy_zrodlami, 1);
  assert.equal(wynik.zrodla.bzp.zduplikowane_miedzy_zrodlami, 0);
});

test('ślad cyklu niesie liczniki pokrycia BK (bez nich rekonsyliacja jest zgadywaniem)', async () => {
  const wynik = await runTenderFetch({
    zrodla: [{
      nazwa: 'baza_konkurencyjnosci',
      pobierz: async (licznik) => {
        licznik.zapytania = 4;
        licznik.surowe = 1135;
        licznik.pokrycieKompletne = true;
        licznik.bkTotal = 1135;
        licznik.bkNowe = 12;
        licznik.bkZmienione = 3;
        licznik.bkAnulowane = 1;
        licznik.bkZaleglosc = 0;
        return [ogloszenie('baza_konkurencyjnosci')];
      },
    }],
  });

  const bk = wynik.zrodla.baza_konkurencyjnosci;
  assert.equal(bk.surowe, 1135);
  assert.equal(bk.zapytania, 4);
  assert.equal(bk.pokrycie_kompletne, true);
  assert.equal(bk.aktywne_w_zrodle, 1135);
  assert.equal(bk.nowe_ogloszenia, 12);
  assert.equal(bk.zmienione_ogloszenia, 3);
  assert.equal(bk.anulowane, 1);
  assert.equal(bk.zaleglosc, 0);
});

test('NIEPEŁNE pokrycie BK jest widoczne w śladzie cyklu, a nie zamiatane pod dywan', async () => {
  const wynik = await runTenderFetch({
    zrodla: [{
      nazwa: 'baza_konkurencyjnosci',
      pobierz: async (licznik) => {
        licznik.pokrycieKompletne = false;
        licznik.bkTotal = 1135;
        return [ogloszenie('baza_konkurencyjnosci')];
      },
    }],
  });

  assert.equal(wynik.zrodla.baza_konkurencyjnosci.pokrycie_kompletne, false,
    'API BK nie zgłasza tego błędem — jedyny sygnał niekompletności jest nasz');
});

test('źródła bez liczników BK nie dostają śmieciowych pól (BZP/TED nie udają, że mają pokrycie)', async () => {
  const wynik = await runTenderFetch({ zrodla: [zrodlo('bzp', [ogloszenie('bzp')])] });
  assert.equal(wynik.zrodla.bzp.pokrycie_kompletne, undefined);
  assert.equal(wynik.zrodla.bzp.aktywne_w_zrodle, undefined);
});
