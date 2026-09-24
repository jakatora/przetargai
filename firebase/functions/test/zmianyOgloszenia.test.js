import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TYPY_ZMIAN, TYPY_ISTOTNE,
  wykryjZmiany, kluczZmiany, czySaIstotne, podsumujZmiany,
} from '../src/lib/zmianyOgloszenia.js';

/*
 * HISTORIA ZMIAN OGŁOSZENIA (etap 5, P1-2) — CZYSTA logika.
 *
 * Ogłoszenie w rejestrze NIE jest niezmienne. Zamawiający przesuwa termin, dokleja
 * odpowiedzi na pytania, zmienia wartość, a czasem unieważnia całe postępowanie.
 * Wykonawca, który tego nie zobaczy, przygotowuje ofertę na nieaktualnych danych —
 * albo, w najgorszym wypadku, na postępowanie, którego już nie ma.
 *
 * Ten plik odpowiada na jedno pytanie: CO SIĘ ZMIENIŁO i czy warto o tym budzić
 * człowieka. Rozróżnienie „istotne / nieistotne" jest tu, a nie w harmonogramie,
 * bo to decyzja produktowa, nie techniczna — i musi dać się przetestować bez bazy.
 */

test('brak poprzedniej wersji to NIE jest zmiana — nowe ogłoszenie ma własną ścieżkę', () => {
  assert.deepEqual(wykryjZmiany(null, { deadline: '2026-10-01T10:00:00.000Z' }), []);
  assert.deepEqual(wykryjZmiany(undefined, { budget: 1000 }), []);
});

test('identyczne wersje nie produkują ani jednego wpisu', () => {
  const t = { deadline: '2026-10-01T10:00:00.000Z', budget: 500000, title: 'Remont drogi' };
  assert.deepEqual(wykryjZmiany(t, { ...t }), []);
});

test('przesunięcie terminu W PRZÓD: zmiana istotna, kierunek i liczba dni', () => {
  const zmiany = wykryjZmiany(
    { deadline: '2026-10-01T10:00:00.000Z' },
    { deadline: '2026-10-08T10:00:00.000Z' },
  );
  assert.equal(zmiany.length, 1);
  const z = zmiany[0];
  assert.equal(z.typ, 'termin');
  assert.equal(z.istotna, true);
  assert.equal(z.kierunek, 'pozniej');
  assert.equal(z.dni, 7);
  assert.equal(z.przed, '2026-10-01T10:00:00.000Z');
  assert.equal(z.po, '2026-10-08T10:00:00.000Z');
  assert.ok(z.opis.pl && z.opis.en);
});

test('SKRÓCENIE terminu jest alarmem, nie informacją — zostaje mniej czasu na ofertę', () => {
  const [z] = wykryjZmiany(
    { deadline: '2026-10-08T10:00:00.000Z' },
    { deadline: '2026-10-02T10:00:00.000Z' },
  );
  assert.equal(z.typ, 'termin');
  assert.equal(z.kierunek, 'wczesniej');
  assert.equal(z.dni, 6);
  assert.equal(z.ton, 'danger');
});

test('pojawienie się terminu tam, gdzie go nie było, też jest zmianą terminu', () => {
  const [z] = wykryjZmiany({ deadline: null }, { deadline: '2026-10-02T10:00:00.000Z' });
  assert.equal(z.typ, 'termin');
  assert.equal(z.kierunek, 'pojawil_sie');
  assert.equal(z.dni, null);
});

test('ANULOWANIE jest jednoznaczne: własny typ, ton danger i flaga końca postępowania', () => {
  const [z] = wykryjZmiany({ anulowany: false }, { anulowany: true, anulowany_powod: 'unieważnione' });
  assert.equal(z.typ, 'anulowanie');
  assert.equal(z.istotna, true);
  assert.equal(z.ton, 'danger');
  assert.equal(z.koniec, true);
  assert.match(z.opis.pl, /nulowan|nieważ/i);
});

test('cofnięcie anulowania NIE jest anulowaniem — inaczej alarm szedłby na wznowienie', () => {
  const zmiany = wykryjZmiany({ anulowany: true }, { anulowany: false });
  assert.equal(zmiany.filter((z) => z.typ === 'anulowanie').length, 0);
  assert.equal(zmiany[0].typ, 'status');
  assert.equal(zmiany[0].koniec, false);
});

test('anulowanie rozpoznane przy PIERWSZYM zapisaniu pola (przed: brak wartości)', () => {
  // Stary dokument nie miał pola `anulowany` w ogóle — undefined, nie false.
  const [z] = wykryjZmiany({ title: 'x' }, { title: 'x', anulowany: true });
  assert.equal(z.typ, 'anulowanie');
});

test('zmiana wartości zamówienia niesie kierunek i różnicę procentową', () => {
  const [z] = wykryjZmiany({ budget: 1_000_000 }, { budget: 1_250_000 });
  assert.equal(z.typ, 'wartosc');
  assert.equal(z.istotna, true);
  assert.equal(z.kierunek, 'wzrost');
  assert.equal(z.delta, 250_000);
  assert.equal(z.procent, 25);
});

