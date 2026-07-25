import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ocen_szanse_i_rekomendacja,
  OCENA_SZANS,
  WAGI_SILY,
  REKOMENDACJA_WALCZ,
  REKOMENDACJA_ODPUSC,
} from '../src/lib/ocenaSzans.js';
import { analizuj_oferte_zwyciezcy } from '../src/lib/silnikRegulOdrzucenia.js';
import { SILA_ZARZUTU } from '../src/lib/regulaRazacoNiskaCena.js';

/*
 * Warstwa oceny szans i rekomendacji (podzadanie 11/13). Bierze zarzuty z silnika
 * reguł odrzucenia (10/13) + wgrane dokumenty i wydaje: listę potencjalnych zarzutów,
 * ocenę szans (niska/średnia/wysoka) i JEDNOZNACZNĄ rekomendację „jest podstawa,
 * walcz" albo „odpuść". Funkcja jest DETERMINISTYCZNA (bez płatnego API), więc da się
 * ją przetestować jednostkowo — a użytkownik dostaje powtarzalną decyzję.
 */

// Zarzut w kształcie z silnika reguł: { rodzaj, tytul, opis_zarzutu, sila }.
function zarzut(sila, rodzaj = `r_${sila}`) {
  return {
    rodzaj,
    tytul: `Zarzut ${sila}`,
    opis_zarzutu: `Opis zarzutu o sile ${sila}.`,
    sila,
  };
}

// Komplet dokumentów (oferta + protokół) — kształt z modelu kontroli.
const DOKUMENTY_KOMPLET = {
  ofertaZwyciezcy: [{ uri: 'file:///oferta.pdf' }],
  protokol: [{ uri: 'file:///protokol.pdf' }],
};

test('skala OCENA_SZANS: niska/srednia/wysoka w rosnącej kolejności', () => {
  assert.deepEqual(OCENA_SZANS, ['niska', 'srednia', 'wysoka']);
});

test('WAGI_SILY pokrywają całą skalę SILA_ZARZUTU (nowa siła nie przejdzie po cichu)', () => {
  // Każda siła ze skali reguł musi mieć wagę — inaczej ocena zaniżałaby zarzut.
  assert.equal(WAGI_SILY.length, SILA_ZARZUTU.length);
  for (const w of WAGI_SILY) assert.equal(typeof w, 'number');
});

test('rekomendacje: dwie jednoznaczne wartości z etykietami ze specyfikacji', () => {
  assert.equal(REKOMENDACJA_WALCZ.wartosc, 'walcz');
  assert.equal(REKOMENDACJA_WALCZ.etykieta, 'jest podstawa, walcz');
  assert.equal(REKOMENDACJA_ODPUSC.wartosc, 'odpusc');
  assert.equal(REKOMENDACJA_ODPUSC.etykieta, 'odpuść');
});

test('brak zarzutów → szanse niskie, rekomendacja „odpuść"', () => {
  const w = ocen_szanse_i_rekomendacja([], DOKUMENTY_KOMPLET);
  assert.equal(w.liczbaZarzutow, 0);
  assert.equal(w.ocenaSzans, 'niska');
  assert.equal(w.rekomendacja.wartosc, 'odpusc');
  assert.equal(w.rekomendacja.etykieta, 'odpuść');
});

test('jeden zarzut „mocna" → szanse wysokie, „walcz"', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('mocna')], DOKUMENTY_KOMPLET);
  assert.equal(w.ocenaSzans, 'wysoka');
  assert.equal(w.rekomendacja.wartosc, 'walcz');
  assert.equal(w.rekomendacja.etykieta, 'jest podstawa, walcz');
});

test('jeden zarzut „umiarkowana" → szanse średnie, „walcz" (jest podstawa)', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('umiarkowana')], DOKUMENTY_KOMPLET);
  assert.equal(w.ocenaSzans, 'srednia');
  assert.equal(w.rekomendacja.wartosc, 'walcz');
});

test('dwa zarzuty „umiarkowana" → kumulują się do wysokich szans', () => {
  const w = ocen_szanse_i_rekomendacja(
    [zarzut('umiarkowana', 'a'), zarzut('umiarkowana', 'b')],
    DOKUMENTY_KOMPLET,
  );
  assert.equal(w.ocenaSzans, 'wysoka');
  assert.equal(w.rekomendacja.wartosc, 'walcz');
});

test('jeden zarzut „slaba" → szanse niskie, „odpuść" (nie warto wpisu do KIO)', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('slaba')], DOKUMENTY_KOMPLET);
  assert.equal(w.ocenaSzans, 'niska');
  assert.equal(w.rekomendacja.wartosc, 'odpusc');
});

test('dwa zarzuty „slaba" → nadal niskie (słabe formalności się nie sumują w podstawę)', () => {
  const w = ocen_szanse_i_rekomendacja(
    [zarzut('slaba', 'a'), zarzut('slaba', 'b')],
    DOKUMENTY_KOMPLET,
  );
  assert.equal(w.ocenaSzans, 'niska');
  assert.equal(w.rekomendacja.wartosc, 'odpusc');
});

