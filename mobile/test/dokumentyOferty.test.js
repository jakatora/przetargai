import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ID_POL_WYKONAWCY,
  POLA_WYKONAWCY,
  WIELKOSCI_FIRMY,
  KIEDY,
  ETYKIETY_KIEDY,
  szablonDanychWykonawcy,
  walidujDaneWykonawcy,
  daneZOgloszenia,
  policzBrutto,
  generujOswiadczenie125,
  generujFormularzOfertowy,
  generujOswiadczenieGrupaKapitalowa,
  generujOswiadczenieAktualnosci,
  coJeszczeDolaczyc,
  pakietDokumentow,
} from '../src/lib/dokumentyOferty.js';

/*
 * „Dokumenty do oferty w 1 klik" — generator oświadczeń i formularza ofertowego
 * z danych wykonawcy (wpisanych RAZ) i danych ogłoszenia. Czysta logika bez UI,
 * bez sieci, bez zegara (data wchodzi parametrem `dzisiaj`).
 *
 * Po co testy: użytkownik podpisze i wyśle te teksty zamawiającemu. Pomyłka
 * w podstawie prawnej, brak wymaganego elementu albo źle policzone brutto to
 * odrzucona oferta — dlatego pilnujemy treści, nie tylko „że coś zwraca".
 */

function wykonawcaPelny() {
  return {
    nazwa: 'Budrem Sp. z o.o.',
    adres: 'ul. Długa 12, 30-001 Kraków',
    nip: '5261040827', // poprawna suma kontrolna
    regon: '012345678',
    rejestr: 'KRS 0000123456',
    reprezentant: 'Jan Kowalski',
    stanowisko: 'Prezes Zarządu',
    email: 'biuro@budrem.pl',
    telefon: '600 100 200',
    miejscowosc: 'Kraków',
    wielkosc: 'male',
  };
}

const PRZETARG = {
  tytul: 'Remont dachu szkoły podstawowej nr 3',
  zamawiajacy: 'Gmina Miejska Kraków',
  numer: 'ZP.271.14.2026',
  termin: '2026-11-05T10:00:00.000Z',
  zrodlo: 'bzp',
};

const DZIS = '2026-10-23T09:00:00.000Z';

test('model pól: każde pole ma id, etykietę i flagę wymagane; wymagane to minimum do podpisu', () => {
  const ids = POLA_WYKONAWCY.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'zdublowane id pól');
  for (const p of POLA_WYKONAWCY) {
    assert.ok(p.id && p.etykieta, 'pole bez id/etykiety');
    assert.equal(typeof p.wymagane, 'boolean');
  }
  const wymagane = POLA_WYKONAWCY.filter((p) => p.wymagane).map((p) => p.id);
  for (const w of [ID_POL_WYKONAWCY.NAZWA, ID_POL_WYKONAWCY.ADRES, ID_POL_WYKONAWCY.NIP, ID_POL_WYKONAWCY.REPREZENTANT, ID_POL_WYKONAWCY.EMAIL]) {
    assert.ok(wymagane.includes(w), `${w} musi być wymagane`);
  }
  assert.ok(Object.isFrozen(POLA_WYKONAWCY));
});

test('szablon danych wykonawcy: pusty, a z profilu bierze nazwę i NIP', () => {
  const pusty = szablonDanychWykonawcy();
  for (const p of POLA_WYKONAWCY) assert.equal(pusty[p.id], '', `pole ${p.id} nie jest puste`);

  const zProfilu = szablonDanychWykonawcy({ company_name: 'Alfa S.A.', company_nip: '526-10-40-827' });
  assert.equal(zProfilu.nazwa, 'Alfa S.A.');
  assert.equal(zProfilu.nip, '5261040827', 'NIP z profilu znormalizowany do samych cyfr');
});

test('walidacja: braki wymaganych pól i zły NIP (suma kontrolna) blokują komplet', () => {
  const ok = walidujDaneWykonawcy(wykonawcaPelny());
  assert.equal(ok.kompletne, true);
  assert.deepEqual(ok.braki, []);
  assert.deepEqual(ok.bledy, []);

  const bezAdresu = walidujDaneWykonawcy({ ...wykonawcaPelny(), adres: '  ' });
  assert.equal(bezAdresu.kompletne, false);
  assert.deepEqual(bezAdresu.braki.map((b) => b.id), [ID_POL_WYKONAWCY.ADRES]);

  const zlyNip = walidujDaneWykonawcy({ ...wykonawcaPelny(), nip: '5261040828' });
  assert.equal(zlyNip.kompletne, false);
  assert.equal(zlyNip.bledy[0].id, ID_POL_WYKONAWCY.NIP);
  assert.match(zlyNip.bledy[0].komunikat, /sum/i);

  const nipZKreskami = walidujDaneWykonawcy({ ...wykonawcaPelny(), nip: '526-104-08-27' });
  assert.equal(nipZKreskami.kompletne, true, 'kreski w NIP są dozwolone');

  const zlyEmail = walidujDaneWykonawcy({ ...wykonawcaPelny(), email: 'biuro' });
  assert.equal(zlyEmail.bledy[0].id, ID_POL_WYKONAWCY.EMAIL);

  assert.equal(walidujDaneWykonawcy(null).kompletne, false, 'null nie rzuca');
});

