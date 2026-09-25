import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizujOgloszenie, ogloszenieZKalendarza, ogloszenieZAlertu, ogloszenieZRadaru,
} from '../src/lib/skrotOgloszenia.js';
import { metryczkaZrodla, etykietaOtwarciaOgloszenia, linkDoOryginalu } from '../src/lib/zrodlaDanych.js';
import { opisAlertu } from '../src/lib/centrumAlertow.js';
import { ulozKalendarz } from '../src/lib/kalendarzPrzetargu.js';

/*
 * Ekran „Ogłoszenie" (KatalogDetail) otwierany SPOZA katalogu (2026-09-25, P1).
 *
 * Kalendarz, centrum alertów i radar planów przekazywały okrojone `{ id, title }`
 * (kalendarz dodatkowo pod złym kluczem `source` zamiast `zrodlo`). Ekran czyta
 * `tender.zrodlo.kod` — brak = „BZP", więc ogłoszenie z TED/Bazy Konkurencyjności
 * udawało BZP, znikał przycisk „Otwórz oryginał", a termin był „nieznany", choć
 * ekran-źródło go znał. Backend nie ma trasy pojedynczego ogłoszenia z katalogu,
 * więc przekazujemy wszystko, co ekran-źródło ma, a nieznanego rejestru NIE
 * zgadujemy.
 */

// ---------- zrodlaDanych: metryczka z samego kodu ----------

