import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stem, matchKeywords } from '../src/lib/textNorm.js';

/*
 * Stary scoring robił `haystack.includes(keyword)` — zwykły podciąg.
 * To gubiło 91% przetargów drogowych ("droga" nie jest podciągiem "drogi")
 * i jednocześnie wpuszczało fałszywe trafienia ("budowa" JEST podciągiem
 * "Przebudowa"). Jedna poprawka leczy oba objawy.
 */

// ---------------------------- normalize ----------------------------

test('normalize — sprowadza do małych liter', () => {
  assert.equal(normalize('Przebudowa DROGI'), 'przebudowa drogi');
});

test('normalize — usuwa polskie znaki diakrytyczne', () => {
  assert.equal(normalize('dróg ścieżka łąka żółć'), 'drog sciezka laka zolc');
});

test('normalize — skleja nadmiarowe białe znaki', () => {
  assert.equal(normalize('  budowa   drogi \n gminnej '), 'budowa drogi gminnej');
});

test('normalize — puste wejście daje pusty łańcuch', () => {
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

// ---------------------------- stem ----------------------------

test('stem — sprowadza odmiany słowa "droga" do wspólnego rdzenia', () => {
  assert.equal(stem('droga'), 'drog');
  assert.equal(stem('drogi'), 'drog');
  assert.equal(stem('droge'), 'drog');   // "drogę" po normalizacji
  assert.equal(stem('drog'), 'drog');    // "dróg" po normalizacji
});

test('stem — obcina końcówki przymiotnikowe', () => {
  assert.equal(stem('drogowej'), 'drogow');
  assert.equal(stem('drogowych'), 'drogow');
  assert.equal(stem('gminnej'), 'gminn');
});

test('stem — "chodników" i "chodnika" mają wspólny rdzeń', () => {
  assert.equal(stem('chodnikow'), 'chodnik');
  assert.equal(stem('chodnika'), 'chodnik');
});

test('stem — nie skraca rdzenia poniżej trzech znaków', () => {
  assert.equal(stem('gaz'), 'gaz');
  assert.equal(stem('bud'), 'bud');
});

test('stem — krótkie słowo też traci końcówkę, gdy rdzeń przetrwa', () => {
  // Próg 4 znaków blokowałby "gazu" → "gaz" i krótkie słowa kluczowe nie działałyby.
  assert.equal(stem('gazu'), 'gaz');
  assert.equal(stem('wody'), 'wod');
});

test('stem — słowo bez rozpoznanej końcówki zostaje bez zmian', () => {
  assert.equal(stem('remont'), 'remont');
  assert.equal(stem('asfalt'), 'asfalt');
});

test('stem — "budowa" i "przebudowa" mają RÓŻNE rdzenie', () => {
  // Fundament naprawy U-4: to są dwa różne słowa, nie jedno w drugim.
  assert.equal(stem('budowa'), 'budow');
  assert.equal(stem('przebudowa'), 'przebudow');
  assert.notEqual(stem('przebudowa'), stem('budowa'));
});

// ---------------------------- matchKeywords ----------------------------

test('REGRESJA P-2: "droga" trafia w odmienione "drogi"', () => {
  assert.deepEqual(
    matchKeywords(['droga'], 'Przebudowa drogi gminnej w Lubiatowie'),
    ['droga'],
  );
});

test('REGRESJA P-2: "droga" trafia w "dróg" i w "drogowej"', () => {
  // Te dwie formy pokrywają 78 z 79 wystąpień rdzenia "drog" w 500 realnych tytułach BZP.
  assert.deepEqual(matchKeywords(['droga'], 'Remont dróg powiatowych'), ['droga']);
  assert.deepEqual(matchKeywords(['droga'], 'Budowa chodnika w ciągu drogi powiatowej'), ['droga']);
  assert.deepEqual(matchKeywords(['droga'], 'Przebudowa nawierzchni drogowej'), ['droga']);
});

test('ZNANE OGRANICZENIE: oboczność g→dz nie jest obsługiwana', () => {
  // "drodze" to 1 tytuł na 500. Reguły alternacji kosztowałyby więcej, niż dają.
  // Test dokumentuje granicę świadomie, zamiast udawać, że jej nie ma.
  assert.deepEqual(matchKeywords(['droga'], 'Budowa chodnika przy drodze powiatowej'), []);
});

test('REGRESJA U-4: "budowa" NIE trafia w "Przebudowa gabinetów lekarskich"', () => {
  // Realny fałszywy alarm z produkcji: brukarz dostawał remont gabinetów z wynikiem 80%.
  assert.deepEqual(
    matchKeywords(['budowa'], 'Przebudowa gabinetów lekarskich, łazienek, pomieszczenia matki z dzieckiem'),
    [],
  );
});

test('matchKeywords — "budowa" wciąż trafia w prawdziwą "Budowę chodników"', () => {
  assert.deepEqual(
    matchKeywords(['budowa'], 'Remont i budowa chodników w Szczecinie'),
    ['budowa'],
  );
});

test('matchKeywords — fraza wielowyrazowa wymaga wszystkich rdzeni', () => {
  assert.deepEqual(
    matchKeywords(['kostka brukowa'], 'Budowa nawierzchni z kostki brukowej'),
    ['kostka brukowa'],
  );
  assert.deepEqual(
    matchKeywords(['kostka brukowa'], 'Budowa nawierzchni asfaltowej'),
    [],
  );
});

test('matchKeywords — zwraca wszystkie trafione słowa, nie tylko pierwsze', () => {
  assert.deepEqual(
    matchKeywords(['remont', 'chodnik', 'oczyszczalnia'], 'Remont i budowa chodników w Szczecinie'),
    ['remont', 'chodnik'],
  );
});

test('matchKeywords — krótkie słowo wymaga dokładnego rdzenia, nie prefiksu', () => {
  // "gaz" nie może trafiać w "gazeta"
  assert.deepEqual(matchKeywords(['gaz'], 'Dostawa gazet i czasopism'), []);
  assert.deepEqual(matchKeywords(['gaz'], 'Dostawa gazu ziemnego'), ['gaz']);
});

test('matchKeywords — pusty profil lub pusty tekst daje pustą listę', () => {
  assert.deepEqual(matchKeywords([], 'Budowa drogi'), []);
  assert.deepEqual(matchKeywords(['droga'], ''), []);
});

test('matchKeywords — nie duplikuje słowa trafionego wielokrotnie', () => {
  assert.deepEqual(matchKeywords(['droga'], 'Droga gminna i droga powiatowa'), ['droga']);
});
