import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * SmartSpiżarka — publiczny endpoint cen. TEST KONTRAKTU dla PIERWSZYCH
 * ZWERYFIKOWANYCH, AKTUALNYCH ofert (ulepszenie „Dodać pierwsze zweryfikowane,
 * aktualne ceny", podzadanie 3/4).
 *
 * Kontekst: podzadanie 2/4 dodało do produkcyjnego katalogu
 * `src/data/smartspizarka_prices.json` cztery oferty POTWIERDZONE na kartach
 * zakupy.biedronka.pl (2026-08-13) z realnym `sourceUrl` i przyszłym
 * `validUntil` (2026-09-30): "Mąka pszenna", "Cukier", "Masło", "Jajko".
 * Istniejący `smartspizarkaPrices.test.js` weryfikował pełną ofertę na
 * SYNTETYCZNYM rekordzie (bo wcześniej ŻADEN rekord produkcyjny nie miał
 * potwierdzonego terminu). Ten plik domyka lukę: dowodzi, że REALNE dane seeda
 * przechodzą guard prawdomówności i endpoint zwraca dla nich niepustą cenę.
 *
 * Dwa przypadki wprost z podzadania:
 *   (a) znany productId z ważnym sourceUrl i validUntil w przyszłości → 200 +
 *       NIEPUSTE price/unit/store/sourceUrl/validUntil.
 *   (b) productId z validUntil=null LUB bez sourceUrl → 200 + price/sourceUrl/
 *       validUntil = null (store/unit/checkedAt informacyjnie zostają).
 *
 * DYSCYPLINA MONEY-PATH / brak pułapki czasowej: „niepustą cenę" dowodzimy na
 * REALNYM rekordzie przez wyeksportowany budowniczy `zbudujOfertePubliczna(rekord,
 * teraz)` z INIEKCJĄ ZEGARA w oknie ważności (deterministycznie, ten sam kod, który
 * odpala handler: `res.json(zbudujOfertePubliczna(rekord))`). Żywą ścieżkę HTTP
 * sprawdzamy na status 200 + WIERNOŚĆ (body === budowniczy(rekord)) — to nie
 * zależy od realnej daty. Kontrola adwersaryjna (ten sam rekord + zegar PO
 * validUntil → null) broni przed „zawsze niepuste".
 *
 * UWAGA o kontrakcie pól: schemat mirrora to store/unit/price/checkedAt +
 * sourceUrl/validUntil (dokładnie to, czego oczekuje klient `PriceApiDto`).
 * `currency` NIE jest polem — waluta jest dorozumiana PLN. `quantity` NIE jest
 * polem — ilość jest dorozumiana przez `unit` (cena za 1 jednostkę bazową, np.
 * 1,79 zł / 1 kg). Dlatego asertujemy dokładnie ten 6-polowy kontrakt, a nie
 * nieistniejące `currency`/`quantity` (inaczej byłaby to fałszywa zieleń na
 * `undefined`).
 */

import { createApp } from '../src/app.js';
import { zbudujOfertePubliczna } from '../src/routes/smartspizarkaPrices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KATALOG = JSON.parse(
  readFileSync(join(__dirname, '../src/data/smartspizarka_prices.json'), 'utf8'),
);
const CENY = KATALOG.prices ?? {};

// Zegar w OKNIE ważności ofert 2/4 (validUntil = 2026-09-30) — data checkedAt.
const TERAZ_W_OKNIE = new Date('2026-08-13T00:00:00Z');
// Zegar PO wygaśnięciu — kontrola adwersaryjna „nie zawsze niepuste".
const TERAZ_PO_WYGASNIECIU = new Date('2026-12-31T00:00:00Z');

// Oferty potwierdzone w seedzie 2/4 (realny sourceUrl + przyszły validUntil).
const ZWERYFIKOWANE = ['Mąka pszenna', 'Cukier', 'Masło', 'Jajko'];

const PELNY_KONTRAKT = ['checkedAt', 'price', 'sourceUrl', 'store', 'unit', 'validUntil'];

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

// ── (a) ZNANY productId z ważnym źródłem i przyszłym validUntil → niepusta cena ──

