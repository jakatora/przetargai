import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symulujPlynnosc } from '../src/services/symulacjaPlynnosci.js';

/*
 * Miesięczna symulacja przepływów i luka finansowania (ulepszenie „Symulator płynności:
 * czy udźwigniesz ten kontrakt", podzadanie 2/6). Czysta, deterministyczna funkcja
 * model finansowy (z kroku 1/6) + koszty/czas → tablica miesięcy {wydatki, wplywy,
 * saldoNarastajaco} oraz luka finansowania (szczyt ujemnego salda), miesiące pomostowe
 * i miesiąc pierwszej wpłaty od zamawiającego. ZERO I/O, bez Date.now, bez płatnego AI.
 *
 * Model przyjęty w symulacji (spójnie z pesymizmem kroku 1/6 — nie zaniżać luki):
 *  • koszty (ludzie+materiały) ponoszone co miesiąc przez czas trwania kontraktu,
 *  • kwoty BLOKOWANE (wadium + zabezpieczenie w GOTÓWCE) wykładane na starcie (mies. 1)
 *    i zwracane na końcu horyzontu (zabezpieczenie po realizacji, wadium po udzieleniu),
 *  • zabezpieczenie w formie „dowolna" (dopuszczona gwarancja) NIE blokuje gotówki,
 *  • wpływy od zamawiającego wg harmonogramu: jedna faktura końcowa vs częściowe,
 *    z opóźnieniem = termin zapłaty przeliczony na miesiące (ceil(dni/30)),
 *  • zaliczka wpływa w miesiącu 1 i pomniejsza kwotę pozostałą do fakturowania.
 */

/** Model finansowy jak z `parametryFinansowe.js` — bazowo neutralny dla płynności. */
const P = (o = {}) => ({
  harmonogramPlatnosci: 'jedna_faktura',
  terminZaplatyDni: 30,
  zabezpieczenieProcent: 0,
  zabezpieczenieForma: 'dowolna',
  zaliczkaProcent: 0,
  wadiumKwota: null,
  cenaBrutto: 200000,
  ...o,
});

// ───────────────── jedna faktura: pełna luka = suma wyłożonego kapitału ──────

test('jedna faktura na końcu — luka = suma wyłożonego kapitału (koszty × miesiące)', () => {
  const w = symulujPlynnosc(P({ harmonogramPlatnosci: 'jedna_faktura', cenaBrutto: 200000 }), {
    kosztyMiesieczne: 45000,
    czasTrwaniaMies: 4,
  });

  // 4 miesiące pracy + 1 miesiąc oczekiwania na przelew (termin 30 dni → +1 mies.)
  assert.equal(w.miesiace.length, 5);
  assert.equal(w.lukaFinansowania, 180000); // = 45000 × 4, cały wyłożony kapitał
  assert.equal(w.miesiecyPomostowych, 4);
  assert.equal(w.pierwszaWplataMiesiac, 5);

  // szczyt ujemnego salda w miesiącu 4 (tuż przed pierwszym przelewem)
  assert.equal(w.miesiace[3].saldoNarastajaco, -180000);
  // przelew końcowy w miesiącu 5 wychodzi na plus (marża na kontrakcie)
  assert.equal(w.miesiace[4].wplywy, 200000);
  assert.equal(w.miesiace[4].saldoNarastajaco, 20000);
});

// ───────────────── płatności częściowe: mniejsza luka, krótszy pomost ────────

test('płatności częściowe redukują lukę i skracają miesiące pomostowe', () => {
  const opcje = { kosztyMiesieczne: 45000, czasTrwaniaMies: 4 };
  const jedna = symulujPlynnosc(P({ harmonogramPlatnosci: 'jedna_faktura', cenaBrutto: 260000 }), opcje);
  const czesciowe = symulujPlynnosc(P({ harmonogramPlatnosci: 'czesciowe', cenaBrutto: 260000 }), opcje);

  assert.equal(jedna.lukaFinansowania, 180000);
  assert.equal(jedna.miesiecyPomostowych, 4);

  // częściowe: 65000/mies. wpływu vs 45000/mies. kosztu → szybki powrót nad kreskę
  assert.equal(czesciowe.lukaFinansowania, 45000);
  assert.equal(czesciowe.miesiecyPomostowych, 3);
  assert.equal(czesciowe.pierwszaWplataMiesiac, 2); // pierwsza rata po terminie zapłaty

  assert.ok(czesciowe.lukaFinansowania < jedna.lukaFinansowania, 'częściowe: mniejsza luka');
  assert.ok(czesciowe.miesiecyPomostowych < jedna.miesiecyPomostowych, 'częściowe: krótszy pomost');
});

// ───────────────── zaliczka obniża szczyt zapotrzebowania na kapitał ─────────

