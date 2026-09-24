import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * BAZA KONKURENCYJNOŚCI — testy KONTRAKTOWE na utrwalonych odpowiedziach API.
 *
 * Fixture'y w test/fixtures/bk-*.json to DOSŁOWNE odpowiedzi żywego API z pomiaru
 * 2026-09-24. Gdy BK zmieni schemat, te testy pękną z nazwą pola, a nie objawią
 * się jako cichy feed pełen `null`-i (dokładnie ta klasa awarii, przez którą BZP
 * gubiło 85 % okna bez jednego błędu w logach).
 *
 * 🚨 NAJWAŻNIEJSZA PUŁAPKA API (zmierzona, nie wydedukowana):
 * `GET /announcements/{id}` zwraca `data.advertisement` = WERSJĘ ogłoszenia, a nie
 * ogłoszenie. Wersja ma WŁASNE `id` (inne niż to z listy!) i WŁASNY `status`, który
 * zawsze brzmi PUBLISHED. Prawdziwe ogłoszenie — z identyfikatorem widocznym w
 * linku, numerem sprawy i STATUSEM ANULOWANIA — siedzi o poziom głębiej, w
 * `data.advertisement.advertisement`. Fixture `bk-szczegol-anulowane-191542.json`
 * jest tego dowodem: wersja mówi PUBLISHED, ogłoszenie mówi CANCELLED.
 * Adapter w backend/src/services/adaptery/ czyta płytkie `a.id` — dlatego ten kod
 * NIE jest jego kopią.
 */

process.env.ANTHROPIC_API_KEY = '';

const {
  normalizujOgloszenieBk, wyodrebnijListe, wyodrebnijOgloszenie, statusOgloszenia,
  pobierzAktywne, pobierzSzczegolBk, ZRODLO, STATUS_AKTYWNY, STATUS_ANULOWANY,
} = await import('../src/services/bazaKonkurencyjnosci.js');
const { pustyLicznik } = await import('../src/lib/licznikZrodla.js');
const { stanTempa } = await import('../src/lib/tempoZapytan.js');

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const SZCZEGOL = fixture('bk-szczegol-292028.json');
const SZCZEGOL_WIELE = fixture('bk-szczegol-292045.json');
const ANULOWANE = fixture('bk-szczegol-anulowane-191542.json');
const LISTA = fixture('bk-lista.json');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (dane, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => dane,
  text: async () => JSON.stringify(dane),
});

const tempoTestowe = () => stanTempa({ spij: async () => {}, odstepMs: 0 });

/* ========================= kontrakt odpowiedzi ========================= */

test('KONTRAKT: identyfikator bierzemy z OGŁOSZENIA, nie z wersji (inaczej link prowadzi gdzie indziej)', () => {
  const plytkie = SZCZEGOL.data.advertisement.id;
  const t = normalizujOgloszenieBk(SZCZEGOL);

  assert.equal(t.externalId, 'bk:292028', 'to jest id z listy i z publicznego linku');
  assert.notEqual(String(plytkie), '292028', 'fixture musi bronić pułapki: wersja ma INNE id');
  assert.equal(t.url, 'https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/292028');
});

test('KONTRAKT: status anulowania siedzi na OGŁOSZENIU — wersja zawsze mówi PUBLISHED', () => {
  assert.equal(ANULOWANE.data.advertisement.status.label, STATUS_AKTYWNY,
    'wersja kłamie o stanie ogłoszenia — na tym polega pułapka');
  assert.equal(statusOgloszenia(ANULOWANE), STATUS_ANULOWANY);
  assert.equal(statusOgloszenia(SZCZEGOL), STATUS_AKTYWNY);
});

test('KONTRAKT: znormalizowane ogłoszenie ma kształt `tenders.upsert`', () => {
  const t = normalizujOgloszenieBk(SZCZEGOL);

  assert.equal(t.source, ZRODLO);
  assert.equal(t.organization, 'Fundacja Klaster LifeScience Kraków');
  assert.equal(t.cpvMain, '55120000-7, 55300000-3', 'wszystkie CPV pozycji — heurystyka filtruje po nich');
  assert.equal(t.currency, 'PLN');
  assert.equal(t.wojewodztwo, 'małopolskie');
  assert.equal(t.rodzaj, 'Usługa');
  assert.equal(t.numer, '2026-4203-292028', 'numer sprawy BK — po nim człowiek szuka w portalu');
  assert.equal(
    t.title,
    'Wynajem lokalu wraz z usługą cateringu na konferencji Life Science Open Space w Krakowie w dniach 26-27 listopada 2026 r.',
    'tytuł mieszka na WERSJI (nagłówek go nie ma) — pomyłka daje feed z pustymi pozycjami',
  );
});

