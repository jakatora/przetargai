import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * NORMALIZACJA ogłoszeń podprogowych `normalizujPodprogowe` — podzadanie 2/7
 * ulepszenia „Radar zamówień podprogowych (poniżej 170 tys. zł)". Czysta funkcja,
 * bez I/O: surowe ogłoszenie z dowolnego źródła + konfiguracja progu/preferencji →
 * znormalizowany rekord (kolumny tabeli `zamowienia_podprogowe`) z policzonym
 * `hash_dedup`, dopasowaniem do branży/regionu użytkownika i flagą `latwiejszy_start`
 * z heurystyk (bez_wadium / bez_kio / prosta_procedura).
 *
 * Testujemy szczęśliwą ścieżkę i ADWERSARYJNIE: granicę progu (169k/170k/171k),
 * regułę zasady konkurencyjności od 80k dla Bazy Konkurencyjności, dopasowanie
 * branży/regionu (z diakrytykami), dedup identycznych ogłoszeń (i rozróżnianie
 * różnych), heurystyki „łatwiejszego startu" oraz braki/śmieciowe dane (bez wyjątku).
 */

const { normalizujPodprogowe } = await import('../src/lib/normalizacjaPodprogowe.js');

// Surowe ogłoszenie „domyślne" — łatwe do nadpisania w konkretnym teście.
const bazoweSurowe = {
  zrodlo: 'bip',
  id_zewnetrzny: 'OGL-2026-001',
  tytul: 'Dostawa materiałów biurowych',
  zamawiajacy: 'Gmina Piaseczno',
  wartosc_netto: 50000,
  termin_skladania: '2026-08-15T10:00:00.000Z',
  link: 'https://bip.piaseczno.pl/ogloszenie/1',
  data_publikacji: '2026-07-20T08:00:00.000Z',
};

// ── Próg wartości netto: 169k przechodzi, 170k i 171k już nie ─────────────────

test('próg: 169 000 zł < 170 000 → kwalifikuje się (podprogowe)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: 169000 }, {});
  assert.equal(r.kwalifikujeSie, true);
  assert.equal(r.rekord.wartosc_netto, 169000);
});

test('próg: dokładnie 170 000 zł → NIE kwalifikuje się (to już nadprogowe)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: 170000 }, {});
  assert.equal(r.kwalifikujeSie, false, 'granica progu jest wyłączająca (< 170 000)');
  assert.match(r.powod, /170\s?000|nadprog/i);
});

test('próg: 171 000 zł → NIE kwalifikuje się', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: 171000 }, {});
  assert.equal(r.kwalifikujeSie, false);
});

test('próg: konfigurowalny (np. 130 000) — 150k odpada przy niższym progu', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: 150000 }, { prog_netto: 130000 });
  assert.equal(r.kwalifikujeSie, false, 'przy progu 130k wartość 150k jest nadprogowa');
});

// ── Reguła zasady konkurencyjności (od 80 000 zł) dla Bazy Konkurencyjności ───

test('BK: 80 000 zł → kwalifikuje się (dolna granica zasady konkurencyjności jest włączająca)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'baza_konkurencyjnosci', wartosc_netto: 80000 }, {});
  assert.equal(r.kwalifikujeSie, true);
});

test('BK: 79 999 zł → NIE kwalifikuje się (poniżej progu zasady konkurencyjności)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'baza_konkurencyjnosci', wartosc_netto: 79999 }, {});
  assert.equal(r.kwalifikujeSie, false);
  assert.match(r.powod, /konkurencyjno|80\s?000/i);
});

test('BK: 169 000 zł → kwalifikuje się (mieści się między 80k a 170k)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'baza_konkurencyjnosci', wartosc_netto: 169000 }, {});
  assert.equal(r.kwalifikujeSie, true);
});

test('BK: 170 000 zł → NIE kwalifikuje się (górny próg obowiązuje też BK)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'baza_konkurencyjnosci', wartosc_netto: 170000 }, {});
  assert.equal(r.kwalifikujeSie, false);
});

test('dolny próg 80k dotyczy WYŁĄCZNIE BK — dla BIP 50k dalej się kwalifikuje', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'bip', wartosc_netto: 50000 }, {});
  assert.equal(r.kwalifikujeSie, true, 'poza BK nie ma dolnej granicy');
});

// ── Dopasowanie do branży i regionu użytkownika ──────────────────────────────