test('zaliczka obniża szczyt (lukę) o kwotę wpłaconej zaliczki', () => {
  const opcje = { kosztyMiesieczne: 45000, czasTrwaniaMies: 4 };
  const bez = symulujPlynnosc(P({ cenaBrutto: 200000, zaliczkaProcent: 0 }), opcje);
  const zZaliczka = symulujPlynnosc(P({ cenaBrutto: 200000, zaliczkaProcent: 20 }), opcje);

  assert.equal(bez.lukaFinansowania, 180000);
  assert.equal(zZaliczka.lukaFinansowania, 140000); // 180000 − 40000 (zaliczka 20% z 200000)
  assert.equal(zZaliczka.pierwszaWplataMiesiac, 1); // zaliczka wpływa od razu
  assert.ok(zZaliczka.lukaFinansowania < bez.lukaFinansowania, 'zaliczka obniża szczyt');
});

// ───────────────── kwoty blokowane: wadium + zabezpieczenie w gotówce ────────

test('wadium i zabezpieczenie w GOTÓWCE powiększają lukę; gwarancja (dowolna) nie blokuje gotówki', () => {
  const opcje = { kosztyMiesieczne: 45000, czasTrwaniaMies: 4 };
  const gotowka = symulujPlynnosc(
    P({ cenaBrutto: 200000, zabezpieczenieProcent: 5, zabezpieczenieForma: 'pieniadz', wadiumKwota: 10000 }),
    opcje,
  );
  const gwarancja = symulujPlynnosc(
    P({ cenaBrutto: 200000, zabezpieczenieProcent: 5, zabezpieczenieForma: 'dowolna', wadiumKwota: 10000 }),
    opcje,
  );

  // gotówka: wadium 10000 + zabezpieczenie 5% z 200000 = 10000 → blokada 20000
  assert.equal(gotowka.lukaFinansowania, 200000); // 180000 kosztów + 20000 blokady
  // gwarancja zamiast gotówki na zabezpieczenie → blokada tylko wadium 10000
  assert.equal(gwarancja.lukaFinansowania, 190000);
  assert.ok(gotowka.lukaFinansowania > gwarancja.lukaFinansowania, 'gwarancja uwalnia gotówkę zabezpieczenia');

  // blokada wraca na końcu horyzontu → saldo końcowe jak bez blokad (marża)
  assert.equal(gotowka.miesiace.at(-1).saldoNarastajaco, 20000);
  assert.equal(gotowka.miesiace.at(-1).wplywy, 220000); // przelew 200000 + zwrot blokady 20000
});

// ───────────────── opóźnienie wpływu wg terminu zapłaty ──────────────────────

test('dłuższy termin zapłaty odsuwa pierwszą wpłatę i wydłuża horyzont', () => {
  const opcje = { kosztyMiesieczne: 45000, czasTrwaniaMies: 4 };
  const dni60 = symulujPlynnosc(P({ terminZaplatyDni: 60, cenaBrutto: 200000 }), opcje);
  // termin 60 dni → +2 miesiące po zakończeniu pracy
  assert.equal(dni60.miesiace.length, 6);
  assert.equal(dni60.pierwszaWplataMiesiac, 6);
  assert.equal(dni60.miesiecyPomostowych, 5); // dłuższy pomost niż przy 30 dniach
});

// ───────────────── cena nieznana: brak wpływów, luka = cały wyłożony kapitał ─

test('nieznana cena brutto (null) — brak wpływów od zamawiającego, pierwszaWplataMiesiac = null', () => {
  const w = symulujPlynnosc(P({ cenaBrutto: null }), { kosztyMiesieczne: 45000, czasTrwaniaMies: 3 });
  assert.equal(w.miesiace.length, 3);
  assert.equal(w.lukaFinansowania, 135000); // 45000 × 3, nic nie wpływa
  assert.equal(w.miesiecyPomostowych, 3);
  assert.equal(w.pierwszaWplataMiesiac, null);
});

// ───────────────── determinizm i spójność narastającego salda ────────────────

test('determinizm — ten sam wynik dla tego samego wejścia', () => {
  const args = [P({ harmonogramPlatnosci: 'czesciowe', cenaBrutto: 260000, wadiumKwota: 5000 }),
    { kosztyMiesieczne: 45000, czasTrwaniaMies: 4 }];
  assert.deepEqual(symulujPlynnosc(...args), symulujPlynnosc(...args));
});

test('niezmiennik — saldoNarastajaco to skumulowana suma (wplywy − wydatki)', () => {
  const w = symulujPlynnosc(P({ harmonogramPlatnosci: 'czesciowe', cenaBrutto: 260000, wadiumKwota: 5000 }), {
    kosztyMiesieczne: 45000,
    czasTrwaniaMies: 4,
  });
  let narast = 0;
  for (const m of w.miesiace) {
    narast += m.wplywy - m.wydatki;
    assert.equal(m.saldoNarastajaco, narast);
  }
  // luka to wartość bezwzględna najgłębszego ujemnego salda
  const najglebsze = Math.min(0, ...w.miesiace.map((m) => m.saldoNarastajaco));
  assert.equal(w.lukaFinansowania, -najglebsze);
});

test('wynik jest zamrożony (migawka symulacji)', () => {
  const w = symulujPlynnosc(P(), { kosztyMiesieczne: 1000, czasTrwaniaMies: 2 });
  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.miesiace));
  assert.ok(Object.isFrozen(w.miesiace[0]));
});
