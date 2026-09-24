import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  profilRadaru, zbudujRadar, zbudujSzczegolPlanu, ogloszenieZPrzetargu, LIMIT_DOMYSLNY, LIMIT_MAKS,
} from '../src/lib/widokRadaru.js';

const DZIS = '2026-09-24';

const wpis = (id, nad = {}) => ({
  id,
  przedmiot: 'Przebudowa drogi gminnej',
  cpv: ['45233140'],
  region: '14',
  terminWszczecia: '2026-12-01',
  wartosc: null,
  waluta: null,
  zamawiajacy: 'Gmina X',
  zamawiajacy_nip: '5251575309',
  rodzaj: 'pin-rtl',
  skraca_termin: true,
  opublikowano: '2026-09-20',
  wygasa_o: '2027-01-30',
  ...nad,
});

const UZYTKOWNIK = { cpv_codes: ['45233140'], keywords: ['droga'], regiony: ['14'], wartosc_max: 2_000_000 };

describe('profil radaru z konta', () => {
  test('mapuje pola konta na wejście czystych modułów', () => {
    const p = profilRadaru(UZYTKOWNIK, DZIS);
    assert.deepEqual(p.cpv, ['45233140']);
    assert.deepEqual(p.slowaKluczowe, ['droga']);
    assert.deepEqual(p.regiony, ['14']);
    assert.equal(p.maksymalnaWartoscKontraktu, 2_000_000);
    assert.equal(p.dzisiaj, DZIS);
    assert.equal(p.pusty, false);
  });

  test('bez CPV i słów profil jest pusty (region sam nie wystarcza)', () => {
    assert.equal(profilRadaru({ regiony: ['14'] }, DZIS).pusty, true);
    assert.equal(profilRadaru(null, DZIS).pusty, true);
  });
});

describe('zbudujRadar — tryb „dla mnie"', () => {
  test('ranking z wynikiem, poziomem i powodami; najbliższy termin u góry', () => {
    const wynik = zbudujRadar({
      wpisy: [
        wpis('pozny', { terminWszczecia: '2027-03-01' }),
        wpis('bliski', { terminWszczecia: '2026-10-15' }),
        wpis('obcy', { cpv: ['90511000'], przedmiot: 'Odbiór odpadów', region: '02' }),
      ],
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
    });
    assert.equal(wynik.tryb, 'dla_mnie');
    assert.deepEqual(wynik.pozycje.map((p) => p.id), ['bliski', 'pozny']);
    const p = wynik.pozycje[0];
    assert.equal(p.poziom, 'MOCNE');
    assert.ok(p.wynik >= 48);
    assert.ok(p.powody.length >= 1);
    assert.equal(p.miesiacyDoWszczecia, 1);
    assert.equal(p.region_nazwa, 'Mazowieckie');
    assert.match(p.url, /ted\.europa\.eu\/pl\/notice\/-\/detail\/bliski/);
    assert.ok(p.rodzaj_opis.pl && p.rodzaj_opis.en);
    assert.equal(p.skraca_termin, true);
    assert.equal(wynik.lacznie_aktywnych, 3);
    assert.equal(wynik.dopasowanych, 2);
    assert.equal(wynik.podpowiedz, null);
  });

  test('wygasłe pozycje nie wchodzą, nawet gdy leżą jeszcze w indeksie', () => {
    const wynik = zbudujRadar({
      wpisy: [wpis('stary', { wygasa_o: '2026-09-01' }), wpis('ok')],
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
    });
    assert.deepEqual(wynik.pozycje.map((p) => p.id), ['ok']);
    assert.equal(wynik.lacznie_aktywnych, 1);
  });

  test('pusty profil → podpowiedź zamiast pustki, pozycje z przeglądu', () => {
    const wynik = zbudujRadar({ wpisy: [wpis('a'), wpis('b')], uzytkownik: {}, dzisiaj: DZIS });
    assert.equal(wynik.podpowiedz.kod, 'uzupelnij_profil');
    assert.ok(wynik.podpowiedz.pl && wynik.podpowiedz.en);
    assert.equal(wynik.tryb, 'wszystkie', 'bez profilu pokazujemy rynek planów, nie zero');
    assert.equal(wynik.pozycje.length, 2);
  });

  test('profil bez trafień → podpowiedź „brak_trafien" z liczbą aktywnych planów', () => {
    const wynik = zbudujRadar({
      wpisy: [wpis('x', { cpv: ['90511000'], przedmiot: 'Odpady', region: '02' })],
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
    });
    assert.equal(wynik.pozycje.length, 0);
    assert.equal(wynik.podpowiedz.kod, 'brak_trafien');
    assert.match(wynik.podpowiedz.pl, /1/);
  });

  test('limit domyślny i sufit', () => {
    const wpisy = Array.from({ length: LIMIT_MAKS + 20 }, (_, i) => wpis(`p${i}`));
    assert.equal(zbudujRadar({ wpisy, uzytkownik: UZYTKOWNIK, dzisiaj: DZIS }).pozycje.length, LIMIT_DOMYSLNY);
    assert.equal(zbudujRadar({ wpisy, uzytkownik: UZYTKOWNIK, dzisiaj: DZIS, limit: 10_000 }).pozycje.length, LIMIT_MAKS);
  });
});

