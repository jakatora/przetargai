import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Model danych wyniku PRE-FLIGHT kontroli oferty przed wysłaniem — podzadanie 1/12
 * ulepszenia „Pre-flight kontrola oferty przed wysłaniem (podpis + kompletność)".
 *
 * To CZYSTY model danych (bez logiki sprawdzeń): fabryki `punktKontroli` /
 * `raportPreflight` oraz stałe `STATUS` / `WYNIK`. Testy pilnują kontraktu, na
 * którym oprą się kolejne podzadania (detektory, UI, wewnętrzny deadline):
 *  • kształt i pola punktu, domyślne komunikat/instrukcja,
 *  • integralność (błędny/niekompletny punkt się nie prześlizgnie),
 *  • ADWERSARYJNIE regułę statusu ogólnego: pass tylko gdy WSZYSTKIE zielone i
 *    lista niepusta; jeden czerwony albo PUSTA lista => fail (nic nie
 *    zweryfikowano => bramka nie daje zielonego światła),
 *  • niemutowalność (zamrożenie + kopia listy punktów).
 */

const { STATUS, WYNIK, punktKontroli, raportPreflight } =
  await import('../src/lib/preflightOferty.js');

// ── stałe kontraktu ──────────────────────────────────────────────────────────

test('STATUS: dokładnie zielony/czerwony, zamrożone', () => {
  assert.deepEqual({ ...STATUS }, { zielony: 'zielony', czerwony: 'czerwony' });
  assert.ok(Object.isFrozen(STATUS));
});

test('WYNIK: dokładnie pass/fail, zamrożone', () => {
  assert.deepEqual({ ...WYNIK }, { pass: 'pass', fail: 'fail' });
  assert.ok(Object.isFrozen(WYNIK));
});

// ── punktKontroli ────────────────────────────────────────────────────────────

test('punktKontroli: buduje punkt ze wszystkimi polami', () => {
  const p = punktKontroli({
    id: 'podpis_formularz',
    nazwa: 'Podpis formularza ofertowego',
    status: STATUS.czerwony,
    komunikat: 'Formularz nie jest podpisany.',
    instrukcja_naprawy: 'Podpisz formularz podpisem kwalifikowanym.',
  });
  assert.deepEqual(p, {
    id: 'podpis_formularz',
    nazwa: 'Podpis formularza ofertowego',
    status: 'czerwony',
    komunikat: 'Formularz nie jest podpisany.',
    instrukcja_naprawy: 'Podpisz formularz podpisem kwalifikowanym.',
  });
});

test('punktKontroli: komunikat i instrukcja_naprawy domyślnie puste', () => {
  const p = punktKontroli({ id: 'x', nazwa: 'X', status: STATUS.zielony });
  assert.equal(p.komunikat, '');
  assert.equal(p.instrukcja_naprawy, '');
});

test('punktKontroli: zwraca obiekt zamrożony (niemutowalny)', () => {
  const p = punktKontroli({ id: 'x', nazwa: 'X', status: STATUS.zielony });
  assert.ok(Object.isFrozen(p));
});

test('punktKontroli: odrzuca status spoza zielony/czerwony', () => {
  assert.throws(() => punktKontroli({ id: 'x', nazwa: 'X', status: 'pomarańczowy' }), /status/);
  assert.throws(() => punktKontroli({ id: 'x', nazwa: 'X', status: 'zielone' }), /status/);
  assert.throws(() => punktKontroli({ id: 'x', nazwa: 'X' }), /status/);
});

test('punktKontroli: wymaga niepustego id i nazwy', () => {
  assert.throws(() => punktKontroli({ id: '', nazwa: 'X', status: STATUS.zielony }), /id/);
  assert.throws(() => punktKontroli({ nazwa: 'X', status: STATUS.zielony }), /id/);
  assert.throws(() => punktKontroli({ id: 'x', nazwa: '', status: STATUS.zielony }), /nazwa/);
  assert.throws(() => punktKontroli({ id: 'x', status: STATUS.zielony }), /nazwa/);
});

// ── raportPreflight: status ogólny ───────────────────────────────────────────

test('raport: wszystkie punkty zielone => pass', () => {
  const r = raportPreflight([
    punktKontroli({ id: 'a', nazwa: 'A', status: STATUS.zielony }),
    punktKontroli({ id: 'b', nazwa: 'B', status: STATUS.zielony }),
  ]);
  assert.equal(r.status, WYNIK.pass);
  assert.equal(r.punkty.length, 2);
});

test('raport: choćby jeden czerwony => fail', () => {
  const r = raportPreflight([
    punktKontroli({ id: 'a', nazwa: 'A', status: STATUS.zielony }),
    punktKontroli({ id: 'b', nazwa: 'B', status: STATUS.czerwony }),
  ]);
  assert.equal(r.status, WYNIK.fail);
});

test('raport: PUSTA lista => fail (nic nie zweryfikowano, brak zielonego światła)', () => {
  const r = raportPreflight([]);
  assert.equal(r.status, WYNIK.fail);
  assert.deepEqual(r.punkty, []);
});

// ── raportPreflight: niemutowalność ──────────────────────────────────────────

test('raport: jest zamrożony i NIE trzyma referencji do wejściowej listy', () => {
  const wejscie = [punktKontroli({ id: 'a', nazwa: 'A', status: STATUS.zielony })];
  const r = raportPreflight(wejscie);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.punkty));
  // Dopisanie czerwonego punktu do wejścia PO zbudowaniu raportu nie zmienia wyniku.
  wejscie.push(punktKontroli({ id: 'b', nazwa: 'B', status: STATUS.czerwony }));
  assert.equal(r.punkty.length, 1);
  assert.equal(r.status, WYNIK.pass);
});

test('raport: odrzuca argument, który nie jest tablicą', () => {
  assert.throws(() => raportPreflight(null), /punkty/);
  assert.throws(() => raportPreflight('a'), /punkty/);
  assert.throws(() => raportPreflight(), /punkty/);
});