test('„mocna" dominuje nad „slaba" → wysokie szanse', () => {
  const w = ocen_szanse_i_rekomendacja(
    [zarzut('slaba', 'a'), zarzut('mocna', 'b')],
    DOKUMENTY_KOMPLET,
  );
  assert.equal(w.ocenaSzans, 'wysoka');
  assert.equal(w.rekomendacja.wartosc, 'walcz');
});

test('akceptuje agregat z silnika { zarzuty, liczba, najwyzszaSila } tak samo jak gołą tablicę', () => {
  const lista = [zarzut('mocna')];
  const agregat = { zarzuty: lista, liczba: 1, najwyzszaSila: 'mocna' };
  const zTablicy = ocen_szanse_i_rekomendacja(lista, DOKUMENTY_KOMPLET);
  const zAgregatu = ocen_szanse_i_rekomendacja(agregat, DOKUMENTY_KOMPLET);
  assert.equal(zAgregatu.ocenaSzans, zTablicy.ocenaSzans);
  assert.equal(zAgregatu.rekomendacja.wartosc, zTablicy.rekomendacja.wartosc);
  assert.equal(zAgregatu.liczbaZarzutow, 1);
});

test('spina się z prawdziwym wynikiem analizuj_oferte_zwyciezcy (rażąco niska cena → walcz)', () => {
  const pola = { cena: { kwota: 100000 } };
  const kontekst = { oferty: [100000, 200000, 200000] }; // średnia 166 667, oferta 40% niżej
  const wynikSilnika = analizuj_oferte_zwyciezcy(pola, kontekst);
  assert.ok(wynikSilnika.liczba >= 1); // sanity: silnik wykrył przesłankę
  const w = ocen_szanse_i_rekomendacja(wynikSilnika, DOKUMENTY_KOMPLET);
  assert.equal(w.rekomendacja.wartosc, 'walcz');
  assert.equal(w.liczbaZarzutow, wynikSilnika.liczba);
});

test('zwraca listę potencjalnych zarzutów (echo) bez zmiany kolejności', () => {
  const lista = [zarzut('mocna', 'a'), zarzut('umiarkowana', 'b')];
  const w = ocen_szanse_i_rekomendacja(lista, DOKUMENTY_KOMPLET);
  assert.equal(w.zarzuty.length, 2);
  assert.deepEqual(w.zarzuty.map((z) => z.rodzaj), ['a', 'b']);
});

test('komplet dokumentów → kompletDokumentow true', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('mocna')], DOKUMENTY_KOMPLET);
  assert.equal(w.kompletDokumentow, true);
});

test('brak protokołu → analiza wstępna: kompletDokumentow false + wzmianka w uzasadnieniu', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('mocna')], {
    ofertaZwyciezcy: [{ uri: 'file:///oferta.pdf' }],
    protokol: [],
  });
  assert.equal(w.kompletDokumentow, false);
  assert.match(w.uzasadnienie, /wstępn|dokument/i);
});

test('uzasadnienie: niepusty tekst niosący ocenę i rekomendację', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('mocna')], DOKUMENTY_KOMPLET);
  assert.equal(typeof w.uzasadnienie, 'string');
  assert.ok(w.uzasadnienie.length > 0);
});

// --- Defensywność: nigdy nie rzuca, pełny kształt przy braku danych ---

test('null zarzuty → niska/„odpuść", bez wyjątku', () => {
  const w = ocen_szanse_i_rekomendacja(null, DOKUMENTY_KOMPLET);
  assert.equal(w.ocenaSzans, 'niska');
  assert.equal(w.rekomendacja.wartosc, 'odpusc');
  assert.equal(w.liczbaZarzutow, 0);
});

test('brak dokumentów (undefined) → nie rzuca, kompletDokumentow false', () => {
  const w = ocen_szanse_i_rekomendacja([zarzut('umiarkowana')]);
  assert.equal(w.kompletDokumentow, false);
  assert.equal(w.ocenaSzans, 'srednia');
});

test('zarzut o nieznanej/brakującej sile → waga 0 (nie wywraca oceny)', () => {
  // Jeden umiarkowany + jeden „śmieciowy" bez siły: ocena jak dla samego umiarkowanego.
  const w = ocen_szanse_i_rekomendacja(
    [zarzut('umiarkowana', 'a'), { rodzaj: 'x', sila: 'kosmiczna' }],
    DOKUMENTY_KOMPLET,
  );
  assert.equal(w.ocenaSzans, 'srednia');
});

test('rekomendacja jest ZAWSZE jednoznaczna (walcz albo odpusc) — także dla „śmieci"', () => {
  for (const wejscie of [undefined, null, 42, 'x', {}, { zarzuty: null }]) {
    const w = ocen_szanse_i_rekomendacja(wejscie, DOKUMENTY_KOMPLET);
    assert.ok(['walcz', 'odpusc'].includes(w.rekomendacja.wartosc));
    assert.ok(OCENA_SZANS.includes(w.ocenaSzans));
  }
});
