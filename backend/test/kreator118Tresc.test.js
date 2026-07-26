import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * TREŚĆ MERYTORYCZNA kreatora „Pożycz doświadczenie" (art. 118 Pzp) —
 * podzadanie 2/12. To statyczne dane (bez UI): wyjaśnienie art. 118 Pzp prostym
 * językiem, skupione na dwóch filarach, które decydują o (nie)fikcyjności
 * udostępnienia zasobów:
 *   1) przy ROBOTACH i USŁUGACH podmiot udostępniający doświadczenie musi
 *      REALNIE wykonać tę część zamówienia (najczęściej jako podwykonawca),
 *   2) doświadczenia NIE WOLNO „sumować" — jest niepodzielne.
 *
 * Testy pilnują KONTRAKTU struktury, na której oprą się kolejne podzadania
 * (UI kreatora, generator zobowiązania): stabilne id sekcji, obecność obu
 * filarów, oraz głęboka niemutowalność (treść to fakt prawny, nie da się jej
 * „poprawić" po imporcie).
 */

const { WYJASNIENIE_ART_118, sekcjaWyjasnienia, PULAPKI_FIKCYJNOSCI, ID_PULAPEK, pulapka } =
  await import('../src/lib/kreator118Tresc.js');

const ID_REALNY_UDZIAL = 'realny-udzial-podwykonawca';
const ID_ZAKAZ_SUMOWANIA = 'zakaz-sumowania';

// ── podstawa prawna i szkielet ───────────────────────────────────────────────

test('podstawa_prawna wskazuje art. 118 Pzp', () => {
  assert.match(WYJASNIENIE_ART_118.podstawa_prawna, /art\.\s*118/);
});

test('naglowek i wprowadzenie to niepuste stringi', () => {
  assert.equal(typeof WYJASNIENIE_ART_118.naglowek, 'string');
  assert.ok(WYJASNIENIE_ART_118.naglowek.trim().length > 0);
  assert.equal(typeof WYJASNIENIE_ART_118.wprowadzenie, 'string');
  assert.ok(WYJASNIENIE_ART_118.wprowadzenie.trim().length > 0);
});

test('zawiera dokładnie dwie wymagane sekcje po id', () => {
  const ids = WYJASNIENIE_ART_118.sekcje.map((s) => s.id);
  assert.deepEqual(ids, [ID_REALNY_UDZIAL, ID_ZAKAZ_SUMOWANIA]);
});

test('każda sekcja ma niepusty tytul i tresc', () => {
  for (const s of WYJASNIENIE_ART_118.sekcje) {
    assert.ok(s.tytul.trim().length > 0, `pusty tytul w sekcji ${s.id}`);
    assert.ok(s.tresc.trim().length > 0, `pusta tresc w sekcji ${s.id}`);
  }
});

// ── filar 1: realny udział jako podwykonawca (art. 118 ust. 2) ────────────────

test('sekcja realnego udziału dotyczy robót i usług', () => {
  const s = sekcjaWyjasnienia(ID_REALNY_UDZIAL);
  assert.deepEqual(s.dotyczy, ['roboty budowlane', 'usługi']);
});

test('sekcja realnego udziału mówi o podwykonawcy i realnym wykonaniu', () => {
  const s = sekcjaWyjasnienia(ID_REALNY_UDZIAL);
  assert.match(s.tresc, /podwykonaw/i);
  assert.match(s.tresc, /rzeczywi|realn/i);
});

// ── filar 2: zakaz sumowania doświadczenia ───────────────────────────────────

test('sekcja zakazu sumowania mówi o sumowaniu i niepodzielności', () => {
  const s = sekcjaWyjasnienia(ID_ZAKAZ_SUMOWANIA);
  assert.match(s.tresc, /sumowa/i);
  assert.match(s.tresc, /niepodziel|w całości|jeden podmiot/i);
});

// ── akcesor sekcji ───────────────────────────────────────────────────────────

test('sekcjaWyjasnienia zwraca sekcję o danym id', () => {
  assert.equal(sekcjaWyjasnienia(ID_ZAKAZ_SUMOWANIA).id, ID_ZAKAZ_SUMOWANIA);
});

test('sekcjaWyjasnienia rzuca dla nieznanego id', () => {
  assert.throws(() => sekcjaWyjasnienia('nie-ma-takiej'), /nieznane|nieznana|unknown|nie-ma-takiej/i);
});

// ── kluczowe zasady (skrót do szybkiego wyświetlenia) ────────────────────────

test('kluczowe_zasady to niepusta lista niepustych stringów', () => {
  assert.ok(Array.isArray(WYJASNIENIE_ART_118.kluczowe_zasady));
  assert.ok(WYJASNIENIE_ART_118.kluczowe_zasady.length >= 2);
  for (const z of WYJASNIENIE_ART_118.kluczowe_zasady) {
    assert.equal(typeof z, 'string');
    assert.ok(z.trim().length > 0);
  }
});

// ── głęboka niemutowalność (treść to fakt prawny, nie „poprawia się") ─────────

test('struktura jest głęboko zamrożona', () => {
  assert.ok(Object.isFrozen(WYJASNIENIE_ART_118));
  assert.ok(Object.isFrozen(WYJASNIENIE_ART_118.sekcje));
  assert.ok(Object.isFrozen(WYJASNIENIE_ART_118.kluczowe_zasady));
  for (const s of WYJASNIENIE_ART_118.sekcje) {
    assert.ok(Object.isFrozen(s), `sekcja ${s.id} nie jest zamrożona`);
  }
});

test('nie da się podmienić treści sekcji ani dopisać do listy zasad', () => {
  assert.throws(() => {
    WYJASNIENIE_ART_118.sekcje[0].tresc = 'podmiana';
  }, TypeError);
  assert.throws(() => {
    WYJASNIENIE_ART_118.sekcje.push({ id: 'x' });
  }, TypeError);
  assert.throws(() => {
    WYJASNIENIE_ART_118.kluczowe_zasady.push('x');
  }, TypeError);
});

// ── pułapki fikcyjności (podzadanie 3/12: do wyświetlenia i do walidacji) ─────

test('PULAPKI_FIKCYJNOSCI to niepusta tablica', () => {
  assert.ok(Array.isArray(PULAPKI_FIKCYJNOSCI));
  assert.ok(PULAPKI_FIKCYJNOSCI.length >= 5, 'oczekiwano co najmniej 5 typowych pułapek');
});

test('każda pułapka ma id, tytul, opis i jak_uniknac (niepuste stringi)', () => {
  for (const p of PULAPKI_FIKCYJNOSCI) {
    for (const pole of ['id', 'tytul', 'opis', 'jak_uniknac']) {
      assert.equal(typeof p[pole], 'string', `pole ${pole} nie jest stringiem w pułapce ${p.id}`);
      assert.ok(p[pole].trim().length > 0, `puste pole ${pole} w pułapce ${p.id}`);
    }
  }
});

test('id pułapek są unikalne i zgodne z rejestrem ID_PULAPEK', () => {
  const ids = PULAPKI_FIKCYJNOSCI.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'zduplikowane id pułapki');
  const zRejestru = new Set(Object.values(ID_PULAPEK));
  for (const id of ids) {
    assert.ok(zRejestru.has(id), `id „${id}" spoza rejestru ID_PULAPEK`);
  }
  assert.equal(zRejestru.size, ids.length, 'ID_PULAPEK i lista pułapek rozjeżdżają się');
});

