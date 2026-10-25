import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRZYCZYNY, PRZYCZYNY_KLIENTA, ETYKIETY_PRZYCZYN, normalizujPrzyczyne, pustyLicznikPrzyczyn } from '../src/lib/przyczyny.js';
import {
  MIN_DNI_DOMYSLNIE, kartaSchema, kartaZUzytkownika, wersjaKarty, formalnePuste, wersjaFormalnych,
  brakiKarty, publicKarta,
} from '../src/lib/kartaFirmy.js';

test('przyczyny: zamknięta lista z etykietami PL i EN', () => {
  for (const kod of PRZYCZYNY) {
    assert.ok(ETYKIETY_PRZYCZYN[kod].pl && ETYKIETY_PRZYCZYN[kod].en, kod);
  }
  assert.ok(!PRZYCZYNY_KLIENTA.includes('wykluczenie'), 'klient nie odrzuca „wykluczeniem” — to reguła karty');
  assert.equal(normalizujPrzyczyne('teren'), 'teren');
  assert.equal(normalizujPrzyczyne('zupełnie inna'), 'inne');
  assert.equal(normalizujPrzyczyne(undefined), 'inne');
  assert.deepEqual(Object.keys(pustyLicznikPrzyczyn()), PRZYCZYNY);
});

test('karta starego konta: wartości domyślne zamiast undefined', () => {
  const k = kartaZUzytkownika({ keywords: ['droga'] });
  assert.deepEqual(k, {
    opis: null, wykluczenia: [], wartosc_min: null, min_dni_oferta: MIN_DNI_DOMYSLNIE,
    formalne: { obrot_roczny: null, referencja_kwota: null, referencja_opis: null, uprawnienia: [] },
  });
});

test('wersjaKarty: niezależna od kolejności list, wrażliwa na każdą twardą regułę i opis', () => {
  const baza = { keywords: ['droga', 'most'], cpv_codes: ['45'], regiony: ['18'], wartosc_max: 1e6,
    karta: { opis: 'drogi', wykluczenia: ['odśnieżanie'], wartosc_min: 1e4, min_dni_oferta: 5 } };
  const odwrocone = { ...baza, keywords: ['most', 'droga'] };
  assert.equal(wersjaKarty(baza), wersjaKarty(odwrocone));
  for (const zmiana of [
    { keywords: ['droga'] }, { cpv_codes: ['44'] }, { regiony: ['12'] }, { wartosc_max: 2e6 },
    { karta: { ...baza.karta, opis: 'mosty' } }, { karta: { ...baza.karta, wykluczenia: [] } },
    { karta: { ...baza.karta, wartosc_min: 0 } }, { karta: { ...baza.karta, min_dni_oferta: 7 } },
  ]) {
    assert.notEqual(wersjaKarty({ ...baza, ...zmiana }), wersjaKarty(baza), JSON.stringify(zmiana));
  }
});

test('wersjaKarty NIE zależy od części formalnej (ta ma własną wersję)', () => {
  const a = { keywords: ['x'], karta: { formalne: { obrot_roczny: 1e6 } } };
  const b = { keywords: ['x'], karta: { formalne: { obrot_roczny: 2e6 } } };
  assert.equal(wersjaKarty(a), wersjaKarty(b));
  assert.notEqual(wersjaFormalnych(a), wersjaFormalnych(b));
});

test('formalne puste → wersjaFormalnych null', () => {
  assert.equal(formalnePuste({}), true);
  assert.equal(wersjaFormalnych({}), null);
  assert.equal(formalnePuste({ karta: { formalne: { uprawnienia: ['ISO 9001'] } } }), false);
});

test('brakiKarty: kolejność od najważniejszego', () => {
  assert.deepEqual(brakiKarty({}), ['zakres', 'opis', 'wykluczenia', 'teren', 'skala', 'formalne']);
  assert.deepEqual(brakiKarty({
    keywords: ['a'], regiony: ['18'], wartosc_max: 1,
    karta: { opis: 'x', wykluczenia: ['y'], formalne: { obrot_roczny: 1 } },
  }), []);
});

test('kartaSchema: limity i typy', () => {
  assert.equal(kartaSchema.safeParse({ wykluczenia: Array(21).fill('ab') }).success, false);
  assert.equal(kartaSchema.safeParse({ min_dni_oferta: 0 }).success, false);
  assert.equal(kartaSchema.safeParse({ min_dni_oferta: 61 }).success, false);
  assert.equal(kartaSchema.safeParse({ opis: 'a'.repeat(601) }).success, false);
  assert.equal(kartaSchema.safeParse({ wartosc_min: -1 }).success, false);
  assert.equal(kartaSchema.safeParse({
    opis: 'Remonty dachów', wykluczenia: ['drogi'], regiony: ['podkarpackie'], wartosc_min: 0, wartosc_max: 5e5,
    min_dni_oferta: 7, formalne: { obrot_roczny: 2e6, uprawnienia: ['uprawnienia budowlane'] },
  }).success, true);
});

test('publicKarta: profil + karta w jednym kształcie', () => {
  const p = publicKarta({ company_name: 'X', keywords: ['a'], cpv_codes: [], regiony: ['18'], wartosc_max: 10 });
  assert.equal(p.company_name, 'X');
  assert.deepEqual(p.regiony, ['18']);
  assert.equal(p.min_dni_oferta, MIN_DNI_DOMYSLNIE);
});