test('metryczkaZrodla z kodu daje kształt katalogu: kod, etykieta, adres rejestru, brak znacznika synchronizacji', () => {
  const ted = metryczkaZrodla('ted');
  assert.equal(ted.kod, 'ted');
  assert.equal(ted.etykieta.pl, 'TED');
  assert.equal(ted.rejestr, 'https://ted.europa.eu');
  assert.equal(ted.zsynchronizowano_o, null);
  assert.equal(ted.stan, null);
  assert.equal(metryczkaZrodla('bzp').rejestr, 'https://ezamowienia.gov.pl');
  assert.equal(metryczkaZrodla('baza_konkurencyjnosci').rejestr, 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl');
  // Nieznany kod pokazujemy jaki jest — bez adresu, bez przemianowania na BZP.
  const obcy = metryczkaZrodla('platforma_x');
  assert.equal(obcy.etykieta.pl, 'platforma_x');
  assert.equal(obcy.rejestr, null);
  assert.equal(metryczkaZrodla(null), null);
  assert.equal(metryczkaZrodla(''), null);
});

test('etykieta przycisku oryginału: nieznany rejestr → neutralna, znany → nazwa rejestru', () => {
  assert.equal(etykietaOtwarciaOgloszenia({ zrodloNieznane: true, url: 'https://x' }).pl, 'Otwórz oryginał ogłoszenia');
  assert.match(etykietaOtwarciaOgloszenia({ zrodlo: metryczkaZrodla('ted') }).pl, /TED/);
  // Stary kształt (brak pola) nadal znaczy BZP — dane sprzed wielu źródeł.
  assert.match(etykietaOtwarciaOgloszenia({}).pl, /BZP/);
});

// ---------- normalizacja na ekranie ----------

test('normalizujOgloszenie: pełne ogłoszenie z katalogu przechodzi bez zmian metryczki', () => {
  const zrodlo = { kod: 'ted', etykieta: { pl: 'TED', en: 'TED' }, rejestr: 'https://ted.europa.eu', stan: 'ok', zsynchronizowano_o: '2026-09-24T10:00:00Z' };
  const t = normalizujOgloszenie({ id: 'T1', title: 'X', zrodlo, source: 'ted', url: 'https://ted/1' });
  assert.equal(t.zrodlo, zrodlo);
  assert.equal(t.zrodloNieznane, false);
  assert.equal(t.url, 'https://ted/1');
});

test('normalizujOgloszenie: stary klucz `source` / `zrodlo` jako napis → metryczka zamiast „BZP"', () => {
  const zSource = normalizujOgloszenie({ id: 'T2', title: 'Y', source: 'baza_konkurencyjnosci' });
  assert.equal(zSource.zrodlo.kod, 'baza_konkurencyjnosci');
  assert.equal(zSource.zrodloNieznane, false);
  // Bez linku do ogłoszenia przycisk prowadzi przynajmniej do właściwego rejestru.
  assert.equal(linkDoOryginalu(zSource), 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl');

  const zNapisu = normalizujOgloszenie({ id: 'T3', zrodlo: 'ted' });
  assert.equal(zNapisu.zrodlo.kod, 'ted');
});

test('normalizujOgloszenie: brak jakiejkolwiek informacji o rejestrze → jawnie nieznany (nie BZP)', () => {
  const t = normalizujOgloszenie({ id: 'T4', title: 'Z' });
  assert.equal(t.zrodlo, null);
  assert.equal(t.zrodloNieznane, true);
  assert.equal(normalizujOgloszenie(null), null);
  assert.equal(normalizujOgloszenie(undefined), null);
});

// ---------- trzy ekrany-źródła ----------

const KALENDARZ = {
  przetargi: [
    {
      tenderId: 'TED-1',
      tytul: 'Dostawa serwerów',
      zrodlo: 'ted',
      anulowany: false,
      pozycje: [
        { kod: 'pytania', at: '2026-10-01T10:00:00.000Z', znany: true, etykieta: { pl: 'Pytania', en: 'Q' } },
        { kod: 'oferty', at: '2026-10-10T10:00:00.000Z', znany: true, etykieta: { pl: 'Oferty', en: 'Bids' } },
        { kod: 'zwiazanie', at: null, znany: false, etykieta: { pl: 'Związanie', en: 'Validity' } },
      ],
    },
  ],
};

test('kalendarz: pozycja „pytania" otwiera ogłoszenie z TERMINEM SKŁADANIA i rejestrem TED', () => {
  const { grupy } = ulozKalendarz(KALENDARZ.przetargi, Date.parse('2026-09-25T00:00:00Z'), 'pl');
  const pytania = grupy.flatMap((g) => g.pozycje).find((p) => p.kod === 'pytania');
  const t = ogloszenieZKalendarza(pytania, KALENDARZ.przetargi);
  assert.equal(t.id, 'TED-1');
  assert.equal(t.title, 'Dostawa serwerów');
  assert.equal(t.deadline, '2026-10-10T10:00:00.000Z'); // termin składania, nie termin pytań
  assert.equal(t.zrodlo.kod, 'ted');
  assert.equal(t.source, undefined, 'zły klucz `source` nie wraca');
});

test('kalendarz: bez listy przetargów bierzemy datę z samej pozycji „oferty"', () => {
  const t = ogloszenieZKalendarza({ tenderId: 'B', tytulPrzetargu: 'B', zrodlo: 'bzp', kod: 'oferty', at: '2026-11-01T09:00:00.000Z' });
  assert.equal(t.deadline, '2026-11-01T09:00:00.000Z');
  const inna = ogloszenieZKalendarza({ tenderId: 'B', tytulPrzetargu: 'B', zrodlo: 'bzp', kod: 'pytania', at: '2026-10-20T09:00:00.000Z' });
  assert.equal(inna.deadline, null, 'termin pytań nie udaje terminu składania');
});

test('alert: przekazuje organizację, termin i rejestr z pozycji alertu', () => {
  const alert = opisAlertu({
    id: 'a1',
    pozycje: [{ tender_id: 'BK-9', tytul: 'Remont', organizacja: 'Gmina X', deadline: '2026-10-05T08:00:00Z', zrodlo: 'baza_konkurencyjnosci' }],
  });
  const t = ogloszenieZAlertu(alert.pozycje[0]);
  assert.deepEqual(
    { id: t.id, title: t.title, organization: t.organization, deadline: t.deadline, kod: t.zrodlo.kod },
    { id: 'BK-9', title: 'Remont', organization: 'Gmina X', deadline: '2026-10-05T08:00:00Z', kod: 'baza_konkurencyjnosci' },
  );
});

test('alert bez rejestru (np. starszy wpis) → rejestr nieznany, nie zgadujemy', () => {
  const t = normalizujOgloszenie(ogloszenieZAlertu({ tenderId: 'Q', tytul: 'Q', zrodlo: null }));
  assert.equal(t.zrodloNieznane, true);
});

test('radar planu: przekazuje link, termin, datę publikacji i zamawiającego; rejestru backend nie podaje', () => {
  const ogloszenie = {
    tender_id: 'TND-5', tytul: 'Budowa drogi', url: 'https://ezamowienia.gov.pl/x', deadline: '2026-12-01T10:00:00Z', opublikowano: '2026-09-20T00:00:00Z',
  };
  const t = normalizujOgloszenie(ogloszenieZRadaru(ogloszenie, { zamawiajacy: 'Powiat Y' }));
  assert.equal(t.id, 'TND-5');
  assert.equal(t.title, 'Budowa drogi');
  assert.equal(t.url, 'https://ezamowienia.gov.pl/x');
  assert.equal(t.deadline, '2026-12-01T10:00:00Z');
  assert.equal(t.published_at, '2026-09-20T00:00:00Z');
  assert.equal(t.organization, 'Powiat Y');
  assert.equal(t.zrodloNieznane, true);
  assert.equal(linkDoOryginalu(t), 'https://ezamowienia.gov.pl/x');
});
