import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rekomendujFinansowanie,
  PROG_UDZWIGNIESZ,
  PROG_NAPIETE,
} from '../src/services/rekomendacjePlynnosci.js';

/*
 * Rekomendacje domknięcia luki + wsad do decyzji „startować czy nie" (ulepszenie
 * „Symulator płynności: czy udźwigniesz ten kontrakt", podzadanie 3/6). Czysta,
 * deterministyczna funkcja: bierze wynik symulacji (krok 2/6 — luka finansowania,
 * miesiące pomostowe) + poduszkę gotówki firmy + model finansowy (krok 1/6) i zwraca:
 *  • status decyzji: 'udzwigniesz' / 'napiete' / 'luka_krytyczna' wg relacji luka↔poduszka,
 *  • listę KONKRETNYCH ruchów zależnych od danych (gwarancja zamiast gotówki, wniosek
 *    o zaliczkę, faktoring wierzytelności publicznej, pytanie o płatności częściowe),
 *  • jednozdaniowy komunikat „ten kontrakt wymaga ok. X zł finansowania pomostowego
 *    przez Y mies.; twoja poduszka to Z zł".
 * ZERO I/O, bez Date.now, bez płatnego AI.
 */

/** Model finansowy jak z `parametryFinansowe.js` — bazowo neutralny dla ruchów. */
const P = (o = {}) => ({
  harmonogramPlatnosci: 'czesciowe',
  terminZaplatyDni: 30,
  zabezpieczenieProcent: 0,
  zabezpieczenieForma: 'dowolna',
  zaliczkaProcent: 0,
  wadiumKwota: null,
  cenaBrutto: 200000,
  ...o,
});

/** Skrót: znajdź ruch danego typu na liście (albo undefined). */
const ruch = (wynik, typ) => wynik.ruchy.find((r) => r.typ === typ);

// ─────────────────────────── progi statusu: luka ↔ poduszka ──────────────────

test('poduszka pokrywa całą lukę → status „udzwigniesz"', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 120000,
    parametry: P(),
  });
  assert.equal(w.status, 'udzwigniesz');
  assert.equal(w.brakujeKwota, 0); // poduszka > luka → nic nie brakuje
});

test('poduszka pokrywa część luki (≥ połowy) → status „napiete"', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 60000,
    parametry: P(),
  });
  assert.equal(w.status, 'napiete');
  assert.equal(w.brakujeKwota, 40000);
});

test('poduszka pokrywa mniej niż połowę luki → status „luka_krytyczna"', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 20000,
    parametry: P(),
  });
  assert.equal(w.status, 'luka_krytyczna');
  assert.equal(w.brakujeKwota, 80000);
});

test('progi są domknięte od dołu — poduszka = luka → udzwigniesz; poduszka = połowa → napiete', () => {
  const naProgu = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 3,
    poduszkaGotowki: 100000,
    parametry: P(),
  });
  assert.equal(naProgu.status, 'udzwigniesz'); // pokrycie dokładnie PROG_UDZWIGNIESZ

  const polowa = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 3,
    poduszkaGotowki: 50000,
    parametry: P(),
  });
  assert.equal(polowa.status, 'napiete'); // pokrycie dokładnie PROG_NAPIETE

  assert.ok(PROG_UDZWIGNIESZ > PROG_NAPIETE, 'próg „udźwigniesz" powyżej progu „napięte"');
});

test('brak luki (0) → udzwigniesz niezależnie od poduszki, bez ruchów, komunikat „nie wymaga"', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 0,
    miesiecyPomostowych: 0,
    poduszkaGotowki: 0,
    parametry: P({ harmonogramPlatnosci: 'jedna_faktura', zabezpieczenieForma: 'pieniadz', zabezpieczenieProcent: 5 }),
  });
  assert.equal(w.status, 'udzwigniesz');
  assert.deepEqual(w.ruchy, []); // nie ma czego domykać
  assert.match(w.komunikat, /nie wymaga finansowania pomostowego/);
});

test('brak poduszki (null) traktowany pesymistycznie jak 0 → przy luce status krytyczny', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 90000,
    miesiecyPomostowych: 3,
    poduszkaGotowki: null,
    parametry: P(),
  });
  assert.equal(w.poduszkaGotowki, 0);
  assert.equal(w.status, 'luka_krytyczna');
  assert.equal(w.brakujeKwota, 90000);
});

// ─────────────────────────── dobór ruchów wg parametrów ──────────────────────

