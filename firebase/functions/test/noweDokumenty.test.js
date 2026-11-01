import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rodzajDokumentu, noweDokumenty, alertNowychDokumentow } from '../src/lib/noweDokumenty.js';

/*
 * Nowe dokumenty w zapisanym przetargu (2026-11-01). Nazwy plików — prawdziwe z e-Zamówień
 * (postępowania BZP z terminem 2–5.11.2026).
 */
test('rodzaj dokumentu po nazwie (prawdziwe nazwy z e-Zamówień)', () => {
  const r = (nazwa) => rodzajDokumentu({ nazwa });
  assert.deepEqual(['Wyjaśnienie treści SWZ z dnia 30.10.2026r', 'Odpowiedź na pytania Wykonawcy', 'Odpowiedzi na pytania', 'odpowiedź na zapytanie'].map(r), ['wyjasnienia', 'wyjasnienia', 'wyjasnienia', 'wyjasnienia']);
  assert.deepEqual(['Modyfikacja nr 1', 'ZP_5_2025_AKTUALIZACJA_DOKUMENÓWY_ZAMÓWIENIA', 'Zmiana treści SWZ'].map(r), ['zmiana', 'zmiana', 'zmiana']);
  assert.deepEqual(['Informacja z otwarcia ofert', 'Kwota jaką zamawiający zamierza przeznaczyć', 'Zawiadomienie o wyborze najkorzystniejszej oferty'].map(r), ['otwarcie', 'otwarcie', 'rozstrzygniecie']);
  assert.deepEqual(['Specyfikacja Warunków Zamówienia', 'Zał. nr 1 do SWZ - Formularz ofertowy', 'Ogłoszenie o zamówieniu'].map(r), ['inne', 'inne', 'inne']);
});

test('co jest nowe: pierwszy raz — opublikowane po zapisaniu; potem — nieznane id', () => {
  const dok = [
    { id: 'ocds-1_1', nazwa: 'SWZ', opublikowano: '2026-10-14T10:00:00Z' },
    { id: 'ocds-1_2', nazwa: 'Wyjaśnienia treści SWZ nr 1', opublikowano: '2026-10-29T12:00:00Z' },
  ];
  assert.deepEqual(noweDokumenty(dok, { zapisanoO: '2026-10-20T08:00:00Z' }).map((d) => d.id), ['ocds-1_2']);
  assert.deepEqual(noweDokumenty(dok, { znane: ['ocds-1_1', 'ocds-1_2'] }), []);
  assert.deepEqual(noweDokumenty([...dok, { id: 'ocds-1_3', nazwa: 'Modyfikacja nr 1' }], { znane: ['ocds-1_1', 'ocds-1_2'] }).map((d) => d.id), ['ocds-1_3']);
  assert.deepEqual(noweDokumenty(dok, {}), [], 'bez znanej listy i daty zapisu — nic (nie alarmujemy o całej dokumentacji)');
});

test('alert: zmiana i wyjaśnienia są pilne, otwarcie ofert — „zobacz ceny konkurencji”; klucz stały', () => {
  const tender = { id: '2026~BZP_00500001~01', title: 'Remont dachu szkoły', organization: 'Gmina X', deadline: '2026-11-05T09:00:00Z' };
  const a = alertNowychDokumentow({ tender, nowe: [{ id: 'ocds-1_3', nazwa: 'Wyjaśnienia treści SWZ nr 1' }, { id: 'ocds-1_4', nazwa: 'Modyfikacja nr 1' }] });
  assert.deepEqual([a.typ, a.ton, a.klucz, a.tender_id], ['nowe_dokumenty', 'ostrzezenie', 'dok_2026~BZP_00500001~01_ocds-1_4', tender.id]);
  assert.match(a.tresc.pl, /^Zamawiający opublikował zmianę dokumentów, wyjaśnienia treści SWZ \(2\)\. Sprawdź przed złożeniem oferty/);
  const o = alertNowychDokumentow({ tender, nowe: [{ id: 'ocds-1_5', nazwa: 'Informacja z otwarcia ofert' }] });
  assert.equal(o.ton, 'neutral');
  assert.match(o.tresc.pl, /informację z otwarcia ofert \(1\)\. Zobacz, jakie ceny dali konkurenci\./);
  assert.equal(alertNowychDokumentow({ tender, nowe: [] }), null);
});
