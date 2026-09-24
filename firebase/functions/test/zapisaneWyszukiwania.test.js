import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CZESTOTLIWOSCI, CZESTOTLIWOSC_DOMYSLNA, MAKS_WYSZUKIWAN, MAKS_ALERTOW,
  MAKS_DLUGOSC_NAZWY, MAKS_TRAFIEN_W_ALERCIE,
  normalizujNazwe, proponowanaNazwa, normalizujWyszukiwanie, odciskWyszukiwania,
  czyNalezySprawdzic, nastepneSprawdzenie, sprawdzLimity,
} from '../src/lib/zapisaneWyszukiwania.js';

/*
 * ZAPISANE WYSZUKIWANIA trybu „Wszystkie" (etap 5) — CZYSTA logika.
 *
 * Zapisane wyszukiwanie to obietnica: „powiem Ci, gdy pojawi się coś takiego".
 * Dwie rzeczy mogą tę obietnicę złamać i obie mieszkają tutaj:
 *  • filtry zapisane INACZEJ niż rozumie je katalog — alert pokazywałby inny
 *    zbiór niż lista, z której użytkownik go zapisał,
 *  • brak hamulca na częstotliwość — powiadomienie co przebieg to nie alert,
 *    tylko spam, po którym użytkownik wyłącza push na całą aplikację.
 */

test('nazwa jest przycięta, bez nadmiarowych spacji i bez wartości nie-tekstowych', () => {
  assert.equal(normalizujNazwe('  Drogi   w   Małopolsce \n'), 'Drogi w Małopolsce');
  assert.equal(normalizujNazwe('a'.repeat(MAKS_DLUGOSC_NAZWY + 40)).length, MAKS_DLUGOSC_NAZWY);
  assert.equal(normalizujNazwe(null), '');
  assert.equal(normalizujNazwe({ zle: 1 }), '');
});

test('propozycja nazwy opisuje filtry w OBU językach, a pusty zestaw nazywa wprost', () => {
  const zFiltrem = proponowanaNazwa({ zrodlo: 'bzp', region: 'PL12', cpv: '45000000' });
  assert.match(zFiltrem.pl, /BZP/);
  assert.match(zFiltrem.pl, /45000000/);
  assert.equal(typeof zFiltrem.en, 'string');
  assert.ok(zFiltrem.en.length > 0, 'wariant angielski nie może być pusty');

  const bezFiltrow = proponowanaNazwa({});
  assert.ok(bezFiltrow.pl.length > 0);
  assert.ok(bezFiltrow.en.length > 0);
});

test('filtry zapisujemy DOKŁADNIE tak, jak rozumie je katalog — bez pola limit', () => {
  const w = normalizujWyszukiwanie({
    nazwa: 'Roboty drogowe',
    filtry: {
      zrodlo: 'bzp', region: 'małopolskie', cpv: '45-233-000', q: '  remont  ', limit: 50, sort: 'termin',
    },
  });

  // Region z nazwy → kod TERYT, CPV bez separatorów: to jest kontrakt katalogu.
  assert.equal(w.filtry.region, '12');
  assert.equal(w.filtry.cpv, '45233000');
  assert.equal(w.filtry.q, 'remont');
  assert.equal(w.filtry.sort, 'termin');
  assert.ok(!Object.hasOwn(w.filtry, 'limit'), 'limit to rozmiar strony, nie część zbioru wyników');
});

test('nierozpoznana częstotliwość spada na domyślną, a lista częstotliwości ma etykiety PL/EN', () => {
  assert.equal(
    normalizujWyszukiwanie({ nazwa: 'x', czestotliwosc: 'co_minute' }).czestotliwosc,
    CZESTOTLIWOSC_DOMYSLNA,
  );
  assert.equal(normalizujWyszukiwanie({ nazwa: 'x', czestotliwosc: 'tygodniowa' }).czestotliwosc, 'tygodniowa');
  for (const c of CZESTOTLIWOSCI) {
    assert.ok(c.kod && c.etykieta?.pl && c.etykieta?.en, `częstotliwość ${c.kod} bez etykiet`);
    assert.ok(c.minutyMin > 0, 'każda częstotliwość ma minimalny odstęp');
  }
});

test('alert jest domyślnie WŁĄCZONY, a wartość spoza prawdy/fałszu nie przechodzi', () => {
  assert.equal(normalizujWyszukiwanie({ nazwa: 'x' }).alert_wlaczony, true);
  assert.equal(normalizujWyszukiwanie({ nazwa: 'x', alert_wlaczony: false }).alert_wlaczony, false);
  assert.equal(normalizujWyszukiwanie({ nazwa: 'x', alert_wlaczony: 'nie' }).alert_wlaczony, true);
});

