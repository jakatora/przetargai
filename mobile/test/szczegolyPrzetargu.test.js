import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pasekDecyzji, krokiBiore, grupyNarzedzi, liczbaNarzedzi } from '../src/lib/szczegolyPrzetargu.js';

/*
 * Ekran szczegółów (2026-11-10): decyzja „Biorę / Nie dla nas” stale na dole ekranu, „Biorę” robi za leniwego
 * użytkownika zapis + przypomnienie + etap, a narzędzia w jednej zwiniętej sekcji.
 */
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('pasek: przed decyzją „Biorę” + akcja; po „Biorę” stan z podpisem; po złożeniu, wyniku albo terminie — bez paska', () => {
  assert.deepEqual(pasekDecyzji({}).glowna, { etykieta: { pl: 'Biorę', en: 'I will bid' }, akcja: 'biore' });
  assert.equal(pasekDecyzji({ zapisany: true }).glowna.akcja, 'biore', 'zapisany gwiazdką, ale wciąż „Rozważam”');
  const wziety = pasekDecyzji({ zapisany: true, status: 'przygotowuje', przypomnienie: true });
  assert.deepEqual([wziety.glowna.akcja, wziety.glowna.etykieta.pl], [null, 'Bierzesz']);
  assert.match(wziety.podpis.pl, /Przypomnimy 7, 3 i 1 dzień/);
  assert.match(pasekDecyzji({ zapisany: true, status: 'przygotowuje' }).podpis.pl, /włączysz niżej/);
  for (const status of ['zlozona', 'wygrana', 'przegrana']) assert.equal(pasekDecyzji({ status }).widoczny, false, status);
  assert.equal(pasekDecyzji({ terminMinal: true }).widoczny, false);
});

test('„Biorę”: zapis, przypomnienie (tylko z przyszłym terminem) i etap — bez cofania późniejszego etapu', () => {
  assert.deepEqual(krokiBiore({ maTermin: true }), ['zapisz', 'przypomnienie', 'etap']);
  assert.deepEqual(krokiBiore({ zapisany: true, przypomnienie: true, maTermin: true }), ['etap']);
  assert.deepEqual(krokiBiore({ maTermin: false }), ['zapisz', 'etap'], 'bez terminu nie ma czego przypominać');
  assert.deepEqual(krokiBiore({ zapisany: true, maTermin: true, status: 'przygotowuje' }), ['przypomnienie']);
});

test('narzędzia: trzy grupy przed wygraną, „Po wygranej” (zwrot zabezpieczenia, odsetki) dopiero po wygranej', () => {
  const przed = grupyNarzedzi({});
  assert.deepEqual(przed.map((g) => g.klucz), ['decyzja', 'oferta', 'pisma']);
  const ekrany = przed.flatMap((g) => g.pozycje.map((n) => n.ekran));
  assert.ok(!ekrany.includes('ZabezpieczenieZwrot') && !ekrany.includes('KalkulatorOdsetek'));
  assert.equal(new Set(ekrany).size, ekrany.length, 'bez powtórek');
  assert.equal(liczbaNarzedzi(przed), 24);
  const wygrana = grupyNarzedzi({ status: 'wygrana' });
  assert.equal(wygrana[0].klucz, 'po_wygranej');
  assert.ok(wygrana[0].pozycje.some((n) => n.ekran === 'ZabezpieczenieZwrot'));
  assert.ok(!grupyNarzedzi({ maChecklista: false }).flatMap((g) => g.pozycje).some((n) => n.ekran === 'ChecklistaOferty'));
});

test('każde narzędzie prowadzi do istniejącego ekranu w nawigacji aplikacji', () => {
  const nawigacja = fs.readFileSync(path.join(SRC, '..', 'App.js'), 'utf8')
    + fs.readdirSync(path.join(SRC, 'navigation'), { withFileTypes: true }).filter((f) => f.isFile()).map((f) => fs.readFileSync(path.join(SRC, 'navigation', f.name), 'utf8')).join('\n');
  const wszystkie = grupyNarzedzi({ status: 'wygrana' }).flatMap((g) => g.pozycje);
  for (const n of wszystkie) assert.match(nawigacja, new RegExp(`name="${n.ekran}"`), `brak trasy ${n.ekran}`);
  for (const n of wszystkie) assert.ok(n.tytul.pl && n.tytul.en, n.ekran);
});