test('dopasowanie: branża i region z preferencji pasują do treści ogłoszenia', () => {
  const r = normalizujPodprogowe(
    { ...bazoweSurowe, tytul: 'Usługa sprzątania budynku urzędu', region: 'woj. mazowieckie' },
    { branza: 'sprzątanie', region: 'mazowieckie' },
  );
  assert.equal(r.dopasowanie.branza, true);
  assert.equal(r.dopasowanie.region, true);
  assert.equal(r.dopasowanie.pasuje, true);
  assert.equal(r.rekord.branza, 'sprzątanie', 'rekord jest otagowany branżą z preferencji');
  assert.equal(r.rekord.region, 'mazowieckie');
});

test('dopasowanie: branża NIE pasuje → pasuje=false', () => {
  const r = normalizujPodprogowe(
    { ...bazoweSurowe, tytul: 'Dostawa sprzętu komputerowego' },
    { branza: 'sprzątanie', region: 'mazowieckie' },
  );
  assert.equal(r.dopasowanie.branza, false);
  assert.equal(r.dopasowanie.pasuje, false);
});

test('dopasowanie: bez preferencji (pusta konfiguracja) niczego nie zawężamy → pasuje=true', () => {
  const r = normalizujPodprogowe(bazoweSurowe, {});
  assert.equal(r.dopasowanie.pasuje, true);
});

test('dopasowanie: ignoruje wielkość liter i polskie znaki (sprzatanie ~ Sprzątanie)', () => {
  const r = normalizujPodprogowe(
    { ...bazoweSurowe, tytul: 'SPRZĄTANIE terenów zielonych' },
    { branza: 'sprzatanie', region: '' },
  );
  assert.equal(r.dopasowanie.branza, true);
});

// ── hash_dedup: identyczne → ten sam, różne → różne ───────────────────────────

test('dedup: dwa identyczne ogłoszenia dają ten sam hash_dedup', () => {
  const a = normalizujPodprogowe(bazoweSurowe, {});
  const b = normalizujPodprogowe({ ...bazoweSurowe }, {});
  assert.equal(typeof a.rekord.hash_dedup, 'string');
  assert.ok(a.rekord.hash_dedup.length > 0);
  assert.equal(a.rekord.hash_dedup, b.rekord.hash_dedup);
});

test('dedup: ten sam identyfikator źródła mimo różnic redakcyjnych → ten sam hash', () => {
  const a = normalizujPodprogowe(bazoweSurowe, {});
  const b = normalizujPodprogowe(
    { ...bazoweSurowe, tytul: '  dostawa   MATERIAŁÓW biurowych ', link: 'https://inny-mirror.example/1' },
    {},
  );
  assert.equal(a.rekord.hash_dedup, b.rekord.hash_dedup, 'dedup po (źródło + id_zewnetrzny)');
});

test('dedup: inne źródło → inny hash', () => {
  const a = normalizujPodprogowe(bazoweSurowe, {});
  const b = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'platformazakupowa' }, {});
  assert.notEqual(a.rekord.hash_dedup, b.rekord.hash_dedup);
});

test('dedup: inny identyfikator zewnętrzny → inny hash', () => {
  const a = normalizujPodprogowe(bazoweSurowe, {});
  const b = normalizujPodprogowe({ ...bazoweSurowe, id_zewnetrzny: 'OGL-2026-999' }, {});
  assert.notEqual(a.rekord.hash_dedup, b.rekord.hash_dedup);
});

test('dedup: bez id_zewnetrznego — fallback na treść; identyczna treść → ten sam hash', () => {
  const surowe = { zrodlo: 'platformazakupowa', tytul: 'Remont chodnika', zamawiajacy: 'Gmina X', wartosc_netto: 90000, termin_skladania: '2026-09-01' };
  const a = normalizujPodprogowe(surowe, {});
  const b = normalizujPodprogowe({ ...surowe }, {});
  assert.equal(a.rekord.hash_dedup, b.rekord.hash_dedup);
});

// ── Flaga „łatwiejszy start" z heurystyk ─────────────────────────────────────

test('łatwiejszy start: brak sygnałów utrudnień → true, wszystkie flagi true', () => {
  const r = normalizujPodprogowe(bazoweSurowe, {});
  assert.equal(r.rekord.flagi.bez_wadium, true);
  assert.equal(r.rekord.flagi.bez_kio, true);
  assert.equal(r.rekord.flagi.prosta_procedura, true);
  assert.equal(r.rekord.latwiejszy_start, true);
});

test('łatwiejszy start: jawna kwota wadium → bez_wadium=false → latwiejszy_start=false', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wadium: 5000 }, {});
  assert.equal(r.rekord.flagi.bez_wadium, false);
  assert.equal(r.rekord.latwiejszy_start, false);
});

