import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wygeneruj_wniosek_o_protokol,
  TYTUL_WNIOSKU,
} from '../src/lib/wniosekProtokol.js';

import { PoprzetargowaKontrola } from '../src/lib/poprzetargowaKontrola.js';

/*
 * Generator wniosku o udostępnienie protokołu postępowania wraz z załącznikami
 * (podzadanie 5/13 ulepszenia „Prześwietlenie oferty zwycięzcy i szansa na
 * odwołanie"). Czysta funkcja: bierze postępowanie/tender (albo kontrolę), zwraca
 * dokument gotowy do pobrania. Sam szablon + wypełnianie, bez UI.
 *
 * Podstawa prawna kodowana w piśmie:
 *  - art. 18 ust. 1 Pzp — zasada jawności postępowania,
 *  - art. 74 ust. 1 Pzp — protokół jest jawny, udostępniany na wniosek,
 *  - art. 74 ust. 2 pkt 1 Pzp — oferty wraz z załącznikami udostępnia się
 *    niezwłocznie po otwarciu ofert, nie później niż w terminie 3 dni od otwarcia.
 */

// --- Kształt dokumentu do pobrania ---

test('zwraca dokument z tytułem, nazwą pliku, typem MIME i treścią', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 42, title: 'Dostawa serwerów', organization: 'Urząd Miasta X' });
  assert.equal(dok.tytul, TYTUL_WNIOSKU);
  assert.equal(typeof dok.tresc, 'string');
  assert.ok(dok.tresc.length > 0);
  assert.ok(dok.nazwaPliku.endsWith('.txt'));
  assert.match(dok.typMime, /text\/plain/);
});

test('nazwa pliku zawiera id postępowania', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 42 });
  assert.equal(dok.nazwaPliku, 'wniosek-o-protokol-42.txt');
});

test('brak id → neutralna nazwa pliku, bez „undefined"', () => {
  const dok = wygeneruj_wniosek_o_protokol({ title: 'Bez identyfikatora' });
  assert.equal(dok.nazwaPliku, 'wniosek-o-protokol.txt');
  assert.doesNotMatch(dok.nazwaPliku, /undefined|null/);
});

test('id sanityzowane w nazwie pliku (spacje/ukośniki → myślnik)', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 'BZP 2026/S 12/3' });
  assert.doesNotMatch(dok.nazwaPliku, /[ /\\]/);
  assert.match(dok.nazwaPliku, /^wniosek-o-protokol-.+\.txt$/);
});

// --- Podstawa prawna ---

test('podstawaPrawna: tablica z art. 18 ust. 1, art. 74 ust. 1 i art. 74 ust. 2 pkt 1 Pzp', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1 });
  assert.ok(Array.isArray(dok.podstawaPrawna));
  const scalone = dok.podstawaPrawna.join(' | ');
  assert.match(scalone, /art\.\s*18 ust\.\s*1/);
  assert.match(scalone, /art\.\s*74 ust\.\s*1/);
  assert.match(scalone, /art\.\s*74 ust\.\s*2 pkt 1/);
});

test('treść przywołuje podstawę prawną wprost', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1 });
  assert.match(dok.tresc, /art\.\s*74 ust\.\s*1/);
  assert.match(dok.tresc, /art\.\s*74 ust\.\s*2 pkt 1/);
  assert.match(dok.tresc, /art\.\s*18 ust\.\s*1/);
  assert.match(dok.tresc, /Prawo zamówień publicznych|Pzp/);
});

test('treść niesie regułę jawności ofert: „po otwarciu" i „3 dni"', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1 });
  assert.match(dok.tresc, /po otwarciu ofert/i);
  assert.match(dok.tresc, /3 dni/);
});

// --- Wypełnianie danymi postępowania ---

test('wypełnia zamawiającego z organization (surowy tender)', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1, organization: 'Gmina Testowa' });
  assert.match(dok.tresc, /Gmina Testowa/);
});

