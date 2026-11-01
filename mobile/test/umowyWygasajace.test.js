import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonTerminu, opisTerminu, opisUmowy, dataKonca, opisNastepcy, ogloszenieNastepcy } from '../src/lib/umowyWygasajace.js';
import { kwotaKrotko } from '../src/lib/ktoWygrywa.js';

const t = (pl) => pl;

test('pilność i opis terminu końca umowy', () => {
  assert.deepEqual([20, 45, 46, 120, 121, null].map(tonTerminu), ['pilne', 'pilne', 'wkrotce', 'wkrotce', 'neutralne', 'neutralne']);
  assert.deepEqual([0, 1, 20, 60, 61, 150, -1].map((d) => opisTerminu(d, t)), ['kończy się dziś', 'za 1 dzień', 'za 20 dni', 'za 60 dni', 'za ok. 2 mies.', 'za ok. 5 mies.', 'termin nieznany']);
});

test('druga linia karty i data końca po polsku', () => {
  const u = { region_nazwa: 'Wielkopolskie', wartosc: 480000, okres: '12 miesięcy', data_umowy: '2025-12-01', koniec: '2026-11-20' };
  assert.equal(opisUmowy(u, t, kwotaKrotko), `Wielkopolskie · ${kwotaKrotko(480000, t)} · okres: 12 miesięcy · umowa z 01.12.2025`);
  assert.equal(opisUmowy({}, t, kwotaKrotko), '');
  assert.equal(dataKonca(u), '20.11.2026');
  assert.equal(dataKonca({}), null);
});

test('obserwacja zamawiającego: zapisane wyszukiwanie z alertem w limitach Functions', async () => {
  const { wyszukiwanieZamawiajacego } = await import('../src/lib/umowyWygasajace.js');
  assert.deepEqual(wyszukiwanieZamawiajacego({ zamawiajacy: ' Szpital  Wojewódzki ', wojewodztwo: '30' }), {
    nazwa: 'Zamawiający: Szpital Wojewódzki', filtry: { q: 'Szpital Wojewódzki', region: '30' }, alert_wlaczony: true,
  });
  const dlugi = wyszukiwanieZamawiajacego({ zamawiajacy: 'X'.repeat(300) });
  assert.equal(dlugi.nazwa.length, 60);
  assert.equal(dlugi.filtry.q.length, 120);
  assert.equal('region' in dlugi.filtry, false);
  assert.equal(wyszukiwanieZamawiajacego({}), null);
});

test('następca umowy: opis z terminem ofert w dniu polskim, „podobny” przy słabym tytule, ogłoszenie do ekranu', () => {
  const u = { zamawiajacy: 'Gmina Raszyn', nastepca: { tender_id: 't1', tytul: 'Opieka medyczna 2027', deadline: '2026-11-12T23:00:00.000Z', url: 'https://x.pl/t1', zrodlo: 'bzp', opublikowano: '2026-10-28', pewny: true } };
  assert.equal(opisNastepcy(u, t), 'Nowy przetarg już ogłoszony · oferty do 13.11.2026');
  assert.equal(opisNastepcy({ nastepca: { ...u.nastepca, pewny: false, deadline: null } }, t), 'Podobny przetarg tego zamawiającego już ogłoszony');
  assert.equal(opisNastepcy({ nastepca: null }, t), null);
  assert.deepEqual(ogloszenieNastepcy(u), { id: 't1', title: 'Opieka medyczna 2027', url: 'https://x.pl/t1', deadline: '2026-11-12T23:00:00.000Z', published_at: '2026-10-28', organization: 'Gmina Raszyn', source: 'bzp' });
  assert.equal(ogloszenieNastepcy({}), null);
});
