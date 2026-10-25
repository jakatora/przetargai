import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nazwaKodu, slowaZNazwCpv } from '../src/lib/cpvSlowa.js';
import { NAZWY_CPV } from '../src/lib/cpvNazwy.js';
import { heuristicScore } from '../src/lib/scoring.js';

test('nazwaKodu: dokładny kod, potem coraz szerszy prefiks; nieznany dział → null', () => {
  assert.equal(nazwaKodu('45233140'), 'Roboty drogowe');
  assert.equal(nazwaKodu('45233141'), 'Roboty drogowe', 'cyfra kontrolna / węższy kod → najbliższy znany');
  assert.equal(nazwaKodu('45233000'), NAZWY_CPV['45230000'], 'brak klasy → nadrzędna grupa');
  assert.equal(nazwaKodu('45'), NAZWY_CPV['45000000']);
  assert.equal(nazwaKodu('99999999'), null);
});

test('slowaZNazwCpv: słowa z nazw bez ogólników i krótkich, unikalne', () => {
  const s = slowaZNazwCpv(['45233140', '33000000']);
  assert.ok(s.includes('drogowe'), JSON.stringify(s));
  assert.ok(s.includes('medyczny') && s.includes('leki'), JSON.stringify(s));
  assert.ok(!s.includes('roboty') && !s.includes('dostawa') && !s.includes('i'), 'ogólniki odsiane');
  assert.deepEqual(slowaZNazwCpv([]), []);
});

test('heuristicScore: ogłoszenie bez CPV + profil tylko z kodami → sygnał z nazwy (42), inaczej 0', () => {
  const firma = { cpv_codes: ['45233140'] };
  const bezCpv = { title: 'Remont drogi gminnej w Lipinach', cpvMain: null };
  const h = heuristicScore(firma, bezCpv);
  assert.equal(h.score, 42);
  assert.deepEqual(h.cpvZNazw, ['drogowe']);
  assert.equal(h.cpvMatched, false);
  assert.equal(heuristicScore(firma, { title: 'Dostawa implantów ortopedycznych' }).score, 0);
  // Ogłoszenie Z kodami: liczy się kod, nie nazwa (pasujący tytuł nie podbija niezgodnego kodu).
  const zCpv = heuristicScore(firma, { title: 'Remont drogi gminnej', cpvMain: '33100000' });
  assert.equal(zCpv.score, 0);
  assert.deepEqual(zCpv.cpvZNazw, []);
});

test('cpvNazwy.js jest aktualny względem katalogu w aplikacji mobilnej', async () => {
  const { KATALOG_CPV } = await import('../../../mobile/src/lib/cpvKatalog.js');
  const plaski = {};
  for (const d of KATALOG_CPV) { plaski[d.kod] = d.nazwa; for (const x of d.dzieci ?? []) plaski[x.kod] = x.nazwa; }
  assert.deepEqual({ ...NAZWY_CPV }, plaski, 'uruchom: node skrypty/generujCpvNazwy.mjs');
  assert.match(readFileSync(new URL('../src/lib/cpvNazwy.js', import.meta.url), 'utf8'), /WYGENEROWANE/);
});
