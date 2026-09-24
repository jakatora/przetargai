import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  mapujPlanTed,
  wyciagnijNip,
  pobierzPlanyTed,
  zapytaniePlanow,
  RODZAJE_PLANU,
} from '../src/services/tedPlany.js';

const KATALOG = dirname(fileURLToPath(import.meta.url));
const PLANY = JSON.parse(readFileSync(join(KATALOG, 'fixtures', 'ted-plany.json'), 'utf8'));
const poNumerze = (numer) => PLANY.find((n) => n['publication-number'] === numer);

/*
 * Fixture pobrany z ŻYWEGO TED (2026-09-24, form-type = planning, place-of-performance
 * POL, 30 dni = 208 ogłoszeń). Pomiar na całości: future-notice 102/208, wartość
 * szacunkowa 11/208 (wyłącznie PLN), buyer-identifier 208/208 — ale jako WOLNY TEKST.
 */
describe('TED — ogłoszenia planowania (radar planów)', () => {
  describe('NIP zamawiającego z wolnego tekstu', () => {
    test('formaty widziane na żywym TED', () => {
      assert.equal(wyciagnijNip(['5251575309']), '5251575309');
      assert.equal(wyciagnijNip(['841-000-80-86']), '8410008086');
      assert.equal(wyciagnijNip(['842-00-06-338']), '8420006338');
      assert.equal(wyciagnijNip(['821 000 65 10']), '8210006510');
      assert.equal(wyciagnijNip(['NIP: 5930005678', 'REGON: 191675273']), '5930005678');
      assert.equal(wyciagnijNip(['NIP 701-007-37-77 Regon 141032404']), '7010073777');
      assert.equal(wyciagnijNip(['NIP 8421326832; REGON 770799248']), '8421326832');
    });

    test('sam REGON (9 cyfr) to NIE NIP — null zamiast zgadywania', () => {
      assert.equal(wyciagnijNip(['590019152']), null);
      assert.equal(wyciagnijNip(['012567140']), null);
    });

    test('10 cyfr z błędną sumą kontrolną odrzucone', () => {
      assert.equal(wyciagnijNip(['5251575308']), null);
    });

    test('NIP i REGON sklejone spacją nie dają 19-cyfrowego śmiecia', () => {
      assert.equal(wyciagnijNip(['5251575309 191675273']), '5251575309');
    });

    test('puste wejście', () => {
      assert.equal(wyciagnijNip(null), null);
      assert.equal(wyciagnijNip([]), null);
      assert.equal(wyciagnijNip('NIP 7590002830'), '7590002830', 'skalar też');
    });
  });

  describe('mapujPlanTed — kształt pozycji planu dla radaru', () => {
    test('pin-rtl z terminem i wartością', () => {
      const p = mapujPlanTed(poNumerze('657219-2026'));
      assert.equal(p.id, '657219-2026');
      assert.equal(p.zrodlo, 'ted');
      assert.equal(p.rodzaj, 'pin-rtl');
      assert.match(p.przedmiot, /gospodarki leśnej/);
      assert.equal(p.terminWszczecia, '2026-10-30', 'offset odcięty, sama data');
      assert.equal(p.wartosc, 13150027.21);
      assert.equal(p.waluta, 'PLN');
      assert.equal(p.zamawiajacy_nip, '8410008086');
      assert.equal(p.region, '22', 'PL636 (NUTS) = pomorskie, NIE kod TERYT 36');
      assert.equal(p.opublikowano, PLANY[0]['publication-date'].slice(0, 10));
      assert.match(p.url, /ted\.europa\.eu\/pl\/notice/);
    });

    test('CPV bez duplikatów (TED powtarza kod per część) i z działami', () => {
      const p = mapujPlanTed(poNumerze('657219-2026'));
      assert.equal(new Set(p.cpv).size, p.cpv.length);
      assert.ok(p.cpv.length < poNumerze('657219-2026')['classification-cpv'].length);
      assert.ok(p.cpv_dzialy.includes('77'));
    });

    test('brak future-notice → termin null (nie wymyślamy daty)', () => {
      const p = mapujPlanTed(poNumerze('659494-2026'));
      assert.equal(p.terminWszczecia, null);
      assert.equal(p.wartosc, null);
    });

    test('termin w formacie „2027-08-16Z"', () => {
      assert.equal(mapujPlanTed(poNumerze('657983-2026')).terminWszczecia, '2027-08-16');
    });

    test('region z buyer-country-sub nawet bez miejsca realizacji', () => {
      const p = mapujPlanTed(poNumerze('660011-2026'));
      assert.equal(p.region, '14', 'PL924 = mazowieckie');
    });

    test('opis przycięty — pozycja trafia do indeksu radaru, nie cały dokument', () => {
      for (const n of PLANY) {
        const p = mapujPlanTed(n);
        assert.ok(p.opis === null || p.opis.length <= 500, n['publication-number']);
      }
    });

    test('każdy rodzaj z fixture ma etykietę PL/EN', () => {
      for (const n of PLANY) {
        const p = mapujPlanTed(n);
        assert.ok(RODZAJE_PLANU[p.rodzaj], p.rodzaj);
        assert.ok(p.rodzaj_opis.pl && p.rodzaj_opis.en);
      }
    });

    test('pin-rtl niesie ostrzeżenie o skróconym terminie składania', () => {
      assert.equal(mapujPlanTed(poNumerze('657219-2026')).skraca_termin, true);
      assert.equal(mapujPlanTed(poNumerze('657983-2026')).skraca_termin, false);
    });

    test('bez numeru albo tytułu → null', () => {
      assert.equal(mapujPlanTed({ 'title-proc': { pol: 'x' } }), null);
      assert.equal(mapujPlanTed({ 'publication-number': '1-2026' }), null);
      assert.equal(mapujPlanTed(null), null);
    });

    test('cała próbka mapuje się bez odrzuceń', () => {
      assert.equal(PLANY.map(mapujPlanTed).filter(Boolean).length, PLANY.length);
    });
  });

  describe('pobierzPlanyTed — zapytanie i stronicowanie', () => {
    test('zapytanie: Polska, planowanie, od dnia, najnowsze najpierw', () => {
      const q = zapytaniePlanow('20260901');
      assert.match(q, /place-of-performance IN \(POL\)/);
      assert.match(q, /form-type = planning/);
      assert.match(q, /publication-date >= 20260901/);
      assert.match(q, /SORT BY publication-date DESC/);
    });

    test('stronicuje do totalNoticeCount i liczy odrzucone', async () => {
      const zapytania = [];
      const fetchImpl = async (_url, opcje) => {
        const body = JSON.parse(opcje.body);
        zapytania.push(body);
        const strona = body.page === 1 ? PLANY.slice(0, 6) : PLANY.slice(6).concat([{ bez: 'numeru' }]);
        return { ok: true, json: async () => ({ totalNoticeCount: PLANY.length + 1, notices: strona }) };
      };
      const licznik = { zapytania: 0, surowe: 0, odrzucone: 0 };
      const wynik = await pobierzPlanyTed({ odDnia: '20260901', rozmiarStrony: 6, fetchImpl, licznik });
      assert.equal(wynik.length, PLANY.length);
      assert.equal(zapytania.length, 2);
      assert.deepEqual(licznik, { zapytania: 2, surowe: PLANY.length + 1, odrzucone: 1 });
      assert.ok(zapytania[0].fields.includes('future-notice'));
      assert.ok(zapytania[0].fields.includes('buyer-identifier'));
    });

    test('HTTP != 200 → wyjątek z kodem (izolacja w jobie)', async () => {
      const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'Too many' });
      await assert.rejects(pobierzPlanyTed({ odDnia: '20260901', fetchImpl }), /429/);
    });

    test('pusta strona kończy pętlę', async () => {
      let n = 0;
      const fetchImpl = async () => { n += 1; return { ok: true, json: async () => ({ totalNoticeCount: 999, notices: [] }) }; };
      assert.deepEqual(await pobierzPlanyTed({ odDnia: '20260901', fetchImpl }), []);
      assert.equal(n, 1);
    });
  });
});
