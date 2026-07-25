import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analizuj_oferte_zwyciezcy,
  regula_zly_format_podpisu,
  regula_brak_oswiadczen,
  regula_nieaktualne_zaswiadczenia,
  regula_niezgodnosc_swz,
  regula_razaco_niska_cena,
  SILA_ZARZUTU,
  WINDOWS_WAZNOSCI_ZASWIADCZEN,
  DEFAULT_WYMAGANE_OSWIADCZENIA,
} from '../src/lib/silnikRegulOdrzucenia.js';

/*
 * Silnik reguł odrzucenia oferty zwycięzcy (podzadanie 10/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie"). Uruchamia reguły
 * przesłanek odrzucenia na polach z parsera oferty ({@link wyodrebnij_pola_z_oferty})
 * i agreguje wykryte w listę zarzutów. Każda reguła to czysta funkcja zwracająca
 * { wykryto, opis_zarzutu, sila } — jak reguła ceny z podzadania 9/13.
 *
 * Wszystkie funkcje są deterministyczne i defensywne (nigdy nie rzucają, bez
 * Date.now() — datę odniesienia „dzisiaj" wstrzykujemy).
 */

// --- Kontrakt eksportowany ---

test('re-eksportuje skalę siły i regułę ceny z podzadania 9/13', () => {
  assert.deepEqual(SILA_ZARZUTU, ['slaba', 'umiarkowana', 'mocna']);
  assert.equal(typeof regula_razaco_niska_cena, 'function');
});

test('DEFAULT_WYMAGANE_OSWIADCZENIA: oświadczenie wstępne z art. 125 Pzp', () => {
  assert.deepEqual(DEFAULT_WYMAGANE_OSWIADCZENIA, [
    'niepodleganie_wykluczeniu',
    'spelnianie_warunkow',
  ]);
});

test('WINDOWS_WAZNOSCI_ZASWIADCZEN: okna ważności w miesiącach (KRK 6, reszta 3)', () => {
  assert.equal(WINDOWS_WAZNOSCI_ZASWIADCZEN.ZUS, 3);
  assert.equal(WINDOWS_WAZNOSCI_ZASWIADCZEN.US, 3);
  assert.equal(WINDOWS_WAZNOSCI_ZASWIADCZEN.KRK, 6);
  assert.equal(WINDOWS_WAZNOSCI_ZASWIADCZEN.KRS, 3);
  assert.equal(WINDOWS_WAZNOSCI_ZASWIADCZEN.CEIDG, 3);
});

// --- Reguła: zły format podpisu (art. 63 Pzp) ---

test('podpis: dopuszczalna forma (kwalifikowany) — brak zarzutu', () => {
  const wynik = regula_zly_format_podpisu({ formatPodpisu: 'kwalifikowany' });
  assert.equal(wynik.wykryto, false);
  assert.equal(wynik.opis_zarzutu, null);
  assert.equal(wynik.sila, null);
});

test('podpis: forma nieokreślona — słaby zarzut (nie potwierdzono podpisu)', () => {
  const wynik = regula_zly_format_podpisu({ formatPodpisu: 'nieokreslony' });
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'slaba');
  assert.match(wynik.opis_zarzutu, /podpis/i);
});

test('podpis: forma spoza dopuszczalnych (zaufany, gdy wymagany kwalifikowany) — mocny zarzut', () => {
  const wynik = regula_zly_format_podpisu(
    { formatPodpisu: 'zaufany' },
    { dozwolonePodpisy: ['kwalifikowany'] },
  );
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'mocna');
  assert.match(wynik.opis_zarzutu, /art\. 63/);
  assert.match(wynik.opis_zarzutu, /kwalifikowan/i);
});

test('podpis: dopuszczalny mimo zawężenia listy — brak zarzutu', () => {
  const wynik = regula_zly_format_podpisu(
    { formatPodpisu: 'kwalifikowany' },
    { dozwolonePodpisy: ['kwalifikowany'] },
  );
  assert.equal(wynik.wykryto, false);
});

