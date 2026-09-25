import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * WARSTWA DANYCH MONITORINGU (etap 5) — zapisane wyszukiwania, historia zmian,
 * centrum alertów. Test integracyjny na emulatorze Firestore.
 *
 * Trzy właściwości, które muszą trzymać się bazy, a nie dobrej woli wołającego:
 *  • cudzego wyszukiwania nie da się nawet zaadresować (subkolekcja użytkownika),
 *  • ten sam alert zapisany dwa razy zostaje jednym wpisem (klucz = docId),
 *  • ta sama zmiana wykryta w dwóch przebiegach nie dubluje historii.
 */

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { wyszukiwania, historiaZmian, alerty, users } = await import('../src/db/repos.js');
const { wykryjZmiany, kluczZmiany } = await import('../src/lib/zmianyOgloszenia.js');

let seq = 0;
const uid = () => `u-mon-${process.pid}-${++seq}`;

const FILTRY = { zrodlo: 'bzp', region: '12', termin: 'aktywne' };

test('zapis → lista → odczyt po id; wpis niesie odcisk i znaczniki', async () => {
  const u = uid();
  const w = await wyszukiwania.create(u, {
    nazwa: 'Drogi w Małopolsce', filtry: FILTRY, alert_wlaczony: true, czestotliwosc: 'dzienna', odcisk: 'ODC1',
  });

  assert.ok(w.id);
  assert.equal(w.nazwa, 'Drogi w Małopolsce');
  assert.equal(w.odcisk, 'ODC1');
  assert.equal(w.alert_wlaczony, true);
  assert.ok(w.utworzone_o, 'wpis bez znacznika utworzenia nie da się posortować');
  assert.equal(w.ostatnio_sprawdzone_o, null, 'świeże wyszukiwanie nie było jeszcze sprawdzane');

  const lista = await wyszukiwania.list(u);
  assert.equal(lista.length, 1);
  assert.equal((await wyszukiwania.get(u, w.id)).nazwa, 'Drogi w Małopolsce');
});

test('wyszukiwania są skopowane do właściciela — cudzego nie da się odczytać ani usunąć', async () => {
  const wlasciciel = uid();
  const obcy = uid();
  const w = await wyszukiwania.create(wlasciciel, { nazwa: 'Moje', filtry: FILTRY, odcisk: 'ODC2' });

  assert.equal(await wyszukiwania.get(obcy, w.id), null);
  assert.equal(await wyszukiwania.remove(obcy, w.id), false);
  assert.ok(await wyszukiwania.get(wlasciciel, w.id), 'właściciel nie mógł stracić swojego wpisu');
});

test('aktualizacja zmienia tylko podane pola i podnosi znacznik zmiany', async () => {
  const u = uid();
  const w = await wyszukiwania.create(u, { nazwa: 'Stara', filtry: FILTRY, odcisk: 'ODC3', czestotliwosc: 'dzienna' });

  const po = await wyszukiwania.update(u, w.id, { nazwa: 'Nowa', alert_wlaczony: false });
  assert.equal(po.nazwa, 'Nowa');
  assert.equal(po.alert_wlaczony, false);
  assert.equal(po.czestotliwosc, 'dzienna', 'nietknięte pole musi przeżyć aktualizację');
  assert.ok(po.zaktualizowane_o);

  assert.equal(await wyszukiwania.update(uid(), w.id, { nazwa: 'Cudza' }), null);
});

test('usunięcie działa raz — powtórka mówi „nie było czego usuwać", a nie rzuca', async () => {
  const u = uid();
  const w = await wyszukiwania.create(u, { nazwa: 'Do kosza', filtry: FILTRY, odcisk: 'ODC4' });
  assert.equal(await wyszukiwania.remove(u, w.id), true);
  assert.equal(await wyszukiwania.remove(u, w.id), false);
});

test('checkpoint sprawdzenia zapisuje CZAS i KURSOR, po których rusza następny przebieg', async () => {
  const u = uid();
  const w = await wyszukiwania.create(u, { nazwa: 'Z kursorem', filtry: FILTRY, odcisk: 'ODC5' });

  await wyszukiwania.oznaczSprawdzone(u, w.id, {
    teraz: '2026-09-24T12:00:00.000Z',
    kursor: { fetched_at: '2026-09-24T11:59:00.000Z', id: 't-ostatni' },
    trafien: 3,
  });

  const po = await wyszukiwania.get(u, w.id);
  assert.equal(po.ostatnio_sprawdzone_o, '2026-09-24T12:00:00.000Z');
  assert.equal(po.kursor.id, 't-ostatni');
  assert.equal(po.ostatnio_trafien, 3);
});

