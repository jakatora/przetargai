import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Adapter eZamawiający (Marketplanet, zakładka „postępowania wyłączone z Pzp") —
 * podzadanie 4/7 ulepszenia „Radar zamówień podprogowych (poniżej 170 tys. zł)".
 * Test MAPOWANIA surowego wiersza gridu z fixture JSON na rekord + defensywne
 * wyciąganie wierszy z różnych kopert + ścieżka adapter → normalizacja → upsert.
 *
 * Fixture odwzorowuje typową kopertę gridu (`{ Data: [...] }`) z polami
 * spotykanymi na tych platformach; wartość „WartoscSzacunkowa" (format PL) i „Tryb"
 * („wyłączone spod ustawy Pzp") — istotne dla progu i flag „łatwiejszego startu".
 */

const ez = await import('../src/services/adaptery/ezamawiajacy.js');
const { wyodrebnijWiersze, mapujWiersz, wyodrebnijListe, pobierz, adapter } = ez;
const { normalizujPodprogowe } = await import('../src/lib/normalizacjaPodprogowe.js');
const { utworzAdapter } = await import('../src/services/adaptery/kontrakt.js');
const { zbierzIWepnij } = await import('../src/services/adaptery/scalPodprogowe.js');
const { createPodprogoweRepo } = await import('../src/db/podprogoweRepo.js');

const WIERSZ_A = {
  Id: 88123,
  Numer: 'ZP.271.15.2026',
  Nazwa: 'Dostawa artykułów biurowych na potrzeby Urzędu',
  Zamawiajacy: 'Gmina Miasto Przykład',
  Tryb: 'Postępowanie wyłączone spod stosowania ustawy Pzp',
  TerminSkladaniaOfert: '2026-08-12T10:00:00',
  DataPublikacji: '2026-07-25T08:00:00',
  Wojewodztwo: 'wielkopolskie',
  WartoscSzacunkowa: '120 000,00',
  Url: '/servlet/HomeServlet?MP_module=main&MP_action=publicFilesList&iPrzetargId=88123',
};
const WIERSZ_B = {
  Id: 88124,
  Nazwa: 'Budowa parkingu przy szkole podstawowej',
  Zamawiajacy: 'Powiat Przykładowy',
  Tryb: 'Postępowanie wyłączone spod ustawy Pzp',
  TerminSkladania: '2026-08-20 09:00',
  Wojewodztwo: 'wielkopolskie',
  WartoscSzacunkowa: '250000,00',
  Url: 'https://xyz.ezamawiajacy.pl/pn/xyz/88124',
};
const FIXTURE = { Data: [WIERSZ_A, WIERSZ_B], Total: 2 };

// ── Kontrakt ─────────────────────────────────────────────────────────────────

test('kontrakt: adapter eZamawiający spełnia interfejs (zrodlo + pobierz)', () => {
  assert.equal(adapter.zrodlo, 'ezamawiajacy');
  assert.equal(typeof adapter.pobierz, 'function');
});

// ── Defensywne wyciąganie wierszy z różnych kopert ───────────────────────────

test('wyodrebnijWiersze: obsługuje { Data }, { d: { results } }, gołą tablicę', () => {
  assert.equal(wyodrebnijWiersze(FIXTURE).length, 2);
  assert.equal(wyodrebnijWiersze({ d: { results: [WIERSZ_A] } }).length, 1);
  assert.equal(wyodrebnijWiersze([WIERSZ_A, WIERSZ_B]).length, 2);
});

test('wyodrebnijWiersze: nietypowy/pusty kształt → [] (bez wyjątku)', () => {
  assert.deepEqual(wyodrebnijWiersze(null), []);
  assert.deepEqual(wyodrebnijWiersze({}), []);
  assert.deepEqual(wyodrebnijWiersze({ Data: 'nie-tablica' }), []);
});

// ── Mapowanie wiersza JSON → surowe ──────────────────────────────────────────

test('mapujWiersz: mapuje pola gridu na surowe ogłoszenie', () => {
  const s = mapujWiersz(WIERSZ_A);
  assert.equal(s.zrodlo, 'ezamawiajacy');
  assert.equal(s.id_zewnetrzny, '88123');
  assert.equal(s.tytul, 'Dostawa artykułów biurowych na potrzeby Urzędu');
  assert.equal(s.zamawiajacy, 'Gmina Miasto Przykład');
  assert.equal(s.wartosc_netto, 120000);
  assert.equal(s.waluta, 'PLN');
  assert.equal(s.termin_skladania, '2026-08-12T10:00:00');
  assert.equal(s.data_publikacji, '2026-07-25T08:00:00');
  assert.equal(s.region, 'wielkopolskie');
  assert.equal(s.link, 'https://oneplace.marketplanet.pl/servlet/HomeServlet?MP_module=main&MP_action=publicFilesList&iPrzetargId=88123');
  assert.match(s.opis, /wyłączone spod/i, 'Tryb trafia do opisu (zasila heurystykę prostej procedury)');
});

test('mapujWiersz: alternatywne nazwy pól + termin „YYYY-MM-DD HH:MM" → ISO', () => {
  const s = mapujWiersz(WIERSZ_B);
  assert.equal(s.id_zewnetrzny, '88124');
  assert.equal(s.termin_skladania, '2026-08-20T09:00');
  assert.equal(s.link, 'https://xyz.ezamawiajacy.pl/pn/xyz/88124', 'URL bezwzględny zostaje bez zmian');
});

test('mapujWiersz: brak Id → identyfikator z parametru URL (iPrzetargId)', () => {
  const s = mapujWiersz({ Nazwa: 'Usługa', Url: '/x?iPrzetargId=99999&a=1' });
  assert.equal(s.id_zewnetrzny, '99999');
});

// ── Mapowanie → ZNORMALIZOWANY rekord ────────────────────────────────────────

test('JSON→rekord: 120 000 zł kwalifikuje się; 250 000 zł jest nadprogowe', () => {
  const a = normalizujPodprogowe(mapujWiersz(WIERSZ_A), {});
  assert.equal(a.kwalifikujeSie, true);
  assert.equal(a.rekord.zrodlo, 'ezamawiajacy');
  assert.equal(a.rekord.wartosc_netto, 120000);

  const b = normalizujPodprogowe(mapujWiersz(WIERSZ_B), {});
  assert.equal(b.kwalifikujeSie, false);
});

test('wyodrebnijListe: skrót JSON → surowe[] (przez mapujWiersz)', () => {
  const surowe = wyodrebnijListe(FIXTURE);
  assert.equal(surowe.length, 2);
  assert.equal(surowe[0].wartosc_netto, 120000);
});

// ── Kontraktowe pobierz() ─────────────────────────────────────────────────────

test('pobierz: z wstrzykniętym transportem mapuje JSON na surowe[]', async () => {
  const surowe = await pobierz('artykuły biurowe', '', { pobierzTresc: async () => FIXTURE });
  assert.equal(surowe.length, 2);
});

test('pobierz: bez EZAMAWIAJACY_SEARCH_PATH (domyślny transport) świadomie zwraca []', async () => {
  const surowe = await pobierz('dostawa', '');
  assert.deepEqual(surowe, []);
});

test('pobierz: pusta branża i region → []', async () => {
  const surowe = await pobierz('', '', { pobierzTresc: async () => FIXTURE });
  assert.deepEqual(surowe, []);
});

// ── Ścieżka: adapter → normalizacja → upsert z dedupem po hash_dedup ──────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_009 = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/009_radar_podprogowy.sql'),
  'utf8',
);

test('ścieżka: upsert kwalifikujących się, dedup, odrzucenie nadprogowych', async () => {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = OFF;');
  d.exec(MIG_009);
  const repo = createPodprogoweRepo(d);

  const fakeAdapter = utworzAdapter({
    zrodlo: 'ezamawiajacy',
    pobierz: async () => [
      mapujWiersz(WIERSZ_A),  // 120k → kwalifikuje się
      mapujWiersz(WIERSZ_A),  // ten sam → duplikat (hash_dedup)
      mapujWiersz(WIERSZ_B),  // 250k → nadprogowe (odrzucone)
    ],
  });

  const p = await zbierzIWepnij({ adapter: fakeAdapter, repo });
  assert.equal(p.pobrano, 3);
  assert.equal(p.zakwalifikowano, 2);
  assert.equal(p.dodano, 1);
  assert.equal(p.duplikaty, 1);
  assert.equal(p.odrzucono, 1);
  assert.equal(repo.count(), 1);
  d.close();
});
