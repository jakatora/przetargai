import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wykryjZmiany,
  dopasujOgloszenie,
  WAGA_CPV_DOPASOWANIE,
  WAGA_WARTOSC,
  WAGA_TERMIN,
  PUNKT_ZA_SLOWO_OGL,
  MAX_SLOWA_OGL,
  PROG_WARTOSC_BLISKA,
  PROG_WARTOSC_LUZNA,
  PROG_TERMIN_BLISKI_DNI,
  PROG_TERMIN_LUZNY_DNI,
  PROG_PEWNE,
  PROG_PRAWDOPODOBNE,
} from '../src/services/zmianyPlanu.js';

/*
 * WYKRYWANIE ZMIAN PLANU I ŁĄCZENIE OGŁOSZENIA Z POZYCJĄ (ulepszenie „Radar planów
 * postępowań: wiedz o przetargu miesiące przed ogłoszeniem", podzadanie 3/6).
 * Czysta, deterministyczna logika: dwie migawki pozycji planu → lista zmian
 * (termin/wartość/CPV/przedmiot z kierunkiem i deltą) oraz pozycja × świeże ogłoszenie
 * → pewność dopasowania (pewne/prawdopodobne/brak) z flagą alarmu „to jest to, na co
 * czekałeś". ZERO I/O, bez Date.now. Reuse parsera terminu z radaru i matcherów CPV/słów.
 */

// ─────────────────────────── wykryjZmiany: termin ──────────────────────────

const BAZA = {
  cpv: '45233000',
  przedmiot: 'Budowa drogi gminnej',
  orientacyjnaWartosc: 1_000_000,
  terminWszczecia: '2026-09-01',
};

test('przesunięcie terminu w przyszłość → kierunek „opozniony" i dodatnia liczba dni', () => {
  const zmiany = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, terminWszczecia: '2026-11-01' },
  });
  assert.equal(zmiany.length, 1);
  const [z] = zmiany;
  assert.equal(z.typ, 'termin');
  assert.equal(z.kierunek, 'opozniony');
  assert.equal(z.dni, 61); // wrzesień(30) + październik(31)
});

test('przyspieszenie terminu → kierunek „przyspieszony" i ujemna liczba dni', () => {
  const zmiany = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, terminWszczecia: '2026-07-01' },
  });
  assert.equal(zmiany.length, 1);
  const [z] = zmiany;
  assert.equal(z.typ, 'termin');
  assert.equal(z.kierunek, 'przyspieszony');
  assert.equal(z.dni, -62); // lipiec(31) + sierpień(31)
});

test('termin skonkretyzowany z „do ustalenia" na datę → kierunek „ustalony"', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: { ...BAZA, terminWszczecia: 'do ustalenia' },
    pozycjaPo: { ...BAZA, terminWszczecia: '2026-11-01' },
  });
  assert.equal(z.typ, 'termin');
  assert.equal(z.kierunek, 'ustalony');
  assert.equal(z.dni, null);
});

test('brak zmiany terminu → brak wpisu o terminie', () => {
  const zmiany = wykryjZmiany({ pozycjaPrzed: BAZA, pozycjaPo: { ...BAZA } });
  assert.equal(zmiany.length, 0);
});

// ─────────────────────────── wykryjZmiany: wartość ─────────────────────────

test('wzrost wartości → kierunek „wzrost" i dodatnia delta %', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, orientacyjnaWartosc: 1_200_000 },
  });
  assert.equal(z.typ, 'wartosc');
  assert.equal(z.kierunek, 'wzrost');
  assert.equal(z.delta, 200_000);
  assert.equal(z.deltaProcent, 20);
});

test('spadek wartości → kierunek „spadek" i ujemna delta %', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, orientacyjnaWartosc: 800_000 },
  });
  assert.equal(z.typ, 'wartosc');
  assert.equal(z.kierunek, 'spadek');
  assert.equal(z.delta, -200_000);
  assert.equal(z.deltaProcent, -20);
});