test('harmonogram widzi WŁĄCZONE wyszukiwania wszystkich użytkowników, z identyfikatorem właściciela', async () => {
  const a = uid();
  const b = uid();
  await wyszukiwania.create(a, { nazwa: 'A z alertem', filtry: FILTRY, odcisk: 'ODC6', alert_wlaczony: true });
  await wyszukiwania.create(b, { nazwa: 'B bez alertu', filtry: FILTRY, odcisk: 'ODC7', alert_wlaczony: false });

  const doSprawdzenia = await wyszukiwania.zAlertem();
  const moje = doSprawdzenia.filter((w) => w.userId === a || w.userId === b);

  assert.equal(moje.length, 1, 'wyłączony alert nie może kosztować odczytu w każdym przebiegu');
  assert.equal(moje[0].userId, a);
  assert.ok(moje[0].id, 'bez identyfikatora nie da się zapisać checkpointu');
});

test('historia zmian zapisuje wpis raz — ta sama zmiana w drugim przebiegu nie dubluje', async () => {
  const tenderId = `t-mon-${process.pid}-${++seq}`;
  const zmiany = wykryjZmiany(
    { deadline: '2026-10-08T10:00:00.000Z' },
    { deadline: '2026-10-02T10:00:00.000Z' },
  );

  const pierwszy = await historiaZmian.zapisz(tenderId, zmiany, { wykryto_o: '2026-09-24T12:00:00.000Z' });
  const drugi = await historiaZmian.zapisz(tenderId, zmiany, { wykryto_o: '2026-09-24T14:00:00.000Z' });

  assert.equal(pierwszy.zapisane, 1);
  assert.equal(drugi.zapisane, 0, 'idempotencja: drugi przebieg nie dokłada wpisu');

  const lista = await historiaZmian.lista(tenderId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].typ, 'termin');
  assert.equal(lista[0].id, kluczZmiany(tenderId, zmiany[0]));
  assert.equal(lista[0].wykryto_o, '2026-09-24T12:00:00.000Z', 'zachowujemy czas PIERWSZEGO wykrycia');
});

test('historia jednego przetargu wraca od najnowszej zmiany', async () => {
  const tenderId = `t-mon-${process.pid}-${++seq}`;
  await historiaZmian.zapisz(
    tenderId,
    wykryjZmiany({ deadline: '2026-10-08T10:00:00.000Z' }, { deadline: '2026-10-09T10:00:00.000Z' }),
    { wykryto_o: '2026-09-20T12:00:00.000Z' },
  );
  await historiaZmian.zapisz(
    tenderId,
    wykryjZmiany({ anulowany: false }, { anulowany: true }),
    { wykryto_o: '2026-09-22T12:00:00.000Z' },
  );

  const lista = await historiaZmian.lista(tenderId);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].typ, 'anulowanie', 'najnowsza zmiana pierwsza');
});

test('zmiany z ostatnich godzin da się przeczytać ze WSZYSTKICH przetargów naraz', async () => {
  const t1 = `t-mon-${process.pid}-${++seq}`;
  await historiaZmian.zapisz(
    t1,
    wykryjZmiany({ budget: 100 }, { budget: 200 }),
    { wykryto_o: '2026-09-24T18:00:00.000Z' },
  );

  const swieze = await historiaZmian.odCzasu('2026-09-24T17:00:00.000Z');
  assert.ok(swieze.some((z) => z.tenderId === t1), 'harmonogram musi widzieć zmiany bez znajomości przetargu');
  const stare = await historiaZmian.odCzasu('2026-09-24T19:00:00.000Z');
  assert.equal(stare.some((z) => z.tenderId === t1), false);
});

test('alert zapisany dwa razy pod tym samym kluczem zostaje jednym wpisem', async () => {
  const u = uid();
  const alert = {
    klucz: 'a-dedup-1', typ: 'nowe_trafienia', wyszukiwanie_id: 'w1', tytul: 'Nowe przetargi',
    tresc: '3 nowe ogłoszenia', pozycje: [{ tender_id: 't1', tytul: 'Remont' }],
  };

  assert.equal((await alerty.dodaj(u, alert, '2026-09-24T12:00:00.000Z')).nowy, true);
  assert.equal((await alerty.dodaj(u, alert, '2026-09-24T13:00:00.000Z')).nowy, false);

  const lista = await alerty.lista(u);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].przeczytany, false);
});

test('centrum alertów: licznik nieprzeczytanych i oznaczanie jako przeczytane', async () => {
  const u = uid();
  await alerty.dodaj(u, { klucz: 'k1', typ: 'nowe_trafienia', tytul: 'A' }, '2026-09-24T12:00:00.000Z');
  const b = await alerty.dodaj(u, { klucz: 'k2', typ: 'zmiana', tytul: 'B' }, '2026-09-24T13:00:00.000Z');

  assert.equal(await alerty.nieprzeczytane(u), 2);

  await alerty.oznaczPrzeczytany(u, b.id);
  assert.equal(await alerty.nieprzeczytane(u), 1);

  await alerty.oznaczWszystkiePrzeczytane(u);
  assert.equal(await alerty.nieprzeczytane(u), 0);
});

