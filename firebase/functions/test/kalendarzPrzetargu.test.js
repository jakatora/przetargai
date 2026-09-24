import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RODZAJE_TERMINOW, STREFA,
  reguluZrodla, wCzasieWarszawskim, zbudujKalendarz, nastepnyKrok, doIcs,
} from '../src/lib/kalendarzPrzetargu.js';

/*
 * KALENDARZ PRZETARGU (etap 5, P1-7) — CZYSTA logika.
 *
 * Wykonawca zapisuje przetarg i od tej chwili pilnuje TRZECH dat, nie jednej:
 *  • do kiedy można zadać pytanie i mieć gwarancję odpowiedzi,
 *  • do kiedy złożyć ofertę (jedyna data, której NIE liczymy — podaje ją rejestr),
 *  • do kiedy jest związany ofertą (po tej dacie oferta podlega odrzuceniu).
 *
 * Dwie pierwsze i trzecia są WYLICZONE z ustawy, więc muszą być tak oznaczone.
 * Podanie wyliczonej daty jako „termin z ogłoszenia" byłoby fałszywym pomiarem.
 */

test('reguły ustawowe wybieramy po REJESTRZE, bo tylko on jest pewny', () => {
  // Powyżej progów unijnych ogłoszenie idzie do Dz.U. UE (TED), poniżej — do BZP.
  assert.equal(reguluZrodla('bzp').dniPytania, 4);
  assert.equal(reguluZrodla('bzp').dniZwiazania, 30);
  assert.equal(reguluZrodla('ted').dniPytania, 14);
  assert.equal(reguluZrodla('ted').dniZwiazania, 90);
});

test('Baza Konkurencyjności nie podlega Pzp — nie wymyślamy dla niej terminów ustawowych', () => {
  const r = reguluZrodla('baza_konkurencyjnosci');
  assert.equal(r.dniPytania, null);
  assert.equal(r.dniZwiazania, null);
  assert.ok(r.uwaga.pl && r.uwaga.en, 'brak reguły musi być wyjaśniony, a nie przemilczany');
});

test('nieznane źródło też nie dostaje zmyślonej reguły', () => {
  assert.equal(reguluZrodla('cos_nowego').dniPytania, null);
});

test('czas pokazujemy w strefie Europe/Warsaw, bo w niej upływają terminy', () => {
  assert.equal(STREFA, 'Europe/Warsaw');
  // 2026-10-08T08:00Z to 10:00 czasu polskiego (czas letni, +2).
  const w = wCzasieWarszawskim('2026-10-08T08:00:00.000Z');
  assert.equal(w.data, '2026-10-08');
  assert.equal(w.godzina, '10:00');
  assert.match(w.etykieta, /8 października 2026/);

  // Zimą offset jest inny — ta sama godzina UTC daje inną lokalną.
  assert.equal(wCzasieWarszawskim('2026-01-08T08:00:00.000Z').godzina, '09:00');
});

test('brak daty nie udaje daty', () => {
  const w = wCzasieWarszawskim(null);
  assert.equal(w.data, null);
  assert.equal(w.etykieta, null);
});

