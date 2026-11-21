import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utworzKatalogPaginowany } from '../src/lib/katalogPaginacja.js';

const params = (q = 'rumoszu', sort = 'najnowsze') => ({ q, sort, termin: 'aktywne' });
const strona = (ids, next = null) => ({
  tenders: ids.map((id) => ({ id })), next_kursor: next,
  wyczerpano: !next, przeskanowano: 1200,
});
const odrocz = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('rzadkie trafienia za wieloma pustymi porcjami: kontynuacja bez onEndReached i bez limitu liczby porcji', async () => {
  let n = 0;
  const katalog = utworzKatalogPaginowany({ pobierzStrone: async (p) => {
    assert.equal(p.kursor ?? null, n ? `k${n}` : null);
    n += 1;
    return n <= 15 ? strona([], `k${n}`) : strona(['rumoszu']);
  } });
  katalog.ustawParametry(params());
  const stany = [];
  katalog.subskrybuj((s) => stany.push(s));
  await katalog.wczytaj();
  assert.equal(n, 16);
  assert.deepEqual(katalog.stan().pozycje.map((t) => t.id), ['rumoszu']);
  assert.equal(katalog.stan().wyczerpano, true);
  assert.ok(stany.filter((s) => !s.pozycje.length && !s.wyczerpano).every((s) => s.ladowanie));
});

test('paginacja wypełnia stronę mimo pustych przerw, usuwa duplikaty i zachowuje kursor ostatniej porcji', async () => {
  const calls = [];
  const pages = [strona(['a'], '1'), strona([], '2'), strona(['a', 'b'], '3'), strona([], '4'), strona(['c'])];
  const katalog = utworzKatalogPaginowany({ limit: 2, pobierzStrone: async (p) => { calls.push(p); return pages.shift(); } });
  katalog.ustawParametry(params());
  await katalog.wczytaj();
  assert.deepEqual(katalog.stan().pozycje.map((t) => t.id), ['a', 'b']);
  assert.equal(katalog.stan().kursor, '3');
  await katalog.dociagnij();
  assert.deepEqual(katalog.stan().pozycje.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(katalog.stan().wyczerpano, true);
  assert.deepEqual(calls.map((p) => p.kursor), [undefined, '1', '2', '3', '4']);
});

test('zmiana frazy natychmiast unieważnia starą pierwszą stronę PRZED debounce', async () => {
  const stare = odrocz();
  const calls = [];
  const katalog = utworzKatalogPaginowany({ pobierzStrone: (p) => { calls.push(p); return stare.promise; } });
  katalog.ustawParametry(params('kaloszy'));
  const pending = katalog.wczytaj();
  katalog.ustawParametry(params('nowa'));
  stare.resolve(strona(['kaloszy'], 'kursor-kaloszy'));
  await pending;
  await katalog.dociagnij();
  assert.equal(calls.length, 1, 'stary kursor nie może zostać wysłany przy nowej frazie');
  assert.equal(katalog.stan().kursor, null);
  assert.deepEqual(katalog.stan().pozycje, []);
  assert.equal(katalog.stan().ladowanie, true, 'stare finally nie kończy oczekiwania nowej frazy');
});

test('zmiana filtra podczas dociągania: spóźniony sukces lub błąd nie zmienia nowej listy ani jej blokady', async () => {
  for (const sukces of [true, false]) {
    const stare = odrocz(), nowe = odrocz();
    const calls = [];
    const katalog = utworzKatalogPaginowany({ limit: 1, pobierzStrone: (p) => {
      calls.push(p);
      if (calls.length === 1) return Promise.resolve(strona(['kaloszy'], 'stary-kursor'));
      return calls.length === 2 ? stare.promise : nowe.promise;
    } });
    katalog.ustawParametry(params('kaloszy'));
    await katalog.wczytaj();
    const oldRead = katalog.dociagnij();
    katalog.ustawParametry(params('rumoszu'));
    const newRead = katalog.wczytaj();
    if (sukces) stare.resolve(strona(['stare'], 'stary-2'));
    else stare.reject(new Error('Kursor pochodzi z innego zestawu filtrów'));
    await oldRead;
    assert.equal(katalog.stan().blad, null);
    assert.equal(katalog.stan().ladowanie, true);
    await katalog.dociagnij();
    assert.equal(calls.length, 3, 'stare finally nie zwalnia blokady nowego odczytu');
    assert.equal(calls[2].kursor, undefined);
    nowe.resolve(strona(['rumoszu']));
    await newRead;
    assert.deepEqual(katalog.stan().pozycje.map((t) => t.id), ['rumoszu']);
  }
});

test('dwa zdarzenia końca listy przed renderem wysyłają tylko jedno żądanie', async () => {
  const wait = odrocz(); let n = 0;
  const katalog = utworzKatalogPaginowany({ limit: 1, pobierzStrone: async () => ++n === 1 ? strona(['a'], 'k') : wait.promise });
  katalog.ustawParametry(params());
  await katalog.wczytaj();
  const p = katalog.dociagnij();
  await katalog.dociagnij();
  assert.equal(n, 2);
  wait.resolve(strona(['b'])); await p;
});

test('powrót do tej samej frazy po innej nie przywraca odpowiedzi ze starej generacji', async () => {
  const wait = odrocz();
  const katalog = utworzKatalogPaginowany({ pobierzStrone: () => wait.promise });
  katalog.ustawParametry(params('a')); const p = katalog.wczytaj();
  katalog.ustawParametry(params('b')); katalog.ustawParametry(params('a'));
  wait.resolve(strona(['stare-a'])); await p;
  assert.deepEqual(katalog.stan().pozycje, []);
  assert.equal(katalog.stan().ladowanie, true);
});

test('błąd dalszego skanu nie jest pustym wynikiem; ponowienie może dokończyć szukanie', async () => {
  let n = 0;
  const katalog = utworzKatalogPaginowany({ pobierzStrone: async () => {
    n += 1;
    if (n === 1) return strona([], 'k');
    if (n === 2) throw new Error('offline');
    return strona(['rumoszu']);
  } });
  katalog.ustawParametry(params()); await katalog.wczytaj();
  assert.equal(katalog.stan().wyczerpano, false);
  assert.equal(katalog.stan().blad, 'offline');
  await katalog.wczytaj();
  assert.equal(katalog.stan().blad, null);
  assert.deepEqual(katalog.stan().pozycje.map((t) => t.id), ['rumoszu']);
});

test('uszkodzona kontynuacja nie wpada w pętlę i nie twierdzi, że danych nie ma', async () => {
  for (const next of [null, 'k']) {
    let n = 0;
    const katalog = utworzKatalogPaginowany({ pobierzStrone: async () => {
      n += 1; return { ...strona([], n === 1 ? 'k' : next), wyczerpano: false };
    } });
    katalog.ustawParametry(params()); await katalog.wczytaj();
    assert.equal(n, 2);
    assert.ok(katalog.stan().blad);
    assert.equal(katalog.stan().wyczerpano, false);
  }
});

test('odmontowanie przerywa kontynuowanie pustych porcji i ignoruje spóźnione żądanie', async () => {
  const wait = odrocz(); let n = 0;
  const katalog = utworzKatalogPaginowany({ pobierzStrone: () => { n += 1; return wait.promise; } });
  katalog.ustawParametry(params()); const p = katalog.wczytaj();
  katalog.anuluj(); wait.resolve(strona([], 'k')); await p;
  assert.equal(n, 1);
  assert.equal(katalog.stan().kursor, null);
});
