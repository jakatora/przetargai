import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wyciagnijParametryFinansowe,
  DOMYSLNE_PARAMETRY,
  TERMIN_DOMYSLNY_DNI,
  ZABEZPIECZENIE_DOMYSLNE_PROC,
  ZABEZPIECZENIE_MAX_PROC,
} from '../src/services/parametryFinansowe.js';

/*
 * Ekstrakcja parametrów finansowych kontraktu (ulepszenie „Symulator płynności:
 * czy udźwigniesz ten kontrakt", podzadanie 1/6). Czysta, deterministyczna funkcja
 * treść SWZ + wzór umowy → znormalizowany model finansowy, z BEZPIECZNYMI domyślnymi
 * gdy dane są niepełne. ZERO I/O, bez Date.now, bez płatnego AI.
 */

// ───────────────────────── domyślne przy pustym wejściu ─────────────────────

test('domyślne — puste wejście daje bezpieczny model (30 dni, 5%, bez zaliczki)', () => {
  const oczekiwane = {
    harmonogramPlatnosci: 'jedna_faktura',
    terminZaplatyDni: 30,
    zabezpieczenieProcent: 5,
    zabezpieczenieForma: 'nieokreslona',
    zaliczkaProcent: 0,
    wadiumKwota: null,
    cenaBrutto: null,
  };
  assert.deepEqual(wyciagnijParametryFinansowe('', ''), oczekiwane);
});

test('domyślne — brak argumentów i null/undefined też dają model domyślny', () => {
  assert.deepEqual(wyciagnijParametryFinansowe(), DOMYSLNE_PARAMETRY);
  assert.deepEqual(wyciagnijParametryFinansowe(null, undefined), DOMYSLNE_PARAMETRY);
});

test('stałe domyślne mają udokumentowane, bezpieczne wartości', () => {
  assert.equal(TERMIN_DOMYSLNY_DNI, 30);
  assert.equal(ZABEZPIECZENIE_DOMYSLNE_PROC, 5);
  assert.equal(ZABEZPIECZENIE_MAX_PROC, 10);
});

// ───────────────────────── harmonogram płatności ────────────────────────────

test('harmonogram — płatności/faktury częściowe rozpoznane jako czesciowe', () => {
  const swz = 'Zamawiający dopuszcza płatności częściowe. Faktury częściowe wystawiane będą za wykonane i odebrane etapy robót.';
  assert.equal(wyciagnijParametryFinansowe(swz, '').harmonogramPlatnosci, 'czesciowe');
});

test('harmonogram — fakturowanie miesięczne też jest częściowe', () => {
  const um = 'Wynagrodzenie rozliczane będzie fakturami miesięcznymi za faktycznie wykonane usługi.';
  assert.equal(wyciagnijParametryFinansowe('', um).harmonogramPlatnosci, 'czesciowe');
});

test('harmonogram — jedna faktura końcowa po odbiorze całości', () => {
  const um = 'Zapłata wynagrodzenia nastąpi jedną fakturą końcową po odbiorze całości przedmiotu umowy.';
  assert.equal(wyciagnijParametryFinansowe('', um).harmonogramPlatnosci, 'jedna_faktura');
});

// ───────────────────────── termin zapłaty ───────────────────────────────────

test('termin zapłaty — „w terminie 60 dni" odczytany z umowy', () => {
  const um = 'Wynagrodzenie płatne w terminie 60 dni od dnia doręczenia prawidłowo wystawionej faktury.';
  assert.equal(wyciagnijParametryFinansowe('', um).terminZaplatyDni, 60);
});

// ───────────────────────── zabezpieczenie należytego wykonania ───────────────

test('zabezpieczenie — 8% ceny całkowitej brutto odczytane wprost', () => {
  const um = 'Wykonawca wniesie zabezpieczenie należytego wykonania umowy w wysokości 8% ceny całkowitej brutto.';
  assert.equal(wyciagnijParametryFinansowe('', um).zabezpieczenieProcent, 8);
});

test('zabezpieczenie — progi dolny 2% i górny 10% odczytane dokładnie', () => {
  assert.equal(
    wyciagnijParametryFinansowe('', 'Zabezpieczenie w wysokości 2% ceny brutto.').zabezpieczenieProcent, 2);
  assert.equal(
    wyciagnijParametryFinansowe('', 'Zabezpieczenie w wysokości 10% ceny brutto.').zabezpieczenieProcent, 10);
});