test('wypełnia nazwę/przedmiot postępowania z title', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1, title: 'Budowa drogi gminnej' });
  assert.match(dok.tresc, /Budowa drogi gminnej/);
});

test('wstawia oznaczenie postępowania (id) do treści', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 777, title: 'X' });
  assert.match(dok.tresc, /777/);
});

test('data otwarcia ofert (ISO) formatowana po polsku DD.MM.RRRR', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1, deadline: '2026-07-01' });
  assert.match(dok.tresc, /01\.07\.2026/);
});

test('pełny znacznik ISO obcinany do dnia (bez godziny/strefy)', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1, deadline: '2026-07-01T09:30:00Z' });
  assert.match(dok.tresc, /01\.07\.2026/);
  assert.doesNotMatch(dok.tresc, /09:30|T09/);
});

// --- Źródła pól: zagnieżdżony tender, model kontroli, priorytety ---

test('czyta z zagnieżdżonego tender, gdy pola brak na wierzchu', () => {
  const dok = wygeneruj_wniosek_o_protokol({ tender: { id: 9, organization: 'Zamawiający Z', title: 'Usługa U' } });
  assert.match(dok.tresc, /Zamawiający Z/);
  assert.match(dok.tresc, /Usługa U/);
  assert.equal(dok.nazwaPliku, 'wniosek-o-protokol-9.txt');
});

test('daneZamawiajacego ma priorytet nad organization', () => {
  const dok = wygeneruj_wniosek_o_protokol({ id: 1, daneZamawiajacego: 'Z priorytetu', organization: 'Z fallbacku' });
  assert.match(dok.tresc, /Z priorytetu/);
  assert.doesNotMatch(dok.tresc, /Z fallbacku/);
});

test('akceptuje model PoprzetargowaKontrola (daneZamawiajacego/dataOtwarciaOfert/postepowanieId)', () => {
  const kontrola = new PoprzetargowaKontrola({
    postepowanieId: 55,
    daneZamawiajacego: 'Powiat Kontrolny',
    dataOtwarciaOfert: '2026-05-20',
  });
  const dok = wygeneruj_wniosek_o_protokol(kontrola);
  assert.match(dok.tresc, /Powiat Kontrolny/);
  assert.match(dok.tresc, /20\.05\.2026/);
  assert.equal(dok.nazwaPliku, 'wniosek-o-protokol-55.txt');
});

// --- Opcje: dane wnioskodawcy i data pisma ---

test('opcje.wnioskodawca i opcje.dataPisma trafiają do pisma', () => {
  const dok = wygeneruj_wniosek_o_protokol(
    { id: 1, organization: 'Zam' },
    { wnioskodawca: 'Moja Firma sp. z o.o.', dataPisma: '2026-07-25' },
  );
  assert.match(dok.tresc, /Moja Firma sp\. z o\.o\./);
  assert.match(dok.tresc, /25\.07\.2026/);
});

// --- Best-effort: braki danych nie wywracają generatora ---

test('brak danych → placeholdery, wciąż poprawny dokument z podstawą prawną', () => {
  const dok = wygeneruj_wniosek_o_protokol({});
  assert.equal(dok.tytul, TYTUL_WNIOSKU);
  assert.ok(dok.tresc.includes('art. 74 ust. 1'));
  // Zamiast zmyślonych danych — czytelny placeholder do uzupełnienia.
  assert.match(dok.tresc, /\[.*(zamawiaj|wnioskodaw|postępow|miejscowość|data).*\]/i);
  assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
});

test('null/undefined postępowanie → nie rzuca, zwraca szablon', () => {
  for (const wejscie of [null, undefined]) {
    const dok = wygeneruj_wniosek_o_protokol(wejscie);
    assert.equal(dok.tytul, TYTUL_WNIOSKU);
    assert.ok(dok.tresc.includes('art. 74 ust. 1'));
    assert.doesNotMatch(dok.tresc, /undefined|null|NaN/);
  }
});