test('(a1) REALNY rekord "Mąka pszenna" + zegar w oknie → wszystkie pola NIEPUSTE i poprawne', () => {
  const rekord = CENY['Mąka pszenna'];
  assert.ok(rekord, 'rekord "Mąka pszenna" musi istnieć w produkcyjnym katalogu');

  const oferta = zbudujOfertePubliczna(rekord, TERAZ_W_OKNIE);

  // price: niepusta, dodatnia, skończona (money-path: realna kwota)
  assert.equal(typeof oferta.price, 'number');
  assert.ok(Number.isFinite(oferta.price) && oferta.price > 0);
  assert.equal(oferta.price, 1.79);
  // unit / store: niepuste
  assert.equal(oferta.unit, 'kg');
  assert.equal(oferta.store, 'Biedronka');
  assert.equal(oferta.checkedAt, '2026-08-13');
  // sourceUrl: konkretna strona oferty (nie generyczny host)
  assert.equal(typeof oferta.sourceUrl, 'string');
  assert.match(oferta.sourceUrl, /^https:\/\/zakupy\.biedronka\.pl\/.+\.html$/);
  // validUntil: niepusty i REALNIE w przyszłości względem wstrzykniętego zegara
  assert.equal(typeof oferta.validUntil, 'string');
  assert.ok(new Date(oferta.validUntil).getTime() > TERAZ_W_OKNIE.getTime());
  assert.equal(oferta.validUntil, '2026-09-30');
  // dokładnie 6-polowy kontrakt (currency/quantity NIE są polami — patrz nagłówek)
  assert.deepEqual(Object.keys(oferta).sort(), PELNY_KONTRAKT);
});

test('(a1-adw) TEN SAM realny rekord + zegar PO validUntil → pola ceny null (guard, nie „zawsze niepuste")', () => {
  const rekord = CENY['Mąka pszenna'];
  const oferta = zbudujOfertePubliczna(rekord, TERAZ_PO_WYGASNIECIU);

  assert.equal(oferta.price, null);
  assert.equal(oferta.sourceUrl, null);
  assert.equal(oferta.validUntil, null);
  // pola informacyjne zostają
  assert.equal(oferta.store, 'Biedronka');
  assert.equal(oferta.unit, 'kg');
  assert.equal(oferta.checkedAt, '2026-08-13');
});

test('(a2) WSZYSTKIE zweryfikowane oferty 2/4 + zegar w oknie → niepusta cena + źródło + termin', () => {
  for (const id of ZWERYFIKOWANE) {
    const rekord = CENY[id];
    assert.ok(rekord, `rekord "${id}" musi istnieć w katalogu`);

    const oferta = zbudujOfertePubliczna(rekord, TERAZ_W_OKNIE);

    assert.ok(
      Number.isFinite(oferta.price) && oferta.price > 0,
      `${id}: price musi być niepusta i dodatnia (było ${oferta.price})`,
    );
    assert.ok(oferta.sourceUrl && oferta.sourceUrl.startsWith('https://'), `${id}: sourceUrl`);
    assert.ok(oferta.validUntil, `${id}: validUntil`);
    assert.ok(oferta.store, `${id}: store`);
    assert.ok(oferta.unit, `${id}: unit`);
    // termin realnie w przyszłości względem zegara
    assert.ok(
      new Date(oferta.validUntil).getTime() > TERAZ_W_OKNIE.getTime(),
      `${id}: validUntil musi być w przyszłości`,
    );
  }
});

test('(a3) ŻYWY HTTP GET "Mąka pszenna" → 200 + body WIERNIE = budowniczy(rekord)', async () => {
  const { status, body } = await pobierz('Mąka pszenna');

  assert.equal(status, 200);
  // Handler zwraca dokładnie `zbudujOfertePubliczna(rekord)` (zegar serwera) —
  // porównujemy z budowniczym uruchomionym na TYM SAMYM rekordzie i zegarze
  // domyślnym: deterministyczne niezależnie od realnej daty, bez pułapki czasowej.
  const oczekiwane = zbudujOfertePubliczna(CENY['Mąka pszenna']);
  assert.deepEqual(body, oczekiwane);
  // pełny 6-polowy kontrakt na żywej odpowiedzi
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});

// ── (b) validUntil=null LUB brak sourceUrl → 200 + price/sourceUrl/validUntil null ──

test('(b1) validUntil=null ("Mleko", MA sourceUrl w seedzie) → 200 + pola ceny null, reszta zostaje', async () => {
  // Kontrola danych: Mleko ma źródło, ale brak potwierdzonego terminu.
  assert.equal(CENY['Mleko'].validUntil, null);
  assert.ok(CENY['Mleko'].sourceUrl, 'Mleko ma sourceUrl w seedzie (izolujemy brak validUntil)');

  const { status, body } = await pobierz('Mleko');
  assert.equal(status, 200);
  // money-path: bez potwierdzonego terminu NIE fabrykujemy ceny/źródła/terminu
  assert.equal(body.price, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // pola informacyjne zachowane
  assert.equal(body.store, 'Biedronka');
  assert.equal(body.unit, 'l');
  assert.equal(body.checkedAt, '2026-08-13');
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});

test('(b2) brak sourceUrl ("Cebula") → 200 + pola ceny null', async () => {
  // Kontrola danych: Cebula bez źródła i bez terminu.
  assert.equal(CENY['Cebula'].sourceUrl, null);

  const { status, body } = await pobierz('Cebula');
  assert.equal(status, 200);
  assert.equal(body.price, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // pola informacyjne obecne w kontrakcie
  assert.equal(body.unit, 'szt');
  assert.ok('store' in body && 'checkedAt' in body);
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});
