import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * KONTRAKT trzech pakietów (audyt 2026-09-29): katalog typów sejfu na Railway →
 * mapowanie wymagań w aplikacji → checklista w Cloud Functions.
 *
 * Każde ogniwo testowane osobno przechodziło, a razem checklista NIGDY nie znała
 * wymagań. Ten test przepuszcza prawdziwe identyfikatory z katalogu Railway przez
 * prawdziwe funkcje obu pozostałych pakietów — bez sieci i bez atrap kształtu.
 */

import { TYPY_DOKUMENTOW } from '../../backend/src/config/dokumentyKatalog.js';
import { wymaganiaZDopasowania } from '../src/lib/wygrywalnosc.js';
import { zbudujChecklisteOferty, KOSZYKI } from '../../firebase/functions/src/lib/checklistaOferty.js';

const KATALOG = TYPY_DOKUMENTOW.map((t) => ({ id: t.id, nazwa: t.nazwa }));
const TERAZ = Date.parse('2026-10-01T08:00:00.000Z');
const PRZETARG = { id: 't1', source: 'bzp', deadline: '2026-10-20T08:00:00.000Z' };

/** Odpowiedź w kształcie trasy Railway `POST /api/przetarg/sejf/dopasowanie/:id`. */
function odpowiedzDopasowania(wymaganeTypy) {
  return {
    postepowanie_id: 'p1', dzien_zlozenia: '2026-10-20', wymagane_typy: wymaganeTypy,
    swieze: [], przeterminuja_sie: [], brakuje: [],
  };
}

test('każdy typ z katalogu Railway staje się wymaganiem, które checklista Functions rozpoznaje', () => {
  const { stan, wymagania } = wymaganiaZDopasowania(odpowiedzDopasowania(KATALOG.map((t) => t.id)), KATALOG);
  assert.equal(stan, 'znane');
  assert.equal(wymagania.length, KATALOG.length);

  // Sejf w kształcie Railway: typ w `typ_dokumentu`, ważność w `dataWaznosci`.
  const dokumenty = KATALOG.map((t) => ({
    id: `d-${t.id}`, typ_dokumentu: t.id, nazwaTypu: t.nazwa, dataWaznosci: '2027-12-31',
  }));
  const checklista = zbudujChecklisteOferty({ tender: PRZETARG, wymagania, dokumenty, teraz: TERAZ });
  assert.equal(checklista.koszyki[KOSZYKI.MASZ].length, KATALOG.length, 'każde wymaganie dopasowane po kodzie');
  assert.equal(checklista.gotowe, true);
});

test('brakujące i przeterminowane w dniu składania trafiają do właściwych koszyków', () => {
  const { wymagania } = wymaganiaZDopasowania(odpowiedzDopasowania(['krk', 'zus', 'us']), KATALOG);
  const dokumenty = [
    { id: 'd1', typ_dokumentu: 'krk', dataWaznosci: '2027-06-30' },
    // ZUS ważny dziś, ale NIE w dniu składania (20.10) — sedno checklisty.
    { id: 'd2', typ_dokumentu: 'zus', dataWaznosci: '2026-10-10' },
  ];
  const checklista = zbudujChecklisteOferty({ tender: PRZETARG, wymagania, dokumenty, teraz: TERAZ });
  assert.deepEqual(checklista.koszyki[KOSZYKI.MASZ].map((p) => p.kod), ['krk']);
  assert.deepEqual(checklista.koszyki[KOSZYKI.PRZETERMINUJE].map((p) => p.kod), ['zus']);
  assert.deepEqual(checklista.koszyki[KOSZYKI.BRAKUJE].map((p) => p.kod), ['us']);
  assert.equal(checklista.gotowe, false);
  // Nazwa z katalogu Railway, nie surowy kod.
  assert.equal(checklista.koszyki[KOSZYKI.BRAKUJE][0].nazwa, KATALOG.find((t) => t.id === 'us').nazwa);
});

test('brak wymagań w analizie: checklista Functions NIE uznaje gotowości', () => {
  const { stan, wymagania } = wymaganiaZDopasowania(odpowiedzDopasowania([]), KATALOG);
  assert.equal(stan, 'brak_wymagan');
  const checklista = zbudujChecklisteOferty({ tender: PRZETARG, wymagania, dokumenty: [], teraz: TERAZ });
  assert.equal(checklista.gotowe, false);
  assert.equal(checklista.stanWiedzy.znamyWymagania, false);
});
