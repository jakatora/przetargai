import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * WARSTWA DANYCH DLA BAZY KONKURENCYJNOŚCI (etap 3).
 *
 * Trzy rzeczy, których dotąd nie było, a bez których BK nie jest pełnoprawnym
 * źródłem, tylko jednorazowym importem:
 *
 *  1. CHECKPOINT okna (`_health/bk_okno`) — co już pobraliśmy i w jakiej wersji.
 *     Bez niego każdy przebieg ciągnąłby 1 135 szczegółów od nowa.
 *  2. AKTUALIZACJA zmienionego ogłoszenia — `tenders.upsert` jest create-only
 *     (świadomie: przetarg z BZP jest niemutowalny). BK wydaje KOLEJNE WERSJE
 *     tego samego ogłoszenia i najczęstsza zmiana to PRZESUNIĘCIE TERMINU.
 *     Bez aktualizacji pokazywalibyśmy nieaktualny termin składania ofert.
 *  3. ANULOWANIE — ogłoszenie znika z rynku, ale dokument zostaje (ktoś je zapisał,
 *     ktoś ma je w dopasowaniach). Musi wypaść z PULI, a nie z bazy.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, oknoBk, tenderDocId } = await import('../src/db/repos.js');

let seq = 0;
const ogloszenie = (over = {}) => {
  seq += 1;
  return {
    externalId: `bk:repo-${process.pid}-${seq}`,
    title: 'Dostawa sprzętu laboratoryjnego',
    organization: 'Fundacja Testowa',
    deadline: '2099-01-01T00:00:00.000Z',
    source: 'baza_konkurencyjnosci',
    ...over,
  };
};

/* ============================ checkpoint okna ============================ */

test('checkpoint BK: zapis i odczyt stanu ogłoszeń', async () => {
  const stan = { ogloszenia: { 292028: { odcisk: 'a1', pobrane_o: '2026-09-24T00:00:00.000Z' } } };
  await oknoBk.zapisz(stan);

  const wczytany = await oknoBk.wczytaj();
  assert.deepEqual(wczytany.ogloszenia['292028'], stan.ogloszenia['292028']);
});

test('checkpoint BK: zapis PODMIENIA mapę ogłoszeń zamiast ją zlepiać', async () => {
  await oknoBk.zapisz({ ogloszenia: { a: { odcisk: '1' }, b: { odcisk: '2' } } });
  await oknoBk.zapisz({ ogloszenia: { a: { odcisk: '9' } } });

  const wczytany = await oknoBk.wczytaj();
  assert.deepEqual(Object.keys(wczytany.ogloszenia), ['a'],
    'głębokie scalanie zostawiłoby `b` na zawsze — ta sama pułapka co w cykl.zapiszPrzebieg');
  assert.equal(wczytany.ogloszenia.a.odcisk, '9');
});

test('checkpoint BK: ślad przebiegu nie zeruje mapy ogłoszeń (dwa niezależne pola)', async () => {
  await oknoBk.zapisz({ ogloszenia: { x: { odcisk: '1' } } });
  await oknoBk.zapiszPrzebieg({ ok: true, fetched: 3, zakonczony_o: '2026-09-24T01:00:00.000Z' });

  const wczytany = await oknoBk.wczytaj();
  assert.equal(wczytany.ogloszenia.x.odcisk, '1');
  assert.equal(wczytany.ostatni_przebieg.fetched, 3);
});

/* ======================= aktualizacja zmienionego ======================= */

test('KRYTYCZNE: zmiana terminu w BK trafia na istniejący dokument (upsert sam by ją zgubił)', async () => {
  const t = ogloszenie({ deadline: '2099-01-01T00:00:00.000Z', budget: null });
  await tenders.upsert(t);

  const wynik = await tenders.zaktualizujZeZrodla({
    ...t, deadline: '2099-03-01T00:00:00.000Z', budget: 84_000, title: 'Dostawa sprzętu laboratoryjnego (po zmianie)',
  });

  assert.equal(wynik.zmienione, true);
  const zapisany = await tenders.findById(tenderDocId(t.externalId));
  assert.equal(zapisany.deadline, '2099-03-01T00:00:00.000Z');
  assert.equal(zapisany.budget, 84_000);
  assert.equal(zapisany.title, 'Dostawa sprzętu laboratoryjnego (po zmianie)');
  assert.ok(zapisany.zaktualizowany_o, 'bez znacznika nie da się odróżnić świeżej zmiany od starego wpisu');
});

test('aktualizacja NIEISTNIEJĄCEGO ogłoszenia nie tworzy sieroty i nie rzuca', async () => {
  const wynik = await tenders.zaktualizujZeZrodla(ogloszenie());
  assert.equal(wynik.zmienione, false);
});

test('aktualizacja nie kasuje danych, których nowa wersja nie niesie', async () => {
  const t = ogloszenie({ budget: 50_000, cpvMain: '45000000-7' });
  await tenders.upsert(t);

  await tenders.zaktualizujZeZrodla({ ...t, budget: null, cpvMain: null });

  const zapisany = await tenders.findById(tenderDocId(t.externalId));
  assert.equal(zapisany.budget, 50_000, 'BK bywa oszczędne w kolejnej wersji — cisza to nie jest usunięcie wartości');
  assert.equal(zapisany.cpv_main, '45000000-7');
});

/* ============================== anulowanie ============================== */

test('anulowane ogłoszenie ZOSTAJE w bazie, ale znika z puli dopasowań', async () => {
  const t = ogloszenie();
  await tenders.upsert(t);

  const oznaczone = await tenders.oznaczAnulowany(t.externalId, { powod: 'CANCELLED' });
  assert.equal(oznaczone, true);

  const zapisany = await tenders.findById(tenderDocId(t.externalId));
  assert.equal(zapisany.anulowany, true, 'ktoś je zapisał i ma w dopasowaniach — kasowanie zabrałoby mu historię');
  assert.equal(zapisany.anulowany_powod, 'CANCELLED');
  assert.ok(zapisany.anulowany_o);

  const pula = await tenders.openPool({ swiezaKopia: true });
  assert.ok(!pula.some((p) => p.id === tenderDocId(t.externalId)),
    'anulowany przetarg w puli kosztowałby płatne wywołanie AI i wprowadzał użytkownika w błąd');
});

test('anulowanie nieistniejącego ogłoszenia jest bezpieczne (false, bez wyjątku)', async () => {
  assert.equal(await tenders.oznaczAnulowany('bk:nie-ma-takiego', { powod: 'CANCELLED' }), false);
});

test('przetarg AKTYWNY nadal jest w puli (anulowanie nie może wyciąć zdrowych wpisów)', async () => {
  const t = ogloszenie();
  await tenders.upsert(t);
  tenders.odswiezPule();

  const pula = await tenders.openPool({ swiezaKopia: true });
  assert.ok(pula.some((p) => p.id === tenderDocId(t.externalId)));
});