test('powiazana_zasada (gdy jest) wskazuje istniejącą sekcję wyjaśnienia', () => {
  const idSekcji = new Set(WYJASNIENIE_ART_118.sekcje.map((s) => s.id));
  for (const p of PULAPKI_FIKCYJNOSCI) {
    if (p.powiazana_zasada !== undefined) {
      assert.ok(
        idSekcji.has(p.powiazana_zasada),
        `pułapka ${p.id} wskazuje nieistniejącą sekcję ${p.powiazana_zasada}`,
      );
    }
  }
});

test('lista pokrywa kluczowe scenariusze fikcyjności (referencje, sumowanie, podpis)', () => {
  const opisy = PULAPKI_FIKCYJNOSCI.map((p) => `${p.tytul} ${p.opis}`).join(' ').toLowerCase();
  assert.match(opisy, /referencj/); // użyczenie samych referencji bez realizacji
  assert.match(opisy, /sumow/); // składanie warunku z kawałków
  assert.match(opisy, /podpis/); // zobowiązanie niepodpisane przez podmiot / z ofertą
});

test('pulapka() zwraca pułapkę po id, rzuca dla nieznanego', () => {
  const jakas = PULAPKI_FIKCYJNOSCI[0].id;
  assert.equal(pulapka(jakas).id, jakas);
  assert.throws(() => pulapka('nie-ma-takiej-pulapki'), /nieznan|unknown|nie-ma-takiej-pulapki/i);
});

test('lista pułapek jest głęboko zamrożona', () => {
  assert.ok(Object.isFrozen(PULAPKI_FIKCYJNOSCI));
  assert.ok(Object.isFrozen(ID_PULAPEK));
  for (const p of PULAPKI_FIKCYJNOSCI) {
    assert.ok(Object.isFrozen(p), `pułapka ${p.id} nie jest zamrożona`);
  }
  assert.throws(() => {
    PULAPKI_FIKCYJNOSCI.push({ id: 'x' });
  }, TypeError);
  assert.throws(() => {
    PULAPKI_FIKCYJNOSCI[0].opis = 'podmiana';
  }, TypeError);
});
