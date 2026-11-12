import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Powiadomienia o zmianie zapisanego przetargu (2026-11-10): „ogłoszenie o zmianie” BZP bez zmiany terminu
 * (warunki, wadium, przedmiot, umowa) i nowa wersja ogłoszenia w TED (sprostowanie). Dotąd oba przypadki
 * zmieniały przetarg po cichu — kto go zapisał, nie dostawał nic.
 */
process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { zmianaOgloszenia, alertZmianyOgloszenia, alertZmianyTerminu, zmianyPrzedPo, opisZmiany, tekstOgloszenia } = await import('../src/lib/zmianaTerminuBzp.js');
const { alertNowejWersjiTed } = await import('../src/lib/wersjeTed.js');
const { runZmianyTerminowBzp } = await import('../src/jobs/zmianyTerminowBzp.js');
const { runWersjeTed } = await import('../src/jobs/wersjeTed.js');

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/bzp-zmiany-ogloszen.json', import.meta.url), 'utf8'));
const TERAZ = Date.parse('2026-10-30T12:00:00Z');

test('parser zmiany ogłoszenia (prawdziwe ogłoszenia): pozycje bez terminów; ogłoszenie o wykonaniu umowy → null', () => {
  const wg = (nr) => zmianaOgloszenia(FIXTURE.find((n) => n.noticeNumber === nr));
  assert.deepEqual(wg('2026/BZP 00510761/01').pozycje, [
    '4.2.10. Data końcowa okresu obowiązywania',
    '7.5. Zamawiający uwzględnił aspekty społeczne, środowiskowe,…',
    '7.6. Zamawiający przewiduje następujące wymagania związane z…',
  ]);
  assert.equal(wg('2026/BZP 00510761/01').numerZmienianego, '2026/BZP 00490611');
  assert.deepEqual(wg('2026/BZP 00510617/01').pozycje, [], 'same terminy (8.1, 8.3, 8.4) — to obsługuje alert terminu');
  assert.equal(wg('2026/BZP 00510575/01'), null, 'zmiana ogłoszenia o wykonaniu umowy');
  assert.equal(zmianaOgloszenia({ htmlBody: '<p>brak numeru</p>' }), null);
});

test('„było → jest” z prawdziwego ogłoszenia BZP: wartości przed i po, dodano/usunięto, bez terminów (2026-11-12)', () => {
  const n = FIXTURE.find((x) => x.noticeNumber === '2026/BZP 00510761/01');
  assert.deepEqual(zmianyPrzedPo(tekstOgloszenia(n.htmlBody)), [
    { pozycja: '4.2.10. Data końcowa okresu obowiązywania', przed: '2026-11-30', po: '2026-12-15' },
    { pozycja: '7.5. Zamawiający uwzględnił aspekty społeczne, środowiskowe,…', przed: 'NIE', po: 'TAK' },
    { pozycja: '7.6. Zamawiający przewiduje następujące wymagania związane z…', przed: '', po: 'w zakresie zatrudnienia na podstawie stosunku pracy, w okolicznościach, o…' },
  ]);
  assert.deepEqual(zmianaOgloszenia(n).zmiany.map((z) => z.pozycja), zmianaOgloszenia(n).pozycje, 'te same pozycje co lista');
  assert.equal(opisZmiany({ pozycja: '6.4. Wadium', przed: '5000 zł', po: '10000 zł' }), '6.4. Wadium: było „5000 zł”, jest „10000 zł”');
  assert.equal(opisZmiany({ pozycja: '7.6. Wymagania', przed: '', po: 'zatrudnienie na umowę o pracę' }), '7.6. Wymagania: dodano „zatrudnienie na umowę o pracę”');
  assert.equal(opisZmiany({ pozycja: '5.4. Warunki', przed: 'dwie roboty', po: '' }), '5.4. Warunki: usunięto „dwie roboty”');

  const tender = { id: '2026~BZP_00490611', title: 'Dostawa paliw', organization: 'Gmina Krasne', deadline: '2026-11-20T09:00:00.000Z' };
  const o = zmianaOgloszenia(zmianaWarunkow('2026/BZP 00500202', '2026/BZP 00510999/01'));
  const a = alertZmianyOgloszenia({ tender, pozycje: o.pozycje, numer: o.numer, zmiany: o.zmiany });
  assert.equal(a.tresc.pl, 'Gmina Krasne zmienił ogłoszenie w BZP: 5.4. Nazwa i opis warunków udziału w postępowaniu: było „dwie roboty”, jest „jedna robota”. Sprawdź zmiany przed złożeniem oferty — oferta, która ich nie uwzględnia, może zostać odrzucona.');
  assert.deepEqual(a.zmiany, [{ pozycja: '5.4. Nazwa i opis warunków udziału w postępowaniu', przed: 'dwie roboty', po: 'jedna robota' }]);
  const t = alertZmianyTerminu({ tender, staryTermin: '2026-11-13T10:00:00.000Z', nowyTermin: '2026-11-20T10:00:00.000Z', inne: o.pozycje, inneZmiany: o.zmiany });
  assert.match(t.tresc.pl, /Zmienił też: 5\.4\. Nazwa i opis warunków udziału w postępowaniu: było „dwie roboty”, jest „jedna robota” — sprawdź/);
});

