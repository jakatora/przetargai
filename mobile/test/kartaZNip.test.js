import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kodPocztowyZAdresu, wojewodztwoZAdresu, prefillKartyZDanychFirmy, scalDaneWykonawcy, komunikatPrefillu, tekstDoPodpowiedzi, nipDoKonta } from '../src/lib/kartaZNip.js';
import { kartaDoFormularza } from '../src/lib/kartaFirmy.js';
import { WOJEWODZTWA } from '../src/lib/wojewodztwa.js';

test('kod pocztowy z adresu Białej listy (format MF: ulica, kod miasto)', () => {
  assert.equal(kodPocztowyZAdresu('UL. TESTOWA 1, 37-200 PRZEWORSK'), '37-200');
  assert.equal(kodPocztowyZAdresu('Jagiełła 68, 37-203 Gniewczyna Tryniecka'), '37-203');
  assert.equal(kodPocztowyZAdresu('WARSZAWA'), null);
  assert.equal(kodPocztowyZAdresu(null), null);
  assert.equal(kodPocztowyZAdresu('NIP 123-456-78-90'), null, 'NIP z kreskami to nie kod pocztowy');
});

test('województwo z kodu pocztowego: każdy okręg trafia w istniejący kod TERYT', () => {
  const przypadki = [
    ['00-950 Warszawa', '14'], ['09-400 Płock', '14'], ['10-001 Olsztyn', '28'], ['15-001 Białystok', '20'],
    ['20-001 Lublin', '06'], ['25-001 Kielce', '26'], ['31-001 Kraków', '12'], ['35-001 Rzeszów', '18'],
    ['37-200 Przeworsk', '18'], ['40-001 Katowice', '24'], ['45-001 Opole', '16'], ['50-001 Wrocław', '02'],
    ['61-001 Poznań', '30'], ['65-001 Zielona Góra', '08'], ['70-001 Szczecin', '32'], ['75-001 Koszalin', '32'],
    ['80-001 Gdańsk', '22'], ['85-001 Bydgoszcz', '04'], ['87-100 Toruń', '04'], ['90-001 Łódź', '10'], ['99-300 Kutno', '10'],
  ];
  for (const [adres, kod] of przypadki) {
    assert.equal(wojewodztwoZAdresu(adres), kod, adres);
    assert.ok(WOJEWODZTWA[kod], `kod ${kod} istnieje`);
  }
  assert.equal(wojewodztwoZAdresu('brak kodu'), null);
  assert.equal(wojewodztwoZAdresu(undefined), null);
});

test('prefill wypełnia TYLKO puste pola: nazwę i teren; nic nie nadpisuje', () => {
  const pusty = kartaDoFormularza(null);
  const dane = { nazwa: 'DACHY KOWALSKI SP. Z O.O.', adres: 'UL. DŁUGA 5, 37-200 PRZEWORSK', nip: '7941844550' };
  const w = prefillKartyZDanychFirmy(pusty, dane);
  assert.equal(w.form.company_name, 'DACHY KOWALSKI SP. Z O.O.');
  assert.deepEqual(w.form.regiony, ['18']);
  assert.deepEqual(w.zmiany, ['nazwa', 'teren']);
  assert.equal(w.wojewodztwo, '18');
  assert.equal(w.form.opis, '', 'opis zostaje do wpisania własnymi słowami');

  const pelny = { ...pusty, company_name: 'Moja Firma', regiony: ['14', '12'] };
  const w2 = prefillKartyZDanychFirmy(pelny, dane);
  assert.equal(w2.form.company_name, 'Moja Firma');
  assert.deepEqual(w2.form.regiony, ['14', '12']);
  assert.deepEqual(w2.zmiany, []);

  const bezKodu = prefillKartyZDanychFirmy(pusty, { nazwa: 'X', adres: 'Warszawa' });
  assert.deepEqual(bezKodu.zmiany, [], 'nazwa 1-znakowa i adres bez kodu → nic');
  assert.deepEqual(prefillKartyZDanychFirmy(pusty, null).form, pusty);
});

test('scalenie danych wykonawcy: Biała lista ma pierwszeństwo, puste nie kasują, obce pola zostają', () => {
  const w = scalDaneWykonawcy({ nazwa: 'Stara', adres: '', nip: '7941844550', email: 'a@b.pl', reprezentant: 'Jan' },
    { nazwa: 'NOWA SP. Z O.O.', adres: 'UL. X 1, 00-001 WARSZAWA', nip: '7941844550', regon: '123456789', rejestr: 'KRS 0000111222' });
  assert.equal(w.nazwa, 'NOWA SP. Z O.O.');
  assert.equal(w.adres, 'UL. X 1, 00-001 WARSZAWA');
  assert.equal(w.regon, '123456789');
  assert.equal(w.email, 'a@b.pl');
  assert.equal(w.reprezentant, 'Jan');
  const bez = scalDaneWykonawcy({ nazwa: 'Stara', regon: '1' }, { nazwa: '', regon: '  ' });
  assert.equal(bez.nazwa, 'Stara');
  assert.equal(bez.regon, '1');
});

test('komunikat mówi, co wstawiono, i że dane poszły do dokumentów oferty', () => {
  assert.match(komunikatPrefillu({ zmiany: ['nazwa', 'teren'], wojewodztwo: '18' }), /nazwę firmy i województwo Podkarpackie/);
  assert.match(komunikatPrefillu({ zmiany: ['teren'], wojewodztwo: '14' }, 'en'), /Mazowieckie voivodeship/);
  assert.match(komunikatPrefillu({ zmiany: [], wojewodztwo: null }), /nic nie zmieniłem/);
  assert.match(komunikatPrefillu({ zmiany: ['nazwa'], wojewodztwo: null }), /dokumentów oferty/);
});

test('tekst do automatycznej podpowiedzi: własny opis > nazwa bez form prawnych; nic, gdy słowa/CPV już są albo zostaje sama forma', () => {
  assert.equal(tekstDoPodpowiedzi({ opis: 'remonty dachów', nazwa: 'X SP. Z O.O.' }), 'remonty dachów');
  assert.equal(tekstDoPodpowiedzi({ opis: '', nazwa: 'DACHY KOWALSKI SP. Z O.O.' }), 'DACHY KOWALSKI');
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'Zakład Remontowo-Budowlany "BUDMAX" Jan Nowak' }), 'Remontowo-Budowlany BUDMAX Jan Nowak');
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'P.P.H.U. ELEKTRO-INSTAL S.C.' }), 'ELEKTRO-INSTAL');
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'ABC Spółka Akcyjna' }), 'ABC');
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'Sp. z o.o.' }), null);
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'AB' }), null);
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'DACHY KOWALSKI', keywords: 'dach' }), null, 'słowa już są — nie ruszamy');
  assert.equal(tekstDoPodpowiedzi({ nazwa: 'DACHY KOWALSKI', cpv_codes: '45261000' }), null);
  assert.equal(tekstDoPodpowiedzi({}), null);
});

test('NIP do konta: tylko poprawny i inny niż zapisany', () => {
  assert.equal(nipDoKonta('526-104-08-28', null), '5261040828');
  assert.equal(nipDoKonta('5261040828', '5261040828'), null, 'bez zmian — nic nie wysyłamy');
  assert.equal(nipDoKonta('5261040827', null), null, 'zła suma kontrolna');
  assert.equal(nipDoKonta('', '5261040828'), null, 'puste pole nie usuwa NIP-u z konta');
});