test('wartość spadająca do zera nie dzieli przez zero i nie wymyśla procentu', () => {
  const [z] = wykryjZmiany({ budget: 0 }, { budget: 100 });
  assert.equal(z.typ, 'wartosc');
  assert.equal(z.procent, null);
});

test('zmiana statusu w rejestrze źródłowym jest istotna i cytuje obie wartości', () => {
  const [z] = wykryjZmiany({ status_zrodla: 'PUBLISHED' }, { status_zrodla: 'SUSPENDED' });
  assert.equal(z.typ, 'status');
  assert.equal(z.istotna, true);
  assert.equal(z.przed, 'PUBLISHED');
  assert.equal(z.po, 'SUSPENDED');
});

test('zmiana treści/załączników u źródła to sygnał „są nowe dokumenty albo odpowiedzi"', () => {
  const [z] = wykryjZmiany({ zrodlo_odcisk: 'aaa' }, { zrodlo_odcisk: 'bbb' });
  assert.equal(z.typ, 'dokumenty');
  assert.equal(z.istotna, true);
  assert.match(z.opis.pl, /dokument|odpowiedz/i);
});

test('zmiana umowy jest odnotowana, gdy rejestr w ogóle taką informację podaje', () => {
  const [z] = wykryjZmiany(
    { umowa_zmieniona_o: null },
    { umowa_zmieniona_o: '2026-10-05T00:00:00.000Z', umowa_zmiana_opis: 'aneks nr 1' },
  );
  assert.equal(z.typ, 'umowa');
  assert.equal(z.istotna, true);
  assert.match(z.opis.pl, /umow/i);
});

test('poprawka tytułu jest odnotowana w historii, ale NIE budzi nikogo powiadomieniem', () => {
  const [z] = wykryjZmiany({ title: 'Remont drogi' }, { title: 'Remont drogi gminnej' });
  assert.equal(z.typ, 'tresc');
  assert.equal(z.istotna, false);
});

test('jedna wersja może przynieść kilka zmian naraz, w stałej kolejności ważności', () => {
  const zmiany = wykryjZmiany(
    { title: 'A', deadline: '2026-10-08T10:00:00.000Z', budget: 100, anulowany: false },
    { title: 'B', deadline: '2026-10-02T10:00:00.000Z', budget: 200, anulowany: true },
  );
  const typy = zmiany.map((z) => z.typ);
  assert.deepEqual(typy, ['anulowanie', 'termin', 'wartosc', 'tresc']);
});

test('klucz zmiany jest deterministyczny i rozróżnia przeciwne przejścia', () => {
  const doPrzodu = wykryjZmiany({ deadline: '2026-10-01T10:00:00.000Z' }, { deadline: '2026-10-08T10:00:00.000Z' })[0];
  const powrot = wykryjZmiany({ deadline: '2026-10-08T10:00:00.000Z' }, { deadline: '2026-10-01T10:00:00.000Z' })[0];

  assert.equal(kluczZmiany('bk~123', doPrzodu), kluczZmiany('bk~123', doPrzodu));
  assert.notEqual(kluczZmiany('bk~123', doPrzodu), kluczZmiany('bk~123', powrot));
  assert.notEqual(kluczZmiany('bk~123', doPrzodu), kluczZmiany('bk~999', doPrzodu));
});

test('czy jest o czym powiadamiać: sama poprawka tytułu nie wystarcza', () => {
  const drobne = wykryjZmiany({ title: 'A' }, { title: 'B' });
  const powazne = wykryjZmiany({ deadline: '2026-10-08T10:00:00.000Z' }, { deadline: '2026-10-02T10:00:00.000Z' });
  assert.equal(czySaIstotne(drobne), false);
  assert.equal(czySaIstotne(powazne), true);
});

test('lista typów istotnych pokrywa dokładnie to, co obiecuje produkt', () => {
  assert.deepEqual([...TYPY_ISTOTNE].sort(), ['anulowanie', 'dokumenty', 'status', 'termin', 'umowa', 'wartosc']);
  for (const t of TYPY_ZMIAN) {
    assert.ok(t.kod && t.etykieta?.pl && t.etykieta?.en, `typ ${t.kod} bez etykiet PL/EN`);
  }
});

test('podsumowanie mówi ludzkim językiem, ile i jakich zmian przyszło', () => {
  const zmiany = wykryjZmiany(
    { deadline: '2026-10-08T10:00:00.000Z', budget: 100 },
    { deadline: '2026-10-02T10:00:00.000Z', budget: 200 },
  );
  const p = podsumujZmiany(zmiany);
  assert.ok(p.pl.length > 0 && p.en.length > 0);
  assert.equal(podsumujZmiany([]).pl, '');
});
