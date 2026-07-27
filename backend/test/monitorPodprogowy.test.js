import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/*
 * Monitor zamówień podprogowych (ulepszenie „Radar zamówień podprogowych — poniżej
 * 170 tys. zł", podzadanie 6/7).
 *
 * `odswiezPreferencje` (jedna preferencja: adaptery → normalizacja → upsert → domówienie
 * regulaminów) i `runPodprogowyMonitor` (przelot po wszystkich preferencjach).
 *
 * Testy BEZ sieci i BEZ płatnego AI — wstrzykujemy atrapy adapterów i usługi regulaminu.
 * Repo ogłoszeń stawiamy na bazie w pamięci z samej migracji 009 (bez cudzego WIP z
 * schema.sql). Krytyczna asercja ścieżki pieniędzy: regulamin (płatne AI) odpalany
 * WYŁĄCZNIE dla NOWO dodanych ogłoszeń — kolejny cykl (dedup) go nie woła.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-monitor-podprog-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE; // tylko po to, by import modułów nie ruszył prod-bazy
process.env.ANTHROPIC_API_KEY = '';
process.env.RESEND_API_KEY = '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_009 = fs.readFileSync(path.join(__dirname, '../src/db/migrations/009_radar_podprogowy.sql'), 'utf8');

const { createPodprogoweRepo } = await import('../src/db/podprogoweRepo.js');
const { odswiezPreferencje, runPodprogowyMonitor } = await import('../src/jobs/monitorPodprogowy.js');
const { db } = await import('../src/db/index.js');

after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

/** Baza w pamięci tylko z tabelami podprogowymi (FK do users nieistotny). */
function repoWPamieci() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = OFF;');
  d.exec(MIG_009);
  return { d, repo: createPodprogoweRepo(d) };
}

/** Atrapa adaptera zwracająca zadane surowe ogłoszenia. */
function fakeAdapter(zrodlo, surowe) {
  return { zrodlo, pobierz: async () => surowe };
}

/** Surowe „bip" ogłoszenie kwalifikujące się (bip nie ma dolnej granicy). */
function surowe({ id, tytul = 'Dostawa materiałów biurowych', wartosc = 50000, zamawiajacy = 'Gmina Testowa', link, region = 'mazowieckie' }) {
  return {
    zrodlo: 'bip',
    id_zewnetrzny: String(id),
    tytul,
    zamawiajacy,
    wartosc_netto: wartosc,
    region,
    link: link ?? `https://bip.gmina.pl/ogloszenie/${id}`,
    opis: 'Zapytanie ofertowe, oferty składane pisemnie, bez wadium.',
  };
}

/** Atrapa usługi regulaminu: liczy wywołania, opcjonalnie utrwala URL na rekordzie. */
function fakeUzupelnij({ zapisuj = true } = {}) {
  const wywolania = [];
  const fn = async ({ znalezisko, repo }) => {
    wywolania.push(znalezisko.id);
    const url = `https://bip.example/reg-${znalezisko.id_zewnetrzny}.pdf`;
    if (zapisuj) repo.ustawRegulamin(znalezisko.id, { regulamin_url: url, regulamin_streszczenie: 'Oferta pisemna, bez wadium.' });
    return { ...znalezisko, regulamin_url: url };
  };
  fn.wywolania = wywolania;
  return fn;
}

test('odswiezPreferencje — upsertuje kwalifikujące się i domawia regulamin dla każdego NOWEGO', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = fakeUzupelnij();
  const adaptery = [
    fakeAdapter('bip', [surowe({ id: 1 }), surowe({ id: 2 })]),
    fakeAdapter('platformazakupowa', [{ zrodlo: 'platformazakupowa', id_zewnetrzny: '9', tytul: 'Naprawa dachu', wartosc_netto: 90000, region: 'mazowieckie', link: 'https://platformazakupowa.pl/t/9', opis: 'zapytanie' }]),
  ];

  const wynik = await odswiezPreferencje({ pref: { branza: '', region: '', prog_netto: 170000 }, repo, adaptery, uzupelnij });

  assert.equal(wynik.dodano, 3, 'trzy nowe ogłoszenia dodane');
  assert.equal(wynik.regulaminy, 3, 'regulamin domówiony dla każdego nowego');
  assert.equal(uzupelnij.wywolania.length, 3, 'usługa regulaminu wołana raz na nowe ogłoszenie');
  assert.equal(repo.count(), 3);
  d.close();
});