test('alerty: zmiana ogłoszenia z listą pozycji, termin z dopiskiem „Zmienił też”, klucz na ogłoszenie o zmianie', () => {
  const tender = { id: '2026~BZP_00490611', title: 'Dostawa paliw', organization: 'Gmina Krasne', deadline: '2026-11-20T09:00:00.000Z' };
  const a = alertZmianyOgloszenia({ tender, pozycje: ['5.4. Warunki udziału', '6.4. Wadium'], numer: '2026/BZP 00510761/01' });
  assert.deepEqual([a.typ, a.ton, a.klucz], ['zmiany', 'ostrzezenie', 'ogloszenie_2026~BZP_00490611_2026_BZP_00510761_01']);
  assert.equal(a.tytul.pl, 'Zmiana ogłoszenia w zapisanym przetargu: Dostawa paliw');
  assert.equal(a.tresc.pl, 'Gmina Krasne zmienił ogłoszenie w BZP: 5.4. Warunki udziału; 6.4. Wadium. Sprawdź zmiany przed złożeniem oferty — oferta, która ich nie uwzględnia, może zostać odrzucona.');
  assert.equal(alertZmianyOgloszenia({ tender, pozycje: [] }), null);

  const t = alertZmianyTerminu({ tender, staryTermin: '2026-11-13T10:00:00.000Z', nowyTermin: '2026-11-20T10:00:00.000Z', inne: ['4.2.10. Data końcowa okresu obowiązywania'] });
  assert.equal(t.ton, 'ostrzezenie', 'termin później, ale coś jeszcze się zmieniło');
  assert.match(t.tresc.pl, /Przypomnienie ustawiliśmy na nowy termin\. Zmienił też: 4\.2\.10\. Data końcowa okresu obowiązywania — sprawdź przed złożeniem oferty\.$/);
  assert.equal(alertZmianyTerminu({ tender, staryTermin: '2026-11-13T10:00:00.000Z', nowyTermin: '2026-11-20T10:00:00.000Z' }).ton, 'neutral');
});

/** Ogłoszenie o zmianie warunków udziału — bez zmiany terminu (wzór jak w BZP). */
const zmianaWarunkow = (numerZmienianego, numer) => ({
  noticeNumber: numer,
  publicationDate: '2026-10-30T09:00:00Z',
  htmlBody: `<p>SEKCJA III ZMIANA OGŁOSZENIA 3.1.) Nazwa zmienianego ogłoszenia: Ogłoszenie o zamówieniu 3.2.) Numer zmienianego ogłoszenia w BZP: ${numerZmienianego}
    3.3.) Identyfikator ostatniej wersji zmienianego ogłoszenia: 01 3.4.) Identyfikator sekcji zmienianego ogłoszenia: SEKCJA V - KWALIFIKACJA WYKONAWCÓW
    3.4.1.) Opis zmiany, w tym tekst, który należy dodać lub zmienić: 5.4. Nazwa i opis warunków udziału w postępowaniu. Przed zmianą: dwie roboty Po zmianie: jedna robota</p>`,
});

