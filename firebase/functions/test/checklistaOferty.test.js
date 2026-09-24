import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  zbudujChecklisteOferty, dzienZlozenia, dokumentPasuje, czynnosciZOgloszenia,
  KOSZYKI, DNI_ZAPASU,
} from '../src/lib/checklistaOferty.js';

const TERAZ = Date.UTC(2026, 8, 24); // 2026-09-24
const za = (dni) => new Date(TERAZ + dni * 86_400_000).toISOString();

const przetarg = (nad = {}) => ({ id: 't1', deadline: za(49), ...nad });

const WYMAGANIA = [
  { kod: 'krk', nazwa: 'Zaświadczenie z Krajowego Rejestru Karnego', obowiazkowe: true },
  { kod: 'zus', nazwa: 'Zaświadczenie z ZUS o niezaleganiu', obowiazkowe: true },
  { kod: 'polisa', nazwa: 'Polisa OC', obowiazkowe: false },
];

describe('checklista — ważność liczy się na DZIEŃ SKŁADANIA, nie na dzisiaj', () => {
  test('dzień złożenia to termin minus zapas', () => {
    const dzien = dzienZlozenia(przetarg());
    assert.equal(dzien, za(49 - DNI_ZAPASU));
  });

  test('bez terminu nie udajemy, że znamy dzień złożenia', () => {
    assert.equal(dzienZlozenia({ deadline: null }), null);
    assert.equal(dzienZlozenia({ deadline: 'nie-data' }), null);
  });

  test('dokument ważny DZISIAJ, ale nieważny w dniu składania, trafia do „przeterminuje się"', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),          // termin za 49 dni
      wymagania: WYMAGANIA,
      dokumenty: [
        { kod: 'krk', nazwa: 'KRK', wazny_do: za(10) },   // dziś ważny, wtedy nie
        { kod: 'zus', nazwa: 'ZUS', wazny_do: za(90) },
      ],
      teraz: TERAZ,
    });

    const przeterminuje = checklista.koszyki[KOSZYKI.PRZETERMINUJE].map((p) => p.kod);
    assert.deepEqual(przeterminuje, ['krk'],
      'checklista licząca ważność od dzisiaj powiedziałaby, że firma jest gotowa');
    assert.deepEqual(checklista.koszyki[KOSZYKI.MASZ].map((p) => p.kod), ['zus']);
  });

  test('pozycja mówi, ILE dni zapasu zostaje na dzień składania', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [WYMAGANIA[0]],
      dokumenty: [{ kod: 'krk', nazwa: 'KRK', wazny_do: za(10) }],
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.PRZETERMINUJE][0].dniZapasu, 10 - (49 - DNI_ZAPASU));
  });

  test('dokument bez daty ważności nie jest uznawany za przeterminowany', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [{ kod: 'kw', nazwa: 'Odpis KRS' }],
      dokumenty: [{ kod: 'kw', nazwa: 'Odpis KRS' }],
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.MASZ].length, 1);
    assert.equal(checklista.koszyki[KOSZYKI.MASZ][0].waznyDo, null);
  });
});

describe('checklista — trzy koszyki', () => {
  const checklista = zbudujChecklisteOferty({
    tender: przetarg(),
    wymagania: WYMAGANIA,
    dokumenty: [
      { kod: 'zus', nazwa: 'ZUS', wazny_do: za(90) },
      { kod: 'krk', nazwa: 'KRK', wazny_do: za(5) },
    ],
    teraz: TERAZ,
  });

  test('wymaganie bez odpowiednika w sejfie to „brakuje"', () => {
    assert.deepEqual(checklista.koszyki[KOSZYKI.BRAKUJE].map((p) => p.kod), ['polisa']);
  });

  test('każda pozycja pamięta, czy jest obowiązkowa', () => {
    assert.equal(checklista.koszyki[KOSZYKI.BRAKUJE][0].obowiazkowe, false);
  });

  test('brak NIEobowiązkowego nie blokuje gotowości', () => {
    assert.equal(checklista.koszyki[KOSZYKI.PRZETERMINUJE].length, 1, 'KRK straci ważność');
    const bezKrk = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: WYMAGANIA,
      dokumenty: [
        { kod: 'zus', nazwa: 'ZUS', wazny_do: za(90) },
        { kod: 'krk', nazwa: 'KRK', wazny_do: za(90) },
      ],
      teraz: TERAZ,
    });
    assert.equal(bezKrk.gotowe, true, 'brakuje tylko nieobowiązkowej polisy');
  });
});

describe('checklista — dopasowanie dokumentu do wymagania', () => {
  test('kod ma pierwszeństwo przed nazwą', () => {
    assert.equal(dokumentPasuje({ kod: 'krk', nazwa: 'Zupełnie co innego' }, { kod: 'krk', nazwa: 'X' }), true);
    assert.equal(dokumentPasuje({ kod: 'krk', nazwa: 'To samo' }, { kod: 'zus', nazwa: 'To samo' }), false);
  });

  test('bez kodów dopasowuje po nazwie, ignorując diakrytyki i wielkość liter', () => {
    assert.equal(dokumentPasuje({ nazwa: 'Zaświadczenie ZUS' }, { nazwa: 'zaswiadczenie zus' }), true);
  });

  test('nazwa zawierająca się w drugiej też pasuje', () => {
    assert.equal(dokumentPasuje({ nazwa: 'Polisa OC' }, { nazwa: 'Polisa OC na 2026' }), true);
  });

  test('bez kodu i bez nazwy nie zgaduje', () => {
    assert.equal(dokumentPasuje({}, {}), false);
  });
});

