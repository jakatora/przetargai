import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dataWaznosci,
  dniDoWaznosci,
  statusDokumentu,
  dzienAlertu,
} from '../src/services/waznoscDokumentow.js';

import { typDokumentu } from '../src/config/dokumentyKatalog.js';

/*
 * Czysta logika świeżości dokumentów sejfu (podzadanie 2/7 ulepszenia „Sejf
 * podmiotowych środków dowodowych z licznikiem świeżości").
 *
 * Funkcje są CZYSTE i BEZ DB: daty to łańcuchy ISO 'YYYY-MM-DD', a „dziś" (dzień
 * odniesienia / przewidywany dzień złożenia) jest zawsze WSTRZYKIWANY — dzięki
 * czemu ta sama logika obsłuży zarówno „na dzisiaj", jak i „na przewidywany dzień
 * złożenia oferty" (kluczowe przy przesunięciach terminu w podzadaniu 5).
 *
 * Sedno: alert liczy REALNY czas oczekiwania na urząd — KRK pocztą potrafi iść
 * ~3 tygodnie, więc dla niego alarm zapala się istotnie wcześniej niż dla
 * zaświadczeń US/ZUS wydawanych niemal od ręki.
 */

// ── dataWaznosci ─────────────────────────────────────────────────────────────

test('dataWaznosci — data ważności = data wystawienia + okres (liczony w dniach)', () => {
  assert.equal(dataWaznosci('2026-01-10', 90), '2026-04-10', 'US/ZUS: +90 dni');
  assert.equal(dataWaznosci('2026-01-10', 180), '2026-07-09', 'KRK: +180 dni');
});

test('dataWaznosci — przechodzi granicę miesiąca, roku i rok przestępny', () => {
  assert.equal(dataWaznosci('2025-12-20', 30), '2026-01-19', 'granica roku');
  assert.equal(dataWaznosci('2024-02-28', 1), '2024-02-29', 'rok przestępny — 29 lutego istnieje');
  assert.equal(dataWaznosci('2024-02-29', 1), '2024-03-01', 'z 29 lutego na 1 marca');
});

test('dataWaznosci — dokument bezterminowy (okres null) nie ma daty ważności', () => {
  assert.equal(dataWaznosci('2020-01-01', null), null, 'wykaz robót / uprawnienia — bezterminowe');
});

test('dataWaznosci — odrzuca ujemny/niecałkowity okres i błędną datę', () => {
  assert.throws(() => dataWaznosci('2026-01-10', -5), 'okres nie może być ujemny');
  assert.throws(() => dataWaznosci('2026-01-10', 90.5), 'okres musi być całkowity');
  assert.throws(() => dataWaznosci('nie-data', 90), 'błędna data wystawienia');
  assert.throws(() => dataWaznosci('2026-02-30', 90), 'nieistniejący dzień (30 lutego)');
});

// ── dniDoWaznosci ────────────────────────────────────────────────────────────

test('dniDoWaznosci — dodatnia liczba dni, gdy dokument wciąż świeży', () => {
  // KRK 2026-01-10 + 180 = ważne do 2026-07-09; na 2026-04-01 zostaje zapas.
  assert.equal(dniDoWaznosci('2026-01-10', 90, '2026-04-01'), 9, 'do ważności 2026-04-10');
  assert.equal(dniDoWaznosci('2026-01-10', 90, '2026-01-10'), 90, 'w dniu wystawienia = pełny okres');
});

test('dniDoWaznosci — 0 w dniu ważności, ujemne po terminie', () => {
  assert.equal(dniDoWaznosci('2026-01-10', 90, '2026-04-10'), 0, 'ostatni ważny dzień');
  assert.equal(dniDoWaznosci('2026-01-10', 90, '2026-04-11'), -1, 'dzień po = przeterminowane');
  assert.equal(dniDoWaznosci('2026-01-10', 90, '2026-05-10'), -30, 'miesiąc po terminie');
});

test('dniDoWaznosci — dokument bezterminowy nigdy nie traci ważności (Infinity)', () => {
  assert.equal(dniDoWaznosci('2020-01-01', null, '2030-01-01'), Infinity);
});

test('dniDoWaznosci — niezależne od strefy czasowej / DST (pełne dni po UTC)', () => {
  // 90 dni obejmuje wiosenną zmianę czasu w PL — wynik ma być dokładnie 90.
  assert.equal(dniDoWaznosci('2026-03-01', 90, '2026-03-01'), 90);
});

// ── statusDokumentu ──────────────────────────────────────────────────────────

const KRK = {
  dataWystawienia: '2026-01-10',       // ważne do 2026-07-09
  okresWaznosciDni: 180,
  czasOczekiwaniaUrzadDni: 21,         // alert od 2026-06-18
};

test('statusDokumentu — „gotowy" póki zostaje więcej dni niż czas urzędu', () => {
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-06-17' }), // 22 dni > 21
    'gotowy',
  );
});

