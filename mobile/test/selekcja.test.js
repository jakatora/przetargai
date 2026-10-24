import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRZYCZYNY, PRZYCZYNY_KLIENTA, ETYKIETY_PRZYCZYN, etykietaPrzyczyny, zdanieRaportu, grupujOdrzucone,
  opisProby, opisNastepnegoPrzebiegu, zdanieOczekujacych,
} from '../src/lib/selekcja.js';

test('przyczyny zgodne z backendem (te same kody)', () => {
  assert.deepEqual(PRZYCZYNY, ['branza', 'wykluczenie', 'teren', 'za_duze', 'za_male', 'termin', 'warunki', 'inne']);
  assert.ok(!PRZYCZYNY_KLIENTA.includes('wykluczenie'));
  for (const k of PRZYCZYNY) assert.ok(ETYKIETY_PRZYCZYN[k].pl && ETYKIETY_PRZYCZYN[k].en);
  assert.deepEqual(etykietaPrzyczyny('kosmos'), ETYKIETY_PRZYCZYN.inne);
});

test('raport dnia z odmianą; „my”, nie „pracownik”', () => {
  const r = zdanieRaportu({ przejrzane: 1043, wybrane: 4, odrzucone_razem: 1037, ostatni_przebieg_o: '2026-10-21T10:00:00.000Z' });
  assert.equal(r.pl, 'Dziś przejrzeliśmy 1043 ogłoszenia · wybraliśmy 4 · odrzuciliśmy 1037');
  assert.equal(r.en, 'Today we reviewed 1043 notices · picked 4 · rejected 1037');
  assert.equal(zdanieRaportu({ przejrzane: 5, wybrane: 1, odrzucone_razem: 4, ostatni_przebieg_o: 'x' }).pl,
    'Dziś przejrzeliśmy 5 ogłoszeń · wybraliśmy 1 · odrzuciliśmy 4');
  assert.match(zdanieRaportu({ przejrzane: 0, wybrane: 0, odrzucone_razem: 0, ostatni_przebieg_o: null }).pl, /Pierwszy przegląd/);
  assert.ok(!/pracownik/i.test(r.pl));
});

test('grupowanie odrzuconych: malejąco, bez zer', () => {
  assert.deepEqual(grupujOdrzucone({ branza: 900, teren: 21, za_duze: 0, termin: 7 }).map((g) => [g.kod, g.liczba]),
    [['branza', 900], ['teren', 21], ['termin', 7]]);
  assert.deepEqual(grupujOdrzucone(undefined), []);
});

test('próba: odmiana dni; brak/nieaktywna → null', () => {
  assert.equal(opisProby({ aktywna: true, dni_zostalo: 3 }).pl, 'Próba Standard: zostały 3 dni');
  assert.equal(opisProby({ aktywna: true, dni_zostalo: 1 }).pl, 'Próba Standard: został 1 dzień');
  assert.equal(opisProby({ aktywna: true, dni_zostalo: 5 }).pl, 'Próba Standard: zostało 5 dni');
  assert.equal(opisProby({ aktywna: false, dni_zostalo: 0 }), null);
  assert.equal(opisProby(null), null);
});

test('następny przegląd: dziś / jutro + godzina lokalna', () => {
  const teraz = new Date(2026, 9, 21, 12, 5);
  const dzis = new Date(2026, 9, 21, 14, 10).toISOString();
  const jutro = new Date(2026, 9, 22, 12, 0).toISOString();
  assert.equal(opisNastepnegoPrzebiegu(dzis, teraz).pl, 'Następny przegląd: dziś o 14:10');
  assert.equal(opisNastepnegoPrzebiegu(jutro, teraz).en, 'Next review: tomorrow at 12:00');
  assert.equal(opisNastepnegoPrzebiegu(null, teraz), null);
});

test('czekające: Free dostaje zachętę, Standard tylko informację', () => {
  assert.match(zdanieOczekujacych(3, 'free').pl, /Standard/);
  assert.ok(!/Standard/.test(zdanieOczekujacych(3, 'standard').pl));
  assert.equal(zdanieOczekujacych(0, 'free'), null);
});