test('łatwiejszy start: kwota wadium w opisie → bez_wadium=false', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, opis: 'Wadium: 3 000 zł należy wnieść przed terminem.' }, {});
  assert.equal(r.rekord.flagi.bez_wadium, false);
});

test('łatwiejszy start: „Zamawiający nie wymaga wadium" → bez_wadium=true', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, opis: 'Zamawiający nie wymaga wadium.' }, {});
  assert.equal(r.rekord.flagi.bez_wadium, true);
});

test('łatwiejszy start: wzmianka o KIO → bez_kio=false → latwiejszy_start=false', () => {
  const r = normalizujPodprogowe(
    { ...bazoweSurowe, opis: 'Wykonawcy przysługuje odwołanie do Krajowej Izby Odwoławczej.' },
    {},
  );
  assert.equal(r.rekord.flagi.bez_kio, false);
  assert.equal(r.rekord.latwiejszy_start, false);
});

test('łatwiejszy start: „przetarg nieograniczony" → prosta_procedura=false', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, opis: 'Postępowanie prowadzone w trybie przetargu nieograniczonego.' }, {});
  assert.equal(r.rekord.flagi.prosta_procedura, false);
  assert.equal(r.rekord.latwiejszy_start, false);
});

// ── Normalizacja pól i wartości ──────────────────────────────────────────────

test('normalizacja: kwota jako polski string „169 000,00 zł" → liczba 169000', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: '169 000,00 zł' }, {});
  assert.equal(r.rekord.wartosc_netto, 169000);
  assert.equal(r.kwalifikujeSie, true);
});

test('normalizacja: domyślna waluta PLN, regulamin_streszczenie null (uzupełni AI), kolumny obecne', () => {
  const r = normalizujPodprogowe(bazoweSurowe, {});
  assert.equal(r.rekord.waluta, 'PLN');
  assert.equal(r.rekord.regulamin_streszczenie, null);
  for (const k of ['zrodlo', 'tytul', 'zamawiajacy', 'wartosc_netto', 'termin_skladania', 'link', 'data_publikacji', 'hash_dedup', 'flagi', 'latwiejszy_start']) {
    assert.ok(k in r.rekord, `rekord ma kolumnę ${k}`);
  }
});

test('normalizacja: akceptuje warianty nazw pól (camelCase / title / value)', () => {
  const r = normalizujPodprogowe(
    { zrodlo: 'ezamawiajacy', idZewnetrzny: 'X1', title: 'Naprawa dachu', value: 60000, terminSkladania: '2026-08-01' },
    {},
  );
  assert.equal(r.rekord.tytul, 'Naprawa dachu');
  assert.equal(r.rekord.wartosc_netto, 60000);
  assert.equal(r.rekord.termin_skladania, '2026-08-01');
});

// ── Braki i śmieciowe dane: bez wyjątku, konserwatywnie ──────────────────────

test('braki: puste wejście nie rzuca; rekord z nullami, nie kwalifikuje się, hash policzony', () => {
  const r = normalizujPodprogowe({}, {});
  assert.equal(r.kwalifikujeSie, false);
  assert.equal(r.rekord.wartosc_netto, null);
  assert.equal(typeof r.rekord.hash_dedup, 'string');
  assert.ok(r.rekord.hash_dedup.length > 0);
  assert.ok(r.powod && r.powod.length > 0);
});

test('braki: null/undefined jako wejście nie rzuca wyjątku', () => {
  assert.doesNotThrow(() => normalizujPodprogowe(null, null));
  assert.doesNotThrow(() => normalizujPodprogowe(undefined, undefined));
  const r = normalizujPodprogowe(undefined, undefined);
  assert.equal(r.kwalifikujeSie, false);
});

test('braki: śmieciowa kwota → wartosc_netto null, brak kwalifikacji z czytelnym powodem', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, wartosc_netto: 'do uzgodnienia' }, {});
  assert.equal(r.rekord.wartosc_netto, null);
  assert.equal(r.kwalifikujeSie, false);
  assert.match(r.powod, /warto/i);
});

test('braki: nieznane źródło → nie kwalifikuje się (spójne z CHECK w migracji 009)', () => {
  const r = normalizujPodprogowe({ ...bazoweSurowe, zrodlo: 'facebook' }, {});
  assert.equal(r.kwalifikujeSie, false);
  assert.match(r.powod, /źród|zrod/i);
});
