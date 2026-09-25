import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  uruchomSciezkeOdwolania,
  powiadomienieOTerminieKio,
  DOMYSLNY_PROG_PRZYPOMNIENIA_DNI,
  opisPodstawyTerminuKio,
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

// Poprawka 2026-09-25: „dziś" (dzień oznaczenia przegranej) to dzień w POLSCE, nie w UTC.
test('uruchomSciezkeOdwolania: „dziś" liczone po polskiej północy', async () => {
  const mag = atrapaMagazynu();
  // 00:30 CEST 07.07 = 22:30 UTC 06.07 — wg UTC byłby jeszcze 06.07 (termin o dzień za wcześnie).
  const teraz = Date.UTC(2026, 6, 6, 22, 30);
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-PL' }, { teraz });
  assert.equal(kontrola.dataOgloszeniaWyniku, '2026-07-07');
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-07', undefined));
});

test('powiadomienieOTerminieKio: po polskiej północy dnia granicznego nie ma już o czym przypominać', () => {
  // 00:30 CEST 21.07 = 22:30 UTC 20.07 — termin 20.07 upłynął o 24:00 PL.
  const plan = powiadomienieOTerminieKio(
    { terminOdwolaniaKio: '2026-07-20' },
    { teraz: Date.UTC(2026, 6, 20, 22, 30) },
  );
  assert.equal(plan, null);
});

/*
 * 2026-09-25 (P1, wersja minimalna): termin KIO liczył się PO CICHU od „dziś" w trybie
 * 5-dniowym. Teraz: opcjonalna data otrzymania informacji o wyniku + tryb, a w wyniku
 * czytelna PODSTAWA (od kiedy, ile dni, jaki tryb, skąd wzięta data).
 */

test('podstawa: bez daty i trybu → od dnia oznaczenia wyniku, 5 dni, tryb krajowy', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P1' }, { teraz: TERAZ });
  assert.deepEqual(kontrola.podstawaTerminuKio, {
    liczoneOd: '2026-07-06', dni: 5, tryb: 'krajowy', zrodlo: 'dzien_oznaczenia',
  });
  // Utrwalona razem z terminem (ekran wyniku dostaje kontrolę z magazynu).
  const zdysku = await wczytajKontrole(mag, 'BZP-P1');
  assert.deepEqual(zdysku.podstawaTerminuKio, kontrola.podstawaTerminuKio);
});

test('podstawa: podana data otrzymania informacji + tryb unijny', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P2' }, {
    teraz: TERAZ, dataOtrzymaniaInformacji: '2026-07-01', tryb: 'unijny',
  });
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-01', 'unijny'));
  assert.equal(kontrola.dataOgloszeniaWyniku, '2026-07-01');
  assert.deepEqual(kontrola.podstawaTerminuKio, {
    liczoneOd: '2026-07-01', dni: 10, tryb: 'unijny', zrodlo: 'podana',
  });
});

test('podstawa: data w zapisie polskim jest normalizowana do ISO', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P3' }, {
    teraz: TERAZ, dataOtrzymaniaInformacji: '1.07.2026',
  });
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-01', 'krajowy'));
  assert.equal(kontrola.dataOgloszeniaWyniku, '2026-07-01');
  assert.equal(kontrola.podstawaTerminuKio.liczoneOd, '2026-07-01');
});

test('podstawa: zgodność wsteczna — stara opcja dataOgloszeniaWyniku nadal działa', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P4' }, {
    teraz: TERAZ, dataOgloszeniaWyniku: '2026-07-02',
  });
  assert.equal(kontrola.terminOdwolaniaKio, oblicz_termin_kio('2026-07-02', undefined));
  assert.equal(kontrola.podstawaTerminuKio.zrodlo, 'podana');
});

test('podstawa: data z postępowania → źródło „postepowanie"', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(
    mag, { id: 'BZP-P5', dataOgloszeniaWyniku: '2026-07-01' }, { teraz: TERAZ },
  );
  assert.deepEqual(kontrola.podstawaTerminuKio, {
    liczoneOd: '2026-07-01', dni: 5, tryb: 'krajowy', zrodlo: 'postepowanie',
  });
});

