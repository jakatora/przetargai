import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Adapter platformazakupowa.pl — podzadanie 4/7 ulepszenia „Radar zamówień
 * podprogowych (poniżej 170 tys. zł)". Test MAPOWANIA surowego wpisu z fixture HTML
 * na rekord (kontrakt + parsowanie listingu + normalizacja + kontraktowe pobierz).
 *
 * Fixture jest wierny wobec żywego listingu (2026-07-27, WebFetch
 * https://platformazakupowa.pl/all?query=…): karty z kotwicą `/transakcja/<ID>`
 * (tytuł), kupującym linkującym do `/pn/<slug>` i terminem PL „DD-MM-YYYY HH:MM:SS"
 * („Postępowanie trwające:" / „Termin składania ofert"). Listing nie podaje wartości
 * (druga karta zawiera jawne „Wartość szacunkowa: … zł" jako wariant, który UMIEMY
 * odczytać, gdy się pojawi).
 */

const pz = await import('../src/services/adaptery/platformaZakupowa.js');
const { wyodrebnijListe, mapujKarte, pobierz, adapter } = pz;
const { normalizujPodprogowe } = await import('../src/lib/normalizacjaPodprogowe.js');

const HTML = `
<div class="offers">
  <div class="offer-item">
    <a class="company-logo" href="/pn/41blsz"><img src="/logo1.png" alt="logo"></a>
    <h3 class="title"><a href="/transakcja/1340089/25-26-p-roboty-budowlane">25/26/P Roboty budowlane w Dęblinie</a></h3>
    <div class="buyer"><a href="/pn/41blsz">41 Baza Lotnictwa Szkolnego</a></div>
    <div class="status">Postępowanie trwające: 05-08-2026 12:00:00</div>
  </div>
  <div class="offer-item">
    <a class="company-logo" href="/pn/gmina-przyklad"><img src="/logo2.png" alt="logo"></a>
    <h3 class="title"><a href="/transakcja/1340090/dostawa-materialow-biurowych">ZP.2/2026 Dostawa materiałów biurowych</a></h3>
    <div class="buyer"><a href="/pn/gmina-przyklad">Gmina Przykład</a></div>
    <div class="value">Wartość szacunkowa: 150&nbsp;000,00 zł</div>
    <div class="status">Termin składania ofert: 12-08-2026 10:00:00</div>
  </div>
</div>
`;

// ── Kontrakt ─────────────────────────────────────────────────────────────────

test('kontrakt: adapter platformazakupowa spełnia interfejs (zrodlo + pobierz)', () => {
  assert.equal(adapter.zrodlo, 'platformazakupowa');
  assert.equal(typeof adapter.pobierz, 'function');
});

// ── Mapowanie fixture HTML → surowe ──────────────────────────────────────────

test('wyodrebnijListe: parsuje karty listingu na surowe ogłoszenia', () => {
  const surowe = wyodrebnijListe(HTML);
  assert.equal(surowe.length, 2);

  const a = surowe[0];
  assert.equal(a.zrodlo, 'platformazakupowa');
  assert.equal(a.id_zewnetrzny, '1340089');
  assert.match(a.tytul, /^25\/26\/P Roboty budowlane w Dęblinie$/);
  assert.equal(a.zamawiajacy, '41 Baza Lotnictwa Szkolnego');
  assert.equal(a.termin_skladania, '2026-08-05T12:00:00');
  assert.equal(a.wartosc_netto, null, 'listing zwykle nie podaje wartości');
  assert.equal(a.link, 'https://platformazakupowa.pl/transakcja/1340089/25-26-p-roboty-budowlane');
  assert.equal(a.waluta, 'PLN');

  const b = surowe[1];
  assert.equal(b.id_zewnetrzny, '1340090');
  assert.equal(b.zamawiajacy, 'Gmina Przykład');
  assert.equal(b.termin_skladania, '2026-08-12T10:00:00');
  assert.equal(b.wartosc_netto, 150000, 'jawne „Wartość szacunkowa: 150 000,00 zł" odczytane');
});

test('mapujKarte: zdejmuje tagi z tytułu i buduje link bezwzględny', () => {
  const s = mapujKarte({ sciezka: '/transakcja/999/test', id: '999', tytul: '<b>Test</b> zamówienia', blok: '' });
  assert.equal(s.tytul, 'Test zamówienia');
  assert.equal(s.link, 'https://platformazakupowa.pl/transakcja/999/test');
  assert.equal(s.zamawiajacy, null);
  assert.equal(s.termin_skladania, null);
});

test('wyodrebnijListe: pusty/niepoprawny HTML → [] (bez wyjątku)', () => {
  assert.deepEqual(wyodrebnijListe(''), []);
  assert.deepEqual(wyodrebnijListe(null), []);
  assert.deepEqual(wyodrebnijListe('<div>brak ogłoszeń</div>'), []);
});

// ── Mapowanie → ZNORMALIZOWANY rekord (rdzeń podzadania) ──────────────────────

test('HTML→rekord: karta z wartością 150 000 zł kwalifikuje się jako podprogowa', () => {
  const surowe = wyodrebnijListe(HTML)[1];
  const { rekord, kwalifikujeSie } = normalizujPodprogowe(surowe, {});
  assert.equal(kwalifikujeSie, true);
  assert.equal(rekord.zrodlo, 'platformazakupowa');
  assert.equal(rekord.wartosc_netto, 150000);
  assert.equal(rekord.latwiejszy_start, true, 'brak wadium/KIO/Pzp w treści → łatwiejszy start');
  assert.equal(typeof rekord.hash_dedup, 'string');
  assert.ok(rekord.hash_dedup.length > 0);
});

test('HTML→rekord: karta bez wartości NIE kwalifikuje się (brak podstawy do oceny progu)', () => {
  const surowe = wyodrebnijListe(HTML)[0];
  const { kwalifikujeSie, powod } = normalizujPodprogowe(surowe, {});
  assert.equal(kwalifikujeSie, false);
  assert.match(powod, /brak warto/i);
});

// ── Kontraktowe pobierz() z wstrzykniętym transportem ─────────────────────────

test('pobierz: przekazuje frazę i mapuje treść HTML na surowe[]', async () => {
  let widzianaFraza = null;
  const surowe = await pobierz('roboty budowlane', 'zachodniopomorskie', {
    pobierzTresc: async (fraza) => { widzianaFraza = fraza; return HTML; },
  });
  assert.equal(widzianaFraza, 'roboty budowlane'); // branża ma pierwszeństwo nad regionem
  assert.equal(surowe.length, 2);
});

test('pobierz: pusta branża i region → nie zmyśla zapytania, zwraca []', async () => {
  let dotkniete = false;
  const surowe = await pobierz('', '', { pobierzTresc: async () => { dotkniete = true; return HTML; } });
  assert.equal(surowe.length, 0);
  assert.equal(dotkniete, false);
});
