import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createCzarnaSkrzynka } from '../src/services/czarnaSkrzynka.js';
import { createPakietDowodowy } from '../src/services/pakietDowodowy.js';
import {
  generujPismoOPrzedluzenie,
  opiszAwarie,
  wykazZalacznikow,
} from '../src/services/pismoOPrzedluzenie.js';

/*
 * Generator PISMA DO ZAMAWIAJĄCEGO z żądaniem przedłużenia terminu składania ofert
 * (podzadanie 4/7 ulepszenia „Czarna skrzynka składania oferty — dowody na awarię
 * platformy"). Z pakietu dowodowego (3/7) składa gotowe do wysłania pismo, które
 * musi obronić się przed KIO — ciężar udowodnienia awarii spoczywa na wykonawcy,
 * a bez utrwalonych NA BIEŻĄCO dowodów odwołanie przepada. Testujemy:
 *  1. PODSTAWIANIE DANYCH — zamawiający, postępowanie, przedmiot, wykonawca, termin
 *     trafiają do treści.
 *  2. OPIS AWARII ZE ZNACZNIKAMI CZASU — każdy powód awarii z pakietu (z jego czasem
 *     serwera i strefą) pojawia się w piśmie, z polską nazwą typu awarii.
 *  3. WYKAZ ZAŁĄCZNIKÓW — pismo wylicza utrwalone dowody (zrzuty, log dostępności,
 *     hash oferty, suma kontrolna pakietu) — to one czynią pakiet wiarygodnym.
 *  4. WZMIANKA O DOWODACH I TERMINIE + LINIA ORZECZNICZA KIO — pismo powołuje się na
 *     dowody utrwalone na bieżąco, żąda przedłużenia terminu i mówi o ciężarze dowodu.
 *  5. BRAK PUSTYCH PÓL — komplet meta => żadnych widocznych markerów `[...]`; braki
 *     meta => głośne markery i `kompletne=false` (nie ciche luki).
 *  6. BRAK WYKRYTEJ AWARII — pismo nie kłamie o awarii: gdy pakiet jej nie ma,
 *     `kompletne=false` i widoczny marker zamiast zmyślonego opisu.
 *  7. DETERMINIZM + WALIDACJA WEJŚCIA.
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

const META = {
  zamawiajacy: 'Gmina Przykładowa, ul. Ratuszowa 1, 00-001 Przykładów',
  numer_postepowania: 'ZP/12/2026',
  przedmiot_zamowienia: 'Budowa oczyszczalni ścieków',
  wykonawca: 'Instal-Bud Nowak Sp.k., NIP 5252525252',
  termin_skladania: '2026-07-27T12:00:00.000Z',
  miejscowosc: 'Przykładów',
  data_pisma: '2026-07-27',
};

/** Buduje realny pakiet dowodowy z sesji z AWARIĄ (błąd wysyłki + niedostępny ping). */
async function pakietZAwaria(d) {
  const cs = createCzarnaSkrzynka(d, { magazynPlikow: magazynPamiec(), zegar: ZEGAR });
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Otwarto platformę e-Zamówienia' });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  await cs.zapiszZrzut('u1', s.id, `data:image/png;base64,${png.toString('base64')}`, { opis: 'Ekran 11:58 z zegarem' });
  await cs.zapiszZrzut('u1', s.id, `data:image/png;base64,${png.toString('base64')}`, { opis: 'Ekran 11:59 z zegarem' });

  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: null, czasMs: 9000, dostepna: false });

  const oferta = Buffer.from('<Oferta><Cena>123456.78</Cena></Oferta>', 'utf8');
  await cs.zapiszOferte('u1', s.id, oferta.toString('base64'), { nazwaPliku: 'oferta.xml' });

  cs.dopiszZdarzenie('u1', s.id, { typ: 'blad_wysylki', opis: 'HTTP 500 przy wysyłce oferty' });

  const pd = createPakietDowodowy(d, { skrzynka: cs, zegar: ZEGAR });
  return pd.zbudujPakiet('u1', s.id);
}

