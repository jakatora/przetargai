import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CZESTOTLIWOSCI_ZAPASOWE,
  stanFormularza, walidujFormularz, opisObserwacji, opisCzestotliwosci,
  etykietaNastepnego, podsumowanieListy,
} from '../src/lib/zapisaneWyszukiwania.js';
import {
  grupujAlerty, tonAlertu, etykietaPlakietki, opisAlertu, opisPustegoCentrum,
} from '../src/lib/centrumAlertow.js';
import {
  GRUPY_KALENDARZA, ulozKalendarz, kartaNastepnegoKroku, opisPozycji, tonPozycji,
} from '../src/lib/kalendarzPrzetargu.js';

/*
 * MONITORING W APLIKACJI (etap 5) — CZYSTA logika trzech nowych ekranów.
 *
 * Zero importów z React Native: ekran tylko renderuje wynik, a każda decyzja
 * „stan → słowo / kolor / kolejność" ma test bez renderera. Kolory są tu wyłącznie
 * SEMANTYCZNE (`ton`) — hexy mieszkają w motyw.js i dokłada je ekran.
 */

const JEZYK = 'pl';

/* ============ zapisane wyszukiwania ============ */

test('formularz startuje z filtrów katalogu i proponowanej nazwy', () => {
  const stan = stanFormularza({ filtry: { zrodlo: 'bzp', cpv: '45000000' }, propozycja: { pl: 'BZP · CPV 45000000', en: 'x' } });

  assert.equal(stan.nazwa, 'BZP · CPV 45000000');
  assert.equal(stan.alert_wlaczony, true);
  assert.equal(stan.czestotliwosc, 'dzienna');
  assert.equal(stan.filtry.zrodlo, 'bzp');
});

test('formularz edycji odtwarza zapisany wpis, nie domyślne', () => {
  const stan = stanFormularza({
    wpis: { nazwa: 'Moje', filtry: { zrodlo: 'ted' }, alert_wlaczony: false, czestotliwosc: 'tygodniowa' },
  });
  assert.equal(stan.nazwa, 'Moje');
  assert.equal(stan.alert_wlaczony, false);
  assert.equal(stan.czestotliwosc, 'tygodniowa');
});

test('walidacja: pusta nazwa blokuje zapis i mówi dlaczego w obu językach', () => {
  const wynik = walidujFormularz({ nazwa: '   ' });
  assert.equal(wynik.ok, false);
  assert.ok(wynik.blad.pl && wynik.blad.en);

  assert.equal(walidujFormularz({ nazwa: 'Drogi' }).ok, true);
});

test('walidacja tnie zbyt długą nazwę zamiast odrzucać wpisany tekst', () => {
  const wynik = walidujFormularz({ nazwa: 'x'.repeat(200) });
  assert.equal(wynik.ok, true);
  assert.equal(wynik.nazwa.length, 60);
});

test('opis obserwacji mówi, kiedy ostatnio sprawdzaliśmy i ile znaleźliśmy', () => {
  const opis = opisObserwacji(
    { alert_wlaczony: true, czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: '2026-09-24T10:00:00.000Z', ostatnio_trafien: 3 },
    JEZYK,
    Date.parse('2026-09-24T12:00:00.000Z'),
  );
  assert.match(opis.stan, /dzien|Raz dziennie/i);
  assert.match(opis.ostatnio, /2 godz|dziś/i);
  assert.equal(opis.ton, 'sukces');
});

test('wyłączony alert jest widoczny jako wyłączony, a nie jako „nic nie znalazł"', () => {
  const opis = opisObserwacji({ alert_wlaczony: false }, JEZYK, Date.now());
  assert.equal(opis.ton, 'neutral');
  assert.match(opis.stan, /wyłączon/i);
});

test('obserwacja jeszcze niesprawdzona mówi to wprost', () => {
  const opis = opisObserwacji(
    { alert_wlaczony: true, czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: null },
    JEZYK,
    Date.now(),
  );
  assert.match(opis.ostatnio, /jeszcze|pierwsz/i);
});

test('etykiety częstotliwości pochodzą z backendu, a zapasowe istnieją na offline', () => {
  const zBackendu = [{ kod: 'dzienna', etykieta: { pl: 'Raz dziennie', en: 'Once a day' } }];
  assert.equal(opisCzestotliwosci('dzienna', zBackendu, JEZYK), 'Raz dziennie');
  // Bez odpowiedzi backendu ekran nadal musi umieć nazwać częstotliwość.
  assert.ok(opisCzestotliwosci('dzienna', null, JEZYK).length > 0);
  assert.ok(CZESTOTLIWOSCI_ZAPASOWE.every((c) => c.kod && c.etykieta.pl && c.etykieta.en));
});

