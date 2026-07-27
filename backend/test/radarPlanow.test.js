import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dopasujPozycjePlanu,
  WAGA_CPV,
  PUNKT_ZA_SLOWO,
  WAGA_REGION,
  PROG_MOCNE,
  PROG_SLABE,
} from '../src/services/radarPlanow.js';

/*
 * RADAR PLANÓW POSTĘPOWAŃ (ulepszenie „wiedz o przetargu miesiące przed ogłoszeniem",
 * podzadanie 1/6). Czysta, deterministyczna funkcja: pozycje rocznego planu postępowań
 * (art. 23 Pzp) × profil firmy (CPV, słowa kluczowe, region) → posortowana wg
 * przewidywanego terminu wszczęcia lista trafień z wynikiem, poziomem (MOCNE/SLABE)
 * i uzasadnieniem. Odcięcie pozycji poniżej progu. ZERO I/O, bez Date.now — `dzisiaj`
 * wstrzykiwane parametrem. Dopasowanie CPV reużywa `lib/cpv.js`, słowa `lib/textNorm.js`.
 */

const PROFIL = {
  cpv: ['45233000'], // roboty drogowe → prefiks „45233"
  slowaKluczowe: ['droga', 'chodnik'],
  region: 'mazowieckie',
  dzisiaj: '2026-07-27',
};

/** Skrót: pojedyncza pozycja przez radar z domyślnym profilem (chyba że nadpisany). */
function radar(pozycje, profil = PROFIL) {
  return dopasujPozycjePlanu({ pozycjePlanow: pozycje, profil });
}

// ─────────────────────────── stałe modelu ──────────────────────────────────

test('stałe wag i progów mają udokumentowane wartości', () => {
  assert.equal(WAGA_CPV, 60);
  assert.equal(PUNKT_ZA_SLOWO, 12);
  assert.equal(WAGA_REGION, 12);
  assert.equal(PROG_MOCNE, 48);
  assert.equal(PROG_SLABE, 20);
});

// ─────────────────────────── punktacja CPV ─────────────────────────────────

test('CPV dokładny (identyczny kod) — sam daje MOCNE i typ „dokladne"', () => {
  const [poz] = radar([{ id: 'a', przedmiot: 'roboty', cpv: '45233000-1' }]);
  assert.equal(poz.wynik, 60);
  assert.equal(poz.poziom, 'MOCNE');
  assert.equal(poz.uzasadnienie.trafienieCpv.typ, 'dokladne');
  assert.equal(poz.uzasadnienie.trafienieCpv.affinity, 1);
});

test('CPV prefiksowy 5+ cyfr — 0.8 → wynik 48 → MOCNE, typ „prefiks"', () => {
  const [poz] = radar([{ id: 'a', przedmiot: 'roboty', cpv: '45233120-6' }]);
  assert.equal(poz.wynik, 48);
  assert.equal(poz.poziom, 'MOCNE');
  assert.equal(poz.uzasadnienie.trafienieCpv.typ, 'prefiks');
});

test('CPV tylko na poziomie działu (0.35) — sam daje SLABE, typ „dzial"', () => {
  const profil = { ...PROFIL, cpv: ['45000000'] }; // „45" cała budowlanka
  const [poz] = radar([{ id: 'a', przedmiot: 'roboty', cpv: '45233120' }], profil);
  assert.equal(poz.wynik, 21); // round(0.35*60)
  assert.equal(poz.poziom, 'SLABE');
  assert.equal(poz.uzasadnienie.trafienieCpv.typ, 'dzial');
});

// ─────────────────────────── słowa kluczowe ────────────────────────────────

test('słowa kluczowe w przedmiocie — rdzeniowanie PL łapie odmiany', () => {
  const [poz] = radar([{
    id: 'a',
    przedmiot: 'Budowa drogi gminnej wraz z chodnikiem w miejscowości X',
  }]);
  assert.deepEqual(poz.uzasadnienie.trafioneSlowa, ['droga', 'chodnik']);
  assert.equal(poz.wynik, 24); // 2 × 12, bez CPV, bez regionu
  assert.equal(poz.poziom, 'SLABE');
});

test('jedno słowo kluczowe bez innych sygnałów — poniżej progu → odfiltrowane', () => {
  const wynik = radar([{ id: 'a', przedmiot: 'Budowa drogi gminnej' }]);
  assert.equal(wynik.length, 0);
});

// ─────────────────────────── region ────────────────────────────────────────

test('zgodność regionu rozpoznana mimo prefiksu „województwo"', () => {
  const [poz] = radar([{
    id: 'a',
    przedmiot: 'Budowa drogi',
    cpv: '45233000',
    region: 'województwo mazowieckie',
  }]);
  assert.equal(poz.uzasadnienie.zgodnoscRegionu, true);
});

