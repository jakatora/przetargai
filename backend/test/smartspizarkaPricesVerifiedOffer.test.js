import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/*
 * SmartSpiżarka — publiczny endpoint cen. TEST KONTRAKTU dla ZWERYFIKOWANYCH,
 * AKTUALNYCH ofert po ROZSZERZENIU kontraktu o WALUTĘ i ILOŚĆ (ulepszenie
 * „Uzupełnienie kontraktu cen o walutę i ilość", podzadanie 5/6).
 *
 * Kontekst: krok 2/6 dopisał do KAŻDEGO rekordu produkcyjnego katalogu
 * `src/data/smartspizarka_prices.json` pola `currency:"PLN"` i `quantity`
 * (ilość, za którą podana jest `price` — 1 dla ceny znormalizowanej per 1 kg /
 * 1 l / 1 szt.). Krok 3/6 zaostrzył guard `zbudujOfertePubliczna`: oferta jest
 * WIARYGODNA (publikujemy kwotę) WYŁĄCZNIE gdy jednocześnie
 *   `price > 0` && `quantity > 0` && `currency ∈ {PLN}` && `unit` niepuste &&
 *   realny `sourceUrl` && `validUntil` w przyszłości.
 * Inaczej cała PIĄTKA money — `price`, `currency`, `quantity`, `sourceUrl`,
 * `validUntil` — = null (cena nieznana); `store`/`unit`/`checkedAt` zostają
 * informacyjnie.
 *
 * Dwa przypadki wprost z podzadania 5/6:
 *   (a) KOMPLETNY rekord (ważny sourceUrl + przyszły validUntil + dodatnie
 *       price/quantity + obsługiwana waluta + niepuste unit) → 200 + NIEPUSTE
 *       price/currency/quantity/unit/store/sourceUrl/validUntil.
 *   (b) rekord z brakiem quantity/currency albo quantity<=0 / waluta
 *       nieobsługiwana → cena NIEZNANA (piątka money = null) MIMO poprawnego
 *       sourceUrl i przyszłego validUntil.
 *
 * DYSCYPLINA MONEY-PATH / brak pułapki czasowej: „niepustą cenę" dowodzimy na
 * REALNYM rekordzie przez wyeksportowany budowniczy `zbudujOfertePubliczna(rekord,
 * teraz)` z INIEKCJĄ ZEGARA w oknie ważności (deterministycznie, ten sam kod, który
 * odpala handler: `res.json(zbudujOfertePubliczna(rekord))`). Żywą ścieżkę HTTP
 * sprawdzamy na status 200 + WIERNOŚĆ (body === budowniczy(rekord)) — to nie
 * zależy od realnej daty. Kontrole adwersaryjne (ten sam rekord + zegar PO
 * validUntil → null; kompletny rekord z zepsutym quantity/currency → null)
 * bronią przed „zawsze niepuste".
 *
 * KONTRAKT PÓL (8): store/unit/price/currency/quantity/checkedAt/sourceUrl/
 * validUntil — dokładnie to, czego oczekuje klient `PriceApiDto.fromJson`.
 * `currency` (kod ISO, na start tylko PLN) i `quantity` (baza ilościowa ceny) są
 * teraz JAWNYMI polami; asertujemy dokładnie ten 8-polowy kontrakt.
 */

import { createApp } from '../src/app.js';
import { zbudujOfertePubliczna } from '../src/routes/smartspizarkaPrices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KATALOG = JSON.parse(
  readFileSync(join(__dirname, '../src/data/smartspizarka_prices.json'), 'utf8'),
);
const CENY = KATALOG.prices ?? {};

// Zegar w OKNIE ważności ofert (validUntil = 2026-09-30) — data checkedAt.
const TERAZ_W_OKNIE = new Date('2026-08-13T00:00:00Z');
// Zegar PO wygaśnięciu — kontrola adwersaryjna „nie zawsze niepuste".
const TERAZ_PO_WYGASNIECIU = new Date('2026-12-31T00:00:00Z');

// Oferty potwierdzone w seedzie (realny sourceUrl + przyszły validUntil).
const ZWERYFIKOWANE = ['Mąka pszenna', 'Cukier', 'Masło', 'Jajko'];

// Kontrakt 8-polowy (posortowane klucze) — z currency i quantity.
const PELNY_KONTRAKT = [
  'checkedAt', 'currency', 'price', 'quantity',
  'sourceUrl', 'store', 'unit', 'validUntil',
];

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

// ── (a) KOMPLETNY rekord → niepusta cena + waluta + ilość ─────────────────────