describe('zbudujRadar — tryb „wszystkie"', () => {
  test('bez rankingu: termin rosnąco, nieznany termin na końcu', () => {
    const wynik = zbudujRadar({
      wpisy: [wpis('bez', { terminWszczecia: null }), wpis('pozny', { terminWszczecia: '2027-01-10' }), wpis('bliski', { terminWszczecia: '2026-10-01' })],
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
      tryb: 'wszystkie',
    });
    assert.deepEqual(wynik.pozycje.map((p) => p.id), ['bliski', 'pozny', 'bez']);
    assert.equal(wynik.pozycje[0].wynik, null);
    assert.equal(wynik.pozycje[2].miesiacyDoWszczecia, null);
  });

  test('filtr regionu przyjmuje kod albo nazwę', () => {
    const wpisy = [wpis('maz', { region: '14' }), wpis('mal', { region: '12' })];
    const kod = zbudujRadar({ wpisy, uzytkownik: {}, dzisiaj: DZIS, tryb: 'wszystkie', region: 'PL12' });
    assert.deepEqual(kod.pozycje.map((p) => p.id), ['mal']);
    const nazwa = zbudujRadar({ wpisy, uzytkownik: {}, dzisiaj: DZIS, tryb: 'wszystkie', region: 'mazowieckie' });
    assert.deepEqual(nazwa.pozycje.map((p) => p.id), ['maz']);
  });
});

describe('szczegół pozycji planu', () => {
  const pozycja = {
    ...wpis('657219-2026', { wartosc: 3_000_000, waluta: 'PLN' }),
    opis: 'Zakres prac…',
    url: 'https://ted.europa.eu/pl/notice/-/detail/657219-2026',
  };

  test('plan przygotowań, uzasadnienie dla profilu i ostrzeżenie o skróconym terminie', () => {
    const s = zbudujSzczegolPlanu({ pozycja, uzytkownik: UZYTKOWNIK, dzisiaj: DZIS, przetargi: [] });
    assert.equal(s.pozycja.id, '657219-2026');
    assert.equal(s.pozycja.opis, 'Zakres prac…');
    assert.ok(s.przygotowania.kamienieMilowe.length >= 3);
    assert.equal(s.przygotowania.konsorcjum.potrzebnyPartner, true, '3 mln > 2 mln potencjału');
    assert.equal(s.dopasowanie.poziom, 'MOCNE');
    assert.ok(s.ostrzezenia.some((o) => o.kod === 'skrocony_termin'));
    assert.equal(s.ogloszenie, null);
    assert.equal(s.ogloszenie_sprawdzone, true);
  });

  test('bez NIP-u nie da się sprawdzić, czy już ogłoszono — mówimy to wprost', () => {
    const s = zbudujSzczegolPlanu({
      pozycja: { ...pozycja, zamawiajacy_nip: null }, uzytkownik: UZYTKOWNIK, dzisiaj: DZIS, przetargi: [],
    });
    assert.equal(s.ogloszenie_sprawdzone, false);
    assert.ok(s.ostrzezenia.some((o) => o.kod === 'brak_nip'));
  });

  test('ogłoszenie tego zamawiającego z tym samym CPV → „to jest to, na co czekałeś"', () => {
    const s = zbudujSzczegolPlanu({
      pozycja,
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
      przetargi: [
        { id: 'inne', title: 'Dostawa papieru', cpv_main: '30197630-1', published_at: '2026-11-20T08:00:00Z', url: 'u1' },
        { id: 'to', title: 'Przebudowa drogi gminnej w X', cpv_main: '45233140-2', budget: 2_900_000, published_at: '2026-11-25T08:00:00Z', url: 'u2', deadline: '2026-12-20T10:00:00Z' },
      ],
    });
    assert.equal(s.ogloszenie.tender_id, 'to');
    assert.equal(s.ogloszenie.alarm, true);
    assert.equal(s.ogloszenie.etykieta, 'pewne');
    assert.ok(s.ogloszenie.pewnosc >= 70);
  });

  test('przetarg sprzed publikacji planu nie jest „tym" ogłoszeniem', () => {
    const s = zbudujSzczegolPlanu({
      pozycja,
      uzytkownik: UZYTKOWNIK,
      dzisiaj: DZIS,
      przetargi: [{ id: 'stary', title: 'Przebudowa drogi gminnej', cpv_main: '45233140-2', published_at: '2026-01-10T08:00:00Z' }],
    });
    assert.equal(s.ogloszenie, null);
  });

  test('ogłoszenie z przetargu: kształt wejścia dopasujOgloszenie', () => {
    const o = ogloszenieZPrzetargu({ title: 'T', cpv_main: '45233140-2', budget: 10, published_at: '2026-11-25T08:00:00Z' });
    assert.deepEqual(o, { przedmiot: 'T', cpv: '45233140-2', wartosc: 10, dataPublikacji: '2026-11-25' });
  });
});
