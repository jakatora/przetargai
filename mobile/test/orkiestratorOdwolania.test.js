import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uruchomSciezkeOdwolania,
  powiadomienieOTerminieKio,
  DOMYSLNY_PROG_PRZYPOMNIENIA_DNI,
} from '../src/lib/orkiestratorOdwolania.js';
import {
  PoprzetargowaKontrola,
  zapiszKontrole,
  wczytajKontrole,
} from '../src/lib/poprzetargowaKontrola.js';
import { oblicz_termin_kio } from '../src/lib/terminKio.js';

/*
 * Orkiestrator ścieżki odwołania (podzadanie 13/13). Spina wykrycie przegranej z
 * resztą ścieżki i domyka wyliczenie terminu KIO oraz decyzję o powiadomieniu.
 * Magazyn to atrapa (Map) — prawdziwy storage ciągnie react-native i nie ładuje
 * się w node:test. Termin KIO porównujemy do kanonicznej `oblicz_termin_kio`
 * (a nie hardkodu), żeby nie dublować arytmetyki kalendarza w teście.
 */

function atrapaMagazynu() {
  const m = new Map();
  return {
    m,
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, v); },
  };
}

const MS_DZIEN = 24 * 60 * 60 * 1000;
// Poniedziałek 2026-07-06, 10:00 UTC — stały punkt odniesienia „teraz".
const TERAZ = Date.UTC(2026, 6, 6, 10, 0, 0);

test('uruchomSciezkeOdwolania: przegrana → kontrola + termin KIO liczony od DZIŚ', async () => {
  const mag = atrapaMagazynu();
  const tender = { id: 'BZP-1', organization: 'Gmina X', deadline: '2026-06-01' };

  const kontrola = await uruchomSciezkeOdwolania(mag, tender, { teraz: TERAZ });

  assert.ok(kontrola instanceof PoprzetargowaKontrola);
  assert.equal(kontrola.postepowanieId, 'BZP-1');
  assert.equal(kontrola.status, 'nowa');
  // Brak daty wyniku → liczymy od dnia oznaczenia przegranej (DZIŚ = 2026-07-06).
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-06', undefined));
  assert.equal(kontrola.dataOgloszeniaWyniku, '2026-07-06');

  // I jest utrwalone w magazynie (nie tylko w zwróconym obiekcie).
  const zdysku = await wczytajKontrole(mag, 'BZP-1');
  assert.equal(zdysku.terminOdwolaniaKio, kontrola.terminOdwolaniaKio);
});

test('uruchomSciezkeOdwolania: realna data wyniku z postępowania wygrywa z DZIŚ', async () => {
  const mag = atrapaMagazynu();
  const tender = { id: 'BZP-2', organization: 'Gmina Y', dataOgloszeniaWyniku: '2026-07-01' };

  const kontrola = await uruchomSciezkeOdwolania(mag, tender, { teraz: TERAZ });

  assert.equal(kontrola.dataOgloszeniaWyniku, '2026-07-01');
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-01', undefined));
});

test('uruchomSciezkeOdwolania: tryb (np. unijny) wydłuża liczony termin', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(
    mag,
    { id: 'BZP-3' },
    { teraz: TERAZ, tryb: 'unijny' },
  );
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-06', 'unijny'));
  // Tryb unijny (10 dni) daje termin późniejszy niż domyślny krajowy (5 dni).
  assert.ok(kontrola.terminOdwolaniaKio > oblicz_termin_kio('2026-07-06', undefined));
});

test('uruchomSciezkeOdwolania: idempotentnie — nie nadpisuje istniejącego terminu', async () => {
  const mag = atrapaMagazynu();
  // Kontrola już istnieje, z ustalonym wcześniej terminem.
  await zapiszKontrole(mag, new PoprzetargowaKontrola({
    postepowanieId: 'BZP-4',
    status: 'wniosek_wyslany',
    terminOdwolaniaKio: '2026-08-15',
  }));

  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-4' }, { teraz: TERAZ });

  assert.equal(kontrola.terminOdwolaniaKio, '2026-08-15'); // bez zmian
  assert.equal(kontrola.status, 'wniosek_wyslany'); // etap nietknięty
});

