import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /health MUSI pokazywać stan okna Bazy Konkurencyjności (etap 3).
 *
 * BK nie zgłasza niekompletności błędem: listuje w NIESTABILNEJ kolejności i przy
 * niepełnym przejściu po prostu oddaje mniej ogłoszeń, z HTTP 200. Zmierzony
 * przebieg pokrył 921/1135 (81 %). Bez `pokrycie_kompletne` i `zaleglosc` w
 * `/health` operator nie ma ŻADNEGO sygnału, że część rynku nie weszła — to
 * dokładnie ta klasa cichej straty, przez którą BZP gubiło 85 % okna przez miesiące.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { cykl, oknoBk } = await import('../src/db/repos.js');
const { createApp } = await import('../src/app.js');
const { getFirestore } = await import('firebase-admin/firestore');

async function zapytajHealth() {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return { status: res.status, cialo: await res.json() };
  } finally {
    serwer.close();
  }
}

const PRZEBIEG_BK = {
  ok: true,
  fetched: 18,
  newTenders: 12,
  aktywne_w_zrodle: 1135,
  aktywne_pobrane: 1135,
  pokrycie_kompletne: true,
  zaleglosc: 0,
  zaktualizowane: 3,
  anulowane: 1,
  error: null,
  zakonczony_o: new Date().toISOString(),
};

beforeEach(async () => {
  await getFirestore().collection('_health').doc('bk_okno').delete();
  await cykl.zapiszPrzebieg({
    ok: true, fetched: 30, newTenders: 12, skipped: 0, matchesCreated: 0, durationMs: 1000,
    zrodla: { bzp: { fetched: 12, newTenders: 6 }, baza_konkurencyjnosci: { fetched: 18, newTenders: 6 } },
  });
});

test('brak przebiegu BK => `bk_okno: null` zamiast wymyślonych zer', async () => {
  const { status, cialo } = await zapytajHealth();
  assert.equal(status, 200);
  assert.equal(cialo.bk_okno, null, 'zera udawałyby, że import działa i nic nie znalazł');
});

test('/health pokazuje pokrycie, zaległość i anulowane z ostatniego przebiegu BK', async () => {
  await oknoBk.zapiszPrzebieg(PRZEBIEG_BK);

  const { cialo } = await zapytajHealth();
  assert.equal(cialo.bk_okno.aktywne_w_zrodle, 1135);
  assert.equal(cialo.bk_okno.aktywne_pobrane, 1135);
  assert.equal(cialo.bk_okno.pokrycie_kompletne, true);
  assert.equal(cialo.bk_okno.zaleglosc, 0);
  assert.equal(cialo.bk_okno.zaktualizowane, 3);
  assert.equal(cialo.bk_okno.anulowane, 1);
});

test('KRYTYCZNE: niepełne pokrycie BK jest WIDOCZNE, choć API oddało HTTP 200', async () => {
  await oknoBk.zapiszPrzebieg({ ...PRZEBIEG_BK, aktywne_pobrane: 921, pokrycie_kompletne: false, zaleglosc: 214 });

  const { cialo } = await zapytajHealth();
  assert.equal(cialo.bk_okno.pokrycie_kompletne, false);
  assert.equal(cialo.bk_okno.zaleglosc, 214);
});

test('BK w rejestrze źródeł ma własny wpis w statystykach cyklu (nie chowa się pod „bzp")', async () => {
  const { cialo } = await zapytajHealth();
  assert.equal(cialo.cron.ostatni_wynik.zrodla.baza_konkurencyjnosci.fetched, 18);
  assert.ok(cialo.cron.zrodla.baza_konkurencyjnosci, 'historia per źródło musi objąć nowy rejestr');
});

test('awaria samego okna BK nie kłamie o sukcesie — błąd zostaje widoczny', async () => {
  await oknoBk.zapiszPrzebieg({ ...PRZEBIEG_BK, ok: false, error: 'BK search odpowiedziało 500' });

  const { cialo } = await zapytajHealth();
  assert.equal(cialo.bk_okno.error, 'BK search odpowiedziało 500');
});