test('odswiezPreferencje — kolejny cykl (dedup) NIE woła płatnego regulaminu ponownie', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = fakeUzupelnij();
  const adaptery = [fakeAdapter('bip', [surowe({ id: 1 }), surowe({ id: 2 })])];
  const pref = { branza: '', region: '', prog_netto: 170000 };

  const w1 = await odswiezPreferencje({ pref, repo, adaptery, uzupelnij });
  assert.equal(w1.dodano, 2);
  assert.equal(uzupelnij.wywolania.length, 2);

  // Drugi przebieg tych samych ogłoszeń: dedup po hash_dedup => 0 nowych, 0 wywołań AI.
  const w2 = await odswiezPreferencje({ pref, repo, adaptery, uzupelnij });
  assert.equal(w2.dodano, 0, 'nic nowego w drugim cyklu');
  assert.equal(w2.regulaminy, 0);
  assert.equal(uzupelnij.wywolania.length, 2, 'płatne AI NIE wołane ponownie dla znanych ogłoszeń');
  assert.equal(repo.count(), 2, 'brak duplikatów w tabeli');
  d.close();
});

test('odswiezPreferencje — próg z preferencji odrzuca zbyt drogie (bez regulaminu)', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = fakeUzupelnij();
  const adaptery = [fakeAdapter('bip', [
    surowe({ id: 1, wartosc: 50000 }),   // < 100k → wpada
    surowe({ id: 2, wartosc: 150000 }),  // ≥ 100k progu z pref → odrzucone
  ])];

  const wynik = await odswiezPreferencje({ pref: { branza: '', region: '', prog_netto: 100000 }, repo, adaptery, uzupelnij });
  assert.equal(wynik.dodano, 1, 'tylko poniżej progu preferencji');
  assert.equal(uzupelnij.wywolania.length, 1, 'regulamin tylko dla zakwalifikowanego');
  assert.equal(repo.count(), 1);
  d.close();
});

test('odswiezPreferencje — błąd jednego adaptera nie przerywa pozostałych', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = fakeUzupelnij();
  const padajacy = { zrodlo: 'ezamawiajacy', pobierz: async () => { throw new Error('źródło down'); } };
  const adaptery = [padajacy, fakeAdapter('bip', [surowe({ id: 1 })])];

  const wynik = await odswiezPreferencje({ pref: { branza: '', region: '' }, repo, adaptery, uzupelnij });
  assert.equal(wynik.dodano, 1, 'dobre źródło i tak przeszło');
  const padniete = wynik.zrodla.find((z) => z.zrodlo === 'ezamawiajacy');
  assert.ok(padniete?.blad, 'padnięte źródło raportowane z błędem');
  d.close();
});

test('odswiezPreferencje — błąd domówienia regulaminu nie wywala ogłoszenia', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = async () => { throw new Error('AI down'); };
  const adaptery = [fakeAdapter('bip', [surowe({ id: 1 })])];

  const wynik = await odswiezPreferencje({ pref: { branza: '', region: '' }, repo, adaptery, uzupelnij });
  assert.equal(wynik.dodano, 1, 'ogłoszenie zapisane mimo błędu regulaminu');
  assert.equal(wynik.regulaminy, 0, 'regulamin nie doszedł');
  assert.equal(repo.count(), 1);
  d.close();
});

test('runPodprogowyMonitor — przelatuje wszystkie preferencje i izoluje błąd jednej', async () => {
  const { d, repo } = repoWPamieci();
  const uzupelnij = fakeUzupelnij();
  const adaptery = [fakeAdapter('bip', [surowe({ id: 1 }), surowe({ id: 2 })])];

  // Fałszywe prefRepo: dwie preferencje, jedna „psuje" przebieg (null → TypeError w odswiezPreferencje).
  const prefRepo = {
    listAll: () => [
      { id: 'p1', branza: '', region: '', prog_netto: 170000 },
      null, // wymusi błąd — sprawdzamy izolację
    ],
  };

  const wynik = await runPodprogowyMonitor({ repo, prefRepo, adaptery, uzupelnij });
  assert.equal(wynik.ok, true);
  assert.equal(wynik.preferencje, 2);
  assert.equal(wynik.dodano, 2, 'dobra preferencja dodała ogłoszenia');
  assert.equal(wynik.bledy, 1, 'zła preferencja policzona jako błąd, nie wywróciła przebiegu');
  d.close();
});
