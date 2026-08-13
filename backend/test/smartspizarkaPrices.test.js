import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/*
 * SmartSpiżarka — publiczny endpoint cen (ulepszenie „Uruchomienie produkcyjnego
 * endpointu cen", podzadanie testów kontraktowych 3/5). Router
 * `routes/smartspizarkaPrices.js` montowany pod `/api/smartspizarka/prices`
 * (spójnie ze wzorcem `app.use('/api/<projekt>/*', apiLimiter, router)`).
 *
 * Testujemy PEŁNĄ ŚCIEŻKĘ HTTP przez PRAWDZIWĄ aplikację Express (createApp →
 * listen(0) → fetch), tak jak pozostałe route-testy w tym repo — dostajemy realny
 * error-middleware (badRequest→400, notFound→404) i realny katalog cen z pliku.
 *
 * Trzy przypadki wprost z ulepszenia:
 *   (a) POPRAWNA oferta → wszystkie pola zmapowane, sourceUrl = konkretna strona,
 *       validUntil realny. W danych produkcyjnych ŻADEN rekord nie ma dziś
 *       potwierdzonego `validUntil` (świadoma „opcja B" — money-path), więc pełną
 *       ofertę weryfikujemy na wyeksportowanym budowniczym ciała odpowiedzi
 *       `zbudujOfertePubliczna(rekord, teraz)` z INIEKCJĄ ZEGARA (deterministycznie,
 *       bez pułapki czasowej). To DOKŁADNIE to, co zwraca handler:
 *       `res.json(zbudujOfertePubliczna(rekord))`.
 *   (b) BRAK produktu → 404.
 *   (c) oferta bez sourceUrl / bez validUntil → pola ceny (price, sourceUrl,
 *       validUntil) = null, NIGDY nie zmyślone; store/unit/checkedAt zostają
 *       informacyjnie.
 *
 * REGUŁA ŚCIEŻKI PIENIĘDZY: kontrola POZYTYWNA (a) broni przed fałszywą zielenią —
 * gdyby endpoint zawsze zwracał null, przypadek (a) by padł.
 */

import { createApp } from '../src/app.js';
import { zbudujOfertePubliczna } from '../src/routes/smartspizarkaPrices.js';

let server;
let base;

before(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
});

const PRICES = `/api/smartspizarka/prices`;