test('statusDokumentu — „zamow_nowy" od dnia alertu aż do dnia ważności włącznie', () => {
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-06-18' }), // dokładnie 21 dni = dzień alertu
    'zamow_nowy',
    'granica: gdy zapas zrówna się z czasem urzędu, trzeba już zamawiać',
  );
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-07-09' }), // 0 dni — ostatni ważny dzień
    'zamow_nowy',
  );
});

test('statusDokumentu — „przeterminowany" po dniu ważności', () => {
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-07-10' }), // -1 dzień
    'przeterminowany',
  );
});

test('statusDokumentu — dokument bezterminowy jest zawsze „gotowy"', () => {
  assert.equal(
    statusDokumentu({
      dataWystawienia: '2015-01-01',
      okresWaznosciDni: null,
      czasOczekiwaniaUrzadDni: 0,
      dzienOdniesienia: '2030-01-01',
    }),
    'gotowy',
    'wykaz robót / uprawnienia — licznik świeżości ich nie przeterminowuje',
  );
});

test('statusDokumentu — bufor bezpieczeństwa przesuwa próg „zamów nowy" wcześniej', () => {
  // Bez bufora 22 dni to jeszcze „gotowy"; z buforem 3 dni próg = 21+3=24, więc alarm.
  assert.equal(statusDokumentu({ ...KRK, dzienOdniesienia: '2026-06-17' }), 'gotowy');
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-06-17', buforDni: 3 }),
    'zamow_nowy',
  );
});

test('statusDokumentu — działa na przewidywany dzień złożenia (przesunięcie terminu)', () => {
  // Ten sam dokument „na dziś" gotowy, ale rozstrzygamy go na PRZYSZŁY dzień złożenia:
  // jeśli przetarg złożymy 2026-07-20, KRK zdąży się przeterminować (ważny do 07-09).
  assert.equal(statusDokumentu({ ...KRK, dzienOdniesienia: '2026-06-01' }), 'gotowy', 'na dziś: świeży');
  assert.equal(
    statusDokumentu({ ...KRK, dzienOdniesienia: '2026-07-20' }),
    'przeterminowany',
    'na przewidywany (przesunięty) dzień złożenia: już nieważny',
  );
});

test('statusDokumentu — spójny z realnym katalogiem typów (KRK z config)', () => {
  const t = typDokumentu('krk');
  assert.equal(
    statusDokumentu({
      dataWystawienia: '2026-01-10',
      okresWaznosciDni: t.okresWaznosciDniDomyslny, // 180
      czasOczekiwaniaUrzadDni: t.czasOczekiwaniaUrzadDni, // 21
      dzienOdniesienia: '2026-06-18',
    }),
    'zamow_nowy',
    'logika czyta parametry z katalogu, nie z zaszytych liczb',
  );
});

// ── dzienAlertu ──────────────────────────────────────────────────────────────

test('dzienAlertu — data alertu = data ważności minus realny czas urzędu', () => {
  assert.equal(dzienAlertu('2026-07-09', 21), '2026-06-18', 'KRK: 21 dni wyprzedzenia');
  assert.equal(dzienAlertu('2026-07-09', 7), '2026-07-02', 'US/ZUS: 7 dni wyprzedzenia');
});

test('dzienAlertu — KRK (pocztą) alarmuje NAJWCZEŚNIEJ ze wszystkich typów', () => {
  const waznosc = '2026-07-09'; // wspólna data ważności dla porównania
  const alertKrk = dzienAlertu(waznosc, typDokumentu('krk').czasOczekiwaniaUrzadDni);
  const alertUs = dzienAlertu(waznosc, typDokumentu('us').czasOczekiwaniaUrzadDni);
  const alertZus = dzienAlertu(waznosc, typDokumentu('zus').czasOczekiwaniaUrzadDni);
  // ISO 'YYYY-MM-DD' porównuje się leksykograficznie jak chronologicznie.
  assert.ok(alertKrk < alertUs, 'KRK alarmuje wcześniej niż US');
  assert.ok(alertKrk < alertZus, 'KRK alarmuje wcześniej niż ZUS');
});

test('dzienAlertu — bufor bezpieczeństwa dokłada dodatkowe wyprzedzenie', () => {
  assert.equal(dzienAlertu('2026-07-09', 21, 5), '2026-06-13', '21 + 5 dni zapasu');
});

test('dzienAlertu — dokument bezterminowy (data ważności null) nie ma alertu', () => {
  assert.equal(dzienAlertu(null, 21), null, 'brak daty ważności → brak alarmu');
});

test('dzienAlertu — czas oczekiwania 0 (dokument własny) alarmuje dopiero w dniu ważności', () => {
  assert.equal(dzienAlertu('2026-07-09', 0), '2026-07-09');
});