test('podpis: brak pola formatu (brak danych) — nie zgadujemy, brak zarzutu', () => {
  assert.deepEqual(regula_zly_format_podpisu({}), {
    wykryto: false,
    opis_zarzutu: null,
    sila: null,
  });
  assert.deepEqual(regula_zly_format_podpisu(null), {
    wykryto: false,
    opis_zarzutu: null,
    sila: null,
  });
  assert.doesNotThrow(() => regula_zly_format_podpisu());
});

// --- Reguła: brak wymaganych oświadczeń (art. 125/128 Pzp) ---

test('oświadczenia: komplet wymaganych — brak zarzutu', () => {
  const pola = {
    oswiadczenia: [
      { rodzaj: 'niepodleganie_wykluczeniu', etykieta: '...' },
      { rodzaj: 'spelnianie_warunkow', etykieta: '...' },
    ],
  };
  assert.equal(regula_brak_oswiadczen(pola).wykryto, false);
});

test('oświadczenia: brak jednego z wymaganych — zarzut umiarkowany z etykietą', () => {
  const pola = { oswiadczenia: [{ rodzaj: 'niepodleganie_wykluczeniu' }] };
  const wynik = regula_brak_oswiadczen(pola);
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'umiarkowana');
  assert.match(wynik.opis_zarzutu, /spełnianiu warunków/i);
});

test('oświadczenia: własna lista wymaganych z SWZ (JEDZ)', () => {
  const pola = { oswiadczenia: [{ rodzaj: 'niepodleganie_wykluczeniu' }] };
  const wynik = regula_brak_oswiadczen(pola, { wymaganeOswiadczenia: ['jedz'] });
  assert.equal(wynik.wykryto, true);
  assert.match(wynik.opis_zarzutu, /JEDZ/);
});

test('oświadczenia: brak tablicy oświadczeń (brak danych) — brak zarzutu', () => {
  assert.equal(regula_brak_oswiadczen({}).wykryto, false);
  assert.equal(regula_brak_oswiadczen(null).wykryto, false);
  assert.doesNotThrow(() => regula_brak_oswiadczen());
});

// --- Reguła: nieaktualne zaświadczenia (rozporządzenie ws. podmiotowych środków dowodowych) ---

test('zaświadczenia: ZUS wystawione 4 mies. temu (okno 3) — zarzut umiarkowany', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'ZUS', etykieta: 'ZUS', data: '2025-12-01' }] };
  const wynik = regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-01' });
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'umiarkowana');
  assert.match(wynik.opis_zarzutu, /ZUS/);
});

test('zaświadczenia: ZUS wystawione 2 mies. temu (okno 3) — brak zarzutu', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'ZUS', data: '2026-02-01' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-01' }).wykryto, false);
});

test('zaświadczenia: granica okna (dokładnie 3 mies.) — jeszcze aktualne', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'US', data: '2026-01-15' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-15' }).wykryto, false);
});

test('zaświadczenia: dzień po granicy okna — nieaktualne', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'US', data: '2026-01-15' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-16' }).wykryto, true);
});

test('zaświadczenia: KRK ma dłuższe okno (6 mies.) — 5 mies. wciąż aktualne', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'KRK', data: '2025-11-01' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-01' }).wykryto, false);
});

test('zaświadczenia: KRK po 7 mies. — nieaktualne', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'KRK', data: '2025-09-01' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-01' }).wykryto, true);
});

test('zaświadczenia: bez daty odniesienia „dzisiaj" — nie oceniamy, brak zarzutu', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'ZUS', data: '2020-01-01' }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola).wykryto, false);
});

test('zaświadczenia: wpis bez czytelnej daty jest pomijany (nie zgadujemy staleness)', () => {
  const pola = { zaswiadczenia: [{ rodzaj: 'ZUS', data: null }] };
  assert.equal(regula_nieaktualne_zaswiadczenia(pola, { dzisiaj: '2026-04-01' }).wykryto, false);
});