test('nieznana częstotliwość nie pokazuje surowego kodu użytkownikowi', () => {
  assert.doesNotMatch(opisCzestotliwosci('co_minute', null, JEZYK), /co_minute/);
});

test('etykieta następnego sprawdzenia jest ludzka, a brak terminu nie udaje daty', () => {
  const za2h = new Date(Date.now() + 2 * 3_600_000).toISOString();
  assert.match(etykietaNastepnego(za2h, JEZYK, Date.now()), /godz/);
  assert.equal(etykietaNastepnego(null, JEZYK, Date.now()), null);
});

test('podsumowanie listy pokazuje wykorzystanie limitu, a nie samą liczbę', () => {
  const p = podsumowanieListy({ wyszukiwania: [{ alert_wlaczony: true }, { alert_wlaczony: false }], limity: { wyszukiwan: 20, alertow: 10 } }, JEZYK);
  assert.match(p, /2/);
  assert.match(p, /20/);
});

/* ============ centrum alertów ============ */

const alert = (over = {}) => ({
  id: 'a1', typ: 'zmiany', ton: 'ostrzezenie', przeczytany: false,
  tytul: { pl: 'Zmiana terminu', en: 'Deadline changed' },
  tresc: { pl: 'Zmiany w 1 ogłoszeniu', en: 'Changes in 1 notice' },
  utworzone_o: '2026-09-24T10:00:00.000Z',
  pozycje: [],
  ...over,
});

test('alerty grupują się po dniu, od najnowszego, a nieprzeczytane są oznaczone', () => {
  const wynik = grupujAlerty([
    alert({ id: 'stary', utworzone_o: '2026-09-22T10:00:00.000Z', przeczytany: true }),
    alert({ id: 'dzisiejszy', utworzone_o: '2026-09-24T10:00:00.000Z' }),
  ], Date.parse('2026-09-24T12:00:00.000Z'));

  assert.equal(wynik.grupy[0].pozycje[0].id, 'dzisiejszy');
  assert.match(wynik.grupy[0].etykieta, /Dziś/);
  assert.equal(wynik.nieprzeczytane, 1);
});

test('puste centrum alertów tłumaczy, skąd biorą się alerty', () => {
  const wynik = grupujAlerty([], Date.now());
  assert.deepEqual(wynik.grupy, []);
  assert.ok(opisPustegoCentrum(JEZYK).length > 0);
});

