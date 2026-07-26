import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Wykrywanie stanu „warunek udziału niespełniony z powodu braku własnego
 * doświadczenia" — podzadanie 1/12 ulepszenia „Pożycz doświadczenie: kreator
 * polegania na zasobach podmiotu trzeciego (art. 118 Pzp)".
 *
 * `oceniWarunekDoswiadczenia` to CZYSTA funkcja walidująca JEDEN warunek udziału
 * dotyczący zdolności technicznej/zawodowej (doświadczenie). Zamiast blokującego
 * „nie spełniasz warunków" przy niedoborze WŁASNEGO doświadczenia zwraca sygnał
 * `WynikWarunku` z `uruchom_kreator_118=true` — wejście do ścieżki ratunkowej.
 * Testy pilnują kontraktu, na którym oprą się kolejne podzadania (kreator, UI):
 *  • niedobór (posiadana < wymagana) => sygnał kreatora 118 + opis luki,
 *  • spełniony (posiadana >= wymagana) => bez kreatora, luka pusta,
 *  • zero własnego doświadczenia => nadal kreator (można polegać w całości),
 *  • integralność wejścia i niemutowalność wyniku.
 */

const { oceniWarunekDoswiadczenia } =
  await import('../src/lib/warunekUdzialu.js');

// ── niedobór własnego doświadczenia => sygnał kreatora 118 ───────────────────

test('niedobór doświadczenia => WynikWarunku z uruchom_kreator_118=true', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Zdolność techniczna — roboty budowlane',
    wymagana_wartosc: 2,
    posiadana_wartosc: 1,
    jednostka: 'roboty budowlane o wartości min. 500 000 zł',
  });
  assert.equal(w.nazwa_warunku, 'Zdolność techniczna — roboty budowlane');
  assert.equal(w.spelniony, false);
  assert.equal(w.uruchom_kreator_118, true);
  assert.equal(w.wymagana_wartosc, 2);
  assert.equal(w.posiadana_wartosc, 1);
  assert.equal(
    w.luka_opis,
    'roboty budowlane o wartości min. 500 000 zł: wymagane 2, wykazane własnym '
      + 'doświadczeniem 1, brakuje 1.',
  );
});

test('bez podanej jednostki: luka_opis operuje samymi liczbami', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Doświadczenie w dostawach',
    wymagana_wartosc: 3,
    posiadana_wartosc: 1,
  });
  assert.equal(w.uruchom_kreator_118, true);
  assert.equal(
    w.luka_opis,
    'wymagane 3, wykazane własnym doświadczeniem 1, brakuje 2.',
  );
});

test('zero własnego doświadczenia => nadal kreator 118 (poleganie w całości)', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Doświadczenie — usługi',
    wymagana_wartosc: 1,
    posiadana_wartosc: 0,
  });
  assert.equal(w.spelniony, false);
  assert.equal(w.uruchom_kreator_118, true);
  assert.equal(w.posiadana_wartosc, 0);
});

// ── warunek spełniony => bez kreatora ────────────────────────────────────────

test('posiadana > wymagana => spełniony, bez kreatora, luka pusta', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Doświadczenie',
    wymagana_wartosc: 2,
    posiadana_wartosc: 5,
  });
  assert.equal(w.spelniony, true);
  assert.equal(w.uruchom_kreator_118, false);
  assert.equal(w.luka_opis, '');
});

test('posiadana == wymagana (granica) => spełniony', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Doświadczenie',
    wymagana_wartosc: 2,
    posiadana_wartosc: 2,
  });
  assert.equal(w.spelniony, true);
  assert.equal(w.uruchom_kreator_118, false);
});

// ── niemutowalność i integralność ────────────────────────────────────────────

test('zwraca obiekt zamrożony (niemutowalny)', () => {
  const w = oceniWarunekDoswiadczenia({
    nazwa_warunku: 'Doświadczenie',
    wymagana_wartosc: 2,
    posiadana_wartosc: 1,
  });
  assert.ok(Object.isFrozen(w));
});

test('wymaga niepustej nazwy warunku', () => {
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: '', wymagana_wartosc: 2, posiadana_wartosc: 1 }),
    /nazwa_warunku/,
  );
  assert.throws(
    () => oceniWarunekDoswiadczenia({ wymagana_wartosc: 2, posiadana_wartosc: 1 }),
    /nazwa_warunku/,
  );
});

test('wymaga dodatniej wymaganej wartości', () => {
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: 'X', wymagana_wartosc: 0, posiadana_wartosc: 0 }),
    /wymagana_wartosc/,
  );
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: 'X', wymagana_wartosc: -1, posiadana_wartosc: 0 }),
    /wymagana_wartosc/,
  );
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: 'X', wymagana_wartosc: 'dużo', posiadana_wartosc: 0 }),
    /wymagana_wartosc/,
  );
});

test('odrzuca ujemną lub nieliczbową posiadaną wartość', () => {
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: 'X', wymagana_wartosc: 2, posiadana_wartosc: -1 }),
    /posiadana_wartosc/,
  );
  assert.throws(
    () => oceniWarunekDoswiadczenia({ nazwa_warunku: 'X', wymagana_wartosc: 2, posiadana_wartosc: null }),
    /posiadana_wartosc/,
  );
});