test('zaświadczenia: brak tablicy — brak danych, brak zarzutu, nie rzuca', () => {
  assert.equal(regula_nieaktualne_zaswiadczenia({}, { dzisiaj: '2026-04-01' }).wykryto, false);
  assert.doesNotThrow(() => regula_nieaktualne_zaswiadczenia());
});

// --- Reguła: niezgodność z SWZ (art. 226 ust. 1 pkt 5 Pzp) ---

test('SWZ: cena przekracza maksimum z SWZ — mocny zarzut', () => {
  const pola = { cena: { kwota: 120000, waluta: 'PLN' } };
  const wynik = regula_niezgodnosc_swz(pola, { swz: { cenaMaksymalna: 100000 } });
  assert.equal(wynik.wykryto, true);
  assert.equal(wynik.sila, 'mocna');
  assert.match(wynik.opis_zarzutu, /art\. 226/);
});

test('SWZ: cena poniżej maksimum — brak zarzutu', () => {
  const pola = { cena: { kwota: 90000, waluta: 'PLN' } };
  assert.equal(regula_niezgodnosc_swz(pola, { swz: { cenaMaksymalna: 100000 } }).wykryto, false);
});

test('SWZ: waluta oferty inna niż wymagana — mocny zarzut', () => {
  const pola = { cena: { kwota: 100000, waluta: 'EUR' } };
  const wynik = regula_niezgodnosc_swz(pola, { swz: { walutaWymagana: 'PLN' } });
  assert.equal(wynik.wykryto, true);
  assert.match(wynik.opis_zarzutu, /walu/i);
});

test('SWZ: waluta zgodna — brak zarzutu', () => {
  const pola = { cena: { kwota: 100000, waluta: 'PLN' } };
  assert.equal(regula_niezgodnosc_swz(pola, { swz: { walutaWymagana: 'PLN' } }).wykryto, false);
});

test('SWZ: nieznana waluta oferty (null) nie jest oskarżana', () => {
  const pola = { cena: { kwota: 100000, waluta: null } };
  assert.equal(regula_niezgodnosc_swz(pola, { swz: { walutaWymagana: 'PLN' } }).wykryto, false);
});

test('SWZ: bez wymagań SWZ nie da się ocenić — brak zarzutu, nie rzuca', () => {
  const pola = { cena: { kwota: 100000, waluta: 'PLN' } };
  assert.equal(regula_niezgodnosc_swz(pola).wykryto, false);
  assert.doesNotThrow(() => regula_niezgodnosc_swz());
});

// --- Silnik: agregacja do listy zarzutów ---

test('silnik: czysta oferta bez wymagań kontekstu — brak zarzutów', () => {
  const pola = {
    cena: { kwota: 100000, waluta: 'PLN' },
    formatPodpisu: 'kwalifikowany',
    oswiadczenia: [
      { rodzaj: 'niepodleganie_wykluczeniu' },
      { rodzaj: 'spelnianie_warunkow' },
    ],
    zaswiadczenia: [],
  };
  const wynik = analizuj_oferte_zwyciezcy(pola);
  assert.deepEqual(wynik.zarzuty, []);
  assert.equal(wynik.liczba, 0);
  assert.equal(wynik.najwyzszaSila, null);
});

test('silnik: dołącza regułę ceny (rażąco niska) przez kontekst.oferty', () => {
  const pola = {
    cena: { kwota: 30000 },
    formatPodpisu: 'kwalifikowany',
    oswiadczenia: [
      { rodzaj: 'niepodleganie_wykluczeniu' },
      { rodzaj: 'spelnianie_warunkow' },
    ],
    zaswiadczenia: [],
  };
  const wynik = analizuj_oferte_zwyciezcy(pola, { oferty: [30000, 130000, 140000] });
  const ceny = wynik.zarzuty.filter((z) => z.rodzaj === 'razaco_niska_cena');
  assert.equal(ceny.length, 1);
  assert.equal(ceny[0].sila, 'mocna');
});

