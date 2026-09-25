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

/*
 * Liczniki kompletności (audyt 2026-09-23 §4.5): cykl musi nieść nie tylko „ile
 * zapisano", ale też ile źródło REALNIE oddało, ile odpadło na normalizacji
 * i ile scaliła deduplikacja. Bez tych trzech liczb nie da się porównać bazy
 * z liczbą po stronie BZP/TED dla tego samego okna.
 */

test('statystyki per źródło niosą liczniki adaptera (surowe/odrzucone/zduplikowane)', async () => {
  const wynik = await runTenderFetch({
    zrodla: [{
      nazwa: 'bzp',
      pobierz: async (licznik) => {
        licznik.zapytania = 17;
        licznik.surowe = 40;
        licznik.odrzucone = 3;
        return [ogloszenie('bzp'), ogloszenie('bzp')];
      },
    }],
  });

  const bzp = wynik.zrodla.bzp;
  assert.equal(bzp.fetched, 2, 'unikalne, znormalizowane ogłoszenia');
  assert.equal(bzp.surowe, 40);
  assert.equal(bzp.odrzucone, 3);
  assert.equal(bzp.zapytania, 17);
  assert.equal(bzp.zduplikowane, 35, '40 − 3 − 2');
  assert.equal(bzp.pominiete, 0);
});

test('źródło zwracające samą TABLICĘ nadal działa (zgodność wsteczna)', async () => {
  const wynik = await runTenderFetch({
    zrodla: [{ nazwa: 'ted', pobierz: async () => [ogloszenie('ted')] }],
  });
  assert.equal(wynik.zrodla.ted.fetched, 1);
  assert.equal(wynik.zrodla.ted.surowe, 0, 'adapter bez licznika raportuje zera, nie śmieci');
  assert.equal(wynik.zrodla.ted.zduplikowane, 0);
});

test('awaria w POŁOWIE okna zachowuje to, co zdążył zmierzyć licznik', async () => {
  const wynik = await runTenderFetch({
    zrodla: [
      {
        nazwa: 'bzp',
        pobierz: async (licznik) => {
          licznik.zapytania = 5;
          licznik.surowe = 1330;
          throw new Error('The operation was aborted due to timeout');
        },
      },
      { nazwa: 'ted', pobierz: async () => [ogloszenie('ted')] },
    ],
  });

  assert.equal(wynik.zrodla.bzp.error, 'The operation was aborted due to timeout');
  assert.equal(wynik.zrodla.bzp.surowe, 1330,
    'wiedza „doszło do 1330 ogłoszeń i padło" jest warta więcej niż samo `error`');
  assert.equal(wynik.zrodla.bzp.fetched, 0, 'nic nie trafiło do zapisu');
});

test('CHECKPOINT PO ZAPISIE: źródło dostaje listę ogłoszeń, których NIE zapisano (także scalonych z innym rejestrem)', async () => {
  const pechowe = ogloszenie('bzp');
  const dobre = ogloszenie('bzp');
  // Kopia pechowego z BK — scalanie międzyźródłowe dokleja ją do wpisu BZP.
  const kopiaBk = { ...ogloszenie('baza_konkurencyjnosci'), title: pechowe.title, organization: pechowe.organization, numer: 'X' };

  const zatwierdzone = {};
  const zrodlo = (nazwa, lista) => ({
    nazwa,
    pobierz: async () => lista,
    zatwierdz: async (_licznik, { nieudane }) => { zatwierdzone[nazwa] = [...nieudane]; },
  });

  const oryginalnyUpsert = tenders.upsert;
  tenders.upsert = async (o) => {
    if (o.externalId === pechowe.externalId) throw new Error('Firestore: zapis padł');
    return oryginalnyUpsert.call(tenders, o);
  };
  let wynik;
  try {
    wynik = await runTenderFetch({ zrodla: [zrodlo('bzp', [pechowe, dobre]), zrodlo('baza_konkurencyjnosci', [kopiaBk])] });
  } finally {
    tenders.upsert = oryginalnyUpsert;
  }

  assert.ok(zatwierdzone.bzp.includes(pechowe.externalId), 'źródło musi wiedzieć, czego nie zapisano');
  assert.equal(zatwierdzone.bzp.includes(dobre.externalId), false);
  assert.ok(zatwierdzone.baza_konkurencyjnosci.includes(kopiaBk.externalId),
    'kopia scalona z niezapisanym wpisem też nie trafiła do bazy — BK musi ją ponowić');
  assert.equal(wynik.skipped, 1);
  assert.equal(wynik.czesciowy, true, 'utracony zapis nie jest czystym sukcesem');
});