test('odcisk zależy od ZBIORU wyników, a nie od nazwy ani od sortowania', () => {
  const a = normalizujWyszukiwanie({ nazwa: 'Jedna', filtry: { zrodlo: 'bzp', sort: 'najnowsze' } });
  const b = normalizujWyszukiwanie({ nazwa: 'Druga', filtry: { zrodlo: 'bzp', sort: 'termin' } });
  const c = normalizujWyszukiwanie({ nazwa: 'Trzecia', filtry: { zrodlo: 'ted' } });

  assert.equal(odciskWyszukiwania(a.filtry), odciskWyszukiwania(b.filtry));
  assert.notEqual(odciskWyszukiwania(a.filtry), odciskWyszukiwania(c.filtry));
});

test('wyszukiwanie nigdy niesprawdzone jest wymagalne od razu', () => {
  const w = { czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: null };
  assert.equal(czyNalezySprawdzic(w, '2026-09-24T10:00:00.000Z'), true);
});

test('hamulec częstotliwości: przed upływem odstępu NIE sprawdzamy, po nim tak', () => {
  const w = { czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: '2026-09-24T10:00:00.000Z' };
  assert.equal(czyNalezySprawdzic(w, '2026-09-25T09:59:00.000Z'), false);
  assert.equal(czyNalezySprawdzic(w, '2026-09-25T10:00:00.000Z'), true);

  const godzinowa = { czestotliwosc: 'godzinowa', ostatnio_sprawdzone_o: '2026-09-24T10:00:00.000Z' };
  assert.equal(czyNalezySprawdzic(godzinowa, '2026-09-24T10:59:00.000Z'), false);
  assert.equal(czyNalezySprawdzic(godzinowa, '2026-09-24T11:00:00.000Z'), true);
});

test('wyłączony alert nie jest wymagalny — hamulec nie musi go nawet liczyć', () => {
  const w = { czestotliwosc: 'godzinowa', alert_wlaczony: false, ostatnio_sprawdzone_o: null };
  assert.equal(czyNalezySprawdzic(w, '2026-09-24T10:00:00.000Z'), false);
});

test('zepsuty znacznik ostatniego sprawdzenia traktujemy jak brak, nie jak „nigdy więcej"', () => {
  const w = { czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: 'wczoraj' };
  assert.equal(czyNalezySprawdzic(w, '2026-09-24T10:00:00.000Z'), true);
});

test('następne sprawdzenie wypada o pełny odstęp po ostatnim', () => {
  assert.equal(
    nastepneSprawdzenie({ czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: '2026-09-24T10:00:00.000Z' }),
    '2026-09-25T10:00:00.000Z',
  );
  assert.equal(nastepneSprawdzenie({ czestotliwosc: 'dzienna', ostatnio_sprawdzone_o: null }), null);
});

test('limit liczby wyszukiwań chroni przed zalaniem konta', () => {
  const istniejace = Array.from(
    { length: MAKS_WYSZUKIWAN },
    (_, i) => ({ odcisk: `o${i}`, alert_wlaczony: false }),
  );
  const wynik = sprawdzLimity({ istniejace, odcisk: 'nowy', alertWlaczony: false });
  assert.equal(wynik.ok, false);
  assert.equal(wynik.kod, 'limit_wyszukiwan');
  assert.ok(wynik.komunikat.pl && wynik.komunikat.en);
});

test('limit WŁĄCZONYCH alertów jest osobny — zapisać można więcej, niż da się śledzić', () => {
  const istniejace = Array.from(
    { length: MAKS_ALERTOW },
    (_, i) => ({ odcisk: `o${i}`, alert_wlaczony: true }),
  );
  assert.equal(sprawdzLimity({ istniejace, odcisk: 'nowy', alertWlaczony: true }).kod, 'limit_alertow');
  // Ten sam stan, ale bez alertu — zapis przechodzi.
  assert.equal(sprawdzLimity({ istniejace, odcisk: 'nowy', alertWlaczony: false }).ok, true);
});

test('drugi zapis TEGO SAMEGO zbioru filtrów jest odrzucany — inaczej alert przychodzi podwójnie', () => {
  const istniejace = [{ id: 'a1', odcisk: 'ten-sam', alert_wlaczony: true }];
  const wynik = sprawdzLimity({ istniejace, odcisk: 'ten-sam', alertWlaczony: true });
  assert.equal(wynik.ok, false);
  assert.equal(wynik.kod, 'duplikat');
  assert.equal(wynik.istniejaceId, 'a1');
});

test('edycja własnego wpisu nie jest duplikatem samej siebie', () => {
  const istniejace = [{ id: 'a1', odcisk: 'ten-sam', alert_wlaczony: true }];
  assert.equal(sprawdzLimity({
    istniejace, odcisk: 'ten-sam', alertWlaczony: true, pomijanyId: 'a1',
  }).ok, true);
});

test('liczba trafień wymienionych w jednym alercie jest ograniczona', () => {
  assert.ok(MAKS_TRAFIEN_W_ALERCIE >= 1 && MAKS_TRAFIEN_W_ALERCIE <= 10);
});
