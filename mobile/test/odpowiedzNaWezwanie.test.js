import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RODZAJE_WEZWANIA,
  TYPOWE_DOKUMENTY,
  rozpoznajWezwanie,
  generujOdpowiedz,
  kontrolaPrzedWyslaniem,
} from '../src/lib/odpowiedzNaWezwanie.js';

/*
 * „Odpowiedź na wezwanie w 1 klik": z wklejonej treści wezwania rozpoznajemy
 * podstawę (art. 128 / 274 / 223 / 224), termin i znak pisma, a potem składamy
 * pismo przewodnie z listą załączników. Jedna szansa i krótki termin — pomyłka
 * w podstawie albo brak oświadczenia o aktualności to odrzucenie oferty.
 */

const WYKONAWCA = { nazwa: 'Budrem Sp. z o.o.', adres: 'ul. Długa 12, 30-001 Kraków', nip: '5261040827', reprezentant: 'Jan Kowalski', stanowisko: 'Prezes Zarządu', email: 'biuro@budrem.pl', miejscowosc: 'Kraków' };
const PRZETARG = { tytul: 'Remont dachu szkoły', zamawiajacy: 'Gmina Miejska Kraków', numer: 'ZP.271.14.2026' };
const DZIS = '2026-10-23T09:00:00.000Z';

test('katalog rodzajów: stałe id, podstawa prawna, „inne" na końcu bez wzorców', () => {
  const ids = RODZAJE_WEZWANIA.map((r) => r.id);
  assert.deepEqual(ids, ['uzupelnienie', 'srodki_dowodowe', 'wyjasnienia_tresci', 'razaco_niska', 'inne']);
  assert.ok(Object.isFrozen(RODZAJE_WEZWANIA));
  assert.equal(RODZAJE_WEZWANIA.at(-1).wzorce.length, 0);
  assert.ok(TYPOWE_DOKUMENTY.length >= 8);
});

test('rozpoznanie: art. 128 + termin „do dnia 27.10.2026 r. do godz. 10:00" + znak pisma', () => {
  const r = rozpoznajWezwanie('Znak sprawy: ZP.271.14.2026. Na podstawie art. 128 ust. 1 ustawy Pzp wzywam do uzupełnienia oświadczenia, o którym mowa w art. 125 ust. 1, w terminie do dnia 27.10.2026 r. do godz. 10:00.');
  assert.equal(r.rodzaj, 'uzupelnienie');
  assert.equal(r.termin, '2026-10-27');
  assert.equal(r.godzina, '10:00');
  assert.equal(r.znak, 'ZP.271.14.2026');
});

test('rozpoznanie: art. 274 i data słowna „27 października 2026"', () => {
  const r = rozpoznajWezwanie('Zgodnie z art. 274 ust. 1 ustawy Prawo zamówień publicznych wzywamy do złożenia podmiotowych środków dowodowych w terminie do 27 października 2026 r.');
  assert.equal(r.rodzaj, 'srodki_dowodowe');
  assert.equal(r.termin, '2026-10-27');
  assert.equal(r.godzina, null);
});

test('rozpoznanie: art. 223 (wyjaśnienia treści) i art. 224 (rażąco niska cena) oraz ISO', () => {
  assert.equal(rozpoznajWezwanie('Na podstawie art. 223 ust. 1 Pzp prosimy o wyjaśnienie treści oferty do 2026-10-30.').rodzaj, 'wyjasnienia_tresci');
  assert.equal(rozpoznajWezwanie('…art. 223 ust. 1 … do 2026-10-30.').termin, '2026-10-30');
  const rn = rozpoznajWezwanie('Wezwanie do złożenia wyjaśnień, w tym dowodów, dotyczących wyliczenia ceny — art. 224 ust. 1 ustawy Pzp (rażąco niska cena).');
  assert.equal(rn.rodzaj, 'razaco_niska');
  assert.equal(rn.termin, null);
});

test('rozpoznanie: pusty albo nieznany tekst → „inne", bez terminu; nigdy nie rzuca', () => {
  assert.equal(rozpoznajWezwanie('').rodzaj, 'inne');
  assert.equal(rozpoznajWezwanie(null).rodzaj, 'inne');
  assert.equal(rozpoznajWezwanie('Proszę o przesłanie faktury.').termin, null);
  assert.equal(rozpoznajWezwanie('Termin 31.02.2026').termin, null, 'nieistniejąca data odrzucona');
});

test('pismo na art. 128: podstawa, nawiązanie do wezwania, numerowana lista załączników, oświadczenie o aktualności, podpis', () => {
  const dok = generujOdpowiedz({
    wykonawca: WYKONAWCA, przetarg: PRZETARG, dzisiaj: DZIS,
    wezwanie: { rodzaj: 'uzupelnienie', znak: 'ZP.271.14.2026/W1', dataWezwania: '2026-10-22', termin: '2026-10-27', godzina: '10:00' },
    dokumenty: [{ nazwa: 'Zaświadczenie ZUS' }, { nazwa: 'Wykaz robót z referencjami' }],
  });
  assert.equal(dok.nazwa, 'Odpowiedź na wezwanie (art. 128 ust. 1 Pzp)');
  assert.match(dok.tresc, /art\. 128 ust\. 1/);
  assert.match(dok.tresc, /wezwanie z dnia 22\.10\.2026/);
  assert.match(dok.tresc, /ZP\.271\.14\.2026\/W1/);
  assert.match(dok.tresc, /1\. Zaświadczenie ZUS/);
  assert.match(dok.tresc, /2\. Wykaz robót z referencjami/);
  assert.match(dok.tresc, /aktualne na dzień (ich )?złożenia/i);
  assert.match(dok.tresc, /Gmina Miejska Kraków/);
  assert.match(dok.tresc, /Budrem Sp\. z o\.o\./);
  assert.match(dok.tresc, /Kraków, 23\.10\.2026/);
  assert.match(dok.tresc, /podpis kwalifikowany/i);
  assert.match(dok.tresc, /27\.10\.2026.*10:00/, 'pismo przypomina termin z wezwania');
});