function atrapyBzp({ stan, ogloszenia }) {
  const dodane = new Set();
  const push = [];
  const aktualizacje = [];
  return {
    push, aktualizacje,
    deps: {
      teraz: TERAZ,
      pobierzDzien: async (dzien) => (dzien === '2026-10-30' ? ogloszenia : []),
      przetargi: {
        polaWielu: async (ids) => ids.map((id) => stan[id] && { id, ...stan[id] }).filter(Boolean),
        zaktualizujZeZrodla: async (t) => { aktualizacje.push(t); return { zmienione: true }; },
      },
      zapisane: { otwarteWszystkich: async () => [{ userId: 'u1', tenderId: '2026~BZP_00500202' }], zaangazowaneWszystkich: async () => [{ userId: 'u2', tenderId: '2026~BZP_00500202' }] },
      konta: { findById: async (id) => ({ id, push_token: `tok-${id}` }) },
      alertyRepo: { dodaj: async (uid, a) => { const k = `${uid}/${a.klucz}`; const nowy = !dodane.has(k); dodane.add(k); return { nowy }; } },
      wyslijPush: async (token, tresc) => { push.push([token, tresc.data.type, tresc.title]); return { sent: 1 }; },
      wyslijEmail: async () => {},
    },
  };
}

test('job BZP: zmiana warunków w zapisanym przetargu → alert do zapisanych i analizujących, raz; przetarg bez zmian', async () => {
  const stan = { '2026~BZP_00500202': { deadline: '2026-11-04T09:00:00.000Z', title: 'Dostawa sprzętu komputerowego', organization: 'PUW' } };
  const { deps, push, aktualizacje } = atrapyBzp({ stan, ogloszenia: [zmianaWarunkow('2026/BZP 00500202', '2026/BZP 00520000/01')] });
  const w = await runZmianyTerminowBzp(deps);
  assert.deepEqual([w.zmian_terminu, w.zmian_ogloszen, w.alerty_ogloszen, w.ok], [0, 1, 2, true]);
  assert.deepEqual(aktualizacje, [], 'zmiana ogłoszenia nie rusza terminu ani przetargu');
  assert.deepEqual(push.map(([tok, typ]) => [tok, typ]), [['tok-u1', 'zmiany'], ['tok-u2', 'zmiany']]);
  assert.match(push[0][2], /Zmiana ogłoszenia w zapisanym przetargu: Dostawa sprzętu komputerowego/);
  assert.equal(zmianaOgloszenia(zmianaWarunkow('2026/BZP 00500202', 'x')).pozycje[0], '5.4. Nazwa i opis warunków udziału w postępowaniu', 'bez kropki na końcu');
  const w2 = await runZmianyTerminowBzp(deps);
  assert.equal(w2.alerty_ogloszen, 0, 'powtórka okna nie budzi drugi raz');
});

test('job BZP: po terminie albo bez powiadamiania — bez alertu; przetargu, którego nie mamy — też', async () => {
  const stan = { '2026~BZP_00500202': { deadline: '2026-10-29T09:00:00.000Z', title: 'Stary przetarg' } };
  const ogloszenia = [zmianaWarunkow('2026/BZP 00500202', '2026/BZP 00520001/01'), zmianaWarunkow('2026/BZP 00999999', '2026/BZP 00520002/01')];
  const a = atrapyBzp({ stan, ogloszenia });
  assert.equal((await runZmianyTerminowBzp(a.deps)).alerty_ogloszen, 0);
  const b = atrapyBzp({ stan: { '2026~BZP_00500202': { deadline: '2026-11-04T09:00:00.000Z' } }, ogloszenia });
  assert.equal((await runZmianyTerminowBzp({ ...b.deps, powiadamiaj: false })).alerty_ogloszen, 0);
});