test('KONTRAKT: daty schodzą do UTC tak samo jak w BZP/TED (baza porównuje je tekstem)', () => {
  const t = normalizujOgloszenieBk(SZCZEGOL);
  const surowyTermin = SZCZEGOL.data.advertisement.submission_deadline;

  assert.match(surowyTermin, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'BK oddaje czas POLSKI bez strefy');
  assert.match(t.deadline, /Z$/, 'bez normalizacji przetarg po terminie zostawałby w puli');
  assert.match(t.publishedAt, /Z$/);
  assert.equal(t.deadline, new Date(`${surowyTermin.replace(' ', 'T')}+02:00`).toISOString());
});

test('wiele zamówień: CPV zbierają się po WSZYSTKICH pozycjach, bez duplikatów', () => {
  const t = normalizujOgloszenieBk(SZCZEGOL_WIELE);
  assert.equal(t.externalId, 'bk:292045');
  assert.equal(t.cpvMain, '33696500-0, 38437000-7');
  assert.equal(t.liczba_czesci, 3, 'BK rozbija ogłoszenie na `orders` — to są części zamówienia');
});

test('brak szacowanej wartości NIE jest zerem — null znaczy „BK tego nie ujawnia"', () => {
  const t = normalizujOgloszenieBk(SZCZEGOL);
  assert.equal(SZCZEGOL.data.advertisement.orders[0].estimated_value, null);
  assert.equal(t.budget, null, 'zero w budżecie skłamałoby, że zamówienie jest za darmo');
});

test('wartość w formacie PL sumuje się po zamówieniach i nie gubi groszy', () => {
  const zWartoscia = structuredClone(SZCZEGOL_WIELE);
  const o = zWartoscia.data.advertisement.orders;
  o[0].estimated_value = '92 228,84';
  o[1].estimated_value = '7 771,16';
  assert.equal(normalizujOgloszenieBk(zWartoscia).budget, 100_000);
});

test('ogłoszenie BEZ identyfikatora albo BEZ tytułu jest odrzucane (nie da się go zdeduplikować)', () => {
  assert.equal(normalizujOgloszenieBk({ data: { advertisement: { advertisement: { id: null }, title: 'X' } } }), null);
  assert.equal(normalizujOgloszenieBk({ data: { advertisement: { advertisement: { id: 5 }, title: '  ' } } }), null);
  assert.equal(normalizujOgloszenieBk(null), null);
});

test('tytuł z listy bywa opakowany w <mark> (podświetlenie wyszukiwarki) — tagi lecą precz', () => {
  const zTagami = structuredClone(SZCZEGOL);
  zTagami.data.advertisement.title = ['Zakup <mark>usługi</mark> cateringowej'];
  assert.equal(normalizujOgloszenieBk(zTagami).title, 'Zakup usługi cateringowej');
});

test('raw zapisuje NAGŁÓWEK ogłoszenia, nie cały ekran szczegółów (limit 1 MiB na dokument)', () => {
  const t = normalizujOgloszenieBk(SZCZEGOL);
  assert.equal(t.raw.id, 292028);
  assert.equal(t.raw.status, STATUS_AKTYWNY);
  assert.equal(t.raw.terms_of_contract_change, undefined, 'warunki zmiany umowy to kilobajty prozy');
  assert.ok(t.raw.modified_at, 'znacznik zmiany decyduje, czy ogłoszenie trzeba pobrać ponownie');
});

/* ========================= lista i paginacja ========================= */

test('wyodrebnijListe/wyodrebnijOgloszenie czytają kopertę API, nie zgadują', () => {
  assert.equal(wyodrebnijListe(LISTA).length, 3);
  assert.equal(wyodrebnijListe(null).length, 0);
  assert.equal(wyodrebnijOgloszenie(SZCZEGOL).id, 292028);
});

