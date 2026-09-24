import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * HISTORIA ZMIAN W ŚCIEŻCE POBIERANIA (etap 5, P1-2).
 *
 * Wykrywanie zmian mieszka w warstwie DANYCH, a nie w jobie, i to jest decyzja,
 * nie przypadek: `zaktualizujZeZrodla` i `oznaczAnulowany` to JEDYNE dwa miejsca,
 * przez które ogłoszenie w bazie może się zmienić. Zapis historii po ich stronie
 * znaczy, że żaden przyszły job nie może o niej zapomnieć — a gdyby wykrywanie
 * siedziało w `oknoBk.js`, to samo trzeba by powtórzyć dla BZP i TED.
 */

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, historiaZmian } = await import('../src/db/repos.js');

let seq = 0;
const ext = () => `bk:hist-${process.pid}-${++seq}`;

async function zalozOgloszenie(nadpisz = {}) {
  const externalId = ext();
  const { tender } = await tenders.upsert({
    externalId,
    title: 'Dostawa kruszywa',
    organization: 'Gmina Testowa',
    source: 'baza_konkurencyjnosci',
    deadline: '2026-10-30T08:00:00.000Z',
    budget: 500_000,
    ...nadpisz,
  });
  return { externalId, tender };
}

test('przesunięcie terminu przez rejestr ZAPISUJE wpis w historii ogłoszenia', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  const wynik = await tenders.zaktualizujZeZrodla({
    externalId, title: 'Dostawa kruszywa', deadline: '2026-11-15T08:00:00.000Z',
  });

  assert.equal(wynik.zmienione, true);
  assert.equal(wynik.zmiany.length, 1);
  assert.equal(wynik.zmiany[0].typ, 'termin');

  const historia = await historiaZmian.lista(tender.id);
  assert.equal(historia.length, 1);
  assert.equal(historia[0].typ, 'termin');
  assert.equal(historia[0].przed, '2026-10-30T08:00:00.000Z');
  assert.equal(historia[0].po, '2026-11-15T08:00:00.000Z');
  assert.ok(historia[0].wykryto_o, 'bez znacznika wykrycia nie da się dotrzymać obietnicy alertu w 6 h');
});

test('kolejna wersja BEZ zmian nie dokłada ani jednego wpisu do historii', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  await tenders.zaktualizujZeZrodla({ externalId, title: 'Dostawa kruszywa', deadline: '2026-10-30T08:00:00.000Z' });
  await tenders.zaktualizujZeZrodla({ externalId, title: 'Dostawa kruszywa', deadline: '2026-10-30T08:00:00.000Z' });

  assert.equal((await historiaZmian.lista(tender.id)).length, 0);
});

test('ta sama zmiana zobaczona w dwóch przebiegach zostaje JEDNYM wpisem', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  await tenders.zaktualizujZeZrodla({ externalId, deadline: '2026-11-15T08:00:00.000Z' });
  // Powtórka przebiegu: dokument ma już nowy termin, więc porównanie nic nie wykrywa.
  await tenders.zaktualizujZeZrodla({ externalId, deadline: '2026-11-15T08:00:00.000Z' });

  assert.equal((await historiaZmian.lista(tender.id)).length, 1);
});

test('zmiana wartości i terminu naraz daje DWA wpisy, każdy z własnym typem', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  await tenders.zaktualizujZeZrodla({ externalId, deadline: '2026-11-15T08:00:00.000Z', budget: 750_000 });

  const typy = (await historiaZmian.lista(tender.id)).map((z) => z.typ).sort();
  assert.deepEqual(typy, ['termin', 'wartosc']);
});

test('zmieniona treść u źródła (odcisk) zapisuje się jako „nowe dokumenty lub odpowiedzi"', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  // Pierwszy zapis odcisku nie jest zmianą — nie mieliśmy z czym porównać.
  await tenders.zaktualizujZeZrodla({ externalId, zrodlo_odcisk: 'odcisk-A' });
  assert.equal((await historiaZmian.lista(tender.id)).length, 0);

  await tenders.zaktualizujZeZrodla({ externalId, zrodlo_odcisk: 'odcisk-B' });
  const historia = await historiaZmian.lista(tender.id);
  assert.equal(historia.length, 1);
  assert.equal(historia[0].typ, 'dokumenty');
});

test('status z rejestru źródłowego jest zapisywany i porównywany', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  await tenders.zaktualizujZeZrodla({ externalId, status_zrodla: 'PUBLISHED' });
  await tenders.zaktualizujZeZrodla({ externalId, status_zrodla: 'SUSPENDED' });

  const historia = await historiaZmian.lista(tender.id);
  assert.equal(historia.length, 1);
  assert.equal(historia[0].typ, 'status');
  assert.equal(historia[0].po, 'SUSPENDED');
});

test('ANULOWANIE zapisuje jednoznaczny wpis, a powtórka go nie dubluje', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  assert.equal(await tenders.oznaczAnulowany(externalId, { powod: 'CANCELLED' }), true);
  assert.equal(await tenders.oznaczAnulowany(externalId, { powod: 'CANCELLED' }), true);

  const historia = await historiaZmian.lista(tender.id);
  assert.equal(historia.length, 1);
  assert.equal(historia[0].typ, 'anulowanie');
  assert.equal(historia[0].koniec, true);
  assert.equal(historia[0].istotna, true);
});

test('anulowanie nieistniejącego ogłoszenia nie tworzy historii znikąd', async () => {
  assert.equal(await tenders.oznaczAnulowany('bk:nie-ma-takiego-wcale', { powod: 'CANCELLED' }), false);
});

test('cisza w nowej wersji NIE jest zmianą — pola puste zostawiają dotychczasową wartość', async () => {
  const { externalId, tender } = await zalozOgloszenie();

  // Oszczędniejsza kolejna wersja BK: bez budżetu i bez CPV.
  await tenders.zaktualizujZeZrodla({ externalId, budget: null, cpvMain: null, deadline: null });

  assert.equal((await historiaZmian.lista(tender.id)).length, 0, 'milczenie rejestru to nie kasowanie danych');
  const po = await tenders.findById(tender.id);
  assert.equal(po.budget, 500_000);
  assert.equal(po.deadline, '2026-10-30T08:00:00.000Z');
});

test('aktualizacja ogłoszenia, którego nie ma w bazie, jest nieszkodliwym brakiem trafienia', async () => {
  const wynik = await tenders.zaktualizujZeZrodla({ externalId: 'bk:nigdy-nie-pobrane', deadline: '2026-12-01T08:00:00.000Z' });
  assert.equal(wynik.zmienione, false);
  assert.deepEqual(wynik.zmiany, []);
});
