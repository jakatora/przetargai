import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runOknoPlanow, DNI_OKNA_PLANOW } = await import('../src/jobs/oknoPlanow.js');
const { planyPostepowan, oknoPlanow } = await import('../src/db/repos.js');
const { mapujPlanTed } = await import('../src/services/tedPlany.js');
const { WPISOW_NA_CZESC } = await import('../src/lib/indeksPlanow.js');

const KATALOG = dirname(fileURLToPath(import.meta.url));
const PLANY = JSON.parse(readFileSync(join(KATALOG, 'fixtures', 'ted-plany.json'), 'utf8'))
  .map(mapujPlanTed);

const TERAZ = Date.UTC(2026, 8, 24, 6, 15);

describe('okno planów TED → plany + indeks radaru', () => {
  test('import zapisuje pozycje i buduje indeks aktywnych', async () => {
    let zapytanie;
    const wynik = await runOknoPlanow({
      teraz: TERAZ,
      pobierz: async (opts) => {
        zapytanie = opts;
        opts.licznik.zapytania += 1;
        opts.licznik.surowe += PLANY.length;
        return PLANY;
      },
    });
    assert.equal(wynik.ok, true, wynik.error);
    assert.equal(wynik.zapisane, PLANY.length);
    assert.equal(zapytanie.odDnia, '20260922', `okno ${DNI_OKNA_PLANOW} dni wstecz, włącznie z dziś`);

    // 655093-2026 miał przewidywaną datę 2026-09-23 → aktywny jeszcze 60 dni.
    const { wpisy } = await planyPostepowan.indeks({ swiezy: true });
    const ids = new Set(wpisy.map((w) => w.id));
    for (const p of PLANY) assert.ok(ids.has(p.id), `brak w indeksie: ${p.id}`);
    assert.equal(wynik.aktywnych_w_indeksie, wpisy.length);

    const pelna = await planyPostepowan.pobierz('657219-2026');
    assert.match(pelna.url, /ted\.europa\.eu/);
    assert.equal(pelna.wygasa_o, '2026-12-29');

    const slad = await oknoPlanow.wczytaj();
    assert.equal(slad.ostatni_przebieg.ok, true);
    assert.equal(slad.ostatni_przebieg.error, null);
  });

  test('wygasłe pozycje schodzą z indeksu przy przebudowie', async () => {
    await planyPostepowan.zapiszWiele([{
      ...PLANY[0], id: 'WYGASLY-2025', terminWszczecia: '2025-01-10', opublikowano: '2024-12-01',
    }]);
    const pozniej = Date.UTC(2027, 0, 5);
    await runOknoPlanow({ teraz: pozniej, pobierz: async () => [] });
    const { wpisy } = await planyPostepowan.indeks({ swiezy: true });
    assert.ok(!wpisy.some((w) => w.id === 'WYGASLY-2025'));
    // 657219-2026 (termin 2026-10-30 + 60 = 2026-12-29) też już wygasł 2027-01-05.
    assert.ok(!wpisy.some((w) => w.id === '657219-2026'));
    // 657983-2026 (termin 2027-08-16) nadal aktywny.
    assert.ok(wpisy.some((w) => w.id === '657983-2026'));
  });

  test('awaria TED: ślad z błędem, indeks z wczoraj NIE znika', async () => {
    await runOknoPlanow({ teraz: TERAZ, pobierz: async () => PLANY });
    const przed = (await planyPostepowan.indeks({ swiezy: true })).wpisy.length;
    const wynik = await runOknoPlanow({
      teraz: TERAZ,
      pobierz: async () => { throw new Error('TED API (plany) odpowiedziało 429: Too many'); },
    });
    assert.equal(wynik.ok, false);
    assert.match(wynik.error, /429/);
    assert.equal((await planyPostepowan.indeks({ swiezy: true })).wpisy.length, przed);
    const slad = await oknoPlanow.wczytaj();
    assert.match(slad.ostatni_przebieg.error, /429/);
  });

  test('po udanym przebiegu błąd ze śladu znika (nie lepki merge)', async () => {
    await runOknoPlanow({ teraz: TERAZ, pobierz: async () => PLANY });
    const slad = await oknoPlanow.wczytaj();
    assert.equal(slad.ostatni_przebieg.error, null);
  });

  test('indeks dzielony na części i składany bez duplikatów', async () => {
    const duzo = Array.from({ length: WPISOW_NA_CZESC + 7 }, (_, i) => ({
      ...PLANY[1], id: `MASA-${i}-2026`, terminWszczecia: '2026-12-01',
    }));
    await planyPostepowan.zapiszWiele(duzo);
    const wynik = await runOknoPlanow({ teraz: TERAZ, pobierz: async () => [] });
    assert.ok(wynik.czesci_indeksu >= 2);
    const { wpisy } = await planyPostepowan.indeks({ swiezy: true });
    assert.equal(new Set(wpisy.map((w) => w.id)).size, wpisy.length);
    assert.ok(wpisy.filter((w) => w.id.startsWith('MASA-')).length === duzo.length);
  });
});
