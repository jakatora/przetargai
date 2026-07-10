import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Rejestr źródeł ogłoszeń (D-039). Wymogi:
 *  1. awaria JEDNEGO źródła nie zatrzymuje pozostałych (TED pada → BZP dalej działa),
 *  2. cykl liczy dopasowania, jeśli COKOLWIEK się pobrało,
 *  3. ok:false dopiero gdy padły WSZYSTKIE źródła,
 *  4. wynik niesie statystyki per źródło (do /health i alarmów),
 *  5. `source` przetargu wędruje do bazy i do zdenormalizowanego dopasowania.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');
const { tenders, matches, tenderDocId } = await import('../src/db/repos.js');

let seq = 0;
function ogloszenie(zrodlo) {
  seq++;
  return {
    externalId: `${zrodlo}:zr-${process.pid}-${seq}`,
    title: `Ogłoszenie testowe ${seq}`,
    organization: 'Gmina',
    deadline: '2099-01-01T00:00:00.000Z',
    source: zrodlo,
  };
}

test('awaria jednego źródła NIE zatrzymuje pozostałych', async () => {
  const wynik = await runTenderFetch({
    zrodla: [
      { nazwa: 'bzp', pobierz: async () => { throw new Error('BZP w konserwacji'); } },
      { nazwa: 'ted', pobierz: async () => [ogloszenie('ted')] },
    ],
  });

  assert.equal(wynik.ok, true, 'jedno działające źródło = cykl się liczy');
  assert.equal(wynik.fetched, 1);
  assert.equal(wynik.zrodla.bzp.error, 'BZP w konserwacji');
  assert.equal(wynik.zrodla.ted.fetched, 1);
});

test('padły WSZYSTKIE źródła → ok:false (alarm w cronie)', async () => {
  const wynik = await runTenderFetch({
    zrodla: [
      { nazwa: 'bzp', pobierz: async () => { throw new Error('awaria A'); } },
      { nazwa: 'ted', pobierz: async () => { throw new Error('awaria B'); } },
    ],
  });
  assert.equal(wynik.ok, false);
  assert.equal(wynik.fetched, 0);
});

test('source ląduje w bazie przetargów i w zdenormalizowanym dopasowaniu', async () => {
  const przetarg = ogloszenie('ted');
  await runTenderFetch({ zrodla: [{ nazwa: 'ted', pobierz: async () => [przetarg] }] });

  const zapisany = await tenders.findById(tenderDocId(przetarg.externalId));
  assert.equal(zapisany.source, 'ted');

  // Zdenormalizowane dopasowanie niesie źródło — aplikacja pokazuje „Otwórz w TED".
  const { match } = await matches.create({
    userId: `u-zr-${process.pid}`, tenderId: zapisany.id, score: 80, reasoning: 'x', tender: zapisany,
  });
  assert.equal(match.tender_source, 'ted');
});

test('brak source w ogłoszeniu = bzp (zgodność wsteczna z istniejącymi danymi)', async () => {
  const przetarg = { ...ogloszenie('bzp'), source: undefined };
  await runTenderFetch({ zrodla: [{ nazwa: 'bzp', pobierz: async () => [przetarg] }] });
  const zapisany = await tenders.findById(tenderDocId(przetarg.externalId));
  assert.equal(zapisany.source, 'bzp');
});
