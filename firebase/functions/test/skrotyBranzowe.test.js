import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Skróty i nazwy branż w słowach kluczowych (2026-11-07): klient wpisuje „P-poż”, „PV”, „wod-kan”, „elektryka”,
 * a tytuły mówią „przeciwpożarowej”, „fotowoltaicznej”, „wodno-kanalizacyjnej”, „instalacji elektrycznej”. Pomiar
 * na 13 723 otwartych tytułach: P-poż 9 → 55, PV 5 → 62, fotowoltaika 0 → 58, wod-kan 5 → 24, elektryka 0 → 47.
 */
const { matchKeywords, rozwinieciaSlowa } = await import('../src/lib/textNorm.js');

test('skrót trafia w pełną formę i odwrotnie; zwracamy słowo klienta, nie rozwinięcie', () => {
  assert.deepEqual(matchKeywords(['P-poż'], 'Konserwacje i naprawy urządzeń przeciwpożarowych w jednostkach'), ['P-poż']);
  assert.deepEqual(matchKeywords(['przeciwpożarowe'], 'Dostosowanie budynku do wymagań ochrony p.poż.'), ['przeciwpożarowe']);
  assert.deepEqual(matchKeywords(['PV'], 'Montaż instalacji fotowoltaicznej na dachu szkoły'), ['PV']);
  assert.deepEqual(matchKeywords(['fotowoltaika'], 'Budowa instalacji fotowoltaicznych na obiektach PWiK'), ['fotowoltaika']);
  assert.deepEqual(matchKeywords(['wod-kan'], 'Remont instalacji wodno-kanalizacyjnych w szkole'), ['wod-kan']);
  assert.deepEqual(matchKeywords(['c.o.'], 'Przywrócenie działania centralnego ogrzewania w obiekcie KPP'), ['c.o.']);
  assert.deepEqual(matchKeywords(['OZE'], 'Termomodernizacja z zastosowaniem odnawialnych źródeł energii'), ['OZE']);
  assert.deepEqual(matchKeywords(['kanalizacja'], 'Modernizacja systemu kanalizacyjnego w rejonie ulic'), ['kanalizacja']);
  assert.deepEqual(matchKeywords(['wentylacja'], 'Kontrola przewodów kominowo wentylacyjnych'), ['wentylacja']);
});

test('nazwa branży rozwija się we frazy pracy, nie w każdy przymiotnik', () => {
  assert.deepEqual(matchKeywords(['elektryka'], 'Wymiana instalacji elektrycznej w lokalach mieszkalnych'), ['elektryka']);
  assert.deepEqual(matchKeywords(['elektryka'], 'Dostawa energii elektrycznej dla gminy'), [], 'dostawa prądu to nie robota elektryka');
  assert.deepEqual(matchKeywords(['hydraulika'], 'Wykonanie instalacji centralnego ogrzewania w Bastionie VII'), ['hydraulika']);
  assert.deepEqual(matchKeywords(['hydraulika'], 'Dostawa hydraulicznej prasy krawędziowej CNC'), [], 'prasa hydrauliczna to nie hydraulik');
});

test('bez słownika jak dotąd: zwykłe słowo, fraza, brak fałszywych trafień skrótu w środku słowa', () => {
  assert.deepEqual(matchKeywords(['dach'], 'Remont dachu szkoły'), ['dach']);
  assert.deepEqual(matchKeywords(['PV'], 'Dostawa papieru PVC do drukarek'), [], 'PV ≠ PVC');
  assert.deepEqual(matchKeywords(['c.o.'], 'Budowa ronda w Cieszynie'), []);
  assert.deepEqual(rozwinieciaSlowa('dach'), []);
  assert.ok(rozwinieciaSlowa('P.POŻ.').includes('przeciwpożarowy'), 'wielkość liter i kropki bez znaczenia');
});