test('podstawa: nieznany tryb zapisuje tryb, którym faktycznie liczono (domyślny)', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P6' }, { teraz: TERAZ, tryb: 'kosmiczny' });
  assert.equal(kontrola.podstawaTerminuKio.tryb, 'krajowy');
  assert.equal(kontrola.podstawaTerminuKio.dni, 5);
});

test('podstawa: nieczytelna podana data → brak terminu (nie liczymy po cichu od dziś)', async () => {
  const mag = atrapaMagazynu();
  const kontrola = await uruchomSciezkeOdwolania(mag, { id: 'BZP-P7' }, {
    teraz: TERAZ, dataOtrzymaniaInformacji: '2026-7-1',
  });
  assert.equal(kontrola.terminOdwolaniaKio, null);
  assert.equal(kontrola.podstawaTerminuKio, null);
});

test('opisPodstawyTerminuKio: od dnia oznaczenia → podstawa + ostrzeżenie o wcześniejszej informacji', () => {
  const opis = opisPodstawyTerminuKio({
    terminOdwolaniaKio: '2026-07-13',
    podstawaTerminuKio: { liczoneOd: '2026-07-06', dni: 5, tryb: 'krajowy', zrodlo: 'dzien_oznaczenia' },
  });
  assert.equal(opis.tekst, 'Liczone od 06.07 (dzień oznaczenia wyniku), 5 dni.');
  assert.equal(
    opis.ostrzezenie,
    'Jeśli informację o wyniku otrzymałeś wcześniej — termin biegnie od tamtego dnia i może już być krótszy.',
  );
  assert.match(opis.tryb, /Poniżej progów unijnych/);
});

test('opisPodstawyTerminuKio: znana data przekazania informacji → bez ostrzeżenia', () => {
  const opis = opisPodstawyTerminuKio({
    terminOdwolaniaKio: '2026-07-13',
    podstawaTerminuKio: { liczoneOd: '2026-07-01', dni: 10, tryb: 'unijny', zrodlo: 'podana' },
  });
  assert.equal(opis.tekst, 'Liczone od 01.07 (dzień przekazania informacji o wyniku), 10 dni.');
  assert.equal(opis.ostrzezenie, null);
  assert.match(opis.tryb, /Powyżej progów unijnych/);
});

test('opisPodstawyTerminuKio: stary rekord bez podstawy — data + ostrzeżenie, bez zgadywania dni', () => {
  const opis = opisPodstawyTerminuKio({ terminOdwolaniaKio: '2026-07-13', dataOgloszeniaWyniku: '2026-07-06' });
  assert.equal(opis.tekst, 'Liczone od 06.07.');
  assert.ok(opis.ostrzezenie);
  assert.equal(opis.tryb, null);
});

test('opisPodstawyTerminuKio: brak terminu albo kontroli → null', () => {
  assert.equal(opisPodstawyTerminuKio(null), null);
  assert.equal(opisPodstawyTerminuKio({ terminOdwolaniaKio: null }), null);
  assert.equal(opisPodstawyTerminuKio({ terminOdwolaniaKio: '2026-07-13' }), null);
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
  // Upływ = koniec dnia 2026-07-20 = 24:00 PL (CEST) = 2026-07-20T22:00Z.
  // Próg 2 dni → 2026-07-18T22:00Z (00:00 PL 19.07).
  assert.equal(plan.uruchomOMs, Date.UTC(2026, 6, 18, 22, 0, 0));
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
  // Upływ 2026-07-20T22:00Z (24:00 PL) − 5 dni = 2026-07-15T22:00Z.
  assert.equal(plan.uruchomOMs, Date.UTC(2026, 6, 15, 22, 0, 0));
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
  const uplywMs = Date.UTC(2026, 6, 20, 22, 0, 0); // 24:00 PL 20.07
  assert.equal(uplywMs - plan.uruchomOMs, DOMYSLNY_PROG_PRZYPOMNIENIA_DNI * MS_DZIEN);
});