test('(a1) REALNY rekord "Mąka pszenna" + zegar w oknie → wszystkie pola NIEPUSTE i poprawne', () => {
  const rekord = CENY['Mąka pszenna'];
  assert.ok(rekord, 'rekord "Mąka pszenna" musi istnieć w produkcyjnym katalogu');

  const oferta = zbudujOfertePubliczna(rekord, TERAZ_W_OKNIE);

  // price: niepusta, dodatnia, skończona (money-path: realna kwota)
  assert.equal(typeof oferta.price, 'number');
  assert.ok(Number.isFinite(oferta.price) && oferta.price > 0);
  assert.equal(oferta.price, 1.79);
  // currency: niepusta, obsługiwana (PLN)
  assert.equal(oferta.currency, 'PLN');
  // quantity: niepusta, dodatnia (baza ilościowa ceny)
  assert.equal(typeof oferta.quantity, 'number');
  assert.ok(Number.isFinite(oferta.quantity) && oferta.quantity > 0);
  assert.equal(oferta.quantity, 1);
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
  // dokładnie 8-polowy kontrakt (z currency/quantity)
  assert.deepEqual(Object.keys(oferta).sort(), PELNY_KONTRAKT);
});

test('(a1-adw) TEN SAM realny rekord + zegar PO validUntil → piątka money null (guard, nie „zawsze niepuste")', () => {
  const rekord = CENY['Mąka pszenna'];
  const oferta = zbudujOfertePubliczna(rekord, TERAZ_PO_WYGASNIECIU);

  // cała piątka money nieznana
  assert.equal(oferta.price, null);
  assert.equal(oferta.currency, null);
  assert.equal(oferta.quantity, null);
  assert.equal(oferta.sourceUrl, null);
  assert.equal(oferta.validUntil, null);
  // pola informacyjne zostają
  assert.equal(oferta.store, 'Biedronka');
  assert.equal(oferta.unit, 'kg');
  assert.equal(oferta.checkedAt, '2026-08-13');
  // kontrakt pól niezmienny nawet przy cenie nieznanej
  assert.deepEqual(Object.keys(oferta).sort(), PELNY_KONTRAKT);
});