test('uruchomSciezkeOdwolania: domyka termin na kontroli założonej BEZ terminu', async () => {
  const mag = atrapaMagazynu();
  // Symulacja rekordu ze starszej wersji: kontrola bez terminu KIO.
  await zapiszKontrole(mag, new PoprzetargowaKontrola({
    postepowanieId: 'BZP-5',
    status: 'nowa',
  }));

  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-5' }, { teraz: TERAZ });

  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-06', undefined));
});

test('uruchomSciezkeOdwolania: brak id → null (nie wywraca UI)', async () => {
  const mag = atrapaMagazynu();
  const wynik = await uruchomSciezkeOdwolania(mag, {}, { teraz: TERAZ });
  assert.equal(wynik, null);
});

test('powiadomienieOTerminieKio: plan odpalany 2 dni przed upływem terminu', () => {
  const plan = powiadomienieOTerminieKio(
    { terminOdwolaniaKio: '2026-07-20' },
    { teraz: TERAZ },
  );
  assert.ok(plan);
  // Upływ = koniec dnia 2026-07-20 = północ 2026-07-21. Próg 2 dni → 2026-07-19 00:00.
  assert.equal(plan.uruchomOMs, Date.UTC(2026, 6, 19, 0, 0, 0));
  assert.ok(plan.uruchomOMs > TERAZ);
  assert.equal(plan.terminPL, '20.07.2026');
  assert.match(plan.tresc, /20\.07\.2026/);
  assert.match(plan.tytul, /KIO/);
});

test('powiadomienieOTerminieKio: gdy termin już blisko → odpala natychmiast (teraz)', () => {
  const plan = powiadomienieOTerminieKio(
    { terminOdwolaniaKio: '2026-07-06' }, // upływa końcem dziś
    { teraz: TERAZ },
  );
  assert.ok(plan);
  assert.equal(plan.uruchomOMs, TERAZ); // 2 dni przed upływem to przeszłość → clamp do teraz
  assert.equal(plan.dni, 0);
});

test('powiadomienieOTerminieKio: konfigurowalny próg dni', () => {
  const plan = powiadomienieOTerminieKio(
    { terminOdwolaniaKio: '2026-07-20' },
    { teraz: TERAZ, progDniPrzypomnienia: 5 },
  );
  // Upływ 2026-07-21 00:00 − 5 dni = 2026-07-16 00:00.
  assert.equal(plan.uruchomOMs, Date.UTC(2026, 6, 16, 0, 0, 0));
});

test('powiadomienieOTerminieKio: brak terminu → null', () => {
  assert.equal(powiadomienieOTerminieKio({ terminOdwolaniaKio: null }, { teraz: TERAZ }), null);
  assert.equal(powiadomienieOTerminieKio(null, { teraz: TERAZ }), null);
});

test('powiadomienieOTerminieKio: termin już minął → null (nie przypominamy po terminie)', () => {
  const plan = powiadomienieOTerminieKio(
    { terminOdwolaniaKio: '2026-07-01' },
    { teraz: TERAZ },
  );
  assert.equal(plan, null);
});

test('DOMYSLNY_PROG_PRZYPOMNIENIA_DNI to sensowna, krótka wartość', () => {
  assert.equal(DOMYSLNY_PROG_PRZYPOMNIENIA_DNI, 2);
  // Sanity: domyślny próg zgodny z odległością upływ−uruchom dla dalekiego terminu.
  const plan = powiadomienieOTerminieKio({ terminOdwolaniaKio: '2026-07-20' }, { teraz: TERAZ });
  const uplywMs = Date.UTC(2026, 6, 21, 0, 0, 0);
  assert.equal(uplywMs - plan.uruchomOMs, DOMYSLNY_PROG_PRZYPOMNIENIA_DNI * MS_DZIEN);
});