test('daneZOgloszenia mapuje pola ogłoszenia z feedu, braki → null', () => {
  const t = daneZOgloszenia({
    title: 'Dostawa papieru', organization: 'Urząd Gminy X', numer: '2026/BZP 00012345', deadline: '2026-12-01', source: 'ted',
  });
  assert.deepEqual(t, { tytul: 'Dostawa papieru', zamawiajacy: 'Urząd Gminy X', numer: '2026/BZP 00012345', termin: '2026-12-01', zrodlo: 'ted' });
  assert.deepEqual(daneZOgloszenia(undefined), { tytul: null, zamawiajacy: null, numer: null, termin: null, zrodlo: null });
});

test('policzBrutto liczy na groszach i akceptuje zapis polski', () => {
  assert.deepEqual(policzBrutto('12 500,50', 23), { netto: 12500.5, vat: 2875.12, brutto: 15375.62 });
  assert.deepEqual(policzBrutto('100', 0), { netto: 100, vat: 0, brutto: 100 });
  assert.equal(policzBrutto('', 23), null, 'puste → null');
  assert.equal(policzBrutto('abc', 23), null, 'nie-liczba → null');
  assert.equal(policzBrutto('1.200', 23), null, 'niejednoznaczne „1.200" → null (tak jak w kalkulatorach)');
});

test('oświadczenie art. 125 ust. 1: ma podstawę, obie części (wykluczenie + warunki), dane stron i miejsce na podpis elektroniczny', () => {
  const dok = generujOswiadczenie125({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, dzisiaj: DZIS });
  assert.equal(dok.kiedy, KIEDY.Z_OFERTA);
  assert.match(dok.tresc, /art\. 125 ust\. 1/);
  assert.match(dok.tresc, /nie podlegam wykluczeniu/i);
  assert.match(dok.tresc, /art\. 108 ust\. 1/);
  assert.match(dok.tresc, /spełniam warunki udziału/i);
  assert.match(dok.tresc, /Budrem Sp\. z o\.o\./);
  assert.match(dok.tresc, /NIP 5261040827/);
  assert.match(dok.tresc, /Jan Kowalski/);
  assert.match(dok.tresc, /Gmina Miejska Kraków/);
  assert.match(dok.tresc, /ZP\.271\.14\.2026/);
  assert.match(dok.tresc, /Kraków, 23\.10\.2026/);
  assert.match(dok.tresc, /podpis (kwalifikowany|elektroniczny)/i);
  assert.doesNotMatch(dok.tresc, /art\. 109/, 'bez opcji art. 109 nie wspominamy fakultatywnych przesłanek');

  const zArt109 = generujOswiadczenie125({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, dzisiaj: DZIS, opcje: { art109: true } });
  assert.match(zArt109.tresc, /art\. 109 ust\. 1/);
});

test('oświadczenie 125 powyżej progów UE (TED) niesie uwagę o JEDZ', () => {
  const dok = generujOswiadczenie125({ wykonawca: wykonawcaPelny(), przetarg: { ...PRZETARG, zrodlo: 'ted' }, dzisiaj: DZIS });
  assert.match(dok.uwaga ?? '', /JEDZ/);
  const bzp = generujOswiadczenie125({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, dzisiaj: DZIS });
  assert.equal(bzp.uwaga, null);
});

test('formularz ofertowy: cena netto/VAT/brutto po polsku, termin, gwarancja, podwykonawcy, oświadczenia obowiązkowe', () => {
  const dok = generujFormularzOfertowy({
    wykonawca: wykonawcaPelny(),
    przetarg: PRZETARG,
    oferta: { cenaNetto: '250 000', vatProc: 23, terminWykonania: '90 dni od podpisania umowy', gwarancjaMies: '36', podwykonawcy: '', tajemnica: false },
    dzisiaj: DZIS,
  });
  assert.equal(dok.kiedy, KIEDY.Z_OFERTA);
  assert.match(dok.tresc, /250 000,00 zł/);
  assert.match(dok.tresc, /VAT 23 %: 57 500,00 zł/);
  assert.match(dok.tresc, /brutto: 307 500,00 zł/);
  assert.match(dok.tresc, /90 dni od podpisania umowy/);
  assert.match(dok.tresc, /36 miesi/);
  assert.match(dok.tresc, /bez udziału podwykonawców/i);
  assert.match(dok.tresc, /zapoznał/i, 'oświadczenie o zapoznaniu się z SWZ');
  assert.match(dok.tresc, /związan/i, 'oświadczenie o terminie związania ofertą');
  assert.match(dok.tresc, /RODO/);
  assert.match(dok.tresc, /mał(e|ym) przedsiębior/i, 'status MŚP z danych wykonawcy');
  assert.match(dok.tresc, /nie zawiera informacji stanowiących tajemnicę/i, 'bez zastrzeżenia — jawne oświadczenie o braku tajemnicy');
});