test('zabezpieczenie w gotówce → ruch „gwarancja zamiast gotówki" z kwotą uwolnionych środków', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ zabezpieczenieForma: 'pieniadz', zabezpieczenieProcent: 5, cenaBrutto: 200000 }),
  });
  const r = ruch(w, 'zabezpieczenie_gwarancja');
  assert.ok(r, 'jest ruch zabezpieczenia gwarancją');
  assert.equal(r.oszczednoscKwota, 10000); // 5% z 200000 uwolnione z gotówki
});

test('zabezpieczenie już dopuszczone jako gwarancja (dowolna) → BRAK ruchu o gwarancję', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ zabezpieczenieForma: 'dowolna', zabezpieczenieProcent: 5 }),
  });
  assert.equal(ruch(w, 'zabezpieczenie_gwarancja'), undefined);
});

test('umowa przewiduje zaliczkę → ruch „wniosek o zaliczkę" z kwotą zaliczki', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ zaliczkaProcent: 20, cenaBrutto: 200000 }),
  });
  const r = ruch(w, 'wniosek_zaliczka');
  assert.ok(r, 'jest ruch wniosku o zaliczkę');
  assert.equal(r.oszczednoscKwota, 40000); // 20% z 200000

  const bez = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ zaliczkaProcent: 0 }),
  });
  assert.equal(ruch(bez, 'wniosek_zaliczka'), undefined);
});

test('jedna faktura końcowa → ruch „pytanie o płatności częściowe"; przy częściowych już go nie ma', () => {
  const jedna = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ harmonogramPlatnosci: 'jedna_faktura' }),
  });
  assert.ok(ruch(jedna, 'platnosci_czesciowe'), 'jedna faktura → proponuj pytanie o częściowe');

  const czesciowe = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ harmonogramPlatnosci: 'czesciowe' }),
  });
  assert.equal(ruch(czesciowe, 'platnosci_czesciowe'), undefined);
});

test('gdy jest luka i znana cena → zawsze ruch „faktoring wierzytelności publicznej"', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 30000,
    parametry: P({ cenaBrutto: 200000 }),
  });
  assert.ok(ruch(w, 'faktoring'), 'faktoring dostępny przy realnej wierzytelności');
});

test('komplet parametrów krytycznych → wszystkie cztery ruchy, najskuteczniejsze najpierw', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 180000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 20000,
    parametry: P({
      harmonogramPlatnosci: 'jedna_faktura',
      zabezpieczenieForma: 'pieniadz',
      zabezpieczenieProcent: 10,
      zaliczkaProcent: 10,
      cenaBrutto: 300000,
    }),
  });
  const typy = w.ruchy.map((r) => r.typ);
  assert.deepEqual(typy, ['zabezpieczenie_gwarancja', 'wniosek_zaliczka', 'platnosci_czesciowe', 'faktoring']);
});

// ─────────────────────────── komunikat wsadowy do decyzji ────────────────────

test('komunikat = jedno zdanie z kwotą luki, liczbą miesięcy pomostu i poduszką', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 180000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 50000,
    parametry: P(),
  });
  assert.match(w.komunikat, /ok\. 180 000 zł/);
  assert.match(w.komunikat, /przez 4 mies\./);
  assert.match(w.komunikat, /poduszka to 50 000 zł/);
});

// ─────────────────────────── metryki pokrycia i determinizm ──────────────────

test('pokrycieProcent to udział poduszki w luce (zaokrąglony)', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 200000,
    miesiecyPomostowych: 4,
    poduszkaGotowki: 50000,
    parametry: P(),
  });
  assert.equal(w.pokrycieProcent, 25); // 50000 / 200000
});

test('determinizm — ten sam wynik dla tego samego wejścia', () => {
  const wej = {
    lukaFinansowania: 123456,
    miesiecyPomostowych: 3,
    poduszkaGotowki: 40000,
    parametry: P({ zabezpieczenieForma: 'pieniadz', zabezpieczenieProcent: 4, zaliczkaProcent: 15 }),
  };
  assert.deepEqual(rekomendujFinansowanie(wej), rekomendujFinansowanie(wej));
});

test('wynik i lista ruchów są zamrożone (migawka rekomendacji)', () => {
  const w = rekomendujFinansowanie({
    lukaFinansowania: 100000,
    miesiecyPomostowych: 3,
    poduszkaGotowki: 10000,
    parametry: P({ zabezpieczenieForma: 'pieniadz', zabezpieczenieProcent: 5 }),
  });
  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.ruchy));
  assert.ok(Object.isFrozen(w.ruchy[0]));
});
