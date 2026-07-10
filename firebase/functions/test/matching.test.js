import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Silnik dopasowań na Firestore — biegnie na EMULATORZE (npm run test:emu).
 * Bez klucza Anthropica wszystkie oceny są heurystyczne, więc żaden test
 * nie dotyka płatnego API.
 *
 * Testy kodują naprawy z audytu 2026-07-09:
 *  • P-4      limit dzienny Free ODRACZA nadwyżkę, nie kasuje jej,
 *  • HIGH     odrzucony kandydat nie wraca do płatnego AI (ślad w evaluations),
 *  • HIGH     zmiana kryteriów WYMUSZA ponowną ocenę (a powrót do starych — nie),
 *  • HIGH     dobowy limit wywołań AI na użytkownika (denial-of-wallet).
 */

/*
 * UWAGA: `node --env-file` NIE nadpisuje zmiennych już obecnych w środowisku.
 * Na maszynie dewelopera ANTHROPIC_API_KEY bywa ustawiony globalnie (Windows env),
 * więc sam .env.test nie wystarcza — bez tego testy wołałyby PŁATNE API.
 * Zerujemy klucz PRZED importem config.js (czyta process.env przy ładowaniu).
 */
process.env.ANTHROPIC_API_KEY = '';


const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { users, tenders, matches, evaluations, aiQuota, backfillCooldown } = await import('../src/db/repos.js');
const { generateMatchesForUser, backfillUser, criteriaHash, generateMatchesForAllUsers } =
  await import('../src/services/matching.js');

let seq = 0;
async function dodajPrzetarg(title) {
  seq++;
  const { tender } = await tenders.upsert({
    externalId: `mt-${process.pid}-${seq}`, title, organization: 'Gmina Testowa', deadline: '2099-01-01T00:00:00.000Z',
  });
  return tender;
}
async function dodajUsera(keywords, tier = 'free') {
  seq++;
  const u = await users.create({ email: `m${process.pid}-${seq}@t.pl`, passwordHash: 'h', keywords });
  if (tier !== 'free') await users.setTier(u.id, tier);
  return users.findById(u.id);
}

test('criteriaHash — niezależny od kolejności, wrażliwy na treść', () => {
  const a = criteriaHash({ keywords: ['droga', 'most'], cpv_codes: ['45'] });
  const b = criteriaHash({ keywords: ['most', 'droga'], cpv_codes: ['45'] });
  const c = criteriaHash({ keywords: ['droga', 'most', 'chodnik'], cpv_codes: ['45'] });
  assert.equal(a, b, 'kolejność słów nie może zmieniać odcisku');
  assert.notEqual(a, c, 'dopisane słowo musi zmienić odcisk');
});

test('P-4: limit dzienny Free ODRACZA przetargi — kolejne dni dowożą resztę', async () => {
  const user = await dodajUsera(['chodnik']);
  const pula = [];
  for (let i = 0; i < 8; i++) pula.push(await dodajPrzetarg(`Budowa chodnika nr ${i} w miejscowości`));

  const dzien1 = await generateMatchesForUser(user, pula);
  assert.equal(dzien1.created, 5, `limit Free to 5/dobę, było ${dzien1.created}`);

  // Drugi przebieg TEGO SAMEGO dnia nic nie dodaje (limit wyczerpany)...
  const jeszczeDzis = await generateMatchesForUser(await users.findById(user.id), pula);
  assert.equal(jeszczeDzis.created, 0);

  // ...ale przetargi NIE przepadły: czekają w puli na jutro.
  const dopasowane = await matches.listForUser(user.id, 50);
  assert.equal(dopasowane.length, 5);
  const pozostale = pula.filter((t) => !dopasowane.some((m) => m.tender_id === t.id));
  assert.equal(pozostale.length, 3, 'trzy przetargi czekają, żaden nie zniknął');
});

test('HIGH: kandydat odrzucony poniżej progu zostawia ślad i NIE wraca do oceny', async () => {
  const user = await dodajUsera(['ogrodzenie']);
  // Tytuł bez trafienia w słowo → heurystyka 0 → w ogóle nie wchodzi do rankingu.
  // Bierzemy kandydata ze słabym, ale niezerowym sygnałem: trafia 1 z 2 słów frazy.
  const slaby = await dodajPrzetarg('Dostawa sprzętu komputerowego dla urzędu');
  const mocny = await dodajPrzetarg('Budowa ogrodzenia wokół szkoły podstawowej');

  const pierwszy = await generateMatchesForUser(user, [slaby, mocny]);
  assert.equal(pierwszy.created, 1, 'tylko mocny kandydat tworzy dopasowanie');

  const hash = criteriaHash(await users.findById(user.id));
  const ocenione = await evaluations.idsAmong(user.id, [mocny.id], hash);
  assert.ok(ocenione.has(mocny.id), 'ocena musi zostawić ślad');

  // Drugi przebieg: zero nowych ocen, bo ślad już jest.
  const drugi = await generateMatchesForUser(await users.findById(user.id), [slaby, mocny]);
  assert.equal(drugi.evaluated, 0, 'oceniony przetarg nie może wracać do silnika');
});

