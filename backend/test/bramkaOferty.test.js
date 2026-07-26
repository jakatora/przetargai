import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Bramka przedwysyłkowa oferty + mapowanie zmian SWZ na sekcje oferty (ulepszenie
 * „Radar pytań i odpowiedzi do SWZ", podzadanie 6/7).
 *
 * CZYSTA logika (bez DB, bez AI):
 *  • `mapujNaSekcjeOferty` — z opisu skutku / diffu zmiany wnioskuje, których sekcji
 *    oferty dotyczy (harmonogram / cena / parametry) — heurystyka słów kluczowych,
 *  • `zbudujCheckliste` — z listy zmian buduje checklistę: pozycje do odznaczenia,
 *    status sekcji („wymaga aktualizacji", gdy jest ≥1 nieuwzględniona zmiana jej
 *    dotycząca) i sygnał gotowości do wysyłki,
 *  • `ocenBramke` — decyzja bramki: dopuścić / zablokować / ostrzec (przy `wymus`).
 */

const { SEKCJE_OFERTY, mapujNaSekcjeOferty, zbudujCheckliste, ocenBramke } =
  await import('../src/lib/bramkaOferty.js');

// ── SEKCJE_OFERTY ────────────────────────────────────────────────────────────

test('SEKCJE_OFERTY: dokładnie harmonogram/cena/parametry, zamrożone', () => {
  assert.deepEqual([...SEKCJE_OFERTY], ['harmonogram', 'cena', 'parametry']);
  assert.ok(Object.isFrozen(SEKCJE_OFERTY));
});

// ── mapujNaSekcjeOferty ──────────────────────────────────────────────────────

test('mapuj: klasyczny skutek „termin 60→45 dni — przelicz harmonogram i cenę" => harmonogram+cena', () => {
  const s = mapujNaSekcjeOferty({ opisSkutku: 'termin realizacji 60→45 dni — przelicz harmonogram i cenę' });
  assert.deepEqual(s, ['harmonogram', 'cena'], 'kolejność wg SEKCJE_OFERTY, bez „parametry"');
});

test('mapuj: zmiana wymaganego parametru => parametry', () => {
  const s = mapujNaSekcjeOferty({ opisSkutku: 'zmieniono wymagany parametr — klasa betonu C30/37 zamiast C25/30' });
  assert.deepEqual(s, ['parametry']);
});

test('mapuj: brak dopasowania => pusta lista (nie zmyślamy sekcji)', () => {
  assert.deepEqual(mapujNaSekcjeOferty({ opisSkutku: 'poprawiono literówkę w nagłówku' }), []);
  assert.deepEqual(mapujNaSekcjeOferty({}), []);
});

test('mapuj: gdy brak opisu, wnioskuje z diffu', () => {
  const s = mapujNaSekcjeOferty({ opisSkutku: '', diff: '- Wynagrodzenie: 100 000 zł\n+ Wynagrodzenie: 120 000 zł' });
  assert.deepEqual(s, ['cena']);
});

test('mapuj: dubluje wg wielu słów, ale zwraca każdą sekcję raz i w stałej kolejności', () => {
  const s = mapujNaSekcjeOferty({ opisSkutku: 'nowa cena, inna stawka i waloryzacja wynagrodzenia' });
  assert.deepEqual(s, ['cena'], 'trzy słowa „cenowe" => jedna sekcja');
});

// ── zbudujCheckliste ─────────────────────────────────────────────────────────

test('checklista: brak zmian => gotowa (nie ma czego uwzględniać)', () => {
  const c = zbudujCheckliste([]);
  assert.deepEqual(c.pozycje, []);
  assert.equal(c.do_odznaczenia, 0);
  assert.equal(c.wszystkie_uwzglednione, true);
  assert.equal(c.gotowa_do_wyslania, true);
  // Sekcje raportowane zawsze (kanoniczne trzy), wszystkie „nie wymaga".
  assert.deepEqual(c.sekcje.map((s) => s.sekcja), ['harmonogram', 'cena', 'parametry']);
  assert.ok(c.sekcje.every((s) => s.wymaga_aktualizacji === false));
});

test('checklista: nieuwzględniona zmiana flaguje powiązane sekcje i blokuje gotowość', () => {
  const c = zbudujCheckliste([
    {
      id: 'z1',
      data_publikacji: '2026-07-20T00:00:00.000Z',
      opis_skutku: 'termin realizacji 60→45 dni — przelicz harmonogram i cenę',
      elementy_oferty: ['harmonogram', 'cena'],
      uwzglednione: 0,
    },
  ]);
  assert.equal(c.do_odznaczenia, 1);
  assert.equal(c.wszystkie_uwzglednione, false);
  assert.equal(c.gotowa_do_wyslania, false);

  const flaga = Object.fromEntries(c.sekcje.map((s) => [s.sekcja, s.wymaga_aktualizacji]));
  assert.equal(flaga.harmonogram, true);
  assert.equal(flaga.cena, true);
  assert.equal(flaga.parametry, false, 'sekcja nietknięta zmianą nie wymaga aktualizacji');

  assert.equal(c.pozycje[0].uwzglednione, false);
  assert.equal(c.pozycje[0].wymaga_aktualizacji, true);
});

test('checklista: gdy zmiana uwzględniona, sekcje gasną i bramka jest gotowa', () => {
  const c = zbudujCheckliste([
    { id: 'z1', opis_skutku: 'nowy termin realizacji', elementy_oferty: ['harmonogram'], uwzglednione: 1 },
  ]);
  assert.equal(c.do_odznaczenia, 0);
  assert.equal(c.gotowa_do_wyslania, true);
  assert.ok(c.sekcje.every((s) => s.wymaga_aktualizacji === false));
  assert.equal(c.pozycje[0].uwzglednione, true);
});

test('checklista: gdy elementy_oferty puste, wywnioskuje sekcje z opisu skutku', () => {
  const c = zbudujCheckliste([
    { id: 'z1', opis_skutku: 'zmiana wymaganego parametru materiału', elementy_oferty: [], uwzglednione: 0 },
  ]);
  assert.deepEqual(c.pozycje[0].elementy_oferty, ['parametry'], 'brak zapisanego mapowania => wnioskuj z opisu');
  const flaga = Object.fromEntries(c.sekcje.map((s) => [s.sekcja, s.wymaga_aktualizacji]));
  assert.equal(flaga.parametry, true);
});

test('checklista: mieszane — jedna uwzględniona, jedna nie => blokada, tylko żywa sekcja świeci', () => {
  const c = zbudujCheckliste([
    { id: 'z1', opis_skutku: 'termin realizacji', elementy_oferty: ['harmonogram'], uwzglednione: 1 },
    { id: 'z2', opis_skutku: 'nowa cena', elementy_oferty: ['cena'], uwzglednione: 0 },
  ]);
  assert.equal(c.do_odznaczenia, 1);
  assert.equal(c.gotowa_do_wyslania, false);
  const flaga = Object.fromEntries(c.sekcje.map((s) => [s.sekcja, s.wymaga_aktualizacji]));
  assert.equal(flaga.harmonogram, false, 'harmonogram już uwzględniony => nie wymaga');
  assert.equal(flaga.cena, true, 'nieuwzględniona zmiana ceny => sekcja świeci');
});

// ── ocenBramke ───────────────────────────────────────────────────────────────

test('bramka: wszystko uwzględnione => dopuszczona, poziom ok', () => {
  const c = zbudujCheckliste([]);
  const b = ocenBramke(c);
  assert.equal(b.dopuszczona, true);
  assert.equal(b.poziom, 'ok');
});

test('bramka: nieodznaczone pozycje bez wymuszenia => zablokowana (blokada)', () => {
  const c = zbudujCheckliste([
    { id: 'z1', opis_skutku: 'nowa cena', elementy_oferty: ['cena'], uwzglednione: 0 },
  ]);
  const b = ocenBramke(c);
  assert.equal(b.dopuszczona, false);
  assert.equal(b.poziom, 'blokada');
  assert.equal(b.do_odznaczenia, 1);
});

test('bramka: nieodznaczone pozycje z wymuszeniem => dopuszczona, ale poziom ostrzezenie', () => {
  const c = zbudujCheckliste([
    { id: 'z1', opis_skutku: 'nowa cena', elementy_oferty: ['cena'], uwzglednione: 0 },
  ]);
  const b = ocenBramke(c, { wymus: true });
  assert.equal(b.dopuszczona, true);
  assert.equal(b.poziom, 'ostrzezenie');
  assert.equal(b.do_odznaczenia, 1);
});
