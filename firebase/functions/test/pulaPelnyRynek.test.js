import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/*
 * P0-5 — pula dopasowań przestaje mieć sufit 2000.
 *
 * Pomiar z produkcji 2026-09-23: `otwarte_przetargi = 7249` przy `openPool(2000)`.
 * Pula brała 2000 przetargów o NAJBLIŻSZYM terminie, więc silnik widział 28 % rynku,
 * a ogłoszenia z dalszym terminem składania nie trafiały do feedu NIGDY — cicho,
 * bez błędu. Firma dowiadywała się o przetargu dopiero, gdy termin zdążył się zbliżyć.
 *
 * Tu ustawiamy mały rozmiar strony, żeby stronicowanie dało się sprawdzić na kilku
 * dokumentach zamiast na tysiącach: stara wersja robiła JEDNO zapytanie z `limit()`,
 * więc wszystko poza pierwszą stroną przepadało.
 */
process.env.PULA_ROZMIAR_STRONY = '2';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { tenders, users, matches } = await import('../src/db/repos.js');
const { generateMatchesForUser } = await import('../src/services/matching.js');

/** Dziś + `dni`, w formacie kanonicznym (ten sam, którego używa `openPool`). */
function terminZa(dni) {
  return new Date(Date.now() + dni * 86_400_000).toISOString();
}

before(async () => {
  tenders.odswiezPule();
});

test('openPool — stronicowanie sięga poza pierwszą stronę zamiast ucinać pulę', async () => {
  for (const dni of [1, 2, 3, 4, 5]) {
    await tenders.upsert({
      externalId: `strona-${dni}`,
      title: `Remont nawierzchni etap ${dni}`,
      deadline: terminZa(dni),
    });
  }
  tenders.odswiezPule();

  const pula = await tenders.openPool({ swiezaKopia: true });
  const ids = pula.map((t) => t.id);

  for (const dni of [1, 2, 3, 4, 5]) {
    assert.ok(ids.includes(`strona-${dni}`),
      `strona-${dni} wypadło z puli — stronicowanie nie sięgnęło dalej niż pierwsza strona`);
  }
});

test('ogłoszenie z terminem +25 dni trafia do pasującego feedu mimo ogłoszeń z bliższym terminem', async () => {
  // Ogłoszenia z BLIŻSZYM terminem wypełniają pierwsze strony puli.
  for (const dni of [1, 2, 3, 4, 5, 6]) {
    await tenders.upsert({
      externalId: `blizszy-${dni}`,
      title: `Dostawa sprzętu biurowego ${dni}`,
      deadline: terminZa(dni),
    });
  }
  const { tender: dalszy } = await tenders.upsert({
    externalId: 'dalszy-25-dni',
    title: 'Budowa kanalizacji sanitarnej w gminie',
    deadline: terminZa(25),
  });
  tenders.odswiezPule();

  const user = await users.create({
    email: 'pula25@t.pl',
    passwordHash: 'h',
    keywords: ['kanalizacja'],
  });

  const pula = await tenders.openPool({ swiezaKopia: true });
  assert.ok(pula.some((t) => t.id === dalszy.id),
    'przetarg z terminem +25 dni musi wejść do puli, choć bliższe terminy zapełniają jej początek');

  const wynik = await generateMatchesForUser(user, pula);
  assert.equal(wynik.created, 1, 'pasujący przetarg z dalszym terminem ma utworzyć dopasowanie');

  const feed = await matches.listForUser(user.id);
  assert.deepEqual(feed.map((m) => m.tender_id), [dalszy.id],
    'przetarg z terminem +25 dni ma być widoczny w feedzie użytkownika');
});

test('openPool — sufit kosztowy jest respektowany i RAPORTOWANY, nie cichy', async () => {
  for (const dni of [7, 8, 9, 10]) {
    await tenders.upsert({
      externalId: `sufit-${dni}`,
      title: `Usługi porządkowe ${dni}`,
      deadline: terminZa(dni),
    });
  }
  tenders.odswiezPule();

  const pula = await tenders.openPool({ swiezaKopia: true, limit: 3 });
  const staty = tenders.statystykiPuli();

  // Sufit obowiązuje na KAŻDĄ gałąź zapytania (z terminem / bez terminu) —
  // to bezpiecznik kosztowy na odczyty Firestore, nie łączny rozmiar puli.
  assert.equal(staty.zTerminem, 3, 'twardy sufit nadal obowiązuje jako bezpiecznik kosztowy');
  assert.equal(staty.osiagnietoSufit, true,
    'obcięcie puli musi być widoczne — cichy sufit był istotą P0-5');
  assert.equal(staty.pobrane, pula.length, 'raport zgadza się z tym, co dostał silnik dopasowań');
  assert.ok(staty.zapytan >= 2, 'stronicowanie liczy zapytania (obserwowalność kosztu)');
});

