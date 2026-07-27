import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createCzarnaSkrzynka } from '../src/services/czarnaSkrzynka.js';
import { createPakietDowodowy, wykryjAwarie } from '../src/services/pakietDowodowy.js';

/*
 * Detektor awarii + budowa PAKIETU DOWODOWEGO (podzadanie 3/7 ulepszenia „Czarna
 * skrzynka składania oferty — dowody na awarię platformy"). Gdy platforma zawiedzie,
 * pakiet musi obronić się przed KIO (ciężar udowodnienia awarii spoczywa na wykonawcy),
 * więc testujemy:
 *  1. DETEKCJĘ TRZECH TYPÓW AWARII — błąd wysyłki, brak potwierdzenia EPO, niedostępność
 *     platformy (z jawnego wpisu logu ORAZ z wyników cyklicznego pingu monitora 2/7).
 *  2. „ZDROWĄ" sesję — brak fałszywych alarmów, gdy platforma odpowiadała (ping dostępny).
 *  3. KOMPLETNOŚĆ MANIFESTU — pakiet spina zrzuty + pełny przebieg sesji + hash oferty +
 *     wyniki dostępności; nic z dowodów nie ginie.
 *  4. SUMĘ KONTROLNĄ CAŁOŚCI — manifest jest tamper-evident: zmiana jakiegokolwiek dowodu
 *     zmienia sumę kontrolną pakietu.
 *  5. IZOLACJĘ PO user_id — pakietu cudzej sesji nie da się zbudować.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');
const migracjaSql = fs.readFileSync(
  path.join(__dirname, '../src/db/migrations/011_czarna_skrzynka.sql'),
  'utf8',
);

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  d.exec(migracjaSql);
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u1','a@b.pl','h','t','t')").run();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES ('u2','c@d.pl','h','t','t')").run();
  return d;
}

function magazynPamiec() {
  const store = new Map();
  return {
    async zapisz(id, format, bajty) {
      store.set(id, Buffer.from(bajty));
      return `mem://${id}.${format}`;
    },
    _store: store,
  };
}

const ZEGAR = { teraz: () => '2026-07-27T10:00:00.000Z', strefa: () => 'Europe/Warsaw' };

function fabrykaSkrzynki(d) {
  return createCzarnaSkrzynka(d, { magazynPlikow: magazynPamiec(), zegar: ZEGAR });
}

// Zdarzenie „logu" na potrzeby czystych testów detekcji (kształt jak wiersz z DB).
function zd(typ, opis, i = 1) {
  return { id: i, typ, opis, plik_url: null, czas_serwera: '2026-07-27T10:00:00.000Z', strefa_czasowa: 'Europe/Warsaw' };
}

// ══════════════════════════ 1. DETEKCJA TRZECH TYPÓW AWARII ═══════════════════

test('wykryjAwarie — wykrywa BŁĄD WYSYŁKI oferty', () => {
  const w = wykryjAwarie({ zdarzenia: [zd('krok', 'Wgrano plik'), zd('blad_wysylki', 'HTTP 500 przy wysyłce', 2)] });
  assert.equal(w.awaria, true);
  assert.deepEqual(w.typy, ['blad_wysylki']);
  assert.equal(w.powody.length, 1);
  assert.equal(w.powody[0].typ, 'blad_wysylki');
  assert.match(w.powody[0].opis, /HTTP 500/);
});

test('wykryjAwarie — wykrywa BRAK POTWIERDZENIA EPO', () => {
  const w = wykryjAwarie({ zdarzenia: [zd('krok', 'Wysłano ofertę'), zd('brak_epo', 'Nie otrzymano EPO w 15 min', 2)] });
  assert.equal(w.awaria, true);
  assert.deepEqual(w.typy, ['brak_epo']);
  assert.equal(w.powody[0].typ, 'brak_epo');
});

test('wykryjAwarie — wykrywa NIEDOSTĘPNOŚĆ z jawnego wpisu logu', () => {
  const w = wykryjAwarie({ zdarzenia: [zd('niedostepnosc', 'Strona nie ładuje się', 1)] });
  assert.equal(w.awaria, true);
  assert.deepEqual(w.typy, ['niedostepnosc']);
});

test('wykryjAwarie — wykrywa NIEDOSTĘPNOŚĆ z wyniku pingu monitora (real zapiszPing)', () => {
  const d = freshDb();
  const cs = fabrykaSkrzynki(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  // Ping producenta z kroku 2/7 zapisuje wynik jako tekst — detektor musi go rozumieć.
  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: null, czasMs: 8000, dostepna: false });

  const w = wykryjAwarie({ zdarzenia: cs.zdarzenia('u1', s.id) });
  assert.equal(w.awaria, true);
  assert.deepEqual(w.typy, ['niedostepnosc']);
  assert.equal(w.powody[0].typ, 'niedostepnosc');
  assert.match(w.powody[0].opis, /NIEDOST/i);
  d.close();
});

test('wykryjAwarie — łączy wiele typów naraz, typy są unikalne i posortowane', () => {
  const w = wykryjAwarie({
    zdarzenia: [
      zd('blad_wysylki', 'e1', 1),
      zd('brak_epo', 'e2', 2),
      zd('niedostepnosc', 'e3', 3),
      zd('blad_wysylki', 'e4 (drugi)', 4),
    ],
  });
  assert.equal(w.awaria, true);
  assert.deepEqual(w.typy, ['blad_wysylki', 'brak_epo', 'niedostepnosc']);
  // Każde zdarzenie-awaria trafia do powodów (dwa błędy wysyłki => dwa powody).
  assert.equal(w.powody.filter((p) => p.typ === 'blad_wysylki').length, 2);
});

// ══════════════════════════ 2. ZDROWA SESJA — BRAK FAŁSZYWEGO ALARMU ══════════

test('wykryjAwarie — zdrowa sesja (ping dostępny, same kroki) => brak awarii', () => {
  const d = freshDb();
  const cs = fabrykaSkrzynki(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Otwarto platformę' });
  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: 200, czasMs: 120, dostepna: true });

  const w = wykryjAwarie({ zdarzenia: cs.zdarzenia('u1', s.id) });
  assert.equal(w.awaria, false);
  assert.deepEqual(w.typy, []);
  assert.deepEqual(w.powody, []);
  d.close();
});

test('wykryjAwarie — akceptuje też goły masyw zdarzeń i pustą/nieokreśloną sesję', () => {
  assert.equal(wykryjAwarie([zd('blad_wysylki', 'x')]).awaria, true);
  assert.equal(wykryjAwarie({ zdarzenia: [] }).awaria, false);
  assert.equal(wykryjAwarie().awaria, false);
  assert.equal(wykryjAwarie(null).awaria, false);
});

// ══════════════════════════ 3. KOMPLETNOŚĆ MANIFESTU ═════════════════════════

async function sesjaZDowodami(d) {
  const cs = fabrykaSkrzynki(d);
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Otwarto platformę' });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await cs.zapiszZrzut('u1', s.id, `data:image/png;base64,${png.toString('base64')}`, { opis: 'Ekran 11:58' });
  await cs.zapiszZrzut('u1', s.id, `data:image/png;base64,${png.toString('base64')}`, { opis: 'Ekran 11:59' });

  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: 200, czasMs: 100, dostepna: true });
  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: null, czasMs: 9000, dostepna: false });

  const oferta = Buffer.from('<Oferta><Cena>123456.78</Cena></Oferta>', 'utf8');
  await cs.zapiszOferte('u1', s.id, oferta.toString('base64'), { nazwaPliku: 'oferta.xml' });

  cs.dopiszZdarzenie('u1', s.id, { typ: 'blad_wysylki', opis: 'HTTP 500 przy wysyłce' });

  const ofertaHash = cs.hashPliku(oferta);
  return { cs, sesjaId: s.id, ofertaHash };
}

test('zbudujPakiet — manifest spina WSZYSTKIE dowody (zrzuty, przebieg, ping, hash oferty)', async () => {
  const d = freshDb();
  const { cs, sesjaId, ofertaHash } = await sesjaZDowodami(d);
  const pd = createPakietDowodowy(d, { skrzynka: cs, zegar: ZEGAR });

  const pakiet = pd.zbudujPakiet('u1', sesjaId);

  assert.equal(pakiet.sesjaId, sesjaId);
  assert.equal(pakiet.postepowanieId, 'p1');
  assert.equal(pakiet.strefaCzasowa, 'Europe/Warsaw');
  assert.equal(pakiet.utworzonyPakiet, '2026-07-27T10:00:00.000Z');

  // Hash oferty w pakiecie.
  assert.equal(pakiet.oferta.hash, ofertaHash);
  assert.equal(pakiet.oferta.zlozona, true);
  assert.ok(pakiet.oferta.plikUrl, 'oryginał oferty wskazany');

  // Zrzuty — oba, z lokalizacją pliku.
  assert.equal(pakiet.manifest.zrzuty.length, 2);
  for (const z of pakiet.manifest.zrzuty) assert.ok(z.plik_url, 'zrzut ma lokalizację pliku');

  // Wyniki dostępności — oba pingi, z rozpoznanym stanem dostępna/niedostępna.
  assert.equal(pakiet.manifest.dostepnosc.length, 2);
  assert.equal(pakiet.manifest.dostepnosc.filter((p) => p.dostepna === false).length, 1);
  assert.equal(pakiet.manifest.dostepnosc.filter((p) => p.dostepna === true).length, 1);

  // Pełny przebieg sesji — wszystkie zdarzenia w kolejności (krok, 2×zrzut, 2×ping, hash_oferty, blad_wysylki).
  const wszystkie = cs.zdarzenia('u1', sesjaId);
  assert.equal(pakiet.manifest.przebieg.length, wszystkie.length);
  assert.deepEqual(pakiet.manifest.przebieg.map((e) => e.typ), wszystkie.map((e) => e.typ));

  // Liczby w manifeście spójne z zawartością.
  assert.equal(pakiet.manifest.liczby.zrzuty, 2);
  assert.equal(pakiet.manifest.liczby.pingi, 2);
  assert.equal(pakiet.manifest.liczby.zdarzenia, wszystkie.length);

  // Detekcja awarii wbudowana w pakiet (błąd wysyłki + niedostępny ping).
  assert.equal(pakiet.awaria.awaria, true);
  assert.deepEqual(pakiet.awaria.typy, ['blad_wysylki', 'niedostepnosc']);
  d.close();
});

// ══════════════════════════ 4. SUMA KONTROLNA CAŁOŚCI ════════════════════════

test('zbudujPakiet — suma kontrolna całości weryfikuje się i wykrywa manipulację', async () => {
  const d = freshDb();
  const { cs, sesjaId } = await sesjaZDowodami(d);
  const pd = createPakietDowodowy(d, { skrzynka: cs, zegar: ZEGAR });

  const pakiet = pd.zbudujPakiet('u1', sesjaId);
  assert.match(pakiet.sumaKontrolna, /^[0-9a-f]{64}$/, 'SHA-256 hex całości');

  // Weryfikacja: suma liczona z treści bez pola sumaKontrolna daje tę samą wartość.
  const { sumaKontrolna, ...tresc } = pakiet;
  const przeliczona = crypto.createHash('sha256').update(JSON.stringify(tresc), 'utf8').digest('hex');
  assert.equal(przeliczona, sumaKontrolna, 'suma kontrolna deterministyczna i policzona z treści pakietu');

  // Manipulacja dowodem (podmiana hasha oferty) => inna suma kontrolna.
  const zmieniona = { ...tresc, oferta: { ...tresc.oferta, hash: 'deadbeef' } };
  const poManipulacji = crypto.createHash('sha256').update(JSON.stringify(zmieniona), 'utf8').digest('hex');
  assert.notEqual(poManipulacji, sumaKontrolna, 'zmiana dowodu zmienia sumę kontrolną');

  // Determinizm: drugi build tej samej sesji daje tę samą sumę.
  const pakiet2 = pd.zbudujPakiet('u1', sesjaId);
  assert.equal(pakiet2.sumaKontrolna, pakiet.sumaKontrolna);
  d.close();
});

// ══════════════════════════ 5. IZOLACJA PO user_id ═══════════════════════════

test('zbudujPakiet — nie zbuduje pakietu cudzej sesji (izolacja po user_id)', async () => {
  const d = freshDb();
  const { cs, sesjaId } = await sesjaZDowodami(d);
  const pd = createPakietDowodowy(d, { skrzynka: cs, zegar: ZEGAR });

  assert.throws(() => pd.zbudujPakiet('u2', sesjaId), /sesj/i);
  d.close();
});