describe('checklista — jawny stan wiedzy zamiast cichego zera', () => {
  test('brak wymagań to NIE jest checklista spełniona', () => {
    const checklista = zbudujChecklisteOferty({ tender: przetarg(), teraz: TERAZ });
    assert.equal(checklista.gotowe, false, 'pusta checklista udaje gotowość');
    assert.equal(checklista.stanWiedzy.znamyWymagania, false);
  });

  test('stan wiedzy rozróżnia brak wymagań, brak sejfu i brak terminu', () => {
    const checklista = zbudujChecklisteOferty({
      tender: { id: 't', deadline: null },
      wymagania: WYMAGANIA,
      teraz: TERAZ,
    });
    assert.deepEqual(checklista.stanWiedzy, {
      znamyWymagania: true, znamySejf: false, znamyTermin: false,
    });
    assert.equal(checklista.dzienZlozenia, null);
    assert.equal(checklista.dniDoZlozenia, null);
  });

  test('bez terminu wszystkie dokumenty lądują w „masz" — nie zmyślamy przeterminowania', () => {
    const checklista = zbudujChecklisteOferty({
      tender: { id: 't', deadline: null },
      wymagania: [WYMAGANIA[0]],
      dokumenty: [{ kod: 'krk', nazwa: 'KRK', wazny_do: '2020-01-01T00:00:00Z' }],
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.PRZETERMINUJE].length, 0);
  });
});

describe('checklista — czynności z ogłoszenia', () => {
  test('wadium wymagane jest osobną czynnością z kwotą', () => {
    const czynnosci = czynnosciZOgloszenia({ wadium_wymagane: true, wadium_kwota: 12_000 });
    assert.match(czynnosci[0].nazwa, /12000/);
    assert.match(czynnosci[0].naKiedy, /przed terminem/);
    assert.equal(czynnosci[0].obowiazkowe, true);
  });

  test('brak informacji o wadium daje zadanie „sprawdź w SWZ", nie ciszę', () => {
    const czynnosci = czynnosciZOgloszenia({});
    assert.equal(czynnosci[0].kod, 'wadium_sprawdz');
    assert.equal(czynnosci[0].obowiazkowe, false);
  });

  test('ogłoszenie bez wadium nie dokłada zadania', () => {
    assert.deepEqual(czynnosciZOgloszenia({ wadium_wymagane: false }), []);
  });
});

describe('checklista — następny krok', () => {
  test('brak dokumentu OBOWIĄZKOWEGO bije dokument, który dopiero straci ważność', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [
        { kod: 'zus', nazwa: 'ZUS', obowiazkowe: true },
        { kod: 'krk', nazwa: 'KRK', obowiazkowe: true },
      ],
      dokumenty: [{ kod: 'krk', nazwa: 'KRK', wazny_do: za(5) }],
      teraz: TERAZ,
    });
    assert.equal(checklista.nastepnyKrok.kod, 'zus');
    assert.equal(checklista.nastepnyKrok.koszyk, KOSZYKI.BRAKUJE);
  });

  test('krótki termin oznacza krok jako pilny', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg({ deadline: za(4) }),
      wymagania: [{ kod: 'zus', nazwa: 'ZUS', obowiazkowe: true }],
      teraz: TERAZ,
    });
    assert.equal(checklista.nastepnyKrok.pilne, true);
    assert.equal(checklista.nastepnyKrok.dniDoZlozenia, 4 - DNI_ZAPASU);
  });

  test('wszystko domknięte = brak następnego kroku', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [{ kod: 'zus', nazwa: 'ZUS', obowiazkowe: true }],
      dokumenty: [{ kod: 'zus', nazwa: 'ZUS', wazny_do: za(200) }],
      teraz: TERAZ,
    });
    assert.equal(checklista.nastepnyKrok, null);
    assert.equal(checklista.gotowe, true);
  });
});

describe('checklista — REALNY kształt dokumentu z usługi Sejfu', () => {
  /*
   * Dokument z Sejfu nie nazywa się `{ kod, wazny_do }`, tylko
   * `{ typ_dokumentu, nazwaTypu, dataWaznosci }`. Gdyby czytniki tego nie
   * obejmowały, dopasowanie zwróciłoby zero trafień i checklista pokazałaby
   * „brakuje wszystkiego" firmie, która ma komplet — błąd wyglądający jak
   * prawdziwa odpowiedź, więc niewykrywalny bez tego testu.
   */
  const zSejfu = (typ, nazwa, dataWaznosci) => ({
    id: `d-${typ}`, typ_dokumentu: typ, nazwaTypu: nazwa, dataWaznosci,
    status: 'gotowy', dniDoWaznosci: 30,
  });

  test('dopasowuje po `typ_dokumentu`', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [{ kod: 'zus', nazwa: 'Zaświadczenie ZUS', obowiazkowe: true }],
      dokumenty: [zSejfu('zus', 'Zaświadczenie z ZUS', za(200))],
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.MASZ].length, 1);
    assert.equal(checklista.gotowe, true);
  });

  test('czyta ważność z `dataWaznosci`, nie tylko z `wazny_do`', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),                       // termin za 49 dni
      wymagania: [{ kod: 'krk', nazwa: 'KRK', obowiazkowe: true }],
      dokumenty: [zSejfu('krk', 'KRK', za(10))], // straci ważność przed złożeniem
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.PRZETERMINUJE].length, 1);
  });

  test('gdy wymaganie nie ma kodu, wchodzi nazwa typu z sejfu', () => {
    const checklista = zbudujChecklisteOferty({
      tender: przetarg(),
      wymagania: [{ nazwa: 'Polisa OC' }],
      dokumenty: [{ nazwaTypu: 'Polisa OC', dataWaznosci: za(200) }],
      teraz: TERAZ,
    });
    assert.equal(checklista.koszyki[KOSZYKI.MASZ].length, 1);
  });
});
