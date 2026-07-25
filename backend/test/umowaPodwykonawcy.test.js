import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Detektor ZAPISÓW O PODWYKONAWCACH `wykryj_podwykonawcow` — podzadanie 6/12
 * ulepszenia „pilnowanie waloryzacji i pułapek w umowie". Czysta funkcja, testy
 * jednostkowe (bez serwera) na realistycznych fragmentach. Klucz: czy
 * podwykonawstwo jest DOPUSZCZONE czy ZAKAZANE/ograniczone (zakaz → pomarańczowa
 * flaga), oraz wychwyt warunków (zgoda Zamawiającego, przedkładanie umów,
 * solidarna odpowiedzialność). Testujemy „szczęśliwą ścieżkę" i ADWERSARYJNIE:
 * że słowa zakazu wiążemy z kontekstem podwykonawstwa, a nie z inną klauzulą.
 */

const { wykryj_podwykonawcow } = await import('../src/lib/umowaPodwykonawcy.js');

const PODWYK_DOPUSZCZONE = `
§ 12. Podwykonawstwo.
1. Wykonawca może powierzyć wykonanie części zamówienia podwykonawcom za uprzednią
zgodą Zamawiającego.
2. Wykonawca przedłoży Zamawiającemu projekt umowy o podwykonawstwo.
3. Wykonawca ponosi odpowiedzialność solidarną za zapłatę wynagrodzenia podwykonawcy.
`;

test('podwykonawstwo dopuszczone: wychwyt zgody, przedkładania i solidarnej odpowiedzialności', () => {
  const r = wykryj_podwykonawcow(PODWYK_DOPUSZCZONE);
  assert.equal(r.obecne, true);
  assert.equal(r.dozwolone, true);
  assert.equal(r.ostrzezenie, null, 'brak zakazu → brak flagi');
  assert.ok(r.ryzyka.some((n) => /zgod/i.test(n)), 'nota o zgodzie Zamawiającego');
  assert.ok(r.ryzyka.some((n) => /przedk|zgłasz/i.test(n)), 'nota o przedkładaniu umów');
  assert.ok(r.ryzyka.some((n) => /solidarn/i.test(n)), 'nota o solidarnej odpowiedzialności');
  assert.match(r.opis, /dopuszczone/);
});

test('zakaz podwykonawstwa → dozwolone=false i pomarańczowa flaga', () => {
  const t = 'Powierzenie wykonania części zamówienia podwykonawcom jest niedopuszczalne. '
    + 'Wykonawca wykona zamówienie wyłącznie własnymi siłami.';
  const r = wykryj_podwykonawcow(t);
  assert.equal(r.obecne, true);
  assert.equal(r.dozwolone, false);
  assert.ok(r.ostrzezenie, 'wykryty zakaz → ostrzezenie obecne');
  assert.equal(r.ostrzezenie.poziom, 'pomarańczowy');
  assert.equal(r.ostrzezenie.kod, 'zakaz_podwykonawstwa');
  assert.match(r.opis, /UWAGA|ogranicz|wyklucz/i);
});

test('obowiązek osobistego wykonania kluczowych części → traktowany jak ograniczenie', () => {
  const t = 'Zamawiający zastrzega obowiązek osobistego wykonania przez wykonawcę '
    + 'kluczowych części zamówienia. Pozostały zakres może być powierzony podwykonawcom.';
  const r = wykryj_podwykonawcow(t);
  assert.equal(r.obecne, true);
  assert.equal(r.dozwolone, false, '„osobistego wykonania" to istotne ograniczenie');
  assert.ok(r.ostrzezenie);
});

test('ADWERSARYJNIE: „niedopuszczalne” dot. innej klauzuli, z dala od podwykonawcy → brak zakazu', () => {
  const t = 'Opóźnienie w dostawie jest niedopuszczalne i skutkuje karą umowną. '
    + 'W odrębnym paragrafie strony dopuszczają udział podwykonawców za zgodą Zamawiającego.';
  const r = wykryj_podwykonawcow(t);
  assert.equal(r.obecne, true);
  assert.equal(r.dozwolone, true, 'słowo zakazu poza oknem podwykonawcy nie tworzy zakazu');
  assert.equal(r.ostrzezenie, null);
  assert.ok(r.ryzyka.some((n) => /zgod/i.test(n)));
});

test('brak zapisów o podwykonawcach → obecne=false, dozwolone=null, opis prosi o weryfikację', () => {
  const t = 'Umowa na dostawę materiałów biurowych. Wynagrodzenie ryczałtowe 50 000 zł. '
    + 'Termin realizacji 30 dni.';
  const r = wykryj_podwykonawcow(t);
  assert.equal(r.obecne, false);
  assert.equal(r.dozwolone, null);
  assert.equal(r.ryzyka.length, 0);
  assert.equal(r.ostrzezenie, null);
  assert.match(r.opis, /[Nn]ie wykryto zapisów o podwykonawcach/);
});

test('wejście puste/null/undefined/nie-string → bezpieczne wartości, bez wyjątku', () => {
  for (const w of [null, undefined, '', '   ', 123]) {
    const r = wykryj_podwykonawcow(w);
    assert.equal(r.obecne, false, `dla wejścia ${JSON.stringify(w)}`);
    assert.equal(r.dozwolone, null);
    assert.deepEqual(r.ryzyka, []);
    assert.equal(r.ostrzezenie, null);
    assert.equal(typeof r.opis, 'string');
  }
});