/** Realny pakiet ze ZDROWEJ sesji (brak awarii) — do testu „pismo nie kłamie". */
async function pakietZdrowy(d) {
  const cs = createCzarnaSkrzynka(d, { magazynPlikow: magazynPamiec(), zegar: ZEGAR });
  const s = cs.rozpocznijSesje('u1', { postepowanieId: 'p1' });
  cs.dopiszZdarzenie('u1', s.id, { typ: 'krok', opis: 'Otwarto platformę' });
  cs.zapiszPing(s.id, { url: 'https://ezamowienia.gov.pl', kodHttp: 200, czasMs: 120, dostepna: true });
  const pd = createPakietDowodowy(d, { skrzynka: cs, zegar: ZEGAR });
  return pd.zbudujPakiet('u1', s.id);
}

// ══════════════════════════ 1. PODSTAWIANIE DANYCH ═══════════════════════════

test('generujPismoOPrzedluzenie — podstawia dane strony i postępowania do treści', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.ok(wynik.tresc.includes(META.zamawiajacy), 'zamawiający w treści');
  assert.ok(wynik.tresc.includes(META.numer_postepowania), 'numer postępowania w treści');
  assert.ok(wynik.tresc.includes(META.przedmiot_zamowienia), 'przedmiot w treści');
  assert.ok(wynik.tresc.includes(META.wykonawca), 'wykonawca w treści');
  assert.ok(wynik.tresc.includes(META.termin_skladania), 'termin składania w treści');
  assert.ok(wynik.tresc.includes(META.miejscowosc), 'miejscowość w treści');
  assert.ok(wynik.tresc.includes(META.data_pisma), 'data pisma w treści');
  d.close();
});

// ══════════════════════════ 2. OPIS AWARII ZE ZNACZNIKAMI CZASU ══════════════

test('opiszAwarie — każdy powód z pakietu jako linia z polską nazwą typu i znacznikiem czasu', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const linie = opiszAwarie(pakiet);

  assert.equal(linie.length, pakiet.awaria.powody.length, 'jedna linia na każdy powód awarii');
  assert.ok(linie.every((l) => l.includes('2026-07-27T10:00:00.000Z')), 'każda linia ma znacznik czasu serwera');
  assert.ok(linie.every((l) => l.includes('Europe/Warsaw')), 'każda linia ma strefę czasową');
  // Polskie nazwy wykrytych typów awarii (błąd wysyłki + niedostępność platformy).
  assert.ok(linie.some((l) => /błąd wysyłki/i.test(l)), 'nazwa: błąd wysyłki');
  assert.ok(linie.some((l) => /niedost[eę]pn/i.test(l)), 'nazwa: niedostępność platformy');
  d.close();
});

test('generujPismoOPrzedluzenie — opis awarii ze znacznikami czasu jest w treści pisma', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.ok(/HTTP 500 przy wysyłce oferty/.test(wynik.tresc), 'oryginalny opis błędu wysyłki');
  assert.ok(/NIEDOST/i.test(wynik.tresc), 'niedostępność platformy z pingu monitora');
  assert.ok(wynik.tresc.includes('2026-07-27T10:00:00.000Z'), 'znacznik czasu awarii w treści');
  d.close();
});

// ══════════════════════════ 3. WYKAZ ZAŁĄCZNIKÓW ═════════════════════════════

test('wykazZalacznikow — wylicza utrwalone dowody z pakietu', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const zal = wykazZalacznikow(pakiet);
  const tekst = zal.join('\n');

  assert.ok(zal.length >= 3, 'kilka pozycji załączników');
  assert.ok(/zrzut/i.test(tekst), 'zrzuty ekranu wymienione');
  assert.ok(tekst.includes('2'), 'liczba zrzutów (2) w wykazie');
  assert.ok(/dost[eę]pno/i.test(tekst), 'log dostępności platformy wymieniony');
  assert.ok(tekst.includes(pakiet.oferta.hash), 'suma kontrolna (hash) oferty w wykazie');
  assert.ok(tekst.includes(pakiet.sumaKontrolna), 'suma kontrolna całości pakietu w wykazie');
  d.close();
});

test('generujPismoOPrzedluzenie — wykaz załączników jest w treści pisma', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.ok(/za[łl][aą]cznik/i.test(wynik.tresc), 'sekcja wykazu załączników');
  assert.ok(wynik.tresc.includes(pakiet.oferta.hash), 'hash oferty jako dowód w piśmie');
  assert.ok(wynik.tresc.includes(pakiet.sumaKontrolna), 'suma kontrolna pakietu w piśmie');
  d.close();
});

// ══════════════════════════ 4. DOWODY + TERMIN + LINIA ORZECZNICZA KIO ═══════

