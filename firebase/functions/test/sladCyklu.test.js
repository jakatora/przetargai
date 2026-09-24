import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * ŚLAD DZIENNEGO CYKLU — dlaczego ten plik istnieje.
 *
 * Audyt 2026-09-23 zobaczył na produkcji kształt, którego kod z repozytorium
 * „nie potrafi wyprodukować" i wyciągnął z tego wniosek, że wdrożona wersja
 * pochodzi spoza repozytorium (P0-1):
 *
 *   "zrodla": { "bzp": { "fetched": 1330, "newTenders": 188,
 *                        "error": "The operation was aborted due to timeout" } }
 *
 * Prawdziwa przyczyna jest inna i groźniejsza: `cykl.zapiszPrzebieg` zapisywał
 * ślad przez `set(..., { merge: true })`, a Firestore scala mapy GŁĘBOKO. Pole
 * `error` z przebiegu sprzed tygodni NIGDY nie znikało — kolejny, w pełni udany
 * przebieg nadpisywał tylko `fetched` i `newTenders`, a błąd zostawał przyklejony
 * na zawsze. `/health` pokazywał więc jednocześnie sukces i „błąd", a operator
 * nie miał jak odróżnić awarii dzisiejszej od trupa z lipca.
 *
 * Ten sam mechanizm działa w drugą stronę i jest jeszcze gorszy: przy PEŁNEJ
 * awarii (padły wszystkie źródła) job wracał wcześniej i śladu NIE zapisywał
 * wcale — ślad zostawał z ostatniego udanego przebiegu, więc awaria wyglądała
 * z zewnątrz jak sukces sprzed kilku godzin.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { cykl } = await import('../src/db/repos.js');
const { runTenderFetch } = await import('../src/jobs/fetchTenders.js');
const { getFirestore } = await import('firebase-admin/firestore');

/**
 * Historia per źródło jest TRWAŁA z założenia, więc testy muszą startować
 * z czystego śladu — inaczej badałyby pozostałość po poprzednim teście.
 */
async function wyczyscSlad() {
  await getFirestore().collection('_health').doc('daily_cycle').delete();
}

test('REGRESJA (P0-1): udany przebieg KASUJE błąd źródła z poprzedniego', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({
    ok: true,
    fetched: 0,
    newTenders: 0,
    zrodla: { bzp: { fetched: 0, newTenders: 0, error: 'The operation was aborted due to timeout' } },
  });

  await cykl.zapiszPrzebieg({
    ok: true,
    fetched: 1330,
    newTenders: 188,
    zrodla: { bzp: { fetched: 1330, newTenders: 188 } },
  });

  const slad = await cykl.ostatniPrzebieg();
  assert.equal(slad.wynik.zrodla.bzp.fetched, 1330);
  assert.equal(slad.wynik.zrodla.bzp.error, undefined,
    'błąd sprzed tygodni NIE MOŻE przeżyć udanego przebiegu — na tym poległ audyt');
});

test('ślad niesie OSOBNO historię: ostatni sukces i ostatni błąd per źródło', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({
    ok: true,
    zrodla: { bzp: { fetched: 10, newTenders: 2 }, ted: { fetched: 0, newTenders: 0, error: '429' } },
  });

  const slad = await cykl.ostatniPrzebieg();
  assert.ok(slad.zrodla.bzp.ostatni_sukces_o, 'BZP pobrał — musi mieć znacznik sukcesu');
  assert.equal(slad.zrodla.bzp.ostatni_blad, null, 'BZP nie miał błędu w tym przebiegu');
  assert.ok(slad.zrodla.ted.ostatni_blad_o, 'TED padł — musi mieć znacznik błędu');
  assert.equal(slad.zrodla.ted.ostatni_blad, '429');
});

test('historia per źródło PRZEŻYWA przebieg, w którym źródło nie brało udziału', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({ ok: true, zrodla: { ted: { fetched: 5, newTenders: 1 } } });
  await cykl.zapiszPrzebieg({ ok: true, zrodla: { bzp: { fetched: 7, newTenders: 3 } } });

  const slad = await cykl.ostatniPrzebieg();
  assert.ok(slad.zrodla.ted.ostatni_sukces_o,
    'wyłączenie TED na jeden dzień nie może skasować wiedzy, kiedy działał ostatnio');
  assert.equal(slad.wynik.zrodla.ted, undefined,
    'ale BIEŻĄCY wynik opisuje wyłącznie ten przebieg');
});

test('KRYTYCZNE: padły WSZYSTKIE źródła → ślad cyklu ZAPISANY z ok:false', async () => {
  await wyczyscSlad();
  await cykl.zapiszPrzebieg({ ok: true, fetched: 999, newTenders: 111, zrodla: { bzp: { fetched: 999, newTenders: 111 } } });

  const wynik = await runTenderFetch({
    zrodla: [
      { nazwa: 'bzp', pobierz: async () => { throw new Error('awaria A'); } },
      { nazwa: 'ted', pobierz: async () => { throw new Error('awaria B'); } },
    ],
  });
  assert.equal(wynik.ok, false);

  const slad = await cykl.ostatniPrzebieg();
  assert.equal(slad.wynik.ok, false,
    'bez zapisu śladu pełna awaria wygląda z zewnątrz jak wczorajszy sukces');
  assert.equal(slad.wynik.fetched, 0);
  assert.match(slad.wynik.error, /awaria A/);
});
