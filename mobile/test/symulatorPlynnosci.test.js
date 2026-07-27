import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUSY,
  formatujZl,
  formatujMiesiace,
  opisStatusu,
  uporzadkujRuchy,
  podsumowanieRekomendacji,
} from '../src/lib/symulatorPlynnosci.js';

/*
 * SYMULATOR PŁYNNOŚCI „CZY UDŹWIGNIESZ KONTRAKT" — panel mobilny (podzadanie 5/6).
 * Czysta logika PREZENTACJI: formatowanie kwoty luki w zł, liczby miesięcy pomostowych,
 * etykiety statusu (udzwigniesz/napiete/luka_krytyczna) z semantycznym `ton` koloru oraz
 * uporządkowanie konkretnych ruchów domknięcia luki. Bez Reacta i bez sieci — ekran (krok
 * 6/6) tylko renderuje to, co tu policzone, a kolor dokłada z tokenów motyw.js przez `ton`.
 *
 * Statusy i progi muszą być spójne z backendem services/rekomendacjePlynnosci.js
 * (udzwigniesz / napiete / luka_krytyczna) — to ta sama decyzja „startować czy nie".
 */

// ---------------- formatujZl: polski zapis kwoty ----------------

test('formatujZl: grupuje tysiące i dokleja „zł"', () => {
  assert.equal(formatujZl(180000), '180 000 zł');
  assert.equal(formatujZl(1234567), '1 234 567 zł');
  assert.equal(formatujZl(0), '0 zł');
});

test('formatujZl: zaokrągla do pełnych złotych', () => {
  assert.equal(formatujZl(1999.6), '2 000 zł');
  assert.equal(formatujZl(49.4), '49 zł');
});

test('formatujZl: null/NaN/ujemne → „0 zł" (pesymistycznie, nigdy nie wywraca ekranu)', () => {
  assert.equal(formatujZl(null), '0 zł');
  assert.equal(formatujZl(undefined), '0 zł');
  assert.equal(formatujZl('xx'), '0 zł');
  assert.equal(formatujZl(-5000), '0 zł');
});

// ---------------- formatujMiesiace: polska odmiana ----------------

test('formatujMiesiace: poprawna odmiana miesiąc/miesiące/miesięcy', () => {
  assert.equal(formatujMiesiace(1), '1 miesiąc');
  assert.equal(formatujMiesiace(2), '2 miesiące');
  assert.equal(formatujMiesiace(4), '4 miesiące');
  assert.equal(formatujMiesiace(5), '5 miesięcy');
  assert.equal(formatujMiesiace(0), '0 miesięcy');
});

test('formatujMiesiace: wyjątki 12–14 → „miesięcy", 22–24 → „miesiące"', () => {
  assert.equal(formatujMiesiace(11), '11 miesięcy');
  assert.equal(formatujMiesiace(12), '12 miesięcy');
  assert.equal(formatujMiesiace(14), '14 miesięcy');
  assert.equal(formatujMiesiace(22), '22 miesiące');
  assert.equal(formatujMiesiace(25), '25 miesięcy');
});

test('formatujMiesiace: śmieci/ujemne → „0 miesięcy"', () => {
  assert.equal(formatujMiesiace(null), '0 miesięcy');
  assert.equal(formatujMiesiace(-3), '0 miesięcy');
  assert.equal(formatujMiesiace(3.4), '3 miesiące');
});

// ---------------- opisStatusu: etykieta + ton koloru ----------------

test('opisStatusu: trzy statusy backendu mają etykietę i właściwy ton', () => {
  assert.equal(opisStatusu('udzwigniesz').ton, 'sukces');
  assert.equal(opisStatusu('napiete').ton, 'ostrzezenie');
  assert.equal(opisStatusu('luka_krytyczna').ton, 'danger');
  for (const s of STATUSY) {
    const w = opisStatusu(s);
    assert.ok(w.etykieta.length > 0, `status ${s} ma etykietę`);
    assert.ok(w.opis.length > 0, `status ${s} ma opis`);
    assert.ok(Object.isFrozen(w));
  }
});

test('opisStatusu: nieznany/pusty status → neutralny opis domyślny (ekran nie znika)', () => {
  for (const s of ['cokolwiek', '', null, undefined]) {
    const w = opisStatusu(s);
    assert.equal(w.ton, 'neutral');
    assert.ok(w.etykieta.length > 0);
  }
});

test('opisStatusu: „ton" należy do słownika tonów motyw.js', () => {
  const dozwolone = new Set(['sukces', 'ostrzezenie', 'danger', 'neutral']);
  for (const s of [...STATUSY, 'nieznany']) {
    assert.ok(dozwolone.has(opisStatusu(s).ton));
  }
});

// ---------------- uporzadkujRuchy: kolejność + etykieta oszczędności ----------------

const RUCHY = [
  // Celowo w KIEPSKIEJ kolejności, żeby test sprawdzał sortowanie, nie przepisywanie wejścia.
  { typ: 'faktoring', tytul: 'Faktoring', opis: '...', oszczednoscKwota: null },
  { typ: 'wniosek_zaliczka', tytul: 'Zaliczka', opis: '...', oszczednoscKwota: 50000 },
  { typ: 'platnosci_czesciowe', tytul: 'Częściowe', opis: '...', oszczednoscKwota: null },
  { typ: 'zabezpieczenie_gwarancja', tytul: 'Gwarancja', opis: '...', oszczednoscKwota: 200000 },
];

