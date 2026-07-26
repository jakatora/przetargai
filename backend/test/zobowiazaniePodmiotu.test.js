import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * MODEL DANYCH „zobowiązanie podmiotu udostępniającego zasoby" (art. 118 ust. 4
 * Pzp) + walidacja kompletności pól — podzadanie 4/12 ulepszenia „Pożycz
 * doświadczenie: kreator polegania na zasobach podmiotu trzeciego".
 *
 * Testy pilnują KONTRAKTU, na którym oprze się generator zobowiązania (kolejne
 * podzadania): jakie pola są WYMAGANE orzecznictwem (dane podmiotu, zakres
 * udostępnianego doświadczenia, sposób, okres, zakres podwykonawstwa) oraz że
 * `walidujKompletnoscZobowiazania` rzetelnie wskazuje braki — inaczej kreator
 * wypuściłby blankietowe zobowiązanie, które KIO uzna za fikcyjne.
 */

const {
  ID_POL,
  POLA_ZOBOWIAZANIA,
  szablonZobowiazania,
  walidujKompletnoscZobowiazania,
} = await import('../src/lib/zobowiazaniePodmiotu.js');

/** Kompletne, poprawne zobowiązanie — punkt odniesienia dla testów. */
function zobowiazaniePelne() {
  return {
    dane_podmiotu: {
      nazwa: 'Budrem Sp. z o.o.',
      identyfikator: 'NIP 5252525252',
      adres: 'ul. Budowlana 1, 00-001 Warszawa',
      reprezentant: 'Jan Kowalski, prezes zarządu',
    },
    zakres_doswiadczenia:
      'Doświadczenie w budowie oczyszczalni ścieków o przepustowości min. 5000 m³/d '
      + '(jedna zakończona realizacja o wartości 6,2 mln zł).',
    sposob_udostepnienia:
      'Udział podmiotu w realizacji zamówienia jako podwykonawca robót '
      + 'technologicznych oczyszczalni oraz nadzór jego kadry nad tym zakresem.',
    okres_udostepnienia: 'Przez cały okres realizacji zamówienia, tj. 18 miesięcy od podpisania umowy.',
    zakres_podwykonawstwa:
      'Wykonanie części technologicznej oczyszczalni (montaż i rozruch ciągu '
      + 'technologicznego) — zakres, dla którego wymagane jest udostępniane doświadczenie.',
  };
}

// ── model: rejestr identyfikatorów pól ───────────────────────────────────────

test('ID_POL zawiera pola wymagane orzecznictwem (art. 118 ust. 4)', () => {
  assert.equal(typeof ID_POL, 'object');
  for (const klucz of [
    'DANE_PODMIOTU_NAZWA',
    'DANE_PODMIOTU_IDENTYFIKATOR',
    'ZAKRES_DOSWIADCZENIA',
    'SPOSOB_UDOSTEPNIENIA',
    'OKRES_UDOSTEPNIENIA',
    'ZAKRES_PODWYKONAWSTWA',
  ]) {
    assert.ok(klucz in ID_POL, `brak ID_POL.${klucz}`);
    assert.ok(typeof ID_POL[klucz] === 'string' && ID_POL[klucz].length > 0);
  }
  assert.ok(Object.isFrozen(ID_POL));
});

// ── model: opis pól (deklaratywny „model danych") ────────────────────────────

test('POLA_ZOBOWIAZANIA to niepusta, głęboko zamrożona tablica', () => {
  assert.ok(Array.isArray(POLA_ZOBOWIAZANIA));
  assert.ok(POLA_ZOBOWIAZANIA.length >= 5);
  assert.ok(Object.isFrozen(POLA_ZOBOWIAZANIA));
  for (const p of POLA_ZOBOWIAZANIA) assert.ok(Object.isFrozen(p), `pole ${p.id} nie zamrożone`);
  assert.throws(() => POLA_ZOBOWIAZANIA.push({ id: 'x' }), TypeError);
});

