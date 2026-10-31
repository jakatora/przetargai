import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsujListe, parsujSzczegol, normalizujOgloszenieLt, bezpiecznyLinkKarty, adresListy } from '../src/services/logintrade.js';

const LISTA = readFileSync(new URL('./fixtures/logintrade-lista.html', import.meta.url), 'utf8');
const SZCZEGOL = readFileSync(new URL('./fixtures/logintrade-szczegol.html', import.meta.url), 'utf8');

test('lista: wiersze z id, tytułem, kartą kupca, datami, województwem i statusem', () => {
  const { pozycje, odrzucone, aktywnych } = parsujListe(LISTA);
  assert.equal(pozycje.length, 4);
  assert.equal(odrzucone, 0);
  assert.equal(aktywnych, 3);
  const p = pozycje[0];
  assert.equal(p.id, '1670248');
  assert.equal(p.host, 'platformazakupowa.grupaazoty.com');
  assert.equal(p.tytul, '46/NM/PM/2026 Wykonanie przeglądów / napraw wagonów kolejowych Grupy Azoty "FOSFORY" Sp. z o.o. w Gdańsku');
  assert.match(p.url, /^https:\/\/platformazakupowa\.grupaazoty\.com\/zapytania_email,1670248,[0-9a-f]+\.html$/);
  assert.deepEqual([p.opublikowano, p.termin_dzien, p.wojewodztwo, p.aktywne], ['2026-10-30', '2026-11-13', 'pomorskie', true]);
  assert.equal(pozycje[3].aktywne, false);
  assert.equal(adresListy(3), 'https://platforma.logintrade.net/platforma-zakupowa,zapytania_otwarte.html?page=3');
});

test('karta: kupiec z NIP-em i adresem, numer, termin z godziną (czas polski → UTC), skrót treści', () => {
  const sz = parsujSzczegol(SZCZEGOL);
  assert.equal(sz.zamawiajacy, 'Grupa Azoty Zakłady Fosforowe Gdańsk sp. z o.o.');
  assert.equal(sz.nip, '5830001675');
  assert.equal(sz.adres, 'Kujawska 2, 80-550 Gdańsk');
  assert.equal(sz.numer, 'Z874/474578');
  assert.equal(sz.termin, '2026-11-13T15:00:00.000Z');
  assert.match(sz.opis, /^Grupa Azoty „FOSFORY” Sp\. z o\.o\. zaprasza do złożenia ofert/);
  assert.ok(!/Jan \.\.\./.test(sz.adres ?? ''), 'osoba kupca nie trafia do adresu');
});

test('normalizacja: bez karty (kupca albo godziny) nie ma ogłoszenia; z kartą — kształt tenders.upsert', () => {
  const [poz] = parsujListe(LISTA).pozycje;
  assert.equal(normalizujOgloszenieLt(poz, null), null);
  assert.equal(normalizujOgloszenieLt(poz, { zamawiajacy: 'X', termin: null }), null);
  const t = normalizujOgloszenieLt(poz, parsujSzczegol(SZCZEGOL));
  assert.equal(t.externalId, 'lt:platformazakupowa.grupaazoty.com:1670248');
  assert.equal(t.source, 'logintrade');
  assert.equal(t.organization, 'Grupa Azoty Zakłady Fosforowe Gdańsk sp. z o.o.');
  assert.equal(t.zamawiajacy_nip, '5830001675');
  assert.equal(t.deadline, '2026-11-13T15:00:00.000Z');
  assert.equal(t.wojewodztwo, 'PL22');
  assert.equal(t.numer, 'Z874/474578');
  assert.equal(t.publishedAt, '2026-10-29T23:00:00.000Z');
});

test('link karty: tylko https i ścieżka karty Logintrade; IP, localhost i inne ścieżki odrzucone', () => {
  assert.ok(bezpiecznyLinkKarty('https://pge.logintrade.net/zapytania_email,123,abcdef.html'));
  assert.equal(bezpiecznyLinkKarty('http://pge.logintrade.net/zapytania_email,123,abcdef.html'), null);
  assert.equal(bezpiecznyLinkKarty('https://127.0.0.1/zapytania_email,123,abcdef.html'), null);
  assert.equal(bezpiecznyLinkKarty('https://localhost/zapytania_email,123,abcdef.html'), null);
  assert.equal(bezpiecznyLinkKarty('https://pge.logintrade.net/zalaczniki/plik.pdf'), null);
});

test('zagraniczne zapytania (cyrylica albo brak NIP-u i polskiego województwa) odrzucone', async () => {
  const { czyZagraniczne } = await import('../src/services/logintrade.js');
  const [poz] = parsujListe(LISTA).pozycje;
  const sz = parsujSzczegol(SZCZEGOL);
  assert.equal(czyZagraniczne({ ...poz, tytul: 'Просування рекламних кампаній' }), true);
  assert.equal(normalizujOgloszenieLt({ ...poz, tytul: 'Переміщення стендів' }, sz), null);
  assert.equal(normalizujOgloszenieLt({ ...poz, wojewodztwo: 'Inne' }, { ...sz, nip: null }), null);
  assert.ok(normalizujOgloszenieLt(poz, { ...sz, nip: null }), 'polska spółka bez NIP-u na karcie, ale z województwem — zostaje');
  assert.ok(normalizujOgloszenieLt({ ...poz, wojewodztwo: 'Inne' }, sz), 'z NIP-em — zostaje');
});