test('zabezpieczenie — absurdalny odczyt przycięty do ustawowego maksimum 10%', () => {
  const um = 'Zabezpieczenie w wysokości 25% ceny brutto.';
  assert.equal(wyciagnijParametryFinansowe('', um).zabezpieczenieProcent, 10);
});

test('zabezpieczenie forma — dopuszczona gwarancja/ubezpieczenie → dowolna', () => {
  const um = 'Zabezpieczenie może być wniesione w gwarancji bankowej lub ubezpieczeniowej.';
  assert.equal(wyciagnijParametryFinansowe('', um).zabezpieczenieForma, 'dowolna');
});

test('zabezpieczenie forma — wnoszone w pieniądzu → pieniadz', () => {
  const um = 'Zabezpieczenie wnoszone jest w pieniądzu na rachunek bankowy Zamawiającego.';
  assert.equal(wyciagnijParametryFinansowe('', um).zabezpieczenieForma, 'pieniadz');
});

// ───────────────────────── zaliczka ─────────────────────────────────────────

test('zaliczka — obecna: „udzielenie zaliczki w wysokości 20%"', () => {
  const swz = 'Zamawiający przewiduje udzielenie zaliczki w wysokości 20% wynagrodzenia.';
  assert.equal(wyciagnijParametryFinansowe(swz, '').zaliczkaProcent, 20);
});

test('zaliczka — brak: „nie przewiduje udzielenia zaliczek" → 0', () => {
  const swz = 'Zamawiający nie przewiduje udzielenia zaliczek.';
  assert.equal(wyciagnijParametryFinansowe(swz, '').zaliczkaProcent, 0);
});

// ───────────────────────── wadium ───────────────────────────────────────────

test('wadium — kwota „15 000,00 zł" sparsowana do liczby 15000', () => {
  const swz = 'Wykonawca zobowiązany jest wnieść wadium w wysokości 15 000,00 zł przed upływem terminu.';
  assert.equal(wyciagnijParametryFinansowe(swz, '').wadiumKwota, 15000);
});

test('wadium — „nie żąda wniesienia wadium" → null', () => {
  const swz = 'Zamawiający nie żąda wniesienia wadium w niniejszym postępowaniu.';
  assert.equal(wyciagnijParametryFinansowe(swz, '').wadiumKwota, null);
});

// ───────────────────────── cena brutto ──────────────────────────────────────

test('cena brutto — „1 200 000,00 zł" z formatu PL sparsowana na 1200000', () => {
  const um = 'Całkowite wynagrodzenie brutto wynosi 1 200 000,00 zł.';
  assert.equal(wyciagnijParametryFinansowe('', um).cenaBrutto, 1200000);
});

// ───────────────────────── wynik zamrożony + pełna integracja ────────────────

test('wynik jest zamrożony (migawka modelu)', () => {
  assert.ok(Object.isFrozen(wyciagnijParametryFinansowe('', '')));
});

test('integracja — realistyczny SWZ + wzór umowy dają komplet parametrów', () => {
  const swz = `
    Zamawiający żąda wniesienia wadium w wysokości 15 000,00 zł.
    Zamawiający przewiduje udzielenie zaliczki w wysokości 10% wynagrodzenia.
  `;
  const umowa = `
    Całkowite wynagrodzenie brutto wynosi 1 200 000,00 zł.
    Zapłata nastąpi na podstawie faktur częściowych za odebrane etapy, w terminie 30 dni od doręczenia faktury.
    Wykonawca wniesie zabezpieczenie należytego wykonania umowy w wysokości 5% ceny brutto; dopuszcza się gwarancję bankową.
  `;
  assert.deepEqual(wyciagnijParametryFinansowe(swz, umowa), {
    harmonogramPlatnosci: 'czesciowe',
    terminZaplatyDni: 30,
    zabezpieczenieProcent: 5,
    zabezpieczenieForma: 'dowolna',
    zaliczkaProcent: 10,
    wadiumKwota: 15000,
    cenaBrutto: 1200000,
  });
});
