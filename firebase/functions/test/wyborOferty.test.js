import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsujWyborOferty, wybranoNip, scalWybor } from '../src/lib/wyborOferty.js';
import { alertNowychDokumentow } from '../src/lib/noweDokumenty.js';

/*
 * Pismo o wyborze najkorzystniejszej oferty (2026-11-01). Fixture = fragmenty prawdziwych pism z e-Zamówień
 * (postępowania BZP z terminem 16–26.10.2026, tekst z `liniePdf`); dane osób fizycznych podmienione.
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/wybor-oferty.json', import.meta.url), 'utf8'));

test('nazwa w tej samej linii do adresu, NIP i liczba ofert („wpłynęł y 3 oferty” rozbite przez PDF)', () => {
  assert.deepEqual(parsujWyborOferty(F.rrbud), { wykonawcy: [{ czesc: null, nazwa: 'RR-BUD Sp. z o.o.', nip: '6871977540' }], oferty: 3 });
  assert.deepEqual(parsujWyborOferty(F.rolmech), { wykonawcy: [{ czesc: null, nazwa: 'ROL-MECH GRAŻYNA I JAN GRZEŚKO SPÓŁKA Z O.O.', nip: '7921002339' }], oferty: 1 });
  assert.equal(parsujWyborOferty(F.cytryn).wykonawcy[0].nazwa, 'CYTRYN Sp. z o. o.');
});

test('nazwa w liniach pod zdaniem złamanym na dwie linie; NIP z kreskami; lider konsorcjum', () => {
  assert.deepEqual(parsujWyborOferty(F.bentley).wykonawcy, [{ czesc: null, nazwa: 'Bentley Polska Sp. z o.o.', nip: '9511773647' }]);
  assert.deepEqual(parsujWyborOferty(F.konsorcjum), { wykonawcy: [{ czesc: null, nazwa: 'TEST Sp. z o.o.', nip: null }], oferty: 1 });
  assert.deepEqual(parsujWyborOferty(F.logplus), { wykonawcy: [{ czesc: null, nazwa: 'LOG Plus sp. z o.o.', nip: null }], oferty: 1 });
});

test('same uzasadnienia („Wybrani Wykonawcy spełniają…”) i wybór w załączniku → null', () => {
  assert.equal(parsujWyborOferty(F.pakiety), null);
  assert.equal(parsujWyborOferty([]), null);
});

test('części, NIP konta i scalanie odczytów', () => {
  const w = parsujWyborOferty(['W Części 2 jako najkorzystniejszą wybrano Ofertę nr 2 złożoną przez Wykonawcę:', 'ARTEX Sp. z o.o.', 'Rzuszcze 33,']);
  assert.deepEqual(w.wykonawcy, [{ czesc: 2, nazwa: 'ARTEX Sp. z o.o.', nip: null }]);
  const rr = parsujWyborOferty(F.rrbud);
  assert.equal(wybranoNip(rr, 'PL 687-197-75-40'), true);
  assert.equal(wybranoNip(rr, '5261040828'), false);
  assert.equal(wybranoNip(rr, null), false);
  const skan = scalWybor(null, null, { id: 'd1' });
  assert.deepEqual(skan, { wykonawcy: [], oferty: null, dokument: null, przeczytane: ['d1'] });
  const po = scalWybor(skan, rr, { id: 'd2', nazwa: 'Wybór', url: 'https://ezamowienia.gov.pl/x', opublikowano: '2026-10-30' });
  assert.deepEqual([po.wykonawcy[0].nazwa, po.przeczytane, po.dokument.id], ['RR-BUD Sp. z o.o.', ['d1', 'd2'], 'd2']);
});

test('alert: kogo wybrano + termin odwołania; wybrano NIP konta → gratulacje, ton sukces, bez terminu', () => {
  const tender = { id: 'bzp_9', title: 'Przebudowa DW 886', organization: 'PZDW', deadline: '2026-10-16T08:00:00.000Z' };
  const nowe = [{ id: 'd2', nazwa: 'Informacja o wyborze oferty', opublikowano: '2026-10-30T09:00:00.000Z' }];
  const wybor = scalWybor(null, parsujWyborOferty(F.rrbud), nowe[0]);
  const teraz = Date.parse('2026-10-30T12:00:00Z');
  const a = alertNowychDokumentow({ tender, nowe, teraz, wybor });
  assert.match(a.tresc.pl, /\(1\)\. Wybrano ofertę: RR-BUD Sp\. z o\.o\. \(3 oferty\)\. Jeśli złożyłeś ofertę i chcesz się odwołać do KIO, masz 5 dni od przekazania informacji — licząc od publikacji, do 04\.11\.2026\./);
  assert.equal(a.ton, 'ostrzezenie');
  const moj = alertNowychDokumentow({ tender, nowe, teraz, wybor, nipKonta: '6871977540' });
  assert.match(moj.tresc.pl, /\(1\)\. Wybrano Twoją ofertę — gratulacje! Informacja/);
  assert.equal(moj.ton, 'sukces');
});
