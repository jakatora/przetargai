import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wstepneDaneRadaru, MAKS_NAZWA_POSTEPOWANIA } from '../src/lib/radarSwz.js';
import { parametryNarzedzia } from '../src/lib/sciezkaDoOferty.js';

/*
 * Wstępne wypełnienie formularza Radaru SWZ (2026-10-03). Radar otwierany z przetargu
 * dostaje nazwę i daty z ogłoszenia; otwierany z katalogu narzędzi — nic, i ma działać
 * jak dotąd. Przy każdej wątpliwości pole zostaje PUSTE: od tych dat backend liczy
 * termin na pytania do SWZ, więc przesunięta data jest gorsza niż brak daty.
 */

const PUSTE = { nazwa: '', dataOgloszenia: '', termin: '', tenderId: null, zPrzetargu: false };

test('brak parametrów (katalog narzędzi): formularz pusty jak dotąd', () => {
  for (const brak of [undefined, null, {}, 'napis', 5, []]) {
    assert.deepEqual(wstepneDaneRadaru(brak), PUSTE);
  }
});

test('pełny kontekst: nazwa i obie daty w zapisie RRRR-MM-DD', () => {
  assert.deepEqual(
    wstepneDaneRadaru({
      nazwa: '  Remont drogi gminnej  ',
      termin: '2026-10-20T08:00:00.000Z',
      dataOgloszenia: '2026-10-01T10:15:00.000Z',
    }),
    { nazwa: 'Remont drogi gminnej', dataOgloszenia: '2026-10-01', termin: '2026-10-20', tenderId: null, zPrzetargu: true },
  );
});

test('chwila tuż przed północą UTC to już następny dzień w Polsce', () => {
  // 22:30 UTC w czasie letnim = 00:30 czasu polskiego dnia następnego.
  assert.equal(wstepneDaneRadaru({ termin: '2026-07-14T22:30:00.000Z' }).termin, '2026-07-15');
  // Zimą przesunięcie to 1 h: 22:30 UTC = 23:30 PL tego samego dnia.
  assert.equal(wstepneDaneRadaru({ termin: '2026-12-14T22:30:00.000Z' }).termin, '2026-12-14');
});

test('sama data (bez godziny) przechodzi bez przesunięcia', () => {
  assert.equal(wstepneDaneRadaru({ termin: '2026-10-20' }).termin, '2026-10-20');
  assert.equal(wstepneDaneRadaru({ dataOgloszenia: '01.10.2026' }).dataOgloszenia, '2026-10-01');
});

test('niepełny kontekst: wypełniamy tylko to, co przyszło', () => {
  assert.deepEqual(
    wstepneDaneRadaru({ nazwa: 'Budowa chodnika' }),
    { nazwa: 'Budowa chodnika', dataOgloszenia: '', termin: '', tenderId: null, zPrzetargu: true },
  );
  assert.deepEqual(
    wstepneDaneRadaru({ termin: '2026-11-03T09:00:00.000Z' }),
    { nazwa: '', dataOgloszenia: '', termin: '2026-11-03', tenderId: null, zPrzetargu: true },
  );
});

test('nieznany albo nieistniejący zapis daty zostawia pole puste', () => {
  for (const zla of ['jutro', '2026-02-30', '10/06/2026', '', '   ', 1760000000000, null, {}, true]) {
    const wynik = wstepneDaneRadaru({ termin: zla, dataOgloszenia: zla });
    assert.equal(wynik.termin, '', `termin=${JSON.stringify(zla)}`);
    assert.equal(wynik.dataOgloszenia, '', `dataOgloszenia=${JSON.stringify(zla)}`);
    assert.equal(wynik.zPrzetargu, false);
  }
});

test('nazwa: tylko napis, przycięta do limitu backendu', () => {
  assert.equal(wstepneDaneRadaru({ nazwa: 123 }).nazwa, '');
  assert.equal(wstepneDaneRadaru({ nazwa: { a: 1 } }).nazwa, '');
  assert.equal(wstepneDaneRadaru({ nazwa: '   ' }).nazwa, '');
  const dluga = 'a'.repeat(MAKS_NAZWA_POSTEPOWANIA + 50);
  assert.equal(wstepneDaneRadaru({ nazwa: dluga }).nazwa.length, MAKS_NAZWA_POSTEPOWANIA);
});

test('ogniwa razem: parametry ze ścieżki dają poprawnie wypełniony formularz', () => {
  const match = {
    id: 'm-1',
    tender: {
      id: 'bzp:1', title: 'Dostawa sprzętu komputerowego',
      deadline: '2026-10-20T08:00:00.000Z', published_at: '2026-10-01T10:15:00.000Z',
    },
  };
  assert.deepEqual(wstepneDaneRadaru(parametryNarzedzia('RadarSwz', match)), {
    nazwa: 'Dostawa sprzętu komputerowego', dataOgloszenia: '2026-10-01', termin: '2026-10-20', tenderId: 'bzp:1', zPrzetargu: true,
  });
  // Ścieżka otwarta bez przetargu → Radar zachowuje się jak z katalogu narzędzi.
  assert.deepEqual(wstepneDaneRadaru(parametryNarzedzia('RadarSwz', null)), PUSTE);
});