test('generujPismoOPrzedluzenie — żąda przedłużenia terminu, powołuje dowody na bieżąco i KIO', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.ok(/przed[łl]u[żz]eni/i.test(wynik.tresc), 'żądanie przedłużenia terminu');
  assert.ok(/termin\w* sk[łl]adania/i.test(wynik.tresc), 'mowa o terminie składania ofert');
  assert.ok(/na bie[żz][ąa]co/i.test(wynik.tresc), 'wzmianka o dowodach utrwalonych na bieżąco');
  assert.ok(/KIO|Krajowej Izby Odwoławczej/i.test(wynik.tresc), 'powołanie na linię orzeczniczą KIO');
  assert.ok(/ci[eę][żz]ar\w* (?:udowodnienia|dowod)/i.test(wynik.tresc), 'ciężar dowodu awarii po stronie wykonawcy');
  // Pismo idzie PRZED terminem — po nim czynności nie da się powtórzyć.
  assert.ok(/przed up[łl]ywem terminu/i.test(wynik.tresc), 'wysyłka jeszcze przed upływem terminu');
  d.close();
});

// ══════════════════════════ 5. BRAK PUSTYCH PÓL ═════════════════════════════

test('generujPismoOPrzedluzenie — komplet meta => brak widocznych markerów braków, kompletne=true', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.equal(wynik.kompletne, true);
  assert.deepEqual(wynik.braki, []);
  assert.ok(!/\[[^\]]+\]/.test(wynik.tresc), `brak markerów [...] w treści; treść:\n${wynik.tresc}`);
  d.close();
});

test('generujPismoOPrzedluzenie — braki meta => głośne markery i kompletne=false (nie ciche luki)', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, {}); // brak wszystkich meta

  assert.equal(wynik.kompletne, false);
  assert.ok(wynik.braki.length > 0, 'braki wykazane');
  assert.ok(/\[UZUPE[ŁL]NIJ:/i.test(wynik.tresc), 'widoczny marker uzupełnienia w treści');
  // Mimo braków meta — opis awarii pochodzi z pakietu, więc dalej jest w piśmie.
  assert.ok(/HTTP 500 przy wysyłce oferty/.test(wynik.tresc), 'opis awarii nie znika przy brakach meta');
  d.close();
});

// ══════════════════════════ 6. BRAK WYKRYTEJ AWARII ═════════════════════════

test('generujPismoOPrzedluzenie — pakiet bez awarii => kompletne=false i marker zamiast zmyślonego opisu', async () => {
  const d = freshDb();
  const pakiet = await pakietZdrowy(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);

  assert.equal(pakiet.awaria.awaria, false);
  assert.equal(wynik.kompletne, false, 'bez awarii pismo nie jest gotowe do wysłania');
  assert.ok(wynik.braki.some((b) => /awari/i.test(JSON.stringify(b))), 'brak: niewykryta awaria');
  assert.ok(/\[UZUPE[ŁL]NIJ:[^\]]*awari/i.test(wynik.tresc), 'widoczny marker w miejscu opisu awarii');
  d.close();
});

// ══════════════════════════ 7. DETERMINIZM + WALIDACJA WEJŚCIA ═══════════════

test('generujPismoOPrzedluzenie — deterministyczne (data wstrzykiwana, brak Date.now)', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const a = generujPismoOPrzedluzenie(pakiet, META);
  const b = generujPismoOPrzedluzenie(pakiet, META);
  assert.equal(a.tresc, b.tresc);
  assert.equal(a.nazwaPliku, b.nazwaPliku);
  d.close();
});

test('generujPismoOPrzedluzenie — nazwa pliku to slug bez diakrytyków, .txt', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);
  assert.match(wynik.nazwaPliku, /^pismo-o-przedluzenie-[a-z0-9-]+\.txt$/);
  d.close();
});

test('generujPismoOPrzedluzenie — wynik jest zamrożony', async () => {
  const d = freshDb();
  const pakiet = await pakietZAwaria(d);
  const wynik = generujPismoOPrzedluzenie(pakiet, META);
  assert.ok(Object.isFrozen(wynik));
  d.close();
});

test('generujPismoOPrzedluzenie — odrzuca wejście, które nie jest pakietem', () => {
  assert.throws(() => generujPismoOPrzedluzenie(null, META), /pakiet/i);
  assert.throws(() => generujPismoOPrzedluzenie('nie-obiekt', META), /pakiet/i);
  assert.throws(() => generujPismoOPrzedluzenie([], META), /pakiet/i);
});
