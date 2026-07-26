import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ID_POL,
  POLA_ZOBOWIAZANIA,
  szablonZobowiazania,
  walidujKompletnoscZobowiazania,
  ID_SEKCJI_FORMULARZA,
  grupujPolaFormularza,
  ustawWartoscPola,
} from '../src/lib/zobowiazaniePodmiotu.js';

/*
 * MODEL „zobowiązanie podmiotu udostępniającego zasoby" (art. 118 ust. 4 Pzp) +
 * walidacja + wsparcie formularza kroku 2 kreatora „Pożycz doświadczenie".
 * Podzadanie 6/12.
 *
 * Model jest LUSTREM backendu (`backend/src/lib/zobowiazaniePodmiotu.js`); mobile
 * nie importuje backendu, więc test pilnuje tego samego KONTRAKTU po tej stronie:
 * które pola są wymagane orzecznictwem i że `walidujKompletnoscZobowiazania`
 * rzetelnie wskazuje braki. Osobno testujemy helpery formularza (`grupujPolaFormularza`,
 * `ustawWartoscPola`), bo to na nich stoi cienki ekran — logika żyje tu, nie w renderze.
 */

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
      'Budowa oczyszczalni ścieków o przepustowości min. 5000 m³/d (jedna realizacja).',
    sposob_udostepnienia: 'Udział jako podwykonawca robót technologicznych oraz nadzór kadry.',
    okres_udostepnienia: 'Przez cały okres realizacji zamówienia (18 miesięcy).',
    zakres_podwykonawstwa: 'Wykonanie części technologicznej oczyszczalni (montaż i rozruch).',
  };
}

// ── model: parytet z backendem (kontrakt art. 118 ust. 4) ────────────────────

