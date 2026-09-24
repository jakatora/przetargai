import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  tonCzynnika, opisWerdyktu, metryczkaProbki, uporzadkujCzynniki, policzTony,
  KOSZYKI_CHECKLISTY, opisGotowosci, opisDniDoZlozenia, odmianaDni, TONY,
} from '../src/lib/wygrywalnosc.js';

describe('wygrywalność — ton czynnika to KLASA koloru, nie hex', () => {
  test('mapuje tony backendu na klasy motywu', () => {
    assert.equal(tonCzynnika('zielony'), 'sukces');
    assert.equal(tonCzynnika('zolty'), 'ostrzezenie');
    assert.equal(tonCzynnika('czerwony'), 'danger');
  });

  test('nieznany ton NIE udaje sukcesu', () => {
    assert.equal(tonCzynnika('nieznany'), 'neutral');
    assert.equal(tonCzynnika('cokolwiek'), 'neutral');
    assert.equal(tonCzynnika(undefined), 'neutral');
  });

  test('w pliku nie ma ani jednego koloru w hexie', () => {
    const zrodlo = readFileSync(new URL('../src/lib/wygrywalnosc.js', import.meta.url), 'utf8');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(zrodlo), 'kolory należą do motyw.js, nie do tej warstwy');
  });

  test('każda klasa tonu jest jedną z czterech znanych motywowi', () => {
    for (const klasa of Object.values(TONY)) {
      assert.ok(['sukces', 'ostrzezenie', 'danger', 'neutral'].includes(klasa), klasa);
    }
  });
});

describe('wygrywalność — werdykt jest kategorią, nie liczbą', () => {
  test('każdy werdykt backendu ma etykietę PL i EN', () => {
    for (const werdykt of ['sprawdz', 'uwazaj', 'trudny', 'brak_danych', 'po_terminie']) {
      assert.ok(opisWerdyktu(werdykt, 'pl').etykieta);
      assert.ok(opisWerdyktu(werdykt, 'en').etykieta);
    }
  });

  test('nieznany werdykt schodzi do „za mało danych", a nie do optymizmu', () => {
    assert.equal(opisWerdyktu('cos-nowego').ton, 'neutral');
  });

  test('„trudny" i „po terminie" mają ton ostrzegawczy', () => {
    assert.equal(opisWerdyktu('trudny').ton, 'danger');
    assert.equal(opisWerdyktu('po_terminie').ton, 'danger');
  });

  test('warstwa prezentacji NIE liczy własnego wskaźnika szans', () => {
    const zrodlo = readFileSync(new URL('../src/lib/wygrywalnosc.js', import.meta.url), 'utf8');
    assert.ok(!/szansa|prawdopodobie|procentSzans|scoreSzans/i.test(
      zrodlo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    ), 'ekran policzył sobie „procent szans", obchodząc decyzję z warstwy danych');
  });
});

describe('wygrywalność — metryczka próbki', () => {
  const karta = (nad = {}) => ({
    zrodloBenchmarku: 'zamawiajacy',
    probka: { czesci: 40, ogloszenia: 12, od: '2026-01-01', do: '2026-09-01', zrodla: ['bzp', 'ted'] },
    ...nad,
  });

  test('mówi, na ilu rozstrzygnięciach stoi wniosek i skąd', () => {
    const m = metryczkaProbki(karta());
    assert.match(m.tekst, /40 rozstrzygniętych części/);
    assert.match(m.tekst, /u tego zamawiającego/);
  });

  test('niesie zakres dat i rejestry', () => {
    const m = metryczkaProbki(karta());
    assert.equal(m.zakres, '2026-01-01 – 2026-09-01');
    assert.equal(m.rejestry, 'BZP + TED');
  });

  test('jedna część odmienia się po polsku, a nie przez doklejenie „s"', () => {
    const m = metryczkaProbki(karta({ probka: { czesci: 1, zrodla: [] } }));
    assert.match(m.tekst, /jednej rozstrzygniętej części/);
  });

  test('brak próbki daje null — ekran nie ma pisać „na podstawie 0"', () => {
    assert.equal(metryczkaProbki({ probka: { czesci: 0 } }), null);
    assert.equal(metryczkaProbki({}), null);
    assert.equal(metryczkaProbki(null), null);
  });

  test('wersja angielska nie zostaje po polsku', () => {
    assert.match(metryczkaProbki(karta(), 'en').tekst, /^Based on 40 settled parts/);
  });
});

