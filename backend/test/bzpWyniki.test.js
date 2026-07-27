import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Kolektor BZP „zwiadu cenowego" (services/bzpWyniki.js) — podzadanie 3/15.
 * Testujemy części BEZ sieci:
 *  • `wyodrebnijListe` — defensywne wyciąganie listy z różnych kształtów odpowiedzi,
 *  • `zbierzSurowe` — pętlę paginacji i „surowość" wyniku, z WSTRZYKNIĘTYM
 *    pobieraczem strony (żaden fetch nie leci).
 * Faktyczny HTTP (`pobierzStroneHttp`) jest wstrzykiwalny — tu go nie ruszamy.
 */

const { wyodrebnijListe, zbierzSurowe, zbierzOgloszeniaOWyniku, zbierzInformacjeZOtwarcia } =
  await import('../src/services/bzpWyniki.js');

// ── wyodrebnijListe ──────────────────────────────────────────────────────────

test('wyodrebnijListe: tablica przechodzi bez zmian', () => {
  const arr = [{ a: 1 }, { a: 2 }];
  assert.equal(wyodrebnijListe(arr), arr);
});

test('wyodrebnijListe: rozpoznaje warianty opakowania (content/items/notices/results/data)', () => {
  assert.deepEqual(wyodrebnijListe({ content: [1, 2] }), [1, 2]);
  assert.deepEqual(wyodrebnijListe({ items: [3] }), [3]);
  assert.deepEqual(wyodrebnijListe({ notices: [4] }), [4]);
  assert.deepEqual(wyodrebnijListe({ results: [5] }), [5]);
  assert.deepEqual(wyodrebnijListe({ data: [6] }), [6]);
});

test('wyodrebnijListe: nietypowy/pusty kształt => [] (nie wybucha)', () => {
  assert.deepEqual(wyodrebnijListe(null), []);
  assert.deepEqual(wyodrebnijListe({}), []);
  assert.deepEqual(wyodrebnijListe('cokolwiek'), []);
  assert.deepEqual(wyodrebnijListe({ content: 'nie-tablica' }), []);
});

// ── pomocnik: fałszywy pobieracz stron (bez sieci) ───────────────────────────

/** Zwraca stronę wg indeksu `page`; zapamiętuje argumenty każdego wywołania. */
function fakePager(stronyWgIndeksu) {
  const wywolania = [];
  const fn = async (args) => {
    wywolania.push(args);
    return stronyWgIndeksu[args.page] ?? [];
  };
  fn.wywolania = wywolania;
  return fn;
}

// ── zbierzSurowe: paginacja ──────────────────────────────────────────────────

test('zbierzSurowe: kumuluje strony aż do strony krótszej niż size (fail-safe)', async () => {
  const pager = fakePager([
    [{ id: 'a' }, { id: 'b' }], // pełna (== size) => leć dalej
    [{ id: 'c' }, { id: 'd' }], // pełna => leć dalej
    [{ id: 'e' }],              // < size => koniec
  ]);
  const wynik = await zbierzSurowe({ noticeType: 'ContractAwardNotice', pages: 9, size: 2, pobierzStrone: pager });

  assert.equal(wynik.strony, 3, 'przerwał po pierwszej niepełnej stronie');
  assert.equal(pager.wywolania.length, 3, 'czwartej strony już nie pobierał');
  assert.deepEqual(wynik.items.map((x) => x.id), ['a', 'b', 'c', 'd', 'e']);
});

test('zbierzSurowe: jedno duże zapytanie kończy się po jednej stronie', async () => {
  const pager = fakePager([[{ id: 'x' }, { id: 'y' }, { id: 'z' }]]); // 3 < 500
  const wynik = await zbierzSurowe({ noticeType: 'ContractAwardNotice', size: 500, pobierzStrone: pager });
  assert.equal(wynik.strony, 1);
  assert.equal(pager.wywolania.length, 1);
  assert.equal(wynik.items.length, 3);
});

test('zbierzSurowe: respektuje limit `pages` nawet gdy strony są pełne', async () => {
  const pelna = () => [{ id: '1' }, { id: '2' }];
  const pager = fakePager([pelna(), pelna(), pelna(), pelna()]);
  const wynik = await zbierzSurowe({ noticeType: 'ContractAwardNotice', pages: 2, size: 2, pobierzStrone: pager });
  assert.equal(wynik.strony, 2, 'zatrzymał się na limicie pages, nie leciał dalej');
  assert.equal(pager.wywolania.length, 2);
  assert.equal(wynik.items.length, 4);
});

