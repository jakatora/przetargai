import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harmonogramZwrotu,
  statusZwrotu,
  naliczOdsetki,
  porownajKoszt,
  PROCENT_ZATRZYMANY_MAX,
  STOPA_ODSETEK_DOMYSLNA,
} from '../src/lib/zabezpieczenieZwrot.js';

/*
 * ODZYSKIWACZ ZABEZPIECZENIA — rdzeń liczbowy (ulepszenie „pilnuj zwrotu swoich
 * pieniędzy po kontrakcie"). Czyste, deterministyczne funkcje bez I/O, bez sieci,
 * bez płatnego AI i BEZ Date.now — „dzisiaj" jest zawsze WSTRZYKIWANE, więc ten sam
 * wsad daje zawsze ten sam wynik.
 *
 * Reguła zwrotu zabezpieczenia należytego wykonania umowy (art. 453 Pzp):
 *  • ust. 1: zamawiający zwraca zabezpieczenie w 30 dni od uznania zamówienia za
 *    należycie wykonane (transza „po odbiorze"),
 *  • ust. 2: może zatrzymać na roszczenia z rękojmi/gwarancji ≤ 30% zabezpieczenia,
 *  • ust. 3: zatrzymaną kwotę zwraca nie później niż w 15. dniu po upływie rękojmi
 *    lub gwarancji (transza „po rękojmi").
 * Za nieterminowy zwrot Pzp nie przewiduje sankcji dla zamawiającego — stąd alarm
 * o wymagalności i naliczanie odsetek za opóźnienie (art. 481 KC), a przy
 * przeterminowaniu ścieżka roszczenia z bezpodstawnego wzbogacenia (art. 405 KC).
 */

// ─────────────────────── Harmonogram zwrotu ──────────────────────────────────

test('harmonogram: domyślnie 70% po odbiorze (+30 dni) i 30% po rękojmi (+15 dni)', () => {
  const h = harmonogramZwrotu({
    kwota: 50_000,
    dataNalezytegoWykonania: '2027-05-31',
    dataUplywuRekojmi: '2032-05-31',
  });
  assert.equal(h.procentZatrzymany, 30, 'konserwatywnie zakładamy maksymalne zatrzymanie 30%');
  assert.equal(h.transze.length, 2);

  const [t1, t2] = h.transze;
  assert.equal(t1.etap, 'po_odbiorze');
  assert.equal(t1.procent, 70);
  assert.equal(t1.kwota, 35_000);
  assert.equal(t1.termin, '2027-06-30', '31.05 + 30 dni = 30.06');

  assert.equal(t2.etap, 'po_rekojmi');
  assert.equal(t2.procent, 30);
  assert.equal(t2.kwota, 15_000);
  assert.equal(t2.termin, '2032-06-15', '31.05 + 15 dni = 15.06');
});

test('harmonogram: transze ZAWSZE sumują się do kwoty (niezmiennik — grosz się nie gubi)', () => {
  // 100,03 zł przy 30% → 70,02 + 30,01 = 100,03 (reszta trafia do ostatniej transzy).
  const h = harmonogramZwrotu({
    kwota: 100.03,
    dataNalezytegoWykonania: '2027-01-10',
    dataUplywuRekojmi: '2030-01-10',
  });
  const suma = h.transze.reduce((s, t) => s + t.kwota, 0);
  assert.equal(Math.round(suma * 100) / 100, 100.03, 'suma transz = kwota co do grosza');
});

test('harmonogram: procentZatrzymany = 0 → jedna transza 100% po odbiorze', () => {
  const h = harmonogramZwrotu({
    kwota: 20_000,
    dataNalezytegoWykonania: '2027-05-31',
    dataUplywuRekojmi: '2032-05-31',
    procentZatrzymany: 0,
  });
  assert.equal(h.transze.length, 1);
  assert.equal(h.transze[0].procent, 100);
  assert.equal(h.transze[0].kwota, 20_000);
});

test('harmonogram: procent poza zakresem [0,30] jest przycinany (nie liczymy absurdu)', () => {
  const zaDuzo = harmonogramZwrotu({
    kwota: 10_000, dataNalezytegoWykonania: '2027-01-01', dataUplywuRekojmi: '2030-01-01',
    procentZatrzymany: 90,
  });
  assert.equal(zaDuzo.procentZatrzymany, PROCENT_ZATRZYMANY_MAX, 'przycięte do 30% (art. 453 ust. 2)');

  const ujemny = harmonogramZwrotu({
    kwota: 10_000, dataNalezytegoWykonania: '2027-01-01', dataUplywuRekojmi: '2030-01-01',
    procentZatrzymany: -5,
  });
  assert.equal(ujemny.procentZatrzymany, 0);
});