test('pismo na art. 223: wyjaśnienia wchodzą do treści i jest zastrzeżenie o braku zmiany oferty; bez listy załączników gdy brak', () => {
  const dok = generujOdpowiedz({
    wykonawca: WYKONAWCA, przetarg: PRZETARG, dzisiaj: DZIS,
    wezwanie: { rodzaj: 'wyjasnienia_tresci', termin: '2026-10-30' },
    wyjasnienie: 'Pozycja 3 kosztorysu obejmuje montaż wraz z materiałem, zgodnie z pkt 4.2 SWZ.',
    dokumenty: [],
  });
  assert.match(dok.tresc, /art\. 223 ust\. 1/);
  assert.match(dok.tresc, /Pozycja 3 kosztorysu/);
  assert.match(dok.tresc, /nie prowadzą do zmiany treści oferty/i);
  assert.doesNotMatch(dok.tresc, /ZAŁĄCZNIKI/);
});

test('pismo na art. 224: dowody jako załączniki + uwaga kierująca do Obrony ceny', () => {
  const dok = generujOdpowiedz({
    wykonawca: WYKONAWCA, przetarg: PRZETARG, dzisiaj: DZIS,
    wezwanie: { rodzaj: 'razaco_niska', termin: '2026-10-30' },
    wyjasnienie: 'Cena wynika z własnego sprzętu i kadry — kalkulacja w załączeniu.',
    dokumenty: [{ nazwa: 'Kalkulacja ceny' }, { nazwa: 'Oferty dostawców materiałów' }],
  });
  assert.match(dok.tresc, /art\. 224/);
  assert.match(dok.tresc, /dowod/i);
  assert.match(dok.tresc, /1\. Kalkulacja ceny/);
  assert.equal(dok.ekranPomocy, 'ObronaCeny');
});

test('pismo: brakujące dane → kropki, nigdy „undefined"; rodzaj nieznany → „inne"', () => {
  const dok = generujOdpowiedz({});
  assert.equal(dok.rodzaj, 'inne');
  assert.match(dok.tresc, /…/);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});

test('stan odpowiedzi per przetarg: zapis rejestruje klucz (id oczyszczone), odczyt odtwarza, śmieci → null', async () => {
  const { kluczStanuWezwania, wczytajStanWezwania, zapiszStanWezwania } = await import('../src/lib/odpowiedzNaWezwanie.js');
  const { KLUCZ_INDEKSU_KONTA } = await import('../src/lib/daneLokalne.js');
  const mapa = new Map();
  const storage = { getItem: async (k) => mapa.get(k) ?? null, setItem: async (k, v) => { mapa.set(k, v); }, deleteItem: async (k) => { mapa.delete(k); } };
  assert.equal(await wczytajStanWezwania(storage, 'bzp:1'), null);
  await zapiszStanWezwania(storage, 'bzp:1', { tekst: 'Wezwanie…', rodzaj: 'uzupelnienie', termin: '2026-10-27', dokumenty: ['ZUS'] });
  assert.deepEqual(await wczytajStanWezwania(storage, 'bzp:1'), { tekst: 'Wezwanie…', rodzaj: 'uzupelnienie', termin: '2026-10-27', dokumenty: ['ZUS'] });
  assert.ok(String(mapa.get(KLUCZ_INDEKSU_KONTA)).includes(kluczStanuWezwania('bzp:1')));
  assert.match(kluczStanuWezwania('bzp:1'), /^przetargai\.wezwanie-odpowiedz\.bzp_1$/);
  mapa.set(kluczStanuWezwania('x'), '{zle');
  assert.equal(await wczytajStanWezwania(storage, 'x'), null);
});

test('kontrola przed wysłaniem: termin (po terminie = danger), brak załączników, podpis, aktualność dokumentów z podpowiedzi', () => {
  const teraz = Date.parse('2026-10-26T08:00:00Z');
  const k = kontrolaPrzedWyslaniem({ rodzaj: 'uzupelnienie', termin: '2026-10-27', dokumenty: [{ nazwa: 'Zaświadczenie ZUS' }], teraz });
  const ids = k.map((p) => p.id);
  assert.ok(ids.includes('termin') && ids.includes('podpis') && ids.includes('forma'));
  assert.equal(k.find((p) => p.id === 'termin').ton, 'ostrzezenie', 'mniej niż 3 dni = ostrzeżenie');
  assert.ok(k.some((p) => p.id.startsWith('dokument:') && /ZUS/.test(p.tekst)), 'podpowiedź aktualności ZUS');

  const po = kontrolaPrzedWyslaniem({ rodzaj: 'uzupelnienie', termin: '2026-10-20', dokumenty: [], teraz });
  assert.equal(po.find((p) => p.id === 'termin').ton, 'danger');
  assert.equal(po.find((p) => p.id === 'zalaczniki').ton, 'danger', 'brak załączników przy art. 128 = czerwony');

  const wyj = kontrolaPrzedWyslaniem({ rodzaj: 'wyjasnienia_tresci', termin: null, dokumenty: [], teraz });
  assert.ok(!wyj.some((p) => p.id === 'zalaczniki'), 'przy wyjaśnieniach treści załączniki nie są wymagane');
  assert.equal(wyj.find((p) => p.id === 'termin').ton, 'neutral');
});
