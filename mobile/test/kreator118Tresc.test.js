import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ID_SEKCJI,
  WYJASNIENIE_ART_118,
  sekcjaWyjasnienia,
} from '../src/lib/kreator118Tresc.js';

/*
 * Treść merytoryczna kroku 1 kreatora „Pożycz doświadczenie" (ekran wyjaśnienia
 * zasad art. 118 Pzp). Ekran to cienki render — cała treść żyje tu i jest
 * testowana bez renderera (mobile nie ma Jesta). Kluczowe niezmienniki:
 *  - dwa filary o STABILNYCH id (parytet z backendem `kreator118Tresc.js`),
 *  - filar realnego udziału niesie zakres `dotyczy` = roboty + usługi (art. 118
 *    ust. 2 nie obejmuje dostaw) — inaczej ekran pokazałby zasadę tam, gdzie nie
 *    obowiązuje,
 *  - treść jest kompletna (żadna sekcja bez tytułu/treści/„ważne") i ZAMROŻONA
 *    (fakt prawny, ekran jej nie „poprawia").
 */

test('ID_SEKCJI: stabilne literały dwóch filarów (parytet z backendem)', () => {
  // Gdyby ktoś zmienił te literały, rozjechałyby się z backendem i z walidacją
  // na końcu kreatora (która zaczepia pułapki o id filarów) — cichy rozjazd.
  assert.equal(ID_SEKCJI.REALNY_UDZIAL, 'realny-udzial-podwykonawca');
  assert.equal(ID_SEKCJI.ZAKAZ_SUMOWANIA, 'zakaz-sumowania');
});

test('WYJASNIENIE_ART_118: nagłówek, wprowadzenie i podstawa prawna są niepuste', () => {
  for (const pole of ['naglowek', 'wprowadzenie', 'podstawa_prawna']) {
    assert.equal(typeof WYJASNIENIE_ART_118[pole], 'string');
    assert.ok(WYJASNIENIE_ART_118[pole].trim().length > 0, `puste pole „${pole}"`);
  }
  // Podstawa prawna wskazuje właściwy przepis.
  assert.match(WYJASNIENIE_ART_118.podstawa_prawna, /art\. 118/);
});

test('sekcje: dokładnie dwa filary w stabilnej kolejności, każdy kompletny', () => {
  const { sekcje } = WYJASNIENIE_ART_118;
  assert.equal(sekcje.length, 2);
  assert.deepEqual(
    sekcje.map((s) => s.id),
    [ID_SEKCJI.REALNY_UDZIAL, ID_SEKCJI.ZAKAZ_SUMOWANIA],
  );
  for (const s of sekcje) {
    for (const pole of ['tytul', 'tresc', 'wazne']) {
      assert.equal(typeof s[pole], 'string', `${s.id}: pole „${pole}" nie jest stringiem`);
      assert.ok(s[pole].trim().length > 0, `${s.id}: puste pole „${pole}"`);
    }
  }
});

test('filar realnego udziału niesie zakres „dotyczy" = roboty + usługi (nie dostawy)', () => {
  const filar = sekcjaWyjasnienia(ID_SEKCJI.REALNY_UDZIAL);
  assert.deepEqual(filar.dotyczy, ['roboty budowlane', 'usługi']);
  // Zakaz sumowania obowiązuje uniwersalnie — nie zawęża się rodzajem zamówienia.
  const zakaz = sekcjaWyjasnienia(ID_SEKCJI.ZAKAZ_SUMOWANIA);
  assert.equal(zakaz.dotyczy, undefined);
});

test('kluczowe_zasady: niepusta lista niepustych zdań', () => {
  const zasady = WYJASNIENIE_ART_118.kluczowe_zasady;
  assert.ok(Array.isArray(zasady) && zasady.length >= 2);
  for (const z of zasady) {
    assert.equal(typeof z, 'string');
    assert.ok(z.trim().length > 0);
  }
});

test('sekcjaWyjasnienia: zwraca sekcję po id, rzuca RangeError na nieznane id', () => {
  assert.equal(sekcjaWyjasnienia(ID_SEKCJI.ZAKAZ_SUMOWANIA).id, ID_SEKCJI.ZAKAZ_SUMOWANIA);
  assert.throws(() => sekcjaWyjasnienia('nie-ma-takiej'), RangeError);
});

test('treść jest głęboko zamrożona — ekran jej nie „poprawia" po imporcie', () => {
  assert.ok(Object.isFrozen(WYJASNIENIE_ART_118));
  assert.ok(Object.isFrozen(WYJASNIENIE_ART_118.sekcje));
  assert.ok(WYJASNIENIE_ART_118.sekcje.every((s) => Object.isFrozen(s)));
  assert.throws(() => {
    WYJASNIENIE_ART_118.sekcje[0].tytul = 'inny';
  }, TypeError);
});