test('paginacja: kolejne strony aż do wyczerpania `meta.total`', async () => {
  const strony = [];
  globalThis.fetch = async (url) => {
    const strona = Number(new URL(url).searchParams.get('page'));
    strony.push(strona);
    const start = (strona - 1) * 2;
    const adv = [0, 1].map((i) => ({ id: start + i + 1 })).filter((a) => a.id <= 5);
    return odpowiedz({ data: { advertisements: adv, meta: { total: 5 } } });
  };

  const licznik = pustyLicznik();
  const wynik = await pobierzAktywne({ licznik, limitStrony: 2, tempo: tempoTestowe() });

  assert.deepEqual(strony, [1, 2, 3]);
  assert.equal(wynik.aktywne.size, 5);
  assert.equal(wynik.total, 5);
  assert.equal(wynik.pokrycieKompletne, true);
  assert.equal(licznik.zapytania, 3);
  assert.equal(licznik.surowe, 5);
});

/*
 * 🚨 ZMIERZONE 2026-09-24: BK oddaje wyniki w NIESTABILNEJ kolejności (dwa
 * identyczne zapytania `page=1` zwróciły różne zestawy). Pojedynczy przebieg
 * paginacji pokrył raz 921/1135, raz 1012/1135 rekordów. Bez powtórki przebiegu
 * gubilibyśmy 11–19 % rynku BK — po cichu, bo API nie zgłasza żadnego błędu.
 */
test('KRYTYCZNE: niestabilna kolejność BK — przebieg powtarza się aż do pełnego pokrycia', async () => {
  let przebieg = 0;
  globalThis.fetch = async (url) => {
    const strona = Number(new URL(url).searchParams.get('page'));
    if (strona === 1) przebieg += 1;
    const adv = przebieg === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }, { id: 3 }];
    return odpowiedz({ data: { advertisements: strona === 1 ? adv : [], meta: { total: 3 } } });
  };

  const licznik = pustyLicznik();
  const wynik = await pobierzAktywne({ licznik, limitStrony: 2, maksPrzebiegow: 3, tempo: tempoTestowe() });

  assert.equal(wynik.aktywne.size, 3, 'dopiero drugi przebieg domknął zestaw');
  assert.equal(wynik.przebiegi, 2);
  assert.equal(wynik.pokrycieKompletne, true);
  assert.ok(licznik.zduplikowaneZrodla > 0, 'nakładka między przebiegami to mierzalny koszt strategii');
});

test('pokrycie NIEPEŁNE jest raportowane, a nie przemilczane (inaczej znika cichy kawałek rynku)', async () => {
  globalThis.fetch = async () => odpowiedz({ data: { advertisements: [{ id: 1 }], meta: { total: 9 } } });

  const licznik = pustyLicznik();
  const wynik = await pobierzAktywne({ licznik, limitStrony: 1, maksPrzebiegow: 2, tempo: tempoTestowe() });

  assert.equal(wynik.pokrycieKompletne, false);
  assert.equal(wynik.aktywne.size, 1);
  assert.equal(wynik.total, 9);
  assert.equal(licznik.pokrycieKompletne, false, 'ślad cyklu musi to zobaczyć');
});

test('limit stron chroni przed pętlą, gdy `meta.total` kłamie w górę', async () => {
  globalThis.fetch = async (url) => {
    const strona = Number(new URL(url).searchParams.get('page'));
    return odpowiedz({ data: { advertisements: [{ id: strona }], meta: { total: 1e9 } } });
  };

  const wynik = await pobierzAktywne({ limitStrony: 1, maksStron: 4, maksPrzebiegow: 1, tempo: tempoTestowe() });
  assert.equal(wynik.zapytania, 4);
});

test('budżet czasu przerywa paginację i JAWNIE oddaje niepełne pokrycie', async () => {
  globalThis.fetch = async (url) => {
    const strona = Number(new URL(url).searchParams.get('page'));
    return odpowiedz({ data: { advertisements: [{ id: strona }], meta: { total: 100 } } });
  };

  let zegar = 0;
  const tempo = stanTempa({ spij: async () => {}, odstepMs: 0, teraz: () => { zegar += 1000; return zegar; } });
  const wynik = await pobierzAktywne({ limitStrony: 1, maksStron: 50, budzetMs: 3000, tempo });

  assert.ok(wynik.zapytania <= 5, `budżet uciął pobieranie (zapytań: ${wynik.zapytania})`);
  assert.equal(wynik.pokrycieKompletne, false);
});

