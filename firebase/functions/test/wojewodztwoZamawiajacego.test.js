import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zbudujMapy, wojewodztwoZNazwy, normNazwy } from '../src/lib/wojewodztwoZamawiajacego.js';
import { runWojewodztwaZamawiajacych, wojewodztwoNowejPozycji } from '../src/jobs/wojewodztwaZamawiajacych.js';

/*
 * Województwo zamawiającego po nazwie (2026-11-01) dla platformazakupowa i e-ProPublico: dokładna nazwa z BZP,
 * „Gmina X” po mieście, „… w X” po miejscowniku nauczonym z nazw BZP. Tylko jednoznaczne wpisy (≥ 90%).
 */
const REKORDY = [
  { org: 'Komenda Wojewódzka Policji w Łodzi', woj: '10', miasto: 'Łódź' },
  { org: 'Szpital Wojewódzki im. M. Kopernika w Łodzi', woj: 'PL10', miasto: 'Łódź' },
  { org: 'Uniwersytet Łódzki', woj: '10', miasto: 'Łódź' },
  { org: 'Gmina Września', woj: '30', miasto: 'Września' },
  { org: 'Szkoła Podstawowa nr 1 we Wrześni', woj: '30', miasto: 'Września' },
  { org: 'Zespół Szkół we Wrześni', woj: '30', miasto: 'Września' },
  { org: 'Ośrodek Sportu w Rzeszowie', woj: '18', miasto: 'Rzeszów' },
  { org: 'Miejski Zarząd Dróg w Rzeszowie', woj: '18', miasto: 'Rzeszów' },
  { org: 'Gmina Michałowice', woj: '12', miasto: 'Michałowice' },
  { org: 'Gmina Michałowice', woj: '14', miasto: 'Michałowice' },
];

test('mapy: dokładna nazwa, miasto i miejscownik; niejednoznaczne nazwy odpadają', () => {
  const m = zbudujMapy(REKORDY);
  assert.equal(m.poNazwie.get(normNazwy('KOMENDA WOJEWÓDZKA POLICJI W ŁODZI')), '10');
  assert.equal(m.poNazwie.has('gmina michałowice'), false, '12 i 14 po połowie — bez wpisu');
  assert.equal(m.poMiejscowniku.get('łodzi'), '10');
  assert.equal(m.poMiejscowniku.get('rzeszowie'), '18');
  assert.equal(m.poMiescie.get('września'), '30');
});

test('przypisanie: dokładna nazwa, „Gmina X”, „… w X”; nieznane i dwuznaczne → null', () => {
  const m = zbudujMapy(REKORDY);
  assert.equal(wojewodztwoZNazwy('Komenda Wojewódzka Policji w Łodzi', m), '10');
  assert.equal(wojewodztwoZNazwy('Urząd Miasta i Gminy Września', m), '30');
  assert.equal(wojewodztwoZNazwy('Przedszkole Miejskie nr 5 w Rzeszowie', m), '18');
  assert.equal(wojewodztwoZNazwy('Zakład Gospodarki Komunalnej Sp. z o.o.', m), null);
  assert.equal(wojewodztwoZNazwy('Gmina Michałowice', m), null);
  assert.equal(wojewodztwoZNazwy('', m), null);
});

test('job: mapa starsza niż tydzień → przebudowa; województwo tylko PZ/ePP bez regionu, TED nietknięty', async () => {
  const mapy = { ...zbudujMapy(REKORDY), zbudowano_o: '2026-10-01T00:00:00.000Z' };
  const zapisy = [];
  let przebudowano = 0;
  const w = await runWojewodztwaZamawiajacych({
    teraz: Date.parse('2026-11-01T03:40:00Z'),
    repoMap: { wczytaj: async () => mapy },
    przebuduj: async () => { przebudowano += 1; return { nazw: mapy.poNazwie.size }; },
    przetargi: {
      otwarteDoWojewodztwa: async () => [
        { id: 'pz:1', source: 'platformazakupowa', organization: 'Komenda Wojewódzka Policji w Łodzi', wojewodztwo: null },
        { id: 'epp:2', source: 'epropublico', organization: 'Ośrodek Kultury w Rzeszowie', wojewodztwo: null },
        { id: 'pz:3', source: 'platformazakupowa', organization: 'Nieznany Zamawiający', wojewodztwo: null },
        { id: 'pz:4', source: 'platformazakupowa', organization: 'Gmina Września', wojewodztwo: 'PL30' },
        { id: 'ted:5', source: 'ted', organization: 'Komenda Wojewódzka Policji w Łodzi', wojewodztwo: null },
      ],
      ustawWojewodztwoZNazwy: async (id, woj) => { zapisy.push([id, woj]); },
    },
  });
  assert.equal(przebudowano, 1);
  assert.deepEqual(zapisy, [['pz:1', 'PL10'], ['epp:2', 'PL18']]);
  assert.deepEqual([w.ok, w.kandydaci, w.przypisane], [true, 3, 2]);
});

test('nowa pozycja z listy: województwo z nazwy z oznaczeniem; bez mapy albo z regionem — bez zmian', () => {
  const m = zbudujMapy(REKORDY);
  assert.deepEqual(wojewodztwoNowejPozycji({ organization: 'Gmina Września', wojewodztwo: null }, m), { organization: 'Gmina Września', wojewodztwo: 'PL30', wojewodztwo_z_nazwy: true });
  const t = { organization: 'Gmina Września', wojewodztwo: null };
  assert.equal(wojewodztwoNowejPozycji(t, null), t);
  assert.equal(wojewodztwoNowejPozycji(null, m), null);
});