test('alert TED: nowy termin z poprzednim, sama data bez „23:59”, klucz na aktualną wersję', () => {
  const tender = { id: 'ted:770139-2026', title: 'Odczynniki Phadia', organization: 'Szpital Kliniczny', deadline: '2026-11-27T10:00:00.000Z' };
  const a = alertNowejWersjiTed({ tender, staryTermin: '2026-11-20T22:59:59.999Z' });
  assert.deepEqual([a.typ, a.ton, a.klucz, a.tender_id], ['zmiany', 'ostrzezenie', 'ted_wersja_ted_770139-2026', 'ted:770139-2026']);
  assert.equal(a.tytul.pl, 'Zmiana ogłoszenia w zapisanym przetargu: Odczynniki Phadia');
  assert.equal(a.tresc.pl, 'Szpital Kliniczny opublikował w TED sprostowanie ogłoszenia (nową wersję). Nowy termin ofert: 27.11.2026, 11:00 (było 20.11.2026) — przypomnienie ustawiliśmy na nowy termin. Sprawdź zmiany i dokumenty przed złożeniem oferty.');
  const bez = alertNowejWersjiTed({ tender: { ...tender, deadline: '2026-11-27T22:59:59.999Z' }, staryTermin: '2026-11-27T22:59:59.999Z' });
  assert.match(bez.tresc.pl, /Termin ofert bez zmian: 27\.11\.2026\. Sprawdź/);
});

function atrapyTed({ zapisaneWersje }) {
  const dodane = new Set();
  const push = [];
  const dokumenty = [
    { id: 'ted:700001-2026', published_at: '2026-10-20T00:00:00+02:00', deadline: '2026-11-20T22:59:59.999Z', postepowanie_id: 'P1' },
    { id: 'ted:750001-2026', published_at: '2026-11-05T00:00:00+01:00', deadline: '2026-11-27T10:00:00.000Z', postepowanie_id: 'P1' },
  ];
  return {
    push,
    deps: {
      postepowania: ['P1'],
      teraz: Date.parse('2026-11-06T10:00:00Z'),
      przetargi: {
        tedPoPostepowaniu: async () => dokumenty.map((d) => ({ ...d })),
        zastapWersje: async () => 1,
        polaWielu: async (ids) => ids.map((id) => ({ id, title: 'Odczynniki Phadia', organization: 'Szpital', deadline: '2026-11-27T10:00:00.000Z' })),
      },
      oceny: { przeniesNaWersje: async () => ({ oceny: 0, dopasowania: 0 }) },
      zapisane: { otwarteWszystkich: async () => zapisaneWersje, zaangazowaneWszystkich: async () => [] },
      konta: { findById: async (id) => ({ id, push_token: `tok-${id}` }) },
      alertyRepo: { dodaj: async (uid, a) => { const k = `${uid}/${a.klucz}`; const nowy = !dodane.has(k); dodane.add(k); return { nowy }; } },
      wyslijPush: async (token, tresc) => { push.push([token, tresc.data.type]); return { sent: 1 }; },
      wyslijEmail: async () => {},
    },
  };
}

test('job TED: nowa wersja → alert do zapisanych starszej wersji; uzupełnianie wstecz (bez powiadamiania) nie budzi', async () => {
  const zapisaneWersje = [{ userId: 'u1', tenderId: 'ted:700001-2026' }, { userId: 'u2', tenderId: 'ted:750001-2026' }];
  const z = atrapyTed({ zapisaneWersje });
  const w = await runWersjeTed({ ...z.deps, powiadamiaj: true });
  assert.deepEqual([w.zastapione, w.alerty, w.ok], [1, 1, true]);
  assert.deepEqual(z.push, [['tok-u1', 'zmiany']], 'u2 zapisał już aktualną wersję');
  const bez = atrapyTed({ zapisaneWersje });
  const w2 = await runWersjeTed(bez.deps);
  assert.deepEqual([w2.zastapione, w2.alerty, bez.push.length], [1, 0, 0], 'domyślnie bez powiadomień (/admin/wersje-ted)');
});