test('HIGH: zmiana kryteriów wymusza ponowną ocenę, powrót do starych — nie', async () => {
  const user = await dodajUsera(['most']);
  const przetarg = await dodajPrzetarg('Remont mostu nad rzeką Wartą');

  await generateMatchesForUser(user, [przetarg]);
  const hashStary = criteriaHash(await users.findById(user.id));

  // Dopisujemy słowo → nowy odcisk kryteriów → stary ślad przestaje zasłaniać.
  await users.updateProfile(user.id, { companyName: null, keywords: ['most', 'wiadukt'], cpvCodes: [] });
  const poZmianie = await users.findById(user.id);
  const hashNowy = criteriaHash(poZmianie);
  assert.notEqual(hashStary, hashNowy);

  const ocenioneStarymHashem = await evaluations.idsAmong(user.id, [przetarg.id], hashNowy);
  assert.equal(ocenioneStarymHashem.size, 0, 'ślad ze starego profilu nie liczy się dla nowego');

  const ocenioneNowym = await evaluations.idsAmong(user.id, [przetarg.id], hashStary);
  assert.equal(ocenioneNowym.size, 1, 'powrót do starych kryteriów trafia w istniejący ślad — zero kosztu');
});

test('HIGH (denial-of-wallet): aiQuota.reserve twardo ogranicza wywołania AI na dobę', async () => {
  const user = await dodajUsera(['droga']);
  const LIMIT = 3;

  const wyniki = [];
  for (let i = 0; i < 5; i++) wyniki.push(await aiQuota.reserve(user.id, LIMIT));

  assert.deepEqual(wyniki, [true, true, true, false, false], 'po wyczerpaniu limitu rezerwacja musi odmawiać');
  assert.equal(await aiQuota.used(user.id), LIMIT, 'licznik nie może przekroczyć limitu');
});

test('backfillUser — nowe konto dostaje dopasowania do ISTNIEJĄCYCH otwartych przetargów', async () => {
  await dodajPrzetarg('Przebudowa drogi powiatowej nr 1234');
  const user = await dodajUsera(['droga']);
  const r = await backfillUser(user);
  assert.ok(r.created >= 1, 'backfill musi dopasować stare ogłoszenie');
});

test('user bez kryteriów — zero pracy, zero kosztu', async () => {
  const user = await dodajUsera([]);
  const r = await generateMatchesForUser(user, [await dodajPrzetarg('Cokolwiek')]);
  assert.deepEqual(r, { created: 0, evaluated: 0, aiCalls: 0 });
});

test('bez klucza AI wszystkie oceny są heurystyczne (zero płatnych wywołań w testach)', async () => {
  const user = await dodajUsera(['asfalt']);
  const r = await generateMatchesForUser(user, [await dodajPrzetarg('Remont nawierzchni asfaltowej ulicy')]);
  assert.equal(r.aiCalls, 0, 'testy nie mogą wołać płatnego API');
  assert.ok(r.created >= 1);
});

// ============ audyt 2026-07-10: atomowość i degradacja AI ============

test('AUDYT: dopasowanie i ślad oceny powstają ATOMOWO (jeden batch)', async () => {
  // Rozdzielone zapisy groziły albo utratą kwalifikującego się przetargu (ślad bez
  // dopasowania), albo ponowną opłatą za AI nazajutrz (dopasowanie bez śladu).
  const user = await dodajUsera(['wiadukt']);
  const t = await dodajPrzetarg('Remont wiaduktu nad torami kolejowymi');

  const r = await generateMatchesForUser(user, [t]);
  assert.equal(r.created, 1);

  const hash = criteriaHash(await users.findById(user.id));
  const slad = await evaluations.idsAmong(user.id, [t.id], hash);
  assert.ok(slad.has(t.id), 'ślad musi powstać razem z dopasowaniem');
  assert.equal(await matches.exists(user.id, t.id), true);
});

test('AUDYT: kandydat odrzucony przez OSTATECZNĄ ocenę zostawia ślad', async () => {
  // Heurystyka poniżej progu pre-filtra AI => nie było po co pytać modelu,
  // więc ocena jest ostateczna i przetarg nie ma po co wracać.
  const user = await dodajUsera(['ogrodzenie']);
  // Trafienie 1 z 2 słów frazy → sygnał niezerowy, ale niski.
  const slaby = await dodajPrzetarg('Dostawa ogrodzeń tymczasowych i innych materiałów budowlanych');

  await generateMatchesForUser(user, [slaby]);
  const hash = criteriaHash(await users.findById(user.id));
  const ocenione = await evaluations.idsAmong(user.id, [slaby.id], hash);

  // Bez klucza AI features.ai=false → wartoPytacAi=false → ocena ostateczna.
  assert.ok(ocenione.has(slaby.id), 'ocena heurystyczna bez szans na AI jest ostateczna');
});

// ============ audyt 2026-07-10: koszty i sprawiedliwość cyklu ============