async function pobierz(productId) {
  const url = productId === undefined
    ? `${base}${PRICES}`
    : `${base}${PRICES}?productId=${encodeURIComponent(productId)}`;
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ── (a) POPRAWNA oferta → wszystkie pola zmapowane (budowniczy ciała + zegar) ──

test('(a) poprawna oferta: wszystkie pola zmapowane, sourceUrl konkretny, validUntil realny', () => {
  const teraz = new Date('2026-08-13T00:00:00Z');
  const rekord = {
    store: 'Biedronka',
    unit: 'l',
    price: 4.49,
    currency: 'PLN',
    quantity: 1,
    checkedAt: '2026-08-13',
    sourceUrl:
      'https://zakupy.biedronka.pl/mlekovita-mlekovita-mleko-uht-32-tluszczu-wypasione-1-l-0000000036.html',
    validUntil: '2026-12-31', // realny, przyszły względem `teraz`
  };

  const oferta = zbudujOfertePubliczna(rekord, teraz);

  assert.equal(oferta.store, 'Biedronka');
  assert.equal(oferta.unit, 'l');
  assert.equal(oferta.price, 4.49);
  // currency (obsługiwana) i quantity (baza ilościowa) — nowe pola kontraktu
  assert.equal(oferta.currency, 'PLN');
  assert.equal(oferta.quantity, 1);
  assert.equal(oferta.checkedAt, '2026-08-13');
  // sourceUrl wskazuje KONKRETNĄ stronę oferty (nie generyczny host)
  assert.equal(
    oferta.sourceUrl,
    'https://zakupy.biedronka.pl/mlekovita-mlekovita-mleko-uht-32-tluszczu-wypasione-1-l-0000000036.html',
  );
  assert.match(oferta.sourceUrl, /^https:\/\/zakupy\.biedronka\.pl\/.+\.html$/);
  // validUntil REALNY — echo terminu z rekordu, nie zmyślona data
  assert.equal(oferta.validUntil, '2026-12-31');
  // kompletny kontrakt: dokładnie 8 pól klienta (z currency i quantity)
  assert.deepEqual(Object.keys(oferta).sort(), [
    'checkedAt',
    'currency',
    'price',
    'quantity',
    'sourceUrl',
    'store',
    'unit',
    'validUntil',
  ]);
});

test('(a-kontrola) oferta WYGASŁA → pola ceny null (guard terminu działa, nie zawsze null)', () => {
  const teraz = new Date('2026-08-13T00:00:00Z');
  const rekord = {
    store: 'Biedronka',
    unit: 'l',
    price: 4.49,
    currency: 'PLN', // poprawna waluta i ilość — jedyną wadą jest wygasły termin
    quantity: 1,
    checkedAt: '2026-08-13',
    sourceUrl: 'https://zakupy.biedronka.pl/x-0000000036.html',
    validUntil: '2020-01-01', // przeszła → wygasła
  };

  const oferta = zbudujOfertePubliczna(rekord, teraz);

  // cała piątka money null (guard terminu zeruje ofertę mimo poprawnej waluty/ilości)
  assert.equal(oferta.price, null);
  assert.equal(oferta.currency, null);
  assert.equal(oferta.quantity, null);
  assert.equal(oferta.sourceUrl, null);
  assert.equal(oferta.validUntil, null);
  // pola informacyjne zostają
  assert.equal(oferta.store, 'Biedronka');
  assert.equal(oferta.unit, 'l');
  assert.equal(oferta.checkedAt, '2026-08-13');
});

// ── (b) BRAK produktu → 404 (pełna ścieżka HTTP) ──────────────────────────────

test('(b) brak produktu → 404', async () => {
  const { status, body } = await pobierz('Nieistniejacy Produkt 123');
  assert.equal(status, 404);
  assert.equal(body?.error?.code, 'NOT_FOUND');
});

test('(b-kontrola) brak/pusty productId → 400', async () => {
  const puste = await pobierz('');
  assert.equal(puste.status, 400);
  assert.equal(puste.body?.error?.code, 'BAD_REQUEST');

  const brak = await pobierz(undefined);
  assert.equal(brak.status, 400);
  assert.equal(brak.body?.error?.code, 'BAD_REQUEST');
});

// ── (c) oferta bez sourceUrl / validUntil → pola ceny null (HTTP, realne dane) ─

test('(c1) oferta bez sourceUrl (Cebula, priceKnown=false) → pola ceny null, nie zmyślone', async () => {
  const { status, body } = await pobierz('Cebula');
  assert.equal(status, 200);
  // money-path: piątka money NIEZNANA (cena/waluta/ilość/źródło/termin)
  assert.equal(body.price, null);
  assert.equal(body.currency, null);
  assert.equal(body.quantity, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // pola informacyjne obecne w kontrakcie
  assert.equal(body.unit, 'szt');
  assert.ok('store' in body && 'checkedAt' in body);
});

test('(c2) oferta bez validUntil (Mleko, ma sourceUrl w źródle) → pola ceny null, store/unit/checkedAt zostają', async () => {
  const { status, body } = await pobierz('Mleko');
  assert.equal(status, 200);
  // brak potwierdzonego terminu → NIE fabrykujemy: cała piątka money null
  assert.equal(body.price, null);
  assert.equal(body.currency, null);
  assert.equal(body.quantity, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // reszta pól informacyjnie zachowana
  assert.equal(body.store, 'Biedronka');
  assert.equal(body.unit, 'l');
  assert.equal(body.checkedAt, '2026-08-13');
  // pełny kontrakt 8 pól (z currency i quantity)
  assert.deepEqual(Object.keys(body).sort(), [
    'checkedAt',
    'currency',
    'price',
    'quantity',
    'sourceUrl',
    'store',
    'unit',
    'validUntil',
  ]);
});
