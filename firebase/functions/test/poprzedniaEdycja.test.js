import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poprzedniaEdycja, podobienstwoTytulow } from '../src/lib/poprzedniaEdycja.js';
import { kartaStartu, TON } from '../src/lib/czyWartoStartowac.js';

/*
 * Poprzednia edycja przetargu (2026-10-31). Tytuły to prawdziwe pary z dry-runu na 98 otwartych
 * przetargach z produkcji — i te trafne, i te, które wcześniejsza wersja myliła.
 */
const TERAZ = Date.parse('2026-10-31T08:00:00.000Z');
const wynik = (tytul, { cpv = ['15800000-6'], opublikowano = '2026-01-07', dataUmowy = '2026-01-02', koniecUmowy = null, nip = '7010000001', nazwa = 'Hurtownia Smak Sp. z o.o.', cena = 174141, ofert = 5, postepowanie = 'ocds-stare' } = {}) => ({
  tytul, cpv, opublikowano, postepowanie_id: postepowanie,
  czesci: [{ numer: 1, uniewaznione: false, dataUmowy, koniecUmowy, cenaWybrana: cena, spojne: true, liczbaOfert: ofert, zwyciezca: { nazwa, nip } }],
});

test('ta sama umowa sprzed roku: wykonawca, cena, liczba ofert; własne postępowanie pominięte', () => {
  const tender = { title: 'Dostawa produktów mrożonych, garmażeryjnych i ryb', cpv_main: '15800000-6', organization: 'Jednostka Wojskowa 4724', published_at: '2026-10-20T00:00:00.000Z', postepowanie_id: 'ocds-nowe' };
  const p = poprzedniaEdycja(tender, [
    wynik('Dostawa produktów mrożonych, garmażeryjnych i ryb', { nazwa: 'PINGWINEK', cena: 134734, ofert: 6 }),
    wynik('Dostawa produktów mrożonych, garmażeryjnych i ryb', { postepowanie: 'ocds-nowe', nazwa: 'Ten sam przetarg' }),
  ], { teraz: TERAZ });
  assert.deepEqual([p.wykonawcy[0].nazwa, p.kwota, p.liczba_ofert, p.podobienstwo], ['PINGWINEK', 134734, 6, 1]);
});

test('ten sam zamawiający, inny zakup: nazwa zamawiającego i formułki nie robią podobieństwa', () => {
  const zk = { title: 'Dostawa konserw i oleju roślinnego do Zakładu Karnego w Przemyślu i Oddziału Zewnętrznego', cpv_main: '15800000-6', organization: 'Zakład Karny w Przemyślu', published_at: '2026-10-20' };
  assert.equal(poprzedniaEdycja(zk, [wynik('DOSTAWA WYROBÓW PIEKARSKICH DO ZAKŁADU KARNEGO W PRZEMYŚLU I ODDZIAŁU ZEWNĘTRZNEGO')], { teraz: TERAZ }), null);
  const czd = { title: 'ZP/CZD/134/26 Dostawa produktu leczniczego Odevixibatum stosowanego w ramach programu lekowego', cpv_main: '33600000-6', organization: 'Instytut Pomnik-Centrum Zdrowia Dziecka', published_at: '2026-10-20' };
  assert.equal(poprzedniaEdycja(czd, [wynik('ZP/CZD/037/26 Dostawa produktu leczniczego Agalsidasum alfa stosowanego w ramach programu lekowego', { cpv: ['33600000-6'] })], { teraz: TERAZ }), null);
});

test('czas: umowa kończąca się koło nowego przetargu tak, zawarta tydzień temu albo 4 lata temu — nie', () => {
  const tender = { title: 'Opróżnianie ulicznych koszy na odpady w 2027r.', cpv_main: '90500000-2', organization: 'Gmina', published_at: '2026-10-20' };
  const stary = (o) => wynik('Opróżnianie ulicznych koszy na odpady w 2026r.', { cpv: ['90500000-2'], ...o });
  assert.ok(poprzedniaEdycja(tender, [stary({ koniecUmowy: '2026-12-31' })], { teraz: TERAZ }));
  assert.equal(poprzedniaEdycja(tender, [stary({ koniecUmowy: '2029-12-31' })], { teraz: TERAZ }), null);
  assert.equal(poprzedniaEdycja(tender, [stary({ dataUmowy: '2026-10-13' })], { teraz: TERAZ }), null);
  assert.equal(poprzedniaEdycja(tender, [stary({ dataUmowy: '2022-10-13' })], { teraz: TERAZ }), null);
  assert.equal(poprzedniaEdycja(tender, [stary({ opublikowano: '2026-10-25' })], { teraz: TERAZ }), null, 'wynik nowszy niż przetarg to nie poprzednia edycja');
});

test('podobieństwo ważone rzadkością: bez wag i z wagami', () => {
  assert.equal(podobienstwoTytulow('Dostawa artykułów spożywczych', 'Dostawa artykułów spożywczych'), 1);
  assert.equal(podobienstwoTytulow('Dostawa', 'Usługa'), 0);
  const waga = (r) => (r === 'odevix' ? 5 : 0.1);
  assert.ok(podobienstwoTytulow('Odevixibatum leki', 'Odevixibatum inne', null, waga) > 0.9);
});

test('czynnik w karcie: „Poprzednio wygrał” przy tym samym tytule, „Podobne zamówienie” przy innym; nie zmienia werdyktu', () => {
  const kubelek = { probka: { czesci: 30 }, konkurencja: null };
  const baza = { tender: { deadline: '2026-12-01T00:00:00.000Z' }, benchmarki: { zamawiajacy: kubelek }, teraz: TERAZ };
  const ta = kartaStartu({ ...baza, poprzednia: { tytul: 'Dostawa artykułów spożywczych', wykonawcy: [{ nazwa: 'LODOS', nip: '7010000001' }], kwota: 174141, koniec_umowy: '2026-12-31', liczba_ofert: 5, podobienstwo: 1 } });
  const c = ta.czynniki.find((x) => x.kod === 'poprzednia_edycja');
  assert.equal(c.ton, TON.ZOLTY);
  assert.equal(c.naglowek, `Poprzednio wygrał LODOS za ${(174141).toLocaleString('pl-PL')} zł`);
  assert.match(c.szczegol, /umowa do 31\.12\.2026 \(ofert: 5\)/);
  assert.deepEqual(c.wykonawca, { nazwa: 'LODOS', nip: '7010000001' });
  const inna = kartaStartu({ ...baza, poprzednia: { tytul: 'Budowa drogi wewnętrznej', wykonawcy: [{ nazwa: 'LOREK', nip: null }], kwota: null, podobienstwo: 0.4 } });
  assert.match(inna.czynniki.find((x) => x.kod === 'poprzednia_edycja').naglowek, /^Podobne zamówienie tu wygrał LOREK$/);
  assert.equal(kartaStartu(baza).werdykt, ta.werdykt, 'żółty czynnik nie zmienia werdyktu');
  assert.equal(kartaStartu(baza).czynniki.some((x) => x.kod === 'poprzednia_edycja'), false);
});