test('silnik: wiele zarzutów — sortuje malejąco wg siły (mocna → słaba)', () => {
  const pola = {
    cena: { kwota: 30000 }, // mocna po dołączeniu ofert
    formatPodpisu: 'nieokreslony', // słaba
    oswiadczenia: [{ rodzaj: 'niepodleganie_wykluczeniu' }], // brak spełniania warunków → umiarkowana
    zaswiadczenia: [],
  };
  const wynik = analizuj_oferte_zwyciezcy(pola, { oferty: [30000, 130000, 140000] });
  const sily = wynik.zarzuty.map((z) => z.sila);
  const idx = (s) => SILA_ZARZUTU.indexOf(s);
  for (let i = 1; i < sily.length; i += 1) {
    assert.ok(idx(sily[i - 1]) >= idx(sily[i]), `posortowane malejąco: ${sily.join(',')}`);
  }
  assert.equal(wynik.najwyzszaSila, 'mocna');
  assert.equal(wynik.liczba, wynik.zarzuty.length);
});

test('silnik: każdy zarzut ma rodzaj, tytuł, opis i siłę', () => {
  const pola = { formatPodpisu: 'nieokreslony', oswiadczenia: [], zaswiadczenia: [] };
  const wynik = analizuj_oferte_zwyciezcy(pola);
  assert.ok(wynik.zarzuty.length > 0);
  for (const z of wynik.zarzuty) {
    assert.equal(typeof z.rodzaj, 'string');
    assert.equal(typeof z.tytul, 'string');
    assert.equal(typeof z.opis_zarzutu, 'string');
    assert.ok(SILA_ZARZUTU.includes(z.sila));
  }
});

test('silnik: brak pól (null/undefined) — nie ma czego analizować, pusty wynik, nie rzuca', () => {
  const pusty = { zarzuty: [], liczba: 0, najwyzszaSila: null };
  assert.deepEqual(analizuj_oferte_zwyciezcy(null), pusty);
  assert.deepEqual(analizuj_oferte_zwyciezcy(), pusty);
  assert.deepEqual(analizuj_oferte_zwyciezcy('nie obiekt'), pusty);
});

test('silnik: realny kształt z parsera oferty przechodzi bez wyjątku', () => {
  // Kształt dokładnie jak zwraca wyodrebnij_pola_z_oferty.
  const pola = {
    nazwaPliku: 'oferta.pdf',
    cena: { kwota: 40000, waluta: 'PLN', surowa: '40 000 zł' },
    formatPodpisu: 'kwalifikowany',
    oswiadczenia: [{ rodzaj: 'niepodleganie_wykluczeniu', etykieta: '...' }],
    zaswiadczenia: [{ rodzaj: 'ZUS', etykieta: 'ZUS', data: '2025-01-01', surowaData: '01.01.2025' }],
  };
  const wynik = analizuj_oferte_zwyciezcy(pola, {
    oferty: [40000, 130000, 130000],
    dzisiaj: '2026-04-01',
    swz: { walutaWymagana: 'PLN', cenaMaksymalna: 200000 },
  });
  // Oczekujemy: rażąco niska cena (mocna) + brak spełniania warunków (umiarkowana)
  // + nieaktualne ZUS (umiarkowana). Waluta i cena zgodne z SWZ → bez zarzutu SWZ.
  const rodzaje = wynik.zarzuty.map((z) => z.rodzaj);
  assert.ok(rodzaje.includes('razaco_niska_cena'));
  assert.ok(rodzaje.includes('brak_oswiadczen'));
  assert.ok(rodzaje.includes('nieaktualne_zaswiadczenia'));
  assert.ok(!rodzaje.includes('niezgodnosc_swz'));
});