test('wartość podana w formacie PL („1 200 000 zł") jest poprawnie porównana', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: { ...BAZA, orientacyjnaWartosc: '1 000 000 zł' },
    pozycjaPo: { ...BAZA, orientacyjnaWartosc: '1 200 000 zł' },
  });
  assert.equal(z.typ, 'wartosc');
  assert.equal(z.deltaProcent, 20);
});

// ─────────────────────────── wykryjZmiany: CPV i przedmiot ─────────────────

test('zmiana kodów CPV → wpis z listą dodanych i usuniętych kodów', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, cpv: '45000000' },
  });
  assert.equal(z.typ, 'cpv');
  assert.deepEqual(z.dodane, ['45000000']);
  assert.deepEqual(z.usuniete, ['45233000']);
});

test('zmiana opisu przedmiotu → wpis typu „przedmiot"', () => {
  const [z] = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: { ...BAZA, przedmiot: 'Przebudowa mostu na rzece' },
  });
  assert.equal(z.typ, 'przedmiot');
});

test('kilka zmian naraz → wszystkie wykryte (termin + wartość + CPV)', () => {
  const zmiany = wykryjZmiany({
    pozycjaPrzed: BAZA,
    pozycjaPo: {
      ...BAZA, terminWszczecia: '2026-11-01', orientacyjnaWartosc: 1_500_000, cpv: '45000000',
    },
  });
  assert.deepEqual(zmiany.map((z) => z.typ).sort(), ['cpv', 'termin', 'wartosc']);
});

test('identyczne migawki → pusta (zamrożona) lista zmian', () => {
  const zmiany = wykryjZmiany({ pozycjaPrzed: BAZA, pozycjaPo: { ...BAZA } });
  assert.deepEqual(zmiany, []);
  assert.ok(Object.isFrozen(zmiany));
});

test('brak jednej z migawek → pusta lista', () => {
  assert.deepEqual(wykryjZmiany({ pozycjaPrzed: BAZA }), []);
  assert.deepEqual(wykryjZmiany({ pozycjaPo: BAZA }), []);
  assert.deepEqual(wykryjZmiany({}), []);
});

// ─────────────────────────── dopasujOgloszenie: stałe modelu ───────────────

test('stałe wag i progów dopasowania mają udokumentowane wartości', () => {
  assert.equal(WAGA_CPV_DOPASOWANIE, 50);
  assert.equal(WAGA_WARTOSC, 20);
  assert.equal(WAGA_TERMIN, 15);
  assert.equal(PUNKT_ZA_SLOWO_OGL, 5);
  assert.equal(MAX_SLOWA_OGL, 3);
  assert.equal(PROG_WARTOSC_BLISKA, 0.8);
  assert.equal(PROG_WARTOSC_LUZNA, 0.5);
  assert.equal(PROG_TERMIN_BLISKI_DNI, 45);
  assert.equal(PROG_TERMIN_LUZNY_DNI, 120);
  assert.equal(PROG_PEWNE, 70);
  assert.equal(PROG_PRAWDOPODOBNE, 40);
});

// ─────────────────────────── dopasujOgloszenie: pewność ────────────────────

test('pełna zbieżność (CPV + wartość + termin + słowa) → „pewne" i alarm', () => {
  const wynik = dopasujOgloszenie({
    pozycja: {
      cpv: '45233000',
      przedmiot: 'Budowa drogi gminnej z chodnikiem',
      orientacyjnaWartosc: 1_000_000,
      terminWszczecia: '2026-09',
    },
    ogloszenie: {
      cpv: '45233000-1',
      przedmiot: 'Budowa drogi gminnej z chodnikiem w gminie X',
      wartosc: 1_000_000,
      dataPublikacji: '2026-09-10',
    },
  });
  assert.equal(wynik.pewnosc, 100);
  assert.equal(wynik.etykieta, 'pewne');
  assert.equal(wynik.alarm, true);
  assert.equal(wynik.sygnaly.cpv.affinity, 1);
});

test('sam dokładny CPV (bez innych sygnałów) → „prawdopodobne", bez alarmu', () => {
  const wynik = dopasujOgloszenie({
    pozycja: { cpv: '45233000', przedmiot: 'Budowa drogi' },
    ogloszenie: { cpv: '45233000', przedmiot: 'Dostawa papieru biurowego' },
  });
  assert.equal(wynik.pewnosc, 50);
  assert.equal(wynik.etykieta, 'prawdopodobne');
  assert.equal(wynik.alarm, false);
});