test('zbierzSurowe: przekazuje poprawne parametry i przelicza page->PageNumber (od 1 w HTTP)', async () => {
  const pager = fakePager([[{}, {}], [{}]]); // dwie strony (druga niepełna)
  await zbierzSurowe({
    noticeType: 'ContractAwardNotice',
    publishedFrom: '2025-01-01',
    publishedTo: '2025-12-31',
    pages: 5,
    size: 2,
    pobierzStrone: pager,
  });
  assert.deepEqual(pager.wywolania[0], {
    noticeType: 'ContractAwardNotice', from: '2025-01-01', to: '2025-12-31', page: 0, size: 2,
  });
  assert.equal(pager.wywolania[1].page, 1, 'druga iteracja to page=1 (HTTP przeliczy na PageNumber=2)');
});

// ── zbierzSurowe: surowość i domyślne okno dat ───────────────────────────────

test('zbierzSurowe: zwraca ogłoszenia SUROWE — nic nie obcina ani nie mapuje', async () => {
  // Ogłoszenie z dużym htmlBody i nietypowymi polami. services/bzp.js by to
  // znormalizował i wyciął htmlBody; tutaj kolektor MUSI oddać 1:1.
  const surowe = { bzpNumber: '2025/BZP 00099', htmlBody: '<html>...</html>', dziwnePole: { x: [1, 2] } };
  const pager = fakePager([[surowe]]);
  const wynik = await zbierzSurowe({ noticeType: 'ContractAwardNotice', size: 500, pobierzStrone: pager });
  assert.equal(wynik.items.length, 1);
  assert.deepEqual(wynik.items[0], surowe, 'rekord oddany 1:1, z htmlBody i zagnieżdżeniami');
  assert.equal(wynik.items[0], surowe, 'ta sama referencja — brak jakiegokolwiek przetwarzania');
});

test('zbierzSurowe: domyślne okno dat to YYYY-MM-DD i from <= to', async () => {
  const pager = fakePager([[]]);
  const wynik = await zbierzSurowe({ noticeType: 'ContractAwardNotice', pobierzStrone: pager });
  assert.match(wynik.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(wynik.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(wynik.from <= wynik.to, 'okno lookback: from nie jest po to');
});

// ── typ nieskonfigurowany => pominięcie (bez zapytania) ──────────────────────

test('zbierzSurowe: pusty/whitespace typ => strumień pominięty, żaden fetch nie leci', async () => {
  const pager = fakePager([[{ id: 'nie-powinno-polecieć' }]]);
  for (const typ of [undefined, '', '   ']) {
    const wynik = await zbierzSurowe({ noticeType: typ, pobierzStrone: pager });
    assert.equal(wynik.pominieto, true);
    assert.equal(wynik.noticeType, null);
    assert.deepEqual(wynik.items, []);
    assert.equal(wynik.strony, 0);
  }
  assert.equal(pager.wywolania.length, 0, 'nie zgadujemy zapytania dla nieznanego typu');
});

// ── wrappery ─────────────────────────────────────────────────────────────────

test('zbierzOgloszeniaOWyniku: używa domyślnego typu ogłoszenia o wyniku', async () => {
  const pager = fakePager([[{ id: 'w1' }]]);
  const wynik = await zbierzOgloszeniaOWyniku({ size: 500, pobierzStrone: pager });
  assert.equal(pager.wywolania[0].noticeType, 'ContractAwardNotice');
  assert.equal(wynik.items[0].id, 'w1');
});

test('zbierzInformacjeZOtwarcia: bez skonfigurowanego typu jest pomijane (nie zmyśla źródła)', async () => {
  const pager = fakePager([[{ id: 'o1' }]]);
  const wynik = await zbierzInformacjeZOtwarcia({ pobierzStrone: pager });
  assert.equal(wynik.pominieto, true, 'typ otwarcia niepotwierdzony => skip do czasu ustawienia env');
  assert.equal(pager.wywolania.length, 0);
});
