import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Adapter e-ProPublico (e-propublico.pl) — podzadanie 4/7 ulepszenia „Radar
 * zamówień podprogowych (poniżej 170 tys. zł)". Test MAPOWANIA surowego wpisu z
 * fixture HTML (tabela ogłoszeń) na rekord: parser NAGŁÓWEK-sterowany (mapuje
 * kolumny po etykietach `<th>`, więc jest odporny na zmianę ich kolejności),
 * fallback pozycyjny bez `<thead>`, tytuł + link z kotwicy szczegółów, oraz
 * normalizacja (próg 170k) i kontraktowe pobierz.
 */

const ep = await import('../src/services/adaptery/epropublico.js');
const { wyodrebnijListe, wyodrebnijWiersze, mapujWiersz, pobierz, adapter } = ep;
const { normalizujPodprogowe } = await import('../src/lib/normalizacjaPodprogowe.js');

// Kolumny w innej niż domyślna kolejności — sprawdza mapowanie po nagłówkach.
const HTML = `
<table class="ogloszenia">
  <thead>
    <tr><th>Nr</th><th>Przedmiot zamówienia</th><th>Zamawiający</th><th>Termin składania ofert</th><th>Wartość szacunkowa</th><th>Województwo</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>2/2026</td>
      <td><a href="/Ogloszenie/Szczegoly/abc123">Usługa sprzątania budynku administracyjnego</a></td>
      <td>Szpital Wojewódzki w Przykładowie</td>
      <td>15-08-2026 09:00</td>
      <td>90&nbsp;000,00 zł</td>
      <td>małopolskie</td>
    </tr>
    <tr>
      <td>3/2026</td>
      <td><a href="/Ogloszenie/Szczegoly/def456">Roboty remontowe dachu budynku szkoły</a></td>
      <td>Gmina Testowa</td>
      <td>2026-08-20</td>
      <td>190&nbsp;000,00 zł</td>
      <td>małopolskie</td>
    </tr>
  </tbody>
</table>
`;

// Tabela bez <thead> — sprawdza fallback na domyślną kolejność kolumn.
const HTML_BEZ_NAGLOWKA = `
<table>
  <tr>
    <td>7/2026</td>
    <td><a href="/o/xyz789">Dostawa sprzętu komputerowego</a></td>
    <td>Urząd Miasta</td>
    <td>10-09-2026 12:00</td>
    <td>50 000,00 zł</td>
  </tr>
</table>
`;

// ── Kontrakt ─────────────────────────────────────────────────────────────────

test('kontrakt: adapter e-ProPublico spełnia interfejs (zrodlo + pobierz)', () => {
  assert.equal(adapter.zrodlo, 'epropublico');
  assert.equal(typeof adapter.pobierz, 'function');
});

// ── Mapowanie fixture HTML → surowe (nagłówek-sterowane) ─────────────────────

test('wyodrebnijListe: mapuje wiersze tabeli po nagłówkach kolumn', () => {
  const surowe = wyodrebnijListe(HTML);
  assert.equal(surowe.length, 2);

  const a = surowe[0];
  assert.equal(a.zrodlo, 'epropublico');
  assert.equal(a.id_zewnetrzny, '2/2026');
  assert.equal(a.tytul, 'Usługa sprzątania budynku administracyjnego');
  assert.equal(a.zamawiajacy, 'Szpital Wojewódzki w Przykładowie');
  assert.equal(a.termin_skladania, '2026-08-15T09:00');
  assert.equal(a.wartosc_netto, 90000);
  assert.equal(a.region, 'małopolskie');
  assert.equal(a.link, 'https://e-propublico.pl/Ogloszenie/Szczegoly/abc123');
  assert.equal(a.waluta, 'PLN');

  const b = surowe[1];
  assert.equal(b.id_zewnetrzny, '3/2026');
  assert.equal(b.tytul, 'Roboty remontowe dachu budynku szkoły');
  assert.equal(b.termin_skladania, '2026-08-20');
  assert.equal(b.wartosc_netto, 190000);
});

test('wyodrebnijListe: fallback pozycyjny, gdy tabela nie ma <thead>', () => {
  const surowe = wyodrebnijListe(HTML_BEZ_NAGLOWKA);
  assert.equal(surowe.length, 1);
  const s = surowe[0];
  assert.equal(s.id_zewnetrzny, '7/2026');
  assert.equal(s.tytul, 'Dostawa sprzętu komputerowego');
  assert.equal(s.zamawiajacy, 'Urząd Miasta');
  assert.equal(s.termin_skladania, '2026-09-10T12:00');
  assert.equal(s.wartosc_netto, 50000);
  assert.equal(s.link, 'https://e-propublico.pl/o/xyz789');
});

test('mapujWiersz: identyfikator z linku, gdy brak kolumny numeru', () => {
  const wiersz = {
    naglowki: [null, 'tytul'],
    komorki: [
      { tekst: '', link: null, tekstLinku: null },
      { tekst: 'Modernizacja oświetlenia', link: '/Ogloszenie/Szczegoly/zzz999', tekstLinku: 'Modernizacja oświetlenia' },
    ],
  };
  const s = mapujWiersz(wiersz);
  assert.equal(s.id_zewnetrzny, 'zzz999');
  assert.equal(s.tytul, 'Modernizacja oświetlenia');
});

test('wyodrebnijWiersze: pusty/niepoprawny HTML → [] (bez wyjątku)', () => {
  assert.deepEqual(wyodrebnijWiersze(''), []);
  assert.deepEqual(wyodrebnijWiersze(null), []);
  assert.deepEqual(wyodrebnijListe('<p>brak ogłoszeń</p>'), []);
});

// ── Mapowanie → ZNORMALIZOWANY rekord ────────────────────────────────────────

test('HTML→rekord: 90 000 zł kwalifikuje się; 190 000 zł jest nadprogowe', () => {
  const [a, b] = wyodrebnijListe(HTML);
  const na = normalizujPodprogowe(a, {});
  assert.equal(na.kwalifikujeSie, true);
  assert.equal(na.rekord.zrodlo, 'epropublico');
  assert.equal(na.rekord.wartosc_netto, 90000);

  const nb = normalizujPodprogowe(b, {});
  assert.equal(nb.kwalifikujeSie, false);
});

test('HTML→rekord: dopasowanie regionu z kolumny „Województwo"', () => {
  const a = wyodrebnijListe(HTML)[0];
  const dopasowany = normalizujPodprogowe(a, { region: 'małopolskie' });
  assert.equal(dopasowany.dopasowanie.region, true);
  const niedopasowany = normalizujPodprogowe(a, { region: 'pomorskie' });
  assert.equal(niedopasowany.dopasowanie.region, false);
});

// ── Kontraktowe pobierz() ─────────────────────────────────────────────────────

test('pobierz: z wstrzykniętym transportem mapuje HTML na surowe[]', async () => {
  const surowe = await pobierz('sprzątanie', '', { pobierzTresc: async () => HTML });
  assert.equal(surowe.length, 2);
});

test('pobierz: bez EPROPUBLICO_SEARCH_PATH (domyślny transport) świadomie zwraca []', async () => {
  const surowe = await pobierz('usługi', '');
  assert.deepEqual(surowe, []);
});

test('pobierz: pusta branża i region → []', async () => {
  const surowe = await pobierz('', '', { pobierzTresc: async () => HTML });
  assert.deepEqual(surowe, []);
});
