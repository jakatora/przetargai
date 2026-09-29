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

// ── Częściowa detekcja (review 2026-09-29) ──────────────────────────────────────
// `wymagane_typy` pochodzi z parsera FRAZ (wykryjWymaganeTypy). SWZ wymagająca
// KRS, US i ZUS innymi słowami daje tylko KRS — a firma z ważnym KRS widziała
// „Wszystkie obowiązkowe dokumenty są ważne". Automatyczna lista to pomoc,
// nie potwierdzenie kompletności.

import { opisGotowosci } from '../src/lib/wygrywalnosc.js';

process.env.JWT_SECRET ??= 'test-mobile-kontrakt-atrapa-0000';
const { wykryjWymaganeTypy } = await import('../../backend/src/services/dopasowanieSejfSWZ.js');

const SWZ_CZESCIOWA = 'Wykonawca złoży odpis z KRS, zaświadczenie o niezaleganiu z opłacaniem podatków '
  + 'oraz dokument potwierdzający brak zaległości w opłacaniu składek społecznych.';

test('częściowa detekcja parsera: ważny KRS NIE daje „wszystkie obowiązkowe" ani tonu sukcesu', () => {
  const typy = wykryjWymaganeTypy(SWZ_CZESCIOWA);
  assert.deepEqual(typy, ['wpis_rejestr'], 'parser fraz łapie tylko KRS — US i ZUS opisano innymi słowami');

  const { stan, wymagania } = wymaganiaZDopasowania(odpowiedzDopasowania(typy), KATALOG);
  const dokumenty = [{ id: 'd1', typ_dokumentu: 'wpis_rejestr', dataWaznosci: '2027-01-31' }];
  const checklista = zbudujChecklisteOferty({ tender: PRZETARG, wymagania, dokumenty, teraz: TERAZ });
  assert.equal(checklista.gotowe, true, 'backend liczy tylko to, co wykryto');

  const opis = opisGotowosci(checklista, 'pl', { wymagania: stan, sejf: 'ok', wykryte: wymagania.length });
  assert.notEqual(opis.ton, 'sukces');
  assert.doesNotMatch(opis.tekst, /wszystkie obowiązkowe/i);
  assert.match(opis.tekst, /wykryte automatycznie \(1\)/i);
  assert.match(opis.tekst, /sprawdź pozostałe wymagania SWZ/i);
});

test('częściowa detekcja z brakami: liczba braków spośród wykrytych + ostrzeżenie o niepełnej liście', () => {
  const { stan, wymagania } = wymaganiaZDopasowania(odpowiedzDopasowania(['krk', 'zus']), KATALOG);
  const checklista = zbudujChecklisteOferty({
    tender: PRZETARG, wymagania, dokumenty: [{ id: 'd1', typ_dokumentu: 'krk', dataWaznosci: '2027-01-31' }], teraz: TERAZ,
  });
  const opis = opisGotowosci(checklista, 'pl', { wymagania: stan, sejf: 'ok', wykryte: wymagania.length });
  assert.equal(opis.ton, 'danger');
  assert.match(opis.tekst, /1 rzecz do załatwienia spośród 2 wykrytych automatycznie/);
  assert.match(opis.tekst, /sprawdź pozostałe wymagania SWZ/i);
});

test('regresja: puste i błędne dane dalej dają gotowość nieustaloną', () => {
  const checklista = zbudujChecklisteOferty({ tender: PRZETARG, wymagania: [], dokumenty: [], teraz: TERAZ });
  for (const odp of [odpowiedzDopasowania([]), { checklista: {} }, null]) {
    const { stan } = wymaganiaZDopasowania(odp, KATALOG);
    const opis = opisGotowosci(checklista, 'pl', { wymagania: stan, sejf: 'ok' });
    assert.notEqual(opis.ton, 'sukces');
    assert.match(opis.tekst, /nieustalona|nieznanym formacie/i);
  }
  assert.notEqual(opisGotowosci(checklista, 'pl', { wymagania: 'blad', sejf: 'ok' }).ton, 'sukces');
});