test('pusta strona kończy przebieg — nie zapętlamy się na milczącym API', async () => {
  let zapytania = 0;
  globalThis.fetch = async () => {
    zapytania += 1;
    return odpowiedz({ data: { advertisements: [], meta: { total: 500 } } });
  };
  const wynik = await pobierzAktywne({ limitStrony: 100, maksStron: 20, maksPrzebiegow: 2, tempo: tempoTestowe() });
  assert.equal(zapytania, 2, 'jedna pusta strona na przebieg, dwa przebiegi');
  assert.equal(wynik.aktywne.size, 0);
});

test('BK wymaga filtra statusu — jego brak to po ich stronie HTTP 500 (zmierzone)', async () => {
  let widzianyUrl = null;
  globalThis.fetch = async (url) => {
    widzianyUrl = String(url);
    return odpowiedz({ data: { advertisements: [], meta: { total: 0 } } });
  };
  await pobierzAktywne({ tempo: tempoTestowe() });
  assert.match(widzianyUrl, /status%5B0%5D=PUBLISHED/);
});

test('błąd HTTP po ponowieniach RZUCA — rejestr źródeł zamieni to na stan degraded', async () => {
  globalThis.fetch = async () => odpowiedz({ message: 'Internal Server Error' }, 500);
  await assert.rejects(
    () => pobierzAktywne({ tempo: tempoTestowe(), maksStron: 1 }),
    /Baza Konkurencyjności[\s\S]*500/,
  );
});

test('pobierzSzczegolBk oddaje kopertę wprost z API (mapowanie jest osobną decyzją)', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/announcements\/292028$/);
    return odpowiedz(SZCZEGOL);
  };
  const json = await pobierzSzczegolBk(292028, { tempo: tempoTestowe() });
  assert.equal(wyodrebnijOgloszenie(json).id, 292028);
});

/*
 * ODPORNOŚĆ LISTOWANIA — zmierzone na PRODUKCJI 2026-09-24.
 *
 * Podczas kontrolowanego drenażu zaległości (7 przebiegów pod rząd) trzy przebiegi
 * padły w całości. Każdy trwał ~80 s, czyli dokładnie 3 × 25 s limitu czasu plus
 * odstępy ponowień: BK spowolniło pod naszym ruchem i jedna strona listy przestała
 * odpowiadać. Skutek był nieproporcjonalny do przyczyny — przebieg miał już pobrane
 * setki pozycji z wcześniejszych stron i wyrzucał je wszystkie razem z wyjątkiem.
 *
 * Reguła: awaria strony, gdy MAMY JUŻ DANE, kończy listowanie z jawnie niepełnym
 * pokryciem (checkpoint dopobierze resztę). Awaria, gdy nie mamy NICZEGO, nadal
 * rzuca — bo wtedy źródło jest realnie niedostępne i `/health` musi to pokazać.
 */

test('awaria strony po zebraniu części listy NIE kasuje całego przebiegu', async () => {
  let zapytania = 0;
  globalThis.fetch = async (url) => {
    zapytania += 1;
    const strona = Number(new URL(url).searchParams.get('page'));
    if (strona >= 2) throw new Error('The operation was aborted due to timeout');
    return odpowiedz({ data: { advertisements: [{ id: 1 }, { id: 2 }], meta: { total: 9 } } });
  };

  const licznik = pustyLicznik();
  const wynik = await pobierzAktywne({ licznik, limitStrony: 2, maksPrzebiegow: 1, tempo: tempoTestowe() });

  assert.equal(wynik.aktywne.size, 2, 'to, co już zebrane, zostaje — 985 ogłoszeń zaległości to za drogo, by je wyrzucać');
  assert.equal(wynik.pokrycieKompletne, false, 'ale przebieg MUSI się przyznać, że nie domknął listy');
  assert.equal(licznik.pokrycieKompletne, false);
});

test('awaria PIERWSZEJ strony (zero danych) nadal rzuca — źródło jest niedostępne', async () => {
  globalThis.fetch = async () => { throw new Error('The operation was aborted due to timeout'); };
  await assert.rejects(
    () => pobierzAktywne({ maksPrzebiegow: 1, tempo: tempoTestowe() }),
    /timeout/,
    'cisza zamiast błędu ukryłaby padnięte źródło przed /health',
  );
});
