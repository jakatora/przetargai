import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore } from '../src/lib/scoring.js';

test('heuristicScore — trafienie wszystkich słów kluczowych daje wysoki wynik', () => {
  const company = { keywords: ['remont', 'budowa'], cpv_codes: [] };
  const tender = { title: 'Remont i budowa drogi gminnej', organization: 'Gmina X' };
  const result = heuristicScore(company, tender);
  assert.ok(result.score >= 60, `dwa trafienia muszą przekroczyć próg dopasowania, było ${result.score}`);
  assert.deepEqual(result.matchedKeywords.sort(), ['budowa', 'remont']);
});

test('heuristicScore — brak trafień daje 0', () => {
  const company = { keywords: ['catering', 'gastronomia'], cpv_codes: [] };
  const tender = { title: 'Budowa mostu', organization: 'GDDKiA' };
  assert.equal(heuristicScore(company, tender).score, 0);
});

test('heuristicScore — premia za zgodny kod CPV', () => {
  const company = { keywords: ['xyz'], cpv_codes: ['45000000'] };
  const tender = { title: 'Inny przedmiot', organization: '', cpv_main: '45233140-2' };
  const result = heuristicScore(company, tender);
  assert.equal(result.cpvMatched, true);
  // '45000000' to cały dział „roboty budowlane" — przesłanka słaba, ale musi
  // wystarczyć, by kandydat trafił do oceny AI (AI_PREFILTER_MIN = 15).
  assert.ok(result.score >= 15, `luźna zgodność CPV powinna wpuścić do AI, było ${result.score}`);
});

// ============ AUDYT 2026-07-09: normalizacja przez liczbę słów profilu ============

test('AUDYT: dopisanie słowa kluczowego NIE obniża wyniku trafionego przetargu', () => {
  // Było: score = trafione / WSZYSTKIE słowa profilu × 100. Użytkownik, który
  // dokładniej opisał, czym się zajmuje, dostawał NIŻSZE wyniki dla tych samych
  // ogłoszeń: 1 słowo → 100, 5 słów → 20. Przy 8 słowach (100/8 = 12) kandydat
  // nie przechodził nawet progu pre-filtra AI (15) — im lepszy profil, tym pustszy feed.
  const tender = { title: 'Przebudowa drogi wojewódzkiej nr 286', organization: '' };

  const waski = heuristicScore({ keywords: ['droga'], cpv_codes: [] }, tender);
  const szeroki = heuristicScore(
    { keywords: ['droga', 'asfalt', 'chodnik', 'most', 'kostka brukowa'], cpv_codes: [] },
    tender,
  );

  assert.deepEqual(szeroki.matchedKeywords, ['droga']);
  assert.equal(szeroki.score, waski.score, 'nietrafione słowa profilu nie mogą karać wyniku');
  assert.ok(szeroki.score >= 15, 'pojedyncze trafienie musi trafić choćby do oceny AI');
});

test('AUDYT: więcej trafień = wyższy wynik (monotonicznie)', () => {
  const company = (kw) => ({ keywords: kw, cpv_codes: [] });
  const tender = { title: 'Remont drogi asfaltowej z chodnikiem', organization: '' };

  const jedno = heuristicScore(company(['droga']), tender).score;
  const dwa = heuristicScore(company(['droga', 'asfalt']), tender).score;
  const trzy = heuristicScore(company(['droga', 'asfalt', 'chodnik']), tender).score;

  assert.ok(jedno < dwa && dwa < trzy, `wyniki muszą rosnąć: ${jedno} < ${dwa} < ${trzy}`);
  assert.ok(trzy <= 100);
});

test('AUDYT: profil oparty WYŁĄCZNIE na kodach CPV przekracza próg dopasowania', () => {
  // Było: keywords puste → score 0, premia CPV +30 → 30, a próg to 60. Taki
  // użytkownik nie dostawał żadnego dopasowania heurystycznie — przy awarii AI
  // albo wyczerpanym budżecie jego feed był pusty na zawsze.
  const company = { keywords: [], cpv_codes: ['45233000'] };
  const tender = { title: 'Roboty w zakresie nawierzchni', cpv_main: '45233000-9' };
  const result = heuristicScore(company, tender);

  assert.equal(result.cpvMatched, true);
  assert.ok(result.score >= 60, `dokładny kod CPV to mocny sygnał, było ${result.score}`);
});

test('AUDYT: dokładny kod CPV waży więcej niż luźna zgodność działu', () => {
  const tender = { title: 'Nieistotny tytuł', cpv_main: '45233000-9' };
  const dokladny = heuristicScore({ keywords: [], cpv_codes: ['45233000'] }, tender).score;
  const dzial = heuristicScore({ keywords: [], cpv_codes: ['45000000'] }, tender).score;
  assert.ok(dokladny > dzial, `dokładny (${dokladny}) musi bić dział (${dzial})`);
});

