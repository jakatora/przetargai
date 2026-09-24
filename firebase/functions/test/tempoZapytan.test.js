import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * WSPÓLNE TEMPO I PONAWIANIE ZAPYTAŃ HTTP.
 *
 * Do 2026-09-24 ta logika żyła WYŁĄCZNIE wewnątrz services/bzp.js (prywatne
 * `stanTempa` i `pobierzZPonowieniem`). Każde nowe źródło musiałoby ją przepisać
 * od zera — a to najdroższa wiedza w tym projekcie: `403` jako kod DO PONOWIENIA
 * (BZP dławi ruch po ~9 szybkich zapytaniach) kosztował audyt 2026-09-23 całą dobę
 * ogłoszeń i ~3 700 brakujących rekordów w oknie.
 *
 * Kontrakt: `stanTempa` trzyma stan JEDNEGO okna (adaptacyjny odstęp), a
 * `pobierzZPonowieniem` ponawia i zwalnia tempo po dławieniu. Oba wstrzykiwalne
 * w testach — inaczej zestaw testów spałby minutami.
 */

process.env.ANTHROPIC_API_KEY = '';

const { PONAWIALNE, PROBY, TEMPO_DOMYSLNE, stanTempa, pobierzZPonowieniem } =
  await import('../src/lib/tempoZapytan.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (status = 200, dane = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => dane,
  text: async () => JSON.stringify(dane),
});

function tempoTestowe(dodatkowe = {}) {
  const spanie = [];
  return { spanie, tempo: stanTempa({ spij: async (ms) => { spanie.push(ms); }, ...dodatkowe }) };
}

test('403 JEST na liście kodów do ponowienia — to dławienie, nie „nasza wina"', () => {
  assert.ok(PONAWIALNE.has(403), 'najdroższy bug audytu 2026-09-23: 403 traktowane jak trwałe 4xx');
  for (const kod of [429, 500, 502, 503, 504]) assert.ok(PONAWIALNE.has(kod), `${kod} musi być ponawiane`);
  for (const kod of [400, 401, 404]) assert.ok(!PONAWIALNE.has(kod), `${kod} to trwały błąd — ponawianie nic nie da`);
});

test('TEMPO_DOMYSLNE: osobny, DŁUŻSZY backoff na dławienie niż zwykły odstęp', () => {
  assert.ok(TEMPO_DOMYSLNE.odstepMs > 0);
  assert.ok(TEMPO_DOMYSLNE.backoff403Ms >= 10_000, 'throttling odpuszcza w sekundach, nie w milisekundach');
  assert.ok(TEMPO_DOMYSLNE.maksOdstepMs >= TEMPO_DOMYSLNE.odstepMs);
  assert.ok(PROBY >= 2, 'jedna próba to brak ponawiania');
});

test('pierwsze zapytanie okna idzie OD RAZU, kolejne czekają odstęp', async () => {
  const { tempo, spanie } = tempoTestowe({ odstepMs: 250 });
  await tempo.przedZapytaniem();
  assert.deepEqual(spanie, [], 'nie płacimy odstępu za start okna');
  await tempo.przedZapytaniem();
  assert.deepEqual(spanie, [250]);
});

test('zwolnij() mnoży odstęp, ale nie przekracza sufitu', () => {
  const tempo = stanTempa({ odstepMs: 250, mnoznikPo403: 8, maksOdstepMs: 4000 });
  tempo.zwolnij();
  assert.equal(tempo.biezacyOdstepMs, 2000);
  tempo.zwolnij();
  assert.equal(tempo.biezacyOdstepMs, 4000, 'sufit trzyma — inaczej okno stanęłoby na godziny');
});

test('ponawia dławienie (403) i oddaje udaną odpowiedź', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; return wywolania < 3 ? odpowiedz(403) : odpowiedz(200, { ok: 1 }); };

  const { tempo } = tempoTestowe();
  const res = await pobierzZPonowieniem('https://przyklad.test/x', tempo, { zrodlo: 'TEST' });

  assert.equal(wywolania, 3);
  assert.equal(res.status, 200);
});

test('po dławieniu tempo ZWALNIA na resztę okna (nie wchodzi drugi raz na tę samą minę)', async () => {
  globalThis.fetch = async () => odpowiedz(403);
  const { tempo } = tempoTestowe({ odstepMs: 250 });
  const przed = tempo.biezacyOdstepMs;

  await pobierzZPonowieniem('https://przyklad.test/x', tempo, { zrodlo: 'TEST' });

  assert.ok(tempo.biezacyOdstepMs > przed, 'odstęp musi urosnąć, inaczej kolejne doby też dostaną 403');
});

test('trwałe 4xx NIE jest ponawiane — oszczędzamy budżet okna', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; return odpowiedz(404); };

  const { tempo } = tempoTestowe();
  const res = await pobierzZPonowieniem('https://przyklad.test/x', tempo, { zrodlo: 'TEST' });

  assert.equal(wywolania, 1);
  assert.equal(res.status, 404);
});

test('błąd sieci jest ponawiany, a po wyczerpaniu prób RZUCA (cisza byłaby gorsza)', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => { wywolania++; throw new Error('ECONNRESET'); };

  const { tempo } = tempoTestowe();
  await assert.rejects(
    () => pobierzZPonowieniem('https://przyklad.test/x', tempo, { zrodlo: 'TEST' }),
    /ECONNRESET/,
  );
  assert.equal(wywolania, PROBY);
});

test('nagłówki i limit czasu są przekazywane do fetch (bez nich BK odpowiada HTML-em)', async () => {
  let widziane = null;
  globalThis.fetch = async (_url, opcje) => { widziane = opcje; return odpowiedz(200); };

  const { tempo } = tempoTestowe();
  await pobierzZPonowieniem('https://przyklad.test/x', tempo, {
    zrodlo: 'TEST', naglowki: { Accept: 'application/json', 'X-Test': '1' },
  });

  assert.equal(widziane.headers.Accept, 'application/json');
  assert.equal(widziane.headers['X-Test'], '1');
  assert.ok(widziane.signal, 'brak sygnału = zapytanie może wisieć do końca budżetu funkcji');
});