test('(a2) WSZYSTKIE zweryfikowane oferty + zegar w oknie → niepusta cena + waluta + ilość + źródło + termin', () => {
  for (const id of ZWERYFIKOWANE) {
    const rekord = CENY[id];
    assert.ok(rekord, `rekord "${id}" musi istnieć w katalogu`);

    const oferta = zbudujOfertePubliczna(rekord, TERAZ_W_OKNIE);

    assert.ok(
      Number.isFinite(oferta.price) && oferta.price > 0,
      `${id}: price musi być niepusta i dodatnia (było ${oferta.price})`,
    );
    assert.equal(oferta.currency, 'PLN', `${id}: currency musi być PLN`);
    assert.ok(
      Number.isFinite(oferta.quantity) && oferta.quantity > 0,
      `${id}: quantity musi być niepusta i dodatnia (było ${oferta.quantity})`,
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

test('(a3) ŻYWY HTTP GET "Mąka pszenna" → 200 + body WIERNIE = budowniczy(rekord), niepuste currency/quantity', async () => {
  const { status, body } = await pobierz('Mąka pszenna');

  assert.equal(status, 200);
  // Handler zwraca dokładnie `zbudujOfertePubliczna(rekord)` (zegar serwera) —
  // porównujemy z budowniczym uruchomionym na TYM SAMYM rekordzie i zegarze
  // domyślnym: deterministyczne niezależnie od realnej daty, bez pułapki czasowej.
  const oczekiwane = zbudujOfertePubliczna(CENY['Mąka pszenna']);
  assert.deepEqual(body, oczekiwane);
  // na żywej odpowiedzi: waluta i ilość NIEPUSTE (nowy kontrakt) + pełne 8 pól
  assert.equal(body.currency, 'PLN');
  assert.ok(Number.isFinite(body.quantity) && body.quantity > 0);
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});

// ── (b) niekompletna oferta (quantity/currency) → piątka money null ───────────

test('(b0) KOMPLETNY rekord z zepsutym quantity/currency → piątka money null MIMO ważnego sourceUrl i przyszłego validUntil', () => {
  // Rekord bazowy: wszystko poprawne i w oknie ważności → kontrola POZYTYWNA.
  const bazowy = () => ({
    store: 'Biedronka',
    unit: 'kg',
    price: 1.79,
    currency: 'PLN',
    quantity: 1,
    checkedAt: '2026-08-13',
    sourceUrl: 'https://zakupy.biedronka.pl/produkt-0000000072.html',
    validUntil: '2026-09-30', // przyszły względem TERAZ_W_OKNIE
  });

  // KONTROLA POZYTYWNA: nieruszony rekord bazowy → cena znana (dowodzi, że to
  // zepsucie quantity/currency, a nie sam guard terminu/źródła, zeruje ofertę).
  const ok = zbudujOfertePubliczna(bazowy(), TERAZ_W_OKNIE);
  assert.equal(ok.price, 1.79);
  assert.equal(ok.currency, 'PLN');
  assert.equal(ok.quantity, 1);
  assert.ok(ok.sourceUrl && ok.validUntil, 'kontrola pozytywna: źródło i termin obecne');

  // Każda mutacja psuje WYŁĄCZNIE quantity lub currency — sourceUrl i validUntil
  // pozostają POPRAWNE, więc dowodzimy, że to nowy warunek guarda zeruje ofertę.
  const NIEKOMPLETNE = [
    ['brak quantity', (r) => { delete r.quantity; }],
    ['quantity = 0', (r) => { r.quantity = 0; }],
    ['quantity < 0', (r) => { r.quantity = -1; }],
    ['quantity nieliczbowe', (r) => { r.quantity = '1'; }],
    ['brak currency', (r) => { delete r.currency; }],
    ['currency nieobsługiwana (USD)', (r) => { r.currency = 'USD'; }],
    ['currency nieobsługiwana (EUR)', (r) => { r.currency = 'EUR'; }],
    ['currency pusta', (r) => { r.currency = '  '; }],
  ];

  for (const [opis, zepsuj] of NIEKOMPLETNE) {
    const rekord = bazowy();
    // Sanity: przed zepsuciem źródło i termin są poprawne (izolujemy przyczynę).
    assert.ok(rekord.sourceUrl, `${opis}: rekord bazowy MA sourceUrl`);
    assert.ok(rekord.validUntil, `${opis}: rekord bazowy MA validUntil`);
    zepsuj(rekord);

    const oferta = zbudujOfertePubliczna(rekord, TERAZ_W_OKNIE);

    // money-path: cała piątka money = null (cena nieznana), mimo ważnego źródła/terminu
    assert.equal(oferta.price, null, `${opis}: price null`);
    assert.equal(oferta.currency, null, `${opis}: currency null`);
    assert.equal(oferta.quantity, null, `${opis}: quantity null`);
    assert.equal(oferta.sourceUrl, null, `${opis}: sourceUrl null (nie fabrykujemy przy niekompletnej ofercie)`);
    assert.equal(oferta.validUntil, null, `${opis}: validUntil null`);
    // pola informacyjne zostają
    assert.equal(oferta.store, 'Biedronka', `${opis}: store informacyjnie`);
    assert.equal(oferta.unit, 'kg', `${opis}: unit informacyjnie`);
    assert.equal(oferta.checkedAt, '2026-08-13', `${opis}: checkedAt informacyjnie`);
    assert.deepEqual(Object.keys(oferta).sort(), PELNY_KONTRAKT, `${opis}: kontrakt 8 pól`);
  }
});

// ── (b) brak validUntil / brak sourceUrl → 200 + piątka money null (HTTP) ─────

test('(b1) validUntil=null ("Mleko", MA sourceUrl w seedzie) → 200 + piątka money null, reszta zostaje', async () => {
  // Kontrola danych: Mleko ma źródło, ale brak potwierdzonego terminu.
  assert.equal(CENY['Mleko'].validUntil, null);
  assert.ok(CENY['Mleko'].sourceUrl, 'Mleko ma sourceUrl w seedzie (izolujemy brak validUntil)');

  const { status, body } = await pobierz('Mleko');
  assert.equal(status, 200);
  // money-path: bez potwierdzonego terminu NIE fabrykujemy piątki money
  assert.equal(body.price, null);
  assert.equal(body.currency, null);
  assert.equal(body.quantity, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // pola informacyjne zachowane
  assert.equal(body.store, 'Biedronka');
  assert.equal(body.unit, 'l');
  assert.equal(body.checkedAt, '2026-08-13');
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});

test('(b2) brak sourceUrl ("Cebula") → 200 + piątka money null', async () => {
  // Kontrola danych: Cebula bez źródła i bez terminu.
  assert.equal(CENY['Cebula'].sourceUrl, null);

  const { status, body } = await pobierz('Cebula');
  assert.equal(status, 200);
  assert.equal(body.price, null);
  assert.equal(body.currency, null);
  assert.equal(body.quantity, null);
  assert.equal(body.sourceUrl, null);
  assert.equal(body.validUntil, null);
  // pola informacyjne obecne w kontrakcie
  assert.equal(body.unit, 'szt');
  assert.ok('store' in body && 'checkedAt' in body);
  assert.deepEqual(Object.keys(body).sort(), PELNY_KONTRAKT);
});