describe('wygrywalność — kolejność czynników', () => {
  const czynniki = [
    { kod: 'a', ton: 'zielony' },
    { kod: 'b', ton: 'nieznany' },
    { kod: 'c', ton: 'czerwony' },
    { kod: 'd', ton: 'zolty' },
  ];

  test('powody odpuszczenia idą PRZED powodami do optymizmu', () => {
    assert.deepEqual(uporzadkujCzynniki(czynniki).map((c) => c.kod), ['c', 'd', 'a', 'b']);
  });

  test('nie mutuje wejścia', () => {
    const kopia = [...czynniki];
    uporzadkujCzynniki(czynniki);
    assert.deepEqual(czynniki, kopia);
  });

  test('liczy tony do paska podsumowania', () => {
    assert.deepEqual(policzTony(czynniki), { zielony: 1, zolty: 1, czerwony: 1, nieznany: 1 });
    assert.deepEqual(policzTony(null), { zielony: 0, zolty: 0, czerwony: 0, nieznany: 0 });
  });
});

describe('checklista — koszyki i gotowość', () => {
  test('koszyki idą od tego, co blokuje, do tego, co gotowe', () => {
    assert.deepEqual(KOSZYKI_CHECKLISTY.map((k) => k.kod), ['brakuje', 'przeterminuje_sie', 'masz']);
    assert.deepEqual(KOSZYKI_CHECKLISTY.map((k) => k.ton), ['danger', 'ostrzezenie', 'sukces']);
  });

  test('brak wymagań to NIE jest „wszystko gotowe"', () => {
    const opis = opisGotowosci({
      gotowe: false,
      stanWiedzy: { znamyWymagania: false, znamySejf: true, znamyTermin: true },
      koszyki: { brakuje: [], przeterminuje_sie: [], masz: [] },
    });
    assert.equal(opis.ton, 'neutral');
    assert.match(opis.tekst, /Radar/);
  });

  test('brak terminu jest osobno nazwany — bez niego nie ma czego sprawdzać', () => {
    const opis = opisGotowosci({
      gotowe: false,
      stanWiedzy: { znamyWymagania: true, znamySejf: true, znamyTermin: false },
      koszyki: { brakuje: [], przeterminuje_sie: [], masz: [] },
    });
    assert.equal(opis.ton, 'ostrzezenie');
    assert.match(opis.tekst, /terminu składania/);
  });

  test('pusty sejf tłumaczy, dlaczego wszystko jest „brakuje"', () => {
    const opis = opisGotowosci({
      gotowe: false,
      stanWiedzy: { znamyWymagania: true, znamySejf: false, znamyTermin: true },
      koszyki: { brakuje: [{}], przeterminuje_sie: [], masz: [] },
    });
    assert.match(opis.tekst, /sejf/i);
  });

  test('komplet dokumentów mówi wprost, że są ważne W DNIU SKŁADANIA', () => {
    const opis = opisGotowosci({
      gotowe: true,
      stanWiedzy: { znamyWymagania: true, znamySejf: true, znamyTermin: true },
      koszyki: { brakuje: [], przeterminuje_sie: [], masz: [{}] },
    });
    assert.equal(opis.ton, 'sukces');
    assert.match(opis.tekst, /w dniu składania/);
  });

  test('braki są policzone razem z tym, co straci ważność', () => {
    const opis = opisGotowosci({
      gotowe: false,
      stanWiedzy: { znamyWymagania: true, znamySejf: true, znamyTermin: true },
      koszyki: { brakuje: [{}, {}], przeterminuje_sie: [{}], masz: [] },
    });
    assert.match(opis.tekst, /^3 rzeczy/);
  });
});

describe('checklista — licznik dni', () => {
  test('odmienia „dzień/dni"', () => {
    assert.equal(odmianaDni(1), 'dzień');
    assert.equal(odmianaDni(5), 'dni');
    assert.equal(opisDniDoZlozenia({ dniDoZlozenia: 1 }), '1 dzień do planowanego złożenia');
  });

  test('dzisiaj i po terminie mają własne zdania', () => {
    assert.match(opisDniDoZlozenia({ dniDoZlozenia: 0 }), /dzisiaj/);
    assert.match(opisDniDoZlozenia({ dniDoZlozenia: -2 }), /minął/);
  });

  test('brak liczby daje null, a nie „NaN dni"', () => {
    assert.equal(opisDniDoZlozenia({ dniDoZlozenia: null }), null);
    assert.equal(opisDniDoZlozenia({}), null);
  });
});