test('kalendarz BZP: trzy pozycje, z czego dwie WYLICZONE', () => {
  const k = zbudujKalendarz(
    { id: 't1', source: 'bzp', title: 'Remont drogi', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );

  assert.deepEqual(k.pozycje.map((p) => p.kod), ['pytania', 'oferty', 'zwiazanie']);

  const pytania = k.pozycje[0];
  assert.equal(pytania.znany, true);
  assert.equal(pytania.zrodloDaty, 'wyliczony');
  assert.equal(pytania.at, '2026-10-26T08:00:00.000Z'); // 4 dni przed terminem
  assert.match(pytania.podstawa.pl, /284/);

  const oferty = k.pozycje[1];
  assert.equal(oferty.zrodloDaty, 'ogloszenie', 'termin ofert jest JEDYNY, którego nie liczymy');
  assert.equal(oferty.at, '2026-10-30T08:00:00.000Z');

  const zwiazanie = k.pozycje[2];
  assert.equal(zwiazanie.zrodloDaty, 'wyliczony');
  assert.equal(zwiazanie.at, '2026-11-29T08:00:00.000Z'); // +30 dni
  assert.match(zwiazanie.podstawa.pl, /220/);
});

test('kalendarz TED liczy 14 dni na pytania i 90 dni związania', () => {
  const k = zbudujKalendarz(
    { id: 't2', source: 'ted', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );
  assert.equal(k.pozycje[0].at, '2026-10-16T08:00:00.000Z');
  assert.equal(k.pozycje[2].at, '2027-01-28T08:00:00.000Z');
});

test('Baza Konkurencyjności: termin ofert znany, dwa pozostałe uczciwie nieznane', () => {
  const k = zbudujKalendarz(
    { id: 't3', source: 'baza_konkurencyjnosci', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );
  const [pytania, oferty, zwiazanie] = k.pozycje;
  assert.equal(pytania.znany, false);
  assert.equal(pytania.at, null);
  assert.ok(pytania.brak.pl.length > 0 && pytania.brak.en.length > 0);
  assert.equal(oferty.znany, true);
  assert.equal(zwiazanie.znany, false);
});

test('bez terminu składania ofert NIE DA SIĘ policzyć niczego — i tak to mówimy', () => {
  const k = zbudujKalendarz({ id: 't4', source: 'bzp', deadline: null }, { teraz: '2026-10-01T00:00:00.000Z' });
  assert.equal(k.pozycje.every((p) => p.znany === false), true);
  assert.equal(k.nastepny, null);
  assert.ok(k.brakTerminu.pl.length > 0);
});

test('termin pytań wypadający w PRZESZŁOŚCI jest oznaczony jako miniony, a nie ukryty', () => {
  const k = zbudujKalendarz(
    { id: 't5', source: 'bzp', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-28T00:00:00.000Z' },
  );
  assert.equal(k.pozycje[0].minal, true);
  assert.equal(k.pozycje[1].minal, false);
});

test('następny krok to najbliższa PRZYSZŁA pozycja — po tym nazywa się karta na ekranie', () => {
  const k = zbudujKalendarz(
    { id: 't6', source: 'bzp', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-28T00:00:00.000Z' },
  );
  assert.equal(k.nastepny.kod, 'oferty');
  assert.equal(k.nastepny.dniDo, 2);
});

test('gdy wszystko minęło, nie wskazujemy następnego kroku', () => {
  const k = zbudujKalendarz(
    { id: 't7', source: 'bzp', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2027-01-01T00:00:00.000Z' },
  );
  assert.equal(k.nastepny, null);
});

test('anulowane postępowanie nie ma następnego kroku — nie ma po co czekać', () => {
  const k = zbudujKalendarz(
    { id: 't8', source: 'bzp', deadline: '2026-12-30T08:00:00.000Z', anulowany: true },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );
  assert.equal(k.nastepny, null);
  assert.equal(k.anulowany, true);
});

test('każdy rodzaj terminu ma etykietę PL/EN — ekran nie wymyśla własnych', () => {
  for (const r of RODZAJE_TERMINOW) {
    assert.ok(r.kod && r.etykieta?.pl && r.etykieta?.en, `rodzaj ${r.kod} bez etykiet`);
  }
});

test('eksport ICS zawiera tylko ZNANE daty i domyka kopertę kalendarza', () => {
  const k = zbudujKalendarz(
    { id: 't9', source: 'bzp', title: 'Remont drogi gminnej', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );
  const ics = doIcs([k], { teraz: '2026-10-01T00:00:00.000Z' });

  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.match(ics, /DTSTART:20261030T080000Z/);
  assert.match(ics, /Remont drogi gminnej/);
  // Przypomnienie w kalendarzu użytkownika — po to się eksportuje terminy.
  assert.match(ics, /BEGIN:VALARM/);
  // Każda linia kończy się CRLF (RFC 5545) — inaczej część klientów odmawia importu.
  assert.equal(ics.split('\r\n').length - 1, ics.split('\n').length - 1);
});

test('ICS bez ani jednej znanej daty jest pustą, ale POPRAWNĄ kopertą', () => {
  const k = zbudujKalendarz({ id: 't10', source: 'bzp', deadline: null }, { teraz: '2026-10-01T00:00:00.000Z' });
  const ics = doIcs([k], { teraz: '2026-10-01T00:00:00.000Z' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 0);
  assert.match(ics, /^BEGIN:VCALENDAR/);
});

test('identyfikator zdarzenia jest stabilny — powtórny import aktualizuje, nie dubluje', () => {
  const tender = { id: 't11', source: 'bzp', title: 'X', deadline: '2026-10-30T08:00:00.000Z' };
  const a = doIcs([zbudujKalendarz(tender, { teraz: '2026-10-01T00:00:00.000Z' })], { teraz: '2026-10-01T00:00:00.000Z' });
  const b = doIcs([zbudujKalendarz(tender, { teraz: '2026-10-05T00:00:00.000Z' })], { teraz: '2026-10-05T00:00:00.000Z' });
  const uid = (ics) => [...ics.matchAll(/UID:(.+)\r\n/g)].map((m) => m[1]);
  assert.deepEqual(uid(a), uid(b));
});

test('przecinki i średniki w tytule są zabezpieczone, inaczej rozjeżdżają plik', () => {
  const k = zbudujKalendarz(
    { id: 't12', source: 'bzp', title: 'Dostawa: papier, tonery; usługa', deadline: '2026-10-30T08:00:00.000Z' },
    { teraz: '2026-10-01T00:00:00.000Z' },
  );
  const ics = doIcs([k], { teraz: '2026-10-01T00:00:00.000Z' });
  assert.match(ics, /papier\\, tonery\\; usługa/);
});

test('nastepnyKrok działa też na gotowej liście pozycji, bez przeliczania kalendarza', () => {
  const pozycje = [
    { kod: 'pytania', at: '2026-10-01T00:00:00.000Z', znany: true },
    { kod: 'oferty', at: '2026-10-10T00:00:00.000Z', znany: true },
    { kod: 'zwiazanie', at: null, znany: false },
  ];
  assert.equal(nastepnyKrok(pozycje, '2026-10-05T00:00:00.000Z').kod, 'oferty');
  assert.equal(nastepnyKrok(pozycje, '2026-11-05T00:00:00.000Z'), null);
});