test('ID_POL zawiera pola wymagane orzecznictwem i jest zamrożony', () => {
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

test('POLA_ZOBOWIAZANIA to niepusta, głęboko zamrożona tablica kompletnych pól', () => {
  assert.ok(Array.isArray(POLA_ZOBOWIAZANIA));
  assert.ok(POLA_ZOBOWIAZANIA.length >= 5);
  assert.ok(Object.isFrozen(POLA_ZOBOWIAZANIA));
  assert.throws(() => POLA_ZOBOWIAZANIA.push({ id: 'x' }), TypeError);
  for (const p of POLA_ZOBOWIAZANIA) {
    assert.ok(Object.isFrozen(p), `pole ${p.id} nie zamrożone`);
    for (const pole of ['id', 'etykieta', 'opis', 'podstawa']) {
      assert.equal(typeof p[pole], 'string', `pole ${pole} nie jest stringiem w ${p.id}`);
      assert.ok(p[pole].trim().length > 0, `puste ${pole} w ${p.id}`);
    }
    assert.equal(typeof p.wymagane, 'boolean', `wymagane nie jest boolean w ${p.id}`);
    assert.ok(Array.isArray(p.sciezka) && p.sciezka.length >= 1, `zła ścieżka w ${p.id}`);
  }
});

test('id pól są unikalne', () => {
  const ids = POLA_ZOBOWIAZANIA.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'zduplikowane id pola');
});

test('model pokrywa obszary wymagane przez art. 118 ust. 4', () => {
  const sciezki = POLA_ZOBOWIAZANIA.filter((p) => p.wymagane).map((p) => p.sciezka.join('.'));
  for (const sc of [
    'dane_podmiotu.nazwa',
    'dane_podmiotu.identyfikator',
    'zakres_doswiadczenia',
    'sposob_udostepnienia',
    'okres_udostepnienia',
    'zakres_podwykonawstwa',
  ]) {
    assert.ok(sciezki.includes(sc), `pole wymagane nie obejmuje ${sc}`);
  }
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

// ── szablon (pusty draft do wypełnienia w formularzu) ────────────────────────

test('szablonZobowiazania zwraca pusty draft ze wszystkimi ścieżkami', () => {
  const s = szablonZobowiazania();
  assert.equal(s.dane_podmiotu.nazwa, '');
  assert.equal(s.dane_podmiotu.identyfikator, '');
  assert.equal(s.zakres_doswiadczenia, '');
  assert.equal(s.sposob_udostepnienia, '');
  assert.equal(s.okres_udostepnienia, '');
  assert.equal(s.zakres_podwykonawstwa, '');
});

test('szablonZobowiazania zwraca niezależne instancje', () => {
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

test('braki niosą etykietę i id pola (dla formularza)', () => {
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
  for (const o of w.ostrzezenia) assert.ok(typeof o.powod === 'string' && o.powod.trim().length > 0);
});

test('walidacja rzuca TypeError dla nie-obiektu', () => {
  assert.throws(() => walidujKompletnoscZobowiazania(null), TypeError);
  assert.throws(() => walidujKompletnoscZobowiazania('zobowiązanie'), TypeError);
  assert.throws(() => walidujKompletnoscZobowiazania([]), TypeError);
});

test('wynik walidacji jest zamrożony (migawka)', () => {
  const w = walidujKompletnoscZobowiazania(szablonZobowiazania());
  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.braki));
  assert.ok(Object.isFrozen(w.ostrzezenia));
  assert.throws(() => w.braki.push({}), TypeError);
});

// ── wsparcie formularza: grupowanie pól w dwie sekcje ────────────────────────

test('grupujPolaFormularza zwraca dwie sekcje w stabilnej kolejności', () => {
  const sekcje = grupujPolaFormularza();
  assert.equal(sekcje.length, 2);
  assert.deepEqual(
    sekcje.map((s) => s.id),
    [ID_SEKCJI_FORMULARZA.DANE_PODMIOTU, ID_SEKCJI_FORMULARZA.ZAKRES_UDOSTEPNIENIA],
  );
  for (const s of sekcje) {
    assert.ok(s.tytul.trim().length > 0, `sekcja ${s.id} bez tytułu`);
    assert.ok(Array.isArray(s.pola) && s.pola.length > 0, `sekcja ${s.id} bez pól`);
  }
});

test('grupujPolaFormularza rozdziela dane podmiotu od zakresu i nie gubi żadnego pola', () => {
  const [podmiot, zakres] = grupujPolaFormularza();
  assert.ok(podmiot.pola.every((p) => p.sciezka[0] === 'dane_podmiotu'));
  assert.ok(zakres.pola.every((p) => p.sciezka.length === 1));
  // Suma pól obu sekcji = pełny model (żadne pole nie wypada z formularza).
  const wSekcjach = [...podmiot.pola, ...zakres.pola].map((p) => p.id).sort();
  const wModelu = POLA_ZOBOWIAZANIA.map((p) => p.id).sort();
  assert.deepEqual(wSekcjach, wModelu);
});

test('sekcja „zakres" niesie cztery elementy wymagane przez art. 118 ust. 4', () => {
  const [, zakres] = grupujPolaFormularza();
  const ids = zakres.pola.map((p) => p.id);
  assert.deepEqual(ids, [
    ID_POL.ZAKRES_DOSWIADCZENIA,
    ID_POL.SPOSOB_UDOSTEPNIENIA,
    ID_POL.OKRES_UDOSTEPNIENIA,
    ID_POL.ZAKRES_PODWYKONAWSTWA,
  ]);
});

// ── wsparcie formularza: niemutujący zapis po ścieżce ────────────────────────

test('ustawWartoscPola zapisuje pole zagnieżdżone nie mutując oryginału', () => {
  const draft = szablonZobowiazania();
  const nowy = ustawWartoscPola(draft, ['dane_podmiotu', 'nazwa'], 'Budrem');
  assert.equal(nowy.dane_podmiotu.nazwa, 'Budrem');
  assert.equal(draft.dane_podmiotu.nazwa, '', 'oryginał został zmutowany');
  assert.notEqual(nowy, draft, 'nie zwrócono nowego obiektu');
  assert.notEqual(nowy.dane_podmiotu, draft.dane_podmiotu, 'gałąź nie została sklonowana');
});

test('ustawWartoscPola zapisuje pole na pierwszym poziomie', () => {
  const draft = szablonZobowiazania();
  const nowy = ustawWartoscPola(draft, ['zakres_doswiadczenia'], 'budowa mostu');
  assert.equal(nowy.zakres_doswiadczenia, 'budowa mostu');
  assert.equal(draft.zakres_doswiadczenia, '');
});

test('ustawWartoscPola nie tyka gałęzi obok zmienianego pola', () => {
  const draft = ustawWartoscPola(szablonZobowiazania(), ['dane_podmiotu', 'nazwa'], 'A');
  const referencjaOkres = draft.okres_udostepnienia;
  const nowy = ustawWartoscPola(draft, ['dane_podmiotu', 'identyfikator'], 'NIP 1');
  assert.equal(nowy.dane_podmiotu.nazwa, 'A', 'zgubiono wcześniejszą wartość rodzeństwa');
  assert.equal(nowy.dane_podmiotu.identyfikator, 'NIP 1');
  assert.equal(nowy.okres_udostepnienia, referencjaOkres, 'niepowiązana gałąź zmieniona');
});

test('kolejne zapisy przez ustawWartoscPola dają draft, który przechodzi walidację', () => {
  let draft = szablonZobowiazania();
  const pelne = zobowiazaniePelne();
  for (const pole of POLA_ZOBOWIAZANIA) {
    let wartosc = pelne;
    for (const seg of pole.sciezka) wartosc = wartosc[seg];
    draft = ustawWartoscPola(draft, pole.sciezka, wartosc);
  }
  const w = walidujKompletnoscZobowiazania(draft);
  assert.equal(w.kompletne, true);
  assert.deepEqual(w.braki, []);
});

test('ustawWartoscPola rzuca TypeError dla pustej lub błędnej ścieżki', () => {
  assert.throws(() => ustawWartoscPola({}, [], 'x'), TypeError);
  assert.throws(() => ustawWartoscPola({}, 'nazwa', 'x'), TypeError);
});