test('lista alertów wraca od najnowszego i jest skopowana do właściciela', async () => {
  const u = uid();
  const obcy = uid();
  await alerty.dodaj(u, { klucz: 'x1', typ: 'zmiana', tytul: 'Starszy' }, '2026-09-20T12:00:00.000Z');
  await alerty.dodaj(u, { klucz: 'x2', typ: 'zmiana', tytul: 'Nowszy' }, '2026-09-22T12:00:00.000Z');

  const lista = await alerty.lista(u);
  assert.equal(lista[0].tytul, 'Nowszy');
  assert.equal((await alerty.lista(obcy)).length, 0);
});

test('RODO: usunięcie konta kasuje także zapisane wyszukiwania i centrum alertów', async () => {
  /*
   * STRAŻNIK, nie nowa funkcja. `users.usunKonto` używa `recursiveDelete`, więc
   * obejmuje NOWE podkolekcje automatycznie — i właśnie dlatego łatwo tu o regresję:
   * ktoś zamieni kasowanie rekurencyjne na wyliczankę podkolekcji i dwie świeże
   * (`wyszukiwania`, `alerty`) po cichu przeżyją usunięcie konta.
   */
  const u = uid();
  await wyszukiwania.create(u, { nazwa: 'Do skasowania', filtry: FILTRY, odcisk: 'ODC-RODO' });
  await alerty.dodaj(u, { klucz: 'rodo-1', typ: 'zmiana', tytul: 'Alert' }, '2026-09-24T12:00:00.000Z');

  await users.usunKonto(u);

  assert.equal((await wyszukiwania.list(u)).length, 0);
  assert.equal((await alerty.lista(u)).length, 0);
});

/*
 * STRUMIEŃ NOWYCH OGŁOSZEŃ dla monitoringu (naprawa 2026-09-25).
 *
 * Dokumenty zapisujemy z JAWNYM `fetched_at` z 2001 roku: to jedyny sposób, żeby dać
 * kilku ogłoszeniom TEN SAM znacznik (upsert stempluje zegarem), a daleka przeszłość
 * nie wchodzi w okna innych testów, które czytają rynek od „teraz" wstecz.
 */
test('strumień nowych: rosnąco od `od`, do wyczerpania; przerwany budżetem NIE kończy się w środku grupy o tym samym znaczniku', async () => {
  const { tenders } = await import('../src/db/repos.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const kol = getFirestore().collection('tenders');
  const znak = `strumien-${process.pid}-${Date.now()}`;
  const dok = (i, fetched_at) => ({ id: `${znak}-${i}`, title: `S${i}`, source: 'bzp', deadline: '2001-12-31T00:00:00.000Z', fetched_at });

  const wpisy = [
    dok(1, '2001-01-01T00:00:01.000Z'),
    dok(2, '2001-01-01T00:00:02.000Z'),
    // Trzy ogłoszenia zapisane w tej samej milisekundzie (partia pobierania).
    dok(3, '2001-01-01T00:00:03.000Z'),
    dok(4, '2001-01-01T00:00:03.000Z'),
    dok(5, '2001-01-01T00:00:03.000Z'),
    dok(6, '2001-01-01T00:00:04.000Z'),
  ];
  await Promise.all(wpisy.map(({ id, ...d }) => kol.doc(id).set(d)));

  try {
    const od = '2001-01-01T00:00:00.000Z';
    const calosc = await tenders.noweOd({ od, doMaks: '2001-12-31T00:00:00.000Z' });
    assert.equal(calosc.wyczerpano, true);
    assert.deepEqual(calosc.wiersze.map((t) => t.id), wpisy.map((w) => w.id), 'porządek rosnący po fetched_at');
    assert.equal(calosc.przejrzanoDo, '2001-01-01T00:00:04.000Z');

    // Budżet 4 kończy się W ŚRODKU grupy 00:00:03 — cała grupa musi poczekać na następny przebieg,
    // inaczej kursor na 00:00:03 zgubiłby jej nieprzeczytaną resztę (filtr to `fetched_at > kursor`).
    const przerwany = await tenders.noweOd({ od, doMaks: '2001-12-31T00:00:00.000Z', budzetOdczytow: 4, rozmiarStrony: 2 });
    assert.equal(przerwany.wyczerpano, false);
    assert.deepEqual(przerwany.wiersze.map((t) => t.id), [`${znak}-1`, `${znak}-2`]);
    assert.equal(przerwany.przejrzanoDo, '2001-01-01T00:00:02.000Z');

    const dalej = await tenders.noweOd({ od: przerwany.przejrzanoDo, doMaks: '2001-12-31T00:00:00.000Z' });
    assert.deepEqual(dalej.wiersze.map((t) => t.id), [`${znak}-3`, `${znak}-4`, `${znak}-5`, `${znak}-6`],
      'następny przebieg podejmuje dokładnie tam, gdzie poprzedni przestał');
  } finally {
    await Promise.all(wpisy.map(({ id }) => kol.doc(id).delete()));
  }
});