test('każde pole ma id, etykietę, opis, podstawę, flagę wymagane i ścieżkę', () => {
  for (const p of POLA_ZOBOWIAZANIA) {
    for (const pole of ['id', 'etykieta', 'opis', 'podstawa']) {
      assert.equal(typeof p[pole], 'string', `pole ${pole} nie jest stringiem w ${p.id}`);
      assert.ok(p[pole].trim().length > 0, `puste ${pole} w ${p.id}`);
    }
    assert.equal(typeof p.wymagane, 'boolean', `wymagane nie jest boolean w ${p.id}`);
    assert.ok(Array.isArray(p.sciezka) && p.sciezka.length >= 1, `zła ścieżka w ${p.id}`);
    for (const seg of p.sciezka) assert.ok(typeof seg === 'string' && seg.length > 0);
  }
});

test('id pól są unikalne', () => {
  const ids = POLA_ZOBOWIAZANIA.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'zduplikowane id pola');
});

test('model pokrywa pięć obszarów wymaganych przez art. 118 ust. 4', () => {
  const wymagane = POLA_ZOBOWIAZANIA.filter((p) => p.wymagane);
  const sciezki = wymagane.map((p) => p.sciezka.join('.'));
  // dane podmiotu (co najmniej nazwa i identyfikator do identyfikacji)
  assert.ok(sciezki.includes('dane_podmiotu.nazwa'));
  assert.ok(sciezki.includes('dane_podmiotu.identyfikator'));
  // cztery pola treściowe zobowiązania
  assert.ok(sciezki.includes('zakres_doswiadczenia'));
  assert.ok(sciezki.includes('sposob_udostepnienia'));
  assert.ok(sciezki.includes('okres_udostepnienia'));
  assert.ok(sciezki.includes('zakres_podwykonawstwa'));
});

test('pola treściowe zobowiązania powołują art. 118 ust. 4 Pzp jako podstawę', () => {
  for (const id of [
    ID_POL.ZAKRES_DOSWIADCZENIA,
    ID_POL.SPOSOB_UDOSTEPNIENIA,
    ID_POL.OKRES_UDOSTEPNIENIA,
    ID_POL.ZAKRES_PODWYKONAWSTWA,
  ]) {
    const p = POLA_ZOBOWIAZANIA.find((x) => x.id === id);
    assert.ok(p, `brak pola o id ${id}`);
    assert.match(p.podstawa, /art\.\s*118\s*ust\.\s*4/i, `pole ${id} nie powołuje art. 118 ust. 4`);
  }
});

// ── szablon (pusty draft do wypełnienia w UI) ────────────────────────────────

test('szablonZobowiazania zwraca obiekt ze wszystkimi ścieżkami i pustymi wartościami', () => {
  const s = szablonZobowiazania();
  assert.equal(typeof s.dane_podmiotu, 'object');
  assert.equal(s.dane_podmiotu.nazwa, '');
  assert.equal(s.dane_podmiotu.identyfikator, '');
  assert.equal(s.zakres_doswiadczenia, '');
  assert.equal(s.sposob_udostepnienia, '');
  assert.equal(s.okres_udostepnienia, '');
  assert.equal(s.zakres_podwykonawstwa, '');
});

test('szablonZobowiazania jest mutowalny i zwraca niezależne instancje', () => {
  const a = szablonZobowiazania();
  const b = szablonZobowiazania();
  a.zakres_doswiadczenia = 'coś';
  a.dane_podmiotu.nazwa = 'Firma';
  assert.equal(b.zakres_doswiadczenia, '', 'instancje współdzielą stan');
  assert.equal(b.dane_podmiotu.nazwa, '', 'zagnieżdżony obiekt współdzielony');
});

// ── walidacja kompletności ───────────────────────────────────────────────────