test('maksymalne sygnały bez CPV (50 pkt) → „prawdopodobne", NIGDY alarm', () => {
  const wynik = dopasujOgloszenie({
    pozycja: {
      cpv: '30190000',
      przedmiot: 'Budowa drogi gminnej z chodnikiem',
      orientacyjnaWartosc: 1_000_000,
      terminWszczecia: '2026-09',
    },
    ogloszenie: {
      cpv: '45233000',
      przedmiot: 'Budowa drogi gminnej z chodnikiem',
      wartosc: 1_000_000,
      dataPublikacji: '2026-09-05',
    },
  });
  assert.equal(wynik.sygnaly.cpv.punkty, 0);
  assert.equal(wynik.pewnosc, 50);
  assert.equal(wynik.etykieta, 'prawdopodobne');
  assert.equal(wynik.alarm, false); // alarm wymaga CPV — nieosiągalny bez niego
});

test('rozbieżne branże i terminy → „brak", bez alarmu', () => {
  const wynik = dopasujOgloszenie({
    pozycja: {
      cpv: '45233000',
      przedmiot: 'Budowa drogi',
      orientacyjnaWartosc: 1_000_000,
      terminWszczecia: '2026-09',
    },
    ogloszenie: {
      cpv: '77000000',
      przedmiot: 'Usługi sadzenia drzew',
      wartosc: 300_000,
      dataPublikacji: '2027-06',
    },
  });
  assert.equal(wynik.pewnosc, 0);
  assert.equal(wynik.etykieta, 'brak');
  assert.equal(wynik.alarm, false);
});

// ─────────────────────────── dopasujOgloszenie: progi wartości ─────────────

test('zbieżność wartości: ≥0.8 pełne punkty, ≥0.5 połowa, poniżej zero', () => {
  const poz = { cpv: '45233000', orientacyjnaWartosc: 1_000_000 };
  const bliska = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', wartosc: 900_000 } });
  const luzna = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', wartosc: 600_000 } });
  const daleka = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', wartosc: 400_000 } });
  assert.equal(bliska.sygnaly.wartosc.punkty, 20);
  assert.equal(luzna.sygnaly.wartosc.punkty, 10);
  assert.equal(daleka.sygnaly.wartosc.punkty, 0);
});

// ─────────────────────────── dopasujOgloszenie: progi terminu ──────────────

test('bliskość terminu: ≤45 dni pełne, ≤120 połowa, dalej zero', () => {
  const poz = { cpv: '45233000', terminWszczecia: '2026-09-01' };
  const bliski = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', dataPublikacji: '2026-09-10' } });
  const luzny = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', dataPublikacji: '2026-11-01' } });
  const daleki = dopasujOgloszenie({ pozycja: poz, ogloszenie: { cpv: '45233000', dataPublikacji: '2027-03-01' } });
  assert.equal(bliski.sygnaly.termin.punkty, 15);
  assert.equal(luzny.sygnaly.termin.punkty, 8); // round(15/2)
  assert.equal(daleki.sygnaly.termin.punkty, 0);
});

// ─────────────────────────── dopasujOgloszenie: kształt wyniku ─────────────

test('wynik dopasowania jest zamrożony wraz z sekcją sygnałów', () => {
  const wynik = dopasujOgloszenie({
    pozycja: { cpv: '45233000', przedmiot: 'Budowa drogi' },
    ogloszenie: { cpv: '45233000', przedmiot: 'Budowa drogi' },
  });
  assert.ok(Object.isFrozen(wynik));
  assert.ok(Object.isFrozen(wynik.sygnaly));
  assert.ok(Array.isArray(wynik.powody));
  assert.equal(typeof wynik.komunikat, 'string');
});

test('puste wejście dopasowania → „brak", bez wyjątku', () => {
  const wynik = dopasujOgloszenie({});
  assert.equal(wynik.etykieta, 'brak');
  assert.equal(wynik.pewnosc, 0);
  assert.equal(wynik.alarm, false);
});