test('ton alertu mapuje się na semantyczną klasę, nigdy na surowy hex', () => {
  assert.equal(tonAlertu(alert({ ton: 'danger' })), 'danger');
  assert.equal(tonAlertu(alert({ ton: 'nieznany-ton' })), 'neutral');
  assert.doesNotMatch(String(tonAlertu(alert({ ton: 'danger' }))), /^#/);
});

test('plakietka nie pokazuje liczby większej niż da się przeczytać', () => {
  assert.equal(etykietaPlakietki(0), null);
  assert.equal(etykietaPlakietki(7), '7');
  assert.equal(etykietaPlakietki(150), '99+');
});

test('opis alertu wybiera język i wymienia pozycje, gdy są', () => {
  const o = opisAlertu(alert({
    pozycje: [{ tender_id: 't1', tytul: 'Remont drogi', zmiana_opis: { pl: 'Termin skrócony', en: 'x' } }],
  }), JEZYK);

  assert.equal(o.tytul, 'Zmiana terminu');
  assert.equal(o.pozycje[0].tytul, 'Remont drogi');
  assert.equal(o.pozycje[0].opis, 'Termin skrócony');
});

/* ============ kalendarz ============ */

const pozycja = (kod, over = {}) => ({
  kod,
  etykieta: { pl: 'Składanie ofert', en: 'Bid submission' },
  opis: { pl: 'opis', en: 'desc' },
  at: '2026-10-30T08:00:00.000Z',
  znany: true,
  minal: false,
  dniDo: 10,
  lokalnie: { data: '2026-10-30', godzina: '10:00', etykieta: '30 października 2026, 10:00' },
  brak: null,
  zrodloDaty: 'ogloszenie',
  podstawa: null,
  ...over,
});

const kalendarz = (over = {}) => ({
  tenderId: 't1', tytul: 'Remont drogi', zrodlo: 'bzp', anulowany: false,
  pozycje: [pozycja('pytania', { dniDo: 6 }), pozycja('oferty'), pozycja('zwiazanie', { dniDo: 40 })],
  nastepny: { kod: 'pytania', at: '2026-10-26T08:00:00.000Z', dniDo: 6 },
  brakTerminu: null,
  ...over,
});

test('kalendarz układa się w grupy pilności, od najpilniejszej', () => {
  const wynik = ulozKalendarz([kalendarz()], Date.parse('2026-10-20T08:00:00.000Z'));
  assert.ok(wynik.grupy.length > 0);
  const klucze = wynik.grupy.map((g) => g.klucz);
  assert.deepEqual(klucze, GRUPY_KALENDARZA.map((g) => g.klucz).filter((k) => klucze.includes(k)));
});

test('anulowany przetarg trafia do własnej grupy, a nie między żywe terminy', () => {
  const wynik = ulozKalendarz([kalendarz({ anulowany: true })], Date.parse('2026-10-20T08:00:00.000Z'));
  assert.ok(wynik.grupy.some((g) => g.klucz === 'anulowane'));
  assert.equal(wynik.grupy.some((g) => g.klucz === 'wtymtygodniu' && g.pozycje.length), false);
});

test('pozycje bez znanej daty nie zaśmiecają osi czasu, ale są policzone', () => {
  const bezDat = kalendarz({
    pozycje: [pozycja('pytania', { znany: false, at: null, brak: { pl: 'nie dotyczy', en: 'n/a' } }), pozycja('oferty')],
  });
  const wynik = ulozKalendarz([bezDat], Date.parse('2026-10-20T08:00:00.000Z'));
  const wszystkie = wynik.grupy.flatMap((g) => g.pozycje);

  assert.equal(wszystkie.every((p) => p.znany), true);
  assert.equal(wynik.nieznane, 1);
});

test('karta następnego kroku mówi CO i KIEDY, w czasie polskim', () => {
  const karta = kartaNastepnegoKroku(
    { kod: 'pytania', tytul: 'Remont drogi', dniDo: 6, lokalnie: { etykieta: '26 października 2026, 10:00' }, etykieta: { pl: 'Pytania do SWZ', en: 'Questions' } },
    JEZYK,
  );
  assert.match(karta.co, /Pytania/);
  assert.match(karta.kiedy, /26 października/);
  assert.match(karta.zostalo, /6/);
  assert.equal(karta.ton, 'ostrzezenie');
});

test('brak następnego kroku daje kartę, która to wprost mówi', () => {
  const karta = kartaNastepnegoKroku(null, JEZYK);
  assert.equal(karta.ton, 'neutral');
  assert.ok(karta.co.length > 0);
});

test('termin dziś lub jutro jest alarmem, odległy jest spokojny', () => {
  assert.equal(tonPozycji({ znany: true, dniDo: 0, minal: false }), 'danger');
  assert.equal(tonPozycji({ znany: true, dniDo: 5, minal: false }), 'ostrzezenie');
  assert.equal(tonPozycji({ znany: true, dniDo: 40, minal: false }), 'neutral');
  assert.equal(tonPozycji({ znany: true, minal: true }), 'neutral');
  assert.equal(tonPozycji({ znany: false }), 'neutral');
});

test('opis pozycji ujawnia, że data jest WYLICZONA, i podaje podstawę prawną', () => {
  const o = opisPozycji(pozycja('pytania', {
    zrodloDaty: 'wyliczony', podstawa: { pl: 'art. 284 ust. 2 Pzp', en: 'Art. 284(2)' },
  }), JEZYK);

  assert.match(o.zrodlo, /wylicz/i);
  assert.match(o.zrodlo, /284/);

  const zOgloszenia = opisPozycji(pozycja('oferty'), JEZYK);
  assert.match(zOgloszenia.zrodlo, /ogłoszen/i);
});

test('nieznana data pokazuje POWÓD zamiast pustego miejsca', () => {
  const o = opisPozycji(pozycja('pytania', {
    znany: false, at: null, lokalnie: { etykieta: null }, brak: { pl: 'Baza Konkurencyjności nie podlega Pzp.', en: 'x' },
  }), JEZYK);

  assert.equal(o.kiedy, null);
  assert.match(o.brak, /Baza Konkurencyjności/);
});