test('pusty szablon jest niekompletny i wskazuje wszystkie wymagane braki', () => {
  const w = walidujKompletnoscZobowiazania(szablonZobowiazania());
  assert.equal(w.kompletne, false);
  const brakiSciezki = w.braki.map((b) => b.sciezka);
  for (const sc of [
    'dane_podmiotu.nazwa',
    'dane_podmiotu.identyfikator',
    'zakres_doswiadczenia',
    'sposob_udostepnienia',
    'okres_udostepnienia',
    'zakres_podwykonawstwa',
  ]) {
    assert.ok(brakiSciezki.includes(sc), `brak nie obejmuje ${sc}`);
  }
});

test('kompletne zobowiązanie przechodzi walidację bez braków', () => {
  const w = walidujKompletnoscZobowiazania(zobowiazaniePelne());
  assert.equal(w.kompletne, true);
  assert.deepEqual(w.braki, []);
});

test('brak zakresu podwykonawstwa czyni zobowiązanie niekompletnym', () => {
  const z = zobowiazaniePelne();
  z.zakres_podwykonawstwa = '';
  const w = walidujKompletnoscZobowiazania(z);
  assert.equal(w.kompletne, false);
  assert.ok(w.braki.some((b) => b.sciezka === 'zakres_podwykonawstwa'));
});

test('wartość z samych spacji liczy się jako brak', () => {
  const z = zobowiazaniePelne();
  z.okres_udostepnienia = '   ';
  const w = walidujKompletnoscZobowiazania(z);
  assert.equal(w.kompletne, false);
  assert.ok(w.braki.some((b) => b.sciezka === 'okres_udostepnienia'));
});

test('braki niosą etykietę i id pola (dla UI)', () => {
  const w = walidujKompletnoscZobowiazania(szablonZobowiazania());
  for (const b of w.braki) {
    assert.ok(typeof b.id === 'string' && b.id.length > 0);
    assert.ok(typeof b.etykieta === 'string' && b.etykieta.trim().length > 0);
    assert.ok(typeof b.sciezka === 'string' && b.sciezka.length > 0);
  }
});

test('pola zalecane (adres, reprezentant) dają ostrzeżenia, nie blokują kompletności', () => {
  const z = zobowiazaniePelne();
  z.dane_podmiotu.adres = '';
  z.dane_podmiotu.reprezentant = '';
  const w = walidujKompletnoscZobowiazania(z);
  assert.equal(w.kompletne, true, 'zalecane pole nie może blokować kompletności');
  const ostrzSciezki = w.ostrzezenia.map((o) => o.sciezka);
  assert.ok(ostrzSciezki.includes('dane_podmiotu.adres'));
  assert.ok(ostrzSciezki.includes('dane_podmiotu.reprezentant'));
});

test('brakujący zagnieżdżony dane_podmiotu nie wysypuje walidacji', () => {
  const w = walidujKompletnoscZobowiazania({
    zakres_doswiadczenia: 'x',
    sposob_udostepnienia: 'x',
    okres_udostepnienia: 'x',
    zakres_podwykonawstwa: 'x',
  });
  assert.equal(w.kompletne, false);
  const brakiSciezki = w.braki.map((b) => b.sciezka);
  assert.ok(brakiSciezki.includes('dane_podmiotu.nazwa'));
  assert.ok(brakiSciezki.includes('dane_podmiotu.identyfikator'));
});

test('walidacja rzuca TypeError dla nie-obiektu', () => {
  assert.throws(() => walidujKompletnoscZobowiazania(null), TypeError);
  assert.throws(() => walidujKompletnoscZobowiazania('zobowiązanie'), TypeError);
  assert.throws(() => walidujKompletnoscZobowiazania([]), TypeError);
});

test('wynik walidacji jest zamrożony (migawka, nie „poprawia się")', () => {
  const w = walidujKompletnoscZobowiazania(szablonZobowiazania());
  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.braki));
  assert.ok(Object.isFrozen(w.ostrzezenia));
  assert.throws(() => w.braki.push({}), TypeError);
});