test('openPool — powtórny przebieg nie tworzy duplikatów dopasowań (idempotencja)', async () => {
  const { tender } = await tenders.upsert({
    externalId: 'idem-1',
    title: 'Modernizacja oswietlenia ulicznego',
    deadline: terminZa(20),
  });
  tenders.odswiezPule();

  const user = await users.create({
    email: 'idem@t.pl',
    passwordHash: 'h',
    keywords: ['oswietlenia'],
  });

  const pula = await tenders.openPool({ swiezaKopia: true });
  const pierwszy = await generateMatchesForUser(user, pula);
  const drugi = await generateMatchesForUser(user, pula);

  assert.equal(pierwszy.created, 1);
  assert.equal(drugi.created, 0, 'drugi przebieg na tej samej puli nie może dublować dopasowań');
  const feed = await matches.listForUser(user.id);
  assert.equal(feed.filter((m) => m.tender_id === tender.id).length, 1);
});

test('openPool — gałąź BEZ terminu też jest stronicowana (kursor bez jawnego orderBy)', async () => {
  for (const nr of [1, 2, 3, 4, 5]) {
    await tenders.upsert({
      externalId: `bezterminu-${nr}`,
      title: `Zapytanie ofertowe bez terminu ${nr}`,
      deadline: null,
    });
  }
  tenders.odswiezPule();

  const pula = await tenders.openPool({ swiezaKopia: true });
  const ids = pula.map((t) => t.id);

  for (const nr of [1, 2, 3, 4, 5]) {
    assert.ok(ids.includes(`bezterminu-${nr}`),
      `bezterminu-${nr} wypadło — kursor na gałęzi bez terminu nie przechodzi między stronami`);
  }
  assert.equal(new Set(ids).size, ids.length, 'stronicowanie nie może dublować dokumentów');
});

test('openPool — pula niesie TYLKO pola silnika dopasowań, bez surowego raw_data', async () => {
  /*
   * `raw_data` bywa przycinane dopiero przy 700 KB (MAKS_RAW_DATA_BAJTOW), a cykl
   * dzienny ma 512 MiB pamięci. Przy puli 2000 dokumentów nikt tego nie policzył;
   * przy pełnym rynku (7249 i rosnąco) wciągnięcie surowych odpowiedzi BZP do
   * pamięci instancji to OOM w środku cyklu. Pula czyta więc PROJEKCJĘ pól.
   */
  await tenders.upsert({
    externalId: 'projekcja-1',
    title: 'Przebudowa drogi powiatowej',
    organization: 'Powiat Testowy',
    deadline: terminZa(12),
    cpvMain: '45233000-9',
    budget: 1234567,
    url: 'https://example.invalid/ogloszenie',
    raw: { opis: 'x'.repeat(50_000), zalaczniki: Array.from({ length: 200 }, (_, i) => `plik-${i}`) },
  });
  tenders.odswiezPule();

  const pula = await tenders.openPool({ swiezaKopia: true });
  const rekord = pula.find((t) => t.id === 'projekcja-1');

  assert.ok(rekord, 'przetarg musi być w puli');
  assert.equal(rekord.raw_data, undefined, 'surowa odpowiedź źródła nie ma prawa wejść do puli');
  // Pola, bez których silnik dopasowań i feed przestają działać.
  assert.equal(rekord.title, 'Przebudowa drogi powiatowej');
  assert.equal(rekord.organization, 'Powiat Testowy');
  assert.equal(rekord.cpv_main, '45233000-9');
  assert.equal(rekord.budget, 1234567);
  assert.equal(rekord.url, 'https://example.invalid/ogloszenie');
  assert.ok(rekord.deadline, 'termin jest potrzebny do feedu i przypomnień');
});
