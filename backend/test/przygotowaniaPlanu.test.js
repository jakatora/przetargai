import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generujPlanPrzygotowan,
  PROG_WADIUM,
  PROG_ZDOLNOSC_FINANSOWA,
  KAMIENIE_DNI_PRZED,
} from '../src/services/przygotowaniaPlanu.js';

/*
 * PLAN PRZYGOTOWAŃ DLA WYKRYTEJ POZYCJI PLANU (ulepszenie „Radar planów postępowań",
 * podzadanie 2/6). Czysta, deterministyczna funkcja: wykryta pozycja rocznego planu
 * postępowań × profil firmy × wstrzyknięte „dzisiaj" → zamrożony plan przygotowań:
 * lista dokumentów/referencji do skompletowania (wg CPV i wartości), flaga „potrzebny
 * partner do konsorcjum" (wg orientacyjnej wartości i zakresu względem zasobów firmy),
 * moment startu rezerwacji mocy przerobowych oraz kamienie milowe liczone WSTECZ od
 * przewidywanego terminu wszczęcia + jednozdaniowy komunikat „zacznij za ok. X dni;
 * masz Y mies. do wszczęcia". ZERO I/O / Date.now — `dzisiaj` wstrzykiwane parametrem.
 */

const DZIS = '2026-07-27';

const PROFIL = {
  cpv: ['45233000'], // roboty drogowe → dział 45
  maksymalnaWartoscKontraktu: 5_000_000,
  posiadaneDokumenty: [],
};

/** Skrót: plan przygotowań dla jednej pozycji z domyślnym profilem/dniem. */
function plan(pozycja, profil = PROFIL, dzisiaj = DZIS) {
  return generujPlanPrzygotowan({ pozycja, profil, dzisiaj });
}

/** Niezależny od produkcji licznik dni między dwiema datami ISO (UTC, bez zegara). */
function dniMiedzy(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// ─────────────────────────── stałe modelu ──────────────────────────────────

test('progi wartości i offsety kamieni mają udokumentowane wartości', () => {
  assert.equal(PROG_WADIUM, 1_000_000);
  assert.equal(PROG_ZDOLNOSC_FINANSOWA, 3_000_000);
  assert.deepEqual(KAMIENIE_DNI_PRZED, {
    partner: 120, dokumenty: 90, moce: 60, finansowanie: 30, gotowosc: 14,
  });
});

// ─────────────────────────── flaga konsorcjum ──────────────────────────────

test('wartość powyżej samodzielnego potencjału → potrzebny partner do konsorcjum', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: 8_000_000, terminWszczecia: '2027-01-01' });
  assert.equal(p.konsorcjum.potrzebnyPartner, true);
  assert.ok(p.konsorcjum.powody.some((s) => /warto/i.test(s)));
});

test('wartość w zasięgu potencjału i zgodny zakres → partner niepotrzebny', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: 2_000_000, terminWszczecia: '2027-01-01' });
  assert.equal(p.konsorcjum.potrzebnyPartner, false);
  assert.deepEqual(p.konsorcjum.powody, []);
});

test('CPV poza kompetencjami z profilu → partner mimo wartości w zasięgu', () => {
  const p = plan({ przedmiot: 'usługa projektowa', cpv: '71320000', orientacyjnaWartosc: 100_000, terminWszczecia: '2027-01-01' });
  assert.equal(p.konsorcjum.potrzebnyPartner, true);
  assert.ok(p.konsorcjum.powody.some((s) => /zakres|kompeten|71/i.test(s)));
});

test('orientacyjna wartość jako tekst PL („8 000 000 zł") jest rozpoznana', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: '8 000 000 zł', terminWszczecia: '2027-01-01' });
  assert.equal(p.konsorcjum.potrzebnyPartner, true);
});

// ─────────────────────────── dobór dokumentów ──────────────────────────────

test('dokumenty bazowe (oświadczenie, odpis, referencje) zawsze na liście', () => {
  const klucze = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' })
    .dokumenty.map((d) => d.klucz);
  assert.ok(klucze.includes('oswiadczenie_wykluczenie'));
  assert.ok(klucze.includes('odpis_rejestrowy'));
  assert.ok(klucze.includes('referencje'));
});

test('CPV 45 (roboty) → uprawnienia budowlane i potencjał techniczny', () => {
  const klucze = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' })
    .dokumenty.map((d) => d.klucz);
  assert.ok(klucze.includes('uprawnienia_budowlane'));
  assert.ok(klucze.includes('potencjal_techniczny'));
  assert.ok(!klucze.includes('uprawnienia_projektowe'));
});

test('CPV 71 (usługi projektowe) → uprawnienia projektowe, bez budowlanych', () => {
  const profil = { ...PROFIL, cpv: ['71320000'] };
  const klucze = plan({ przedmiot: 'projekt', cpv: '71320000', terminWszczecia: '2027-01-01' }, profil)
    .dokumenty.map((d) => d.klucz);
  assert.ok(klucze.includes('uprawnienia_projektowe'));
  assert.ok(!klucze.includes('uprawnienia_budowlane'));
});

test('wartość ≥ PROG_WADIUM → dokument wadium; poniżej progu → brak', () => {
  const duzy = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: PROG_WADIUM, terminWszczecia: '2027-01-01' });
  assert.ok(duzy.dokumenty.map((d) => d.klucz).includes('wadium'));
  const maly = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: 500_000, terminWszczecia: '2027-01-01' });
  assert.ok(!maly.dokumenty.map((d) => d.klucz).includes('wadium'));
});