test('sam region (bez CPV/słów) — poniżej progu → odfiltrowany', () => {
  const wynik = radar([{ id: 'a', przedmiot: 'Dostawa mebli', region: 'mazowieckie' }]);
  assert.equal(wynik.length, 0);
});

// ─────────────────────────── progi i kombinacje ────────────────────────────

test('pozycja bez żadnego sygnału jest odfiltrowana', () => {
  const wynik = radar([{ id: 'a', przedmiot: 'Dostawa artykułów biurowych', cpv: '30190000' }]);
  assert.equal(wynik.length, 0);
});

test('CPV dział (21) + region (12) = 33 → SLABE i pozycja jest zwracana', () => {
  const profil = { ...PROFIL, cpv: ['45000000'], slowaKluczowe: [] };
  const [poz] = radar([{
    id: 'a', przedmiot: 'roboty', cpv: '45233120', region: 'mazowieckie',
  }], profil);
  assert.equal(poz.wynik, 33);
  assert.equal(poz.poziom, 'SLABE');
  assert.equal(poz.uzasadnienie.zgodnoscRegionu, true);
});

test('maksymalny sygnał (CPV dokładny + 3 słowa + region) klamrowany do 100', () => {
  const profil = {
    ...PROFIL,
    cpv: ['45233000'],
    slowaKluczowe: ['droga', 'chodnik', 'kanalizacja'],
  };
  const [poz] = radar([{
    id: 'a',
    przedmiot: 'Budowa drogi z chodnikiem i kanalizacją deszczową',
    cpv: '45233000',
    region: 'mazowieckie',
  }], profil);
  assert.equal(poz.wynik, 100); // 60 + 36 + 12 = 108 → clamp 100
  assert.equal(poz.poziom, 'MOCNE');
});

// ─────────────────────────── ranking wg terminu wszczęcia ──────────────────

test('ranking — pozycje sortowane rosnąco wg terminu wszczęcia (ISO)', () => {
  const pozycje = [
    { id: 'listopad', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-11-01' },
    { id: 'marzec', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-03-15' },
    { id: 'lipiec', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-07-01' },
  ];
  assert.deepEqual(radar(pozycje).map((p) => p.pozycja.id), ['marzec', 'lipiec', 'listopad']);
});

test('ranking — kwartał („II kwartał 2026") sortuje się po dacie i przed IV kwartałem', () => {
  const pozycje = [
    { id: 'q4', przedmiot: 'droga', cpv: '45233000', terminWszczecia: 'IV kwartał 2026' },
    { id: 'styczen', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-01-10' },
    { id: 'q2', przedmiot: 'droga', cpv: '45233000', terminWszczecia: 'II kwartał 2026' },
  ];
  assert.deepEqual(radar(pozycje).map((p) => p.pozycja.id), ['styczen', 'q2', 'q4']);
});

test('ranking — pozycja z nieznanym terminem trafia na koniec listy', () => {
  const pozycje = [
    { id: 'brak', przedmiot: 'droga', cpv: '45233000', terminWszczecia: 'do ustalenia' },
    { id: 'znany', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-05-01' },
  ];
  assert.deepEqual(radar(pozycje).map((p) => p.pozycja.id), ['znany', 'brak']);
});

// ─────────────────────────── dzisiaj wstrzykiwane (bez Date.now) ────────────

test('miesiące do wszczęcia liczone względem wstrzykniętego „dzisiaj"', () => {
  const [poz] = radar([{
    id: 'a', przedmiot: 'droga', cpv: '45233000', terminWszczecia: '2026-09-01',
  }]);
  assert.equal(poz.miesiacyDoWszczecia, 2); // 2026-07 → 2026-09
});

test('miesiące do wszczęcia = null przy nieznanym terminie', () => {
  const [poz] = radar([{
    id: 'a', przedmiot: 'droga', cpv: '45233000', terminWszczecia: 'do ustalenia',
  }]);
  assert.equal(poz.miesiacyDoWszczecia, null);
});

// ─────────────────────────── kształt wyniku ────────────────────────────────

test('każdy zwrócony wpis jest zamrożony i zachowuje oryginalną pozycję', () => {
  const pozycja = { id: 'a', przedmiot: 'droga', cpv: '45233000' };
  const [poz] = radar([pozycja]);
  assert.ok(Object.isFrozen(poz));
  assert.ok(Object.isFrozen(poz.uzasadnienie));
  assert.equal(poz.pozycja, pozycja);
});

test('puste wejście / brak pozycji daje pustą listę', () => {
  assert.deepEqual(dopasujPozycjePlanu({ pozycjePlanow: [], profil: PROFIL }), []);
  assert.deepEqual(dopasujPozycjePlanu({ pozycjePlanow: null, profil: PROFIL }), []);
  assert.deepEqual(dopasujPozycjePlanu({ profil: PROFIL }), []);
});
