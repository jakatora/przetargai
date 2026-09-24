import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  wpisObserwacji, sprawdzObserwacje, zbudujAlertPlanu, LIMIT_OBSERWOWANYCH,
} from '../src/lib/obserwacjePlanow.js';

const TERAZ = '2026-11-26T10:00:00.000Z';

const POZYCJA = {
  id: '657219-2026',
  przedmiot: 'Przebudowa drogi powiatowej',
  zamawiajacy: 'Powiat Testowy',
  zamawiajacy_nip: '5251575309',
  cpv: ['45233140'],
  region: '14',
  terminWszczecia: '2026-11-15',
  wartosc: 3_000_000,
  opublikowano: '2026-09-20',
  opis: 'nie trafia do obserwacji',
};

const PRZETARG = {
  id: 'ted~700001-2026',
  title: 'Przebudowa drogi powiatowej nr 1234 w m. X',
  cpv_main: '45233140',
  budget: 2_900_000,
  published_at: '2026-11-20T08:00:00Z',
  deadline: '2026-12-22T10:00:00Z',
  url: 'https://ted.europa.eu/x',
};

describe('wpis obserwacji', () => {
  test('niesie tylko pola potrzebne do sprawdzenia, aktywny, bez znaleziska', () => {
    const w = wpisObserwacji(POZYCJA, TERAZ);
    assert.equal(w.plan_id, POZYCJA.id);
    assert.equal(w.zamawiajacy_nip, POZYCJA.zamawiajacy_nip);
    assert.equal(w.aktywna, true);
    assert.equal(w.znalezione, null);
    assert.equal(w.opis, undefined);
    assert.equal(w.wygasa_o, '2027-01-14');
    assert.equal(LIMIT_OBSERWOWANYCH, 50);
  });
});

describe('sprawdzenie obserwacji w przebiegu monitoringu', () => {
  test('pewne ogłoszenie tego zamawiającego po planie → znalezione + alert', () => {
    const w = wpisObserwacji(POZYCJA, '2026-09-24T10:00:00.000Z');
    const wynik = sprawdzObserwacje({ obserwacja: w, przetargi: [PRZETARG], teraz: TERAZ });
    assert.equal(wynik.znalezione.tender_id, PRZETARG.id);
    assert.ok(wynik.znalezione.pewnosc >= 70);
    assert.equal(wynik.aktywna, false, 'po znalezieniu obserwacja się kończy');
    assert.equal(wynik.alert.typ, 'plan_ogloszony');
    assert.equal(wynik.alert.tender_id, PRZETARG.id);
    assert.equal(wynik.alert.ton, 'sukces');
    assert.match(wynik.alert.tytul.pl, /To jest to, na co czekałeś/);
    assert.ok(wynik.alert.tytul.en);
    assert.equal(wynik.alert.pozycje[0].tender_id, PRZETARG.id);
  });

  test('ogłoszenie sprzed planu i „prawdopodobne" NIE alarmują', () => {
    const w = wpisObserwacji(POZYCJA, '2026-09-24T10:00:00.000Z');
    const stary = { ...PRZETARG, published_at: '2026-05-01T08:00:00Z' };
    const inne = { ...PRZETARG, id: 'inne', title: 'Dostawa papieru', cpv_main: '30197630', budget: null };
    const wynik = sprawdzObserwacje({ obserwacja: w, przetargi: [stary, inne], teraz: TERAZ });
    assert.equal(wynik.znalezione, null);
    assert.equal(wynik.alert, null);
    assert.equal(wynik.aktywna, true);
  });

  test('bez NIP-u nie ma czego sprawdzać — obserwacja trwa, bez alertu', () => {
    const w = wpisObserwacji({ ...POZYCJA, zamawiajacy_nip: null }, '2026-09-24T10:00:00.000Z');
    const wynik = sprawdzObserwacje({ obserwacja: w, przetargi: [PRZETARG], teraz: TERAZ });
    assert.equal(wynik.alert, null);
  });

  test('po wygaśnięciu planu obserwacja się kończy bez alertu', () => {
    const w = wpisObserwacji(POZYCJA, '2026-09-24T10:00:00.000Z');
    const wynik = sprawdzObserwacje({ obserwacja: w, przetargi: [], teraz: '2027-02-01T00:00:00.000Z' });
    assert.equal(wynik.aktywna, false);
    assert.equal(wynik.zakonczenie, 'wygasla');
    assert.equal(wynik.alert, null);
  });

  test('klucz alertu deterministyczny (ponowienie przebiegu nie dubluje)', () => {
    const a = zbudujAlertPlanu({ obserwacja: wpisObserwacji(POZYCJA, TERAZ), znalezione: { tender_id: 'X', tytul: 't', pewnosc: 80 } });
    const b = zbudujAlertPlanu({ obserwacja: wpisObserwacji(POZYCJA, TERAZ), znalezione: { tender_id: 'X', tytul: 't', pewnosc: 80 } });
    assert.equal(a.klucz, b.klucz);
    assert.ok(!a.klucz.includes('/'), 'docId Firestore');
  });
});