test('wartość ≥ PROG_ZDOLNOSC_FINANSOWA → zdolność finansowa i polisa OC', () => {
  const profil = { ...PROFIL, maksymalnaWartoscKontraktu: 10_000_000 };
  const klucze = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: PROG_ZDOLNOSC_FINANSOWA, terminWszczecia: '2027-01-01' }, profil)
    .dokumenty.map((d) => d.klucz);
  assert.ok(klucze.includes('zdolnosc_finansowa'));
  assert.ok(klucze.includes('polisa_oc'));
});

test('dokumenty już posiadane są oznaczone i pominięte w doKompletowania', () => {
  const profil = { ...PROFIL, posiadaneDokumenty: ['referencje', 'odpis_rejestrowy'] };
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' }, profil);
  const ref = p.dokumenty.find((d) => d.klucz === 'referencje');
  assert.equal(ref.posiadany, true);
  const doZrobienia = p.doKompletowania.map((d) => d.klucz);
  assert.ok(!doZrobienia.includes('referencje'));
  assert.ok(!doZrobienia.includes('odpis_rejestrowy'));
  assert.ok(doZrobienia.includes('oswiadczenie_wykluczenie'));
});

// ─────────────────────────── kamienie milowe (cofanie od terminu) ──────────

test('kamienie milowe są cofane wstecz o zadaną liczbę dni od terminu wszczęcia', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: 8_000_000, terminWszczecia: '2027-01-01' });
  assert.equal(p.wszczecieData, '2027-01-01');
  const byKey = Object.fromEntries(p.kamienieMilowe.map((k) => [k.klucz, k]));
  for (const [klucz, dni] of Object.entries(KAMIENIE_DNI_PRZED)) {
    assert.ok(byKey[klucz], `brak kamienia ${klucz}`);
    assert.equal(dniMiedzy(byKey[klucz].data, p.wszczecieData), dni);
  }
});

test('kamienie milowe posortowane rosnąco wg daty (najpilniejszy pierwszy)', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', orientacyjnaWartosc: 8_000_000, terminWszczecia: '2027-01-01' });
  const daty = p.kamienieMilowe.map((k) => k.data);
  assert.deepEqual(daty, [...daty].sort());
  assert.equal(p.kamienieMilowe[0].klucz, 'partner'); // 120 dni przed = najwcześniej
});

test('start rezerwacji mocy = kamień „moce" (60 dni przed wszczęciem)', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' });
  assert.equal(p.startRezerwacjiMocy.klucz, 'moce');
  assert.equal(p.startRezerwacjiMocy.dniPrzed, 60);
  assert.equal(dniMiedzy(p.startRezerwacjiMocy.data, p.wszczecieData), 60);
});

// ─────────────────────────── komunikat i miesiące ──────────────────────────

test('komunikat: „zacznij za ok. X dni; masz Y mies. do wszczęcia"', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' });
  assert.equal(p.miesiacyDoWszczecia, 6); // 2026-07 → 2027-01
  const x = dniMiedzy(DZIS, p.startPrzygotowanIso);
  assert.ok(x > 0);
  assert.ok(p.komunikat.includes(`za ok. ${x} dni`), p.komunikat);
  assert.ok(p.komunikat.includes('6 mies'), p.komunikat);
});

test('dniDoStartu równa się dniOdDzis najwcześniejszego kamienia', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' });
  assert.equal(p.dniDoStartu, p.kamienieMilowe[0].dniOdDzis);
  assert.equal(p.dniDoStartu, dniMiedzy(DZIS, p.startPrzygotowanIso));
});

// ─────────────────────────── nieznany termin ───────────────────────────────

test('nieokreślony termin wszczęcia → daty null, offsety zachowane, komunikat ostrzega', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: 'do ustalenia' });
  assert.equal(p.wszczecieData, null);
  assert.equal(p.miesiacyDoWszczecia, null);
  assert.equal(p.dniDoStartu, null);
  assert.equal(p.startPrzygotowanIso, null);
  assert.ok(p.kamienieMilowe.every((k) => k.data === null && k.dniOdDzis === null));
  assert.equal(p.kamienieMilowe.find((k) => k.klucz === 'moce').dniPrzed, 60);
  assert.ok(/nieokreślon/i.test(p.komunikat), p.komunikat);
});

// ─────────────────────────── kształt wyniku / defensywność ─────────────────

test('wynik i jego zagnieżdżone struktury są zamrożone', () => {
  const p = plan({ przedmiot: 'roboty', cpv: '45233000', terminWszczecia: '2027-01-01' });
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.dokumenty));
  assert.ok(Object.isFrozen(p.kamienieMilowe));
  assert.ok(Object.isFrozen(p.konsorcjum));
  assert.ok(Object.isFrozen(p.dokumenty[0]));
  assert.ok(Object.isFrozen(p.kamienieMilowe[0]));
});

test('brak pozycji/profilu → plan bazowy bez wyjątku', () => {
  const p = generujPlanPrzygotowan({});
  assert.equal(p.konsorcjum.potrzebnyPartner, false);
  assert.ok(p.dokumenty.map((d) => d.klucz).includes('oswiadczenie_wykluczenie'));
  assert.equal(p.wszczecieData, null);
});