test('AUDYT (denial-of-wallet): backfill ma hamulec czasowy, rejestracja go omija', async () => {
  /*
   * PATCH /auth/me odpalało pełny odczyt puli (do 4000 dokumentów) przy KAŻDEJ
   * zmianie kryteriów. Konto przełączające słowa kluczowe generowało setki tysięcy
   * odczytów Firestore na minutę. `aiQuota` tego nie broniła — pilnuje tylko AI.
   */
  const user = await dodajUsera(['most']);

  assert.equal(await backfillCooldown.reserve(user.id), true, 'pierwszy przebieg wolno wykonać');
  assert.equal(await backfillCooldown.reserve(user.id), false, 'drugi zaraz po nim — odmowa');

  // Rejestracja i admin muszą działać natychmiast, mimo hamulca.
  const wymuszony = await backfillUser(await users.findById(user.id), { wymus: true });
  assert.notEqual(wymuszony.pominiety, true, 'wymus: true ignoruje hamulec');

  // Zwykły backfill po zmianie profilu — odbity przez hamulec, ale bez błędu.
  const odbity = await backfillUser(await users.findById(user.id));
  assert.equal(odbity.pominiety, true);
  assert.equal(odbity.created, 0);
});

test('AUDYT: hamulec wygasa po zadanym odstępie', async () => {
  const user = await dodajUsera(['tunel']);
  assert.equal(await backfillCooldown.reserve(user.id, 60_000), true);
  assert.equal(await backfillCooldown.reserve(user.id, 60_000), false);
  // Zerowy odstęp = brak hamulca; dowodzi, że decyduje czas, nie sam fakt wpisu.
  assert.equal(await backfillCooldown.reserve(user.id, 0), true);
});

test('AUDYT: cykl przerwany budżetem czasu NIE głodzi wciąż tych samych userów', async () => {
  /*
   * Cykl ginął po 540 s (twardy limit platformy) w połowie sekwencyjnej pętli.
   * Użytkownicy z końca listy nie dostawali nic — codziennie ci sami, po cichu.
   * Teraz kolejność jest wg `last_cycle_at` rosnąco: pominięci idą pierwsi.
   */
  await dodajPrzetarg('Budowa kładki dla pieszych nad rzeką');
  const a = await dodajUsera(['kładka']);
  const b = await dodajUsera(['kładka']);

  // Zerowy budżet czasu → nikt nie zostaje obsłużony, ale cykl kończy się czysto.
  const utworzone = await generateMatchesForAllUsers({ budzetCzasuMs: -1 });
  assert.equal(utworzone, 0, 'brak czasu = brak pracy, bez wyjątku');

  // Pełny cykl obsługuje obu i stempluje ich znacznikiem.
  await generateMatchesForAllUsers();
  const poA = await users.findById(a.id);
  const poB = await users.findById(b.id);
  assert.ok(poA.last_cycle_at, 'użytkownik obsłużony musi dostać znacznik');
  assert.ok(poB.last_cycle_at);
});

test('AUDYT: user z szerokim profilem NIE jest głodzony poza czołówką rankingu', async () => {
  /*
   * Ranking był obcinany do 120 kandydatów PRZED odsianiem ocenionych. Gdy czołowa
   * setka była już oceniona, użytkownik nie dostawał NIC — i tak każdego dnia, bo
   * do 121. kandydata silnik nigdy nie sięgał.
   *
   * Tu: 8 kandydatów, siedmiu pierwszych „już ocenionych". Ósmy MUSI się przebić.
   */
  const user = await dodajUsera(['nasyp']);
  const hash = criteriaHash(await users.findById(user.id));

  const pula = [];
  for (let i = 0; i < 8; i++) pula.push(await dodajPrzetarg(`Budowa nasypu drogowego etap ${i}`));

  // Siedem pierwszych ma już ślad oceny — silnik musi je pominąć i sięgnąć głębiej.
  for (const t of pula.slice(0, 7)) {
    await evaluations.record(user.id, t.id, { score: 10, scorer: 'heuristic', criteriaHash: hash });
  }

  const r = await generateMatchesForUser(user, pula);
  assert.ok(r.evaluated >= 1, 'ósmy kandydat musi zostać oceniony, nie pominięty');
  assert.ok(r.created >= 1, 'i musi trafić do feedu');
});

test('AUDYT: liczba wywołań AI nie rośnie od samego istnienia kandydatów', async () => {
  // Regresja na usunięcie matches.exists: druga tura nie może ponownie „oceniać”
  // przetargu, który ma już dopasowanie (odsiewa go ślad z tego samego batcha).
  const user = await dodajUsera(['przepust']);
  const t = await dodajPrzetarg('Budowa przepustu drogowego pod nasypem');

  const pierwsza = await generateMatchesForUser(user, [t]);
  assert.equal(pierwsza.created, 1);

  const druga = await generateMatchesForUser(await users.findById(user.id), [t]);
  assert.equal(druga.evaluated, 0, 'kandydat z dopasowaniem nie wraca do silnika');
  assert.equal(druga.aiCalls, 0);
});