test('uporzadkujRuchy: ruchy uwalniające gotówkę idą pierwsze, większa kwota wyżej', () => {
  const out = uporzadkujRuchy(RUCHY);
  assert.deepEqual(
    out.map((r) => r.typ),
    ['zabezpieczenie_gwarancja', 'wniosek_zaliczka', 'platnosci_czesciowe', 'faktoring'],
  );
});

test('uporzadkujRuchy: faktoring (finansowanie zewnętrzne) zawsze na końcu', () => {
  const out = uporzadkujRuchy(RUCHY);
  assert.equal(out[out.length - 1].typ, 'faktoring');
});

test('uporzadkujRuchy: dokleja czytelną etykietę oszczędności tylko gdy znana kwota', () => {
  const out = uporzadkujRuchy(RUCHY);
  const gwar = out.find((r) => r.typ === 'zabezpieczenie_gwarancja');
  const fakt = out.find((r) => r.typ === 'faktoring');
  assert.equal(gwar.oszczednoscLabel, '200 000 zł');
  assert.equal(fakt.oszczednoscLabel, null);
});

test('uporzadkujRuchy: nie mutuje wejścia i zwraca zamrożoną listę', () => {
  const kopia = JSON.parse(JSON.stringify(RUCHY));
  const out = uporzadkujRuchy(RUCHY);
  assert.deepEqual(RUCHY, kopia, 'wejście bez zmian');
  assert.ok(Object.isFrozen(out));
  assert.ok(out.every((r) => Object.isFrozen(r)));
});

test('uporzadkujRuchy: puste/niepoprawne wejście → pusta zamrożona lista', () => {
  assert.deepEqual(uporzadkujRuchy([]), []);
  assert.deepEqual(uporzadkujRuchy(null), []);
  assert.deepEqual(uporzadkujRuchy(undefined), []);
  assert.ok(Object.isFrozen(uporzadkujRuchy(null)));
});

// ---------------- podsumowanieRekomendacji: agregat dla ekranu ----------------

// Migawka odpowiedzi backendu rekomendujFinansowanie (kształt z services/rekomendacjePlynnosci.js).
const REKO_NAPIETE = Object.freeze({
  status: 'napiete',
  lukaFinansowania: 180000,
  miesiecyPomostowych: 4,
  poduszkaGotowki: 120000,
  brakujeKwota: 60000,
  pokrycieProcent: 67,
  ruchy: RUCHY,
  komunikat:
    'Ten kontrakt wymaga ok. 180 000 zł finansowania pomostowego przez 4 mies.; twoja poduszka to 120 000 zł.',
});

test('podsumowanieRekomendacji: formatuje wszystkie liczby i mapuje status na ton', () => {
  const w = podsumowanieRekomendacji(REKO_NAPIETE);
  assert.equal(w.status, 'napiete');
  assert.equal(w.ton, 'ostrzezenie');
  assert.equal(w.etykietaStatusu, opisStatusu('napiete').etykieta);
  assert.equal(w.lukaLabel, '180 000 zł');
  assert.equal(w.poduszkaLabel, '120 000 zł');
  assert.equal(w.brakujeLabel, '60 000 zł');
  assert.equal(w.pokrycieLabel, '67%');
  assert.equal(w.miesiaceLabel, '4 miesiące');
  assert.equal(w.wymagaFinansowania, true);
  assert.equal(w.komunikat, REKO_NAPIETE.komunikat);
});

test('podsumowanieRekomendacji: ruchy są uporządkowane (gwarancja przed faktoringiem)', () => {
  const w = podsumowanieRekomendacji(REKO_NAPIETE);
  assert.equal(w.ruchy[0].typ, 'zabezpieczenie_gwarancja');
  assert.equal(w.ruchy[w.ruchy.length - 1].typ, 'faktoring');
});

test('podsumowanieRekomendacji: brak luki → wymagaFinansowania=false, brak ruchów', () => {
  const w = podsumowanieRekomendacji({
    status: 'udzwigniesz',
    lukaFinansowania: 0,
    miesiecyPomostowych: 0,
    poduszkaGotowki: 50000,
    brakujeKwota: 0,
    pokrycieProcent: 100,
    ruchy: [],
    komunikat: 'Ten kontrakt nie wymaga finansowania pomostowego; twoja poduszka to 50 000 zł.',
  });
  assert.equal(w.status, 'udzwigniesz');
  assert.equal(w.ton, 'sukces');
  assert.equal(w.wymagaFinansowania, false);
  assert.equal(w.lukaLabel, '0 zł');
  assert.equal(w.miesiaceLabel, '0 miesięcy');
  assert.deepEqual(w.ruchy, []);
});

test('podsumowanieRekomendacji: puste/niepoprawne wejście nie wywraca ekranu', () => {
  const w = podsumowanieRekomendacji(undefined);
  assert.equal(w.ton, 'neutral');
  assert.equal(w.lukaLabel, '0 zł');
  assert.equal(w.miesiaceLabel, '0 miesięcy');
  assert.deepEqual(w.ruchy, []);
  assert.ok(Object.isFrozen(w));
});