test('heuristicScore — niezgodny kod CPV nie daje premii', () => {
  const company = { keywords: ['xyz'], cpv_codes: ['45300000'] };
  const tender = { title: 'Inny', organization: '', cpv_main: '45233140-2' };
  assert.equal(heuristicScore(company, tender).cpvMatched, false);
});

test('heuristicScore — pusty profil daje 0', () => {
  assert.equal(heuristicScore({ keywords: [], cpv_codes: [] }, { title: 'cokolwiek' }).score, 0);
});

// ==================== regresje z audytu produkcyjnego ====================

test('REGRESJA P-1: kod CPV na dalszej pozycji sklejonego łańcucha jest widziany', () => {
  // Realne ogłoszenie z BZP. Kod chodnikowy stoi na trzeciej pozycji —
  // stary scoring sklejał wszystko w jeden ciąg cyfr i widział tylko 45000000.
  const company = { keywords: [], cpv_codes: ['45233000'] };
  const tender = {
    title: 'Remont i budowa chodników w Szczecinie',
    organization: 'Zarząd Budynków i Lokali Komunalnych',
    cpv_main: '45000000-7 (Roboty budowlane),45233200-1 (Roboty w zakresie różnych nawierzchni),45233222-1 (Roboty w zakresie układania chodników i asfaltowania)',
  };
  const result = heuristicScore(company, tender);
  assert.equal(result.cpvMatched, true);
  assert.equal(result.cpvAffinity, 0.8);
});

test('REGRESJA P-2: słowo kluczowe trafia w odmienioną formę w tytule', () => {
  // "droga" ≠ podciąg "drogi". Stary scoring pomijał 91% przetargów drogowych.
  const company = { keywords: ['droga'], cpv_codes: [] };
  const tender = { title: 'Przebudowa drogi gminnej w Lubiatowie', organization: 'Gmina Dąbie' };
  const result = heuristicScore(company, tender);
  assert.deepEqual(result.matchedKeywords, ['droga'], 'sedno regresji: odmiana ma zostać rozpoznana');
  // Dawniej asercja brzmiała `score === 100` — to był artefakt normalizacji
  // „trafione / wszystkie słowa" (P-5), nie wymaganie. Jedno trafienie to
  // mocna poszlaka, nie pewność; ma wystarczyć na ocenę AI.
  assert.ok(result.score >= 15, `trafienie musi coś znaczyć, było ${result.score}`);
});

test('REGRESJA U-4: "budowa" nie trafia w "Przebudowa gabinetów lekarskich"', () => {
  // Brukarz dostawał remont gabinetów lekarskich z wynikiem 80%,
  // bo "budowa" jest podciągiem "Przebudowa".
  const company = { keywords: ['budowa', 'chodnik'], cpv_codes: [] };
  const tender = {
    title: 'Przebudowa gabinetów lekarskich, łazienek, pomieszczenia matki z dzieckiem',
    organization: 'Gminne Centrum Usług Medycznych',
  };
  const result = heuristicScore(company, tender);
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedKeywords, []);
});

test('REGRESJA precyzji: słowo kluczowe nie trafia przez nazwę zamawiającego', () => {
  // Zmierzone na 500 ogłoszeniach: 15 przetargów trafiało WYŁĄCZNIE przez nazwę
  // urzędu — brukarz dostawał „Zakup pługa odśnieżnego” od Zarządu Dróg Powiatowych
  // i „Rozbudowę o szyb dźwigu” od Zarządu Dróg Wojewódzkich.
  // Słowa kluczowe opisują PRZEDMIOT zamówienia, nie tożsamość zamawiającego.
  const company = { keywords: ['droga'], cpv_codes: [] };
  const tender = {
    title: 'Zakup pługa odśnieżnego o zmiennej geometrii',
    organization: 'Zarząd Dróg Powiatowych w Lublinie',
  };
  const result = heuristicScore(company, tender);
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedKeywords, []);
});

test('heuristicScore — zwraca stopień zgodności CPV, nie tylko flagę', () => {
  // Przygotowanie pod ważony scoring (E5): flaga to za mało.
  const szeroki = heuristicScore({ keywords: [], cpv_codes: ['45000000'] }, { cpv_main: '45233120-6', title: '' });
  const waski = heuristicScore({ keywords: [], cpv_codes: ['45233120'] }, { cpv_main: '45233120-6', title: '' });
  assert.equal(szeroki.cpvAffinity, 0.35);
  assert.equal(waski.cpvAffinity, 1);
});