test('formularz ofertowy: brak ceny daje kropki zamiast kwoty, podwykonawcy i tajemnica wchodzą gdy podane', () => {
  const dok = generujFormularzOfertowy({
    wykonawca: wykonawcaPelny(),
    przetarg: PRZETARG,
    oferta: { cenaNetto: '', vatProc: 8, podwykonawcy: 'Instalacje elektryczne — Elektro-Bud s.c.', tajemnica: true },
    dzisiaj: DZIS,
  });
  assert.match(dok.tresc, /netto: …/);
  assert.match(dok.tresc, /Elektro-Bud s\.c\./);
  assert.match(dok.tresc, /stanowią tajemnicę przedsiębiorstwa/i);
  assert.ok(dok.braki.includes('cena'), 'formularz zgłasza, że cena nie została podana');
});

test('grupa kapitałowa: wariant „nie należę" i „należę" z listą; składane na wezwanie', () => {
  const nie = generujOswiadczenieGrupaKapitalowa({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, nalezy: false, dzisiaj: DZIS });
  assert.equal(nie.kiedy, KIEDY.NA_WEZWANIE);
  assert.match(nie.tresc, /art\. 108 ust\. 1 pkt 5/);
  assert.match(nie.tresc, /nie należ/i);

  const tak = generujOswiadczenieGrupaKapitalowa({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, nalezy: true, czlonkowie: ['Budrem Holding S.A.'], dzisiaj: DZIS });
  assert.match(tak.tresc, /należ/i);
  assert.match(tak.tresc, /Budrem Holding S\.A\./);
  assert.match(tak.tresc, /niezależnie/i, 'przy przynależności trzeba oświadczyć niezależne przygotowanie oferty');
});

test('oświadczenie o aktualności informacji: na wezwanie, odwołuje się do oświadczenia z art. 125', () => {
  const dok = generujOswiadczenieAktualnosci({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, dzisiaj: DZIS });
  assert.equal(dok.kiedy, KIEDY.NA_WEZWANIE);
  assert.match(dok.tresc, /aktualn/i);
  assert.match(dok.tresc, /art\. 125 ust\. 1/);
});

test('coJeszczeDolaczyc: lista zależy od sytuacji wykonawcy', () => {
  const nic = coJeszczeDolaczyc({});
  assert.deepEqual(nic.map((p) => p.id), ['podpis'], 'zawsze przypominamy o podpisie elektronicznym');

  const wszystko = coJeszczeDolaczyc({ pelnomocnik: true, polegaNaZasobach: true, konsorcjum: true, wadium: true });
  const ids = wszystko.map((p) => p.id);
  for (const w of ['pelnomocnictwo', 'zobowiazanie118', 'konsorcjum117', 'wadium', 'podpis']) assert.ok(ids.includes(w), `brak ${w}`);
  const zob = wszystko.find((p) => p.id === 'zobowiazanie118');
  assert.equal(zob.ekran, 'Kreator118', 'pozycja prowadzi do istniejącego narzędzia');
});

test('pakietDokumentow: 4 dokumenty w stałej kolejności, z etykietą „kiedy", każdy ma treść i podstawę', () => {
  const pakiet = pakietDokumentow({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, oferta: { cenaNetto: '1000', vatProc: 23 }, dzisiaj: DZIS });
  assert.deepEqual(pakiet.map((d) => d.id), ['formularz_ofertowy', 'oswiadczenie_125', 'oswiadczenie_grupa_kapitalowa', 'oswiadczenie_aktualnosc']);
  for (const d of pakiet) {
    assert.ok(d.nazwa && d.tresc.length > 100 && d.podstawa, `dokument ${d.id} niekompletny`);
    assert.ok(ETYKIETY_KIEDY[d.kiedy], `nieznane „kiedy": ${d.kiedy}`);
  }
  assert.equal(pakiet.filter((d) => d.kiedy === KIEDY.Z_OFERTA).length, 2);
  assert.ok(Object.isFrozen(WIELKOSCI_FIRMY));
});

test('pakiet jest deterministyczny i nie rzuca na pustych danych', () => {
  const a = pakietDokumentow({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, oferta: {}, dzisiaj: DZIS });
  const b = pakietDokumentow({ wykonawca: wykonawcaPelny(), przetarg: PRZETARG, oferta: {}, dzisiaj: DZIS });
  assert.deepEqual(a, b);
  const pusty = pakietDokumentow({});
  assert.equal(pusty.length, 4);
  assert.match(pusty[1].tresc, /…/, 'brakujące dane to kropki, nie „undefined"');
  assert.doesNotMatch(pusty.map((d) => d.tresc).join('\n'), /undefined|null|NaN/);
});