test('harmonogram: niepoprawna data → termin null (konserwatywnie, bez zmyślania)', () => {
  const h = harmonogramZwrotu({
    kwota: 10_000,
    dataNalezytegoWykonania: 'nie-data',
    dataUplywuRekojmi: '2030-01-01',
  });
  assert.equal(h.transze[0].termin, null, 'nieparsowalna data → null, nie fałszywy termin');
  assert.equal(h.transze[1].termin, '2030-01-16');
});

// ─────────────────────── Status wymagalności ─────────────────────────────────

test('status: przed terminem → oczekuje (ile dni zostało)', () => {
  const s = statusZwrotu({ termin: '2027-06-30', dzisiaj: '2027-06-20' });
  assert.equal(s.status, 'oczekuje');
  assert.equal(s.dni, 10);
});

test('status: w dniu terminu → wymagalne (alarm: możesz żądać pieniędzy)', () => {
  const s = statusZwrotu({ termin: '2027-06-30', dzisiaj: '2027-06-30' });
  assert.equal(s.status, 'wymagalne');
  assert.equal(s.dni, 0);
});

test('status: po terminie → przeterminowane (ile dni zwłoki)', () => {
  const s = statusZwrotu({ termin: '2027-06-30', dzisiaj: '2027-07-30' });
  assert.equal(s.status, 'przeterminowane');
  assert.equal(s.dni, 30);
});

test('status: brak/niepoprawny termin → nieznany', () => {
  assert.equal(statusZwrotu({ termin: null, dzisiaj: '2027-06-30' }).status, 'nieznany');
  assert.equal(statusZwrotu({ termin: 'xxx', dzisiaj: '2027-06-30' }).status, 'nieznany');
});

// ─────────────────────── Odsetki za opóźnienie ───────────────────────────────

test('odsetki: brak zwłoki (przed/w terminie) → 0 zł', () => {
  assert.equal(naliczOdsetki({ kwota: 35_000, termin: '2027-06-30', dzisiaj: '2027-06-30' }).odsetki, 0);
  assert.equal(naliczOdsetki({ kwota: 35_000, termin: '2027-06-30', dzisiaj: '2027-06-01' }).odsetki, 0);
});

test('odsetki: proste, liczone od dnia po terminie wg stopy rocznej', () => {
  // 36 500 zł * 10%/rok * 365 dni / 365 = 3 650 zł.
  const o = naliczOdsetki({ kwota: 36_500, termin: '2027-01-01', dzisiaj: '2028-01-01', stopaRoczna: 10 });
  assert.equal(o.dni, 365);
  assert.equal(o.stopaRoczna, 10);
  assert.equal(o.odsetki, 3_650);
});

test('odsetki: bez podanej stopy używa udokumentowanej stawki domyślnej', () => {
  const o = naliczOdsetki({ kwota: 10_000, termin: '2027-01-01', dzisiaj: '2027-02-01' });
  assert.equal(o.stopaRoczna, STOPA_ODSETEK_DOMYSLNA);
  assert.ok(o.odsetki > 0, 'zwłoka 31 dni → odsetki > 0');
});

// ─────────────────────── Porównanie kosztu: gotówka vs gwarancja ──────────────

test('koszt: zamrożona gotówka droższa od prowizji za gwarancję → wskazuje gwarancję', () => {
  const p = porownajKoszt({
    kwota: 100_000,
    lata: 5,
    prowizjaGwarancjiRocznaProc: 1.5,
    kosztKapitaluRocznyProc: 8,
  });
  // gotówka: 100 000 * 8% * 5 = 40 000; gwarancja: 100 000 * 1,5% * 5 = 7 500.
  assert.equal(p.gotowka.koszt, 40_000);
  assert.equal(p.gwarancja.koszt, 7_500);
  assert.equal(p.tanszaOpcja, 'gwarancja');
  assert.equal(p.roznica, 32_500, 'ile realnie oszczędza gwarancja');
});

test('koszt: zerowe stawki → koszt 0 i opcje porównywalne', () => {
  const p = porownajKoszt({ kwota: 50_000, lata: 3, prowizjaGwarancjiRocznaProc: 0, kosztKapitaluRocznyProc: 0 });
  assert.equal(p.gotowka.koszt, 0);
  assert.equal(p.gwarancja.koszt, 0);
  assert.equal(p.tanszaOpcja, 'porownywalne');
  assert.equal(p.roznica, 0);
});

test('koszt: użyte stawki są jawnie zwrócone w zalozenia (nic ukrytego przy decyzji o pieniądzach)', () => {
  const p = porownajKoszt({ kwota: 50_000, lata: 5 });
  assert.equal(typeof p.zalozenia.prowizjaGwarancjiRocznaProc, 'number');
  assert.equal(typeof p.zalozenia.kosztKapitaluRocznyProc, 'number');
});
