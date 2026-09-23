import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';

/*
 * MOST `/api/przetarg/*` → Railway (P0-4).
 *
 * Audyt 2026-09-23 §3.1: aplikacja ze sklepów mówi do Cloud Functions, a sześć
 * dowiezionych modułów (Sejf, Radar SWZ, Radar podprogowy, Czarna skrzynka,
 * Symulator płynności, Radar planów) żyje wyłącznie na Railway. 42 wywołania
 * `/api/przetarg/*` zwracały na produkcji 404 — moduły były martwe.
 *
 * Najważniejszy test w tym pliku czyta PRAWDZIWY plik klienta mobilnego
 * i sprawdza KAŻDĄ trasę, której aplikacja używa. Lista nie może się rozjechać
 * z rzeczywistością, bo nie jest przepisana ręcznie.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { users } = await import('../src/db/repos.js');
const { signToken } = await import('../src/middleware/auth.js');
const { env } = await import('../src/config.js');
const { emailMostu, hasloMostu } = await import('../src/services/mostRailway.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

let licznikKont = 0;
async function zalozUzytkownika() {
  licznikKont += 1;
  const user = await users.create({
    email: `most-${process.pid}-${licznikKont}@test.pl`,
    passwordHash: 'x',
  });
  return { user, token: signToken(user.id, 0) };
}

/** Atrapa Railway: zapisuje żądania i oddaje zaprogramowane odpowiedzi. */
function podstawRailway({ rejestracja, odpowiedzi } = {}) {
  const zadania = [];
  let iOdpowiedzi = 0;

  globalThis.fetch = async (url, opcje = {}) => {
    const adres = String(url);
    // Atrapa obsługuje WYŁĄCZNIE ruch do Railway. Żądania testu do lokalnego
    // serwera Express muszą iść prawdziwym fetchem — inaczej test sprawdzałby
    // samą atrapę i przechodziłby nawet bez mostu.
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);

    const cialo = opcje.body ? String(opcje.body) : null;
    zadania.push({ adres, metoda: opcje.method ?? 'GET', naglowki: opcje.headers ?? {}, cialo });

    if (adres.endsWith('/auth/register')) {
      const wynik = rejestracja ?? { status: 201, user: { id: `rail-${zadania.length}` } };
      return odpowiedzJson(wynik.status, { token: 'x', user: wynik.user ?? null });
    }
    if (adres.endsWith('/auth/login')) {
      return odpowiedzJson(200, { token: 'x', user: { id: 'rail-z-logowania' } });
    }

    const zaprogramowana = odpowiedzi?.[Math.min(iOdpowiedzi, (odpowiedzi.length ?? 1) - 1)];
    iOdpowiedzi += 1;
    if (zaprogramowana) return zaprogramowana;
    return odpowiedzJson(200, { ok: true, sciezka: adres });
  };

  return zadania;
}

function odpowiedzJson(status, dane) {
  const tresc = Buffer.from(JSON.stringify(dane));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    arrayBuffer: async () => tresc,
    json: async () => dane,
    text: async () => tresc.toString(),
  };
}

async function zapytaj(sciezka, { metoda = 'GET', token, cialo } = {}) {
  const serwer = createApp().listen(0);
  try {
    const { port } = serwer.address();
    const res = await oryginalnyFetch(`http://127.0.0.1:${port}${sciezka}`, {
      method: metoda,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cialo === undefined ? undefined : JSON.stringify(cialo),
    });
    return { status: res.status, tekst: await res.text() };
  } finally {
    serwer.close();
  }
}

/** Trasy `/api/przetarg/*` WYCIĄGNIĘTE z prawdziwego klienta mobilnego. */
function trasyZKlientaMobilnego() {
  const zrodlo = readFileSync(new URL('../../../mobile/src/api/client.js', import.meta.url), 'utf8');
  const znalezione = zrodlo.match(/['`]\/api\/przetarg\/[^'`]*/g) ?? [];
  return [...new Set(znalezione.map((s) => s
    .slice(1)
    // `${id}` → konkretna wartość; `${qs ? ... }` → pusty ogon.
    .replace(/\$\{[^}]*\?[^}]*$/, '')
    .replace(/\$\{[^}]*\}/g, 'testowy-id')
    .replace(/\s+$/, '')))];
}

test('KONTRAKT: klient mobilny używa 42 tras /api/przetarg/* — to jest lista do obsłużenia', () => {
  const trasy = trasyZKlientaMobilnego();
  assert.ok(trasy.length >= 30, `spodziewamy się kilkudziesięciu tras, znaleziono ${trasy.length}`);
  assert.ok(trasy.some((t) => t.startsWith('/api/przetarg/sejf')));
  assert.ok(trasy.some((t) => t.startsWith('/api/przetarg/czarna-skrzynka')));
  assert.ok(trasy.some((t) => t.startsWith('/api/przetarg/symulator-plynnosci')));
});

test('KRYTYCZNE: ŻADNA trasa klienta mobilnego nie zwraca 404 (to był P0-4)', async () => {
  const { token } = await zalozUzytkownika();
  podstawRailway();

  const cztery04 = [];
  for (const trasa of trasyZKlientaMobilnego()) {
    for (const metoda of ['GET', 'POST']) {
      const { status } = await zapytaj(trasa, {
        metoda, token, cialo: metoda === 'POST' ? {} : undefined,
      });
      if (status === 404) cztery04.push(`${metoda} ${trasa}`);
    }
  }

  assert.deepEqual(cztery04, [],
    'na produkcji te trasy zwracały 404, bo Cloud Functions nie miały żadnego prefiksu /api');
});

test('bez tokenu most odpowiada 401, a NIE 404 — moduł istnieje, brakuje tożsamości', async () => {
  podstawRailway();
  const { status } = await zapytaj('/api/przetarg/sejf/dokumenty');
  assert.equal(status, 401);
});

test('TOŻSAMOŚĆ: w górę leci token Railway z `sub` zmapowanego konta, nie token aplikacji', async () => {
  const { user, token } = await zalozUzytkownika();
  const zadania = podstawRailway({ rejestracja: { status: 201, user: { id: 'rail-abc' } } });

  await zapytaj('/api/przetarg/sejf/katalog', { token });

  const przekazane = zadania.find((z) => z.adres.includes('/api/przetarg/sejf/katalog'));
  const wyslanyToken = przekazane.naglowki.Authorization.replace('Bearer ', '');
  const payload = jwt.verify(wyslanyToken, env.JWT_SECRET);

  assert.equal(payload.sub, 'rail-abc', 'Railway rozpoznaje SWOJEGO użytkownika, nie naszego');
  assert.notEqual(wyslanyToken, token, 'token aplikacji nie może iść dalej — tam ma inne znaczenie');
  assert.notEqual(payload.sub, user.id);
});

test('konto pomostowe zakłada się RAZ i zostaje zapamiętane w profilu', async () => {
  const { user, token } = await zalozUzytkownika();
  const zadania = podstawRailway({ rejestracja: { status: 201, user: { id: 'rail-jedyne' } } });

  await zapytaj('/api/przetarg/sejf/katalog', { token });
  await zapytaj('/api/przetarg/sejf/dokumenty', { token });

  const rejestracje = zadania.filter((z) => z.adres.endsWith('/auth/register'));
  assert.equal(rejestracje.length, 1, 'drugie żądanie korzysta z zapamiętanego mapowania');

  const zBazy = await users.findById(user.id);
  assert.equal(zBazy.most_railway_user_id, 'rail-jedyne');

  const rejestracja = JSON.parse(rejestracje[0].cialo);
  assert.equal(rejestracja.email, emailMostu(user.id));
  assert.equal(rejestracja.password, hasloMostu(user.id));
  assert.equal(rejestracja.keywords, undefined,
    'BEZ keywords/CPV — inaczej Railway odpaliłby dopasowania, a z nimi płatne AI');
  assert.ok(!rejestracja.email.includes(zBazy.email),
    'powitalny e-mail z Railway NIE MOŻE trafić do skrzynki użytkownika');
});

test('istniejące konto pomostowe (409) jest odzyskiwane logowaniem, nie duplikowane', async () => {
  const { user, token } = await zalozUzytkownika();
  const zadania = podstawRailway({ rejestracja: { status: 409 } });

  await zapytaj('/api/przetarg/sejf/katalog', { token });

  assert.ok(zadania.some((z) => z.adres.endsWith('/auth/login')));
  const zBazy = await users.findById(user.id);
  assert.equal(zBazy.most_railway_user_id, 'rail-z-logowania');
});

test('przekazuje metodę, ścieżkę, query i ciało BEZ ZMIAN (kontrakt aplikacji zostaje)', async () => {
  const { token } = await zalozUzytkownika();
  const zadania = podstawRailway();

  await zapytaj('/api/przetarg/podprogowe/ogloszenia?limit=20&wojewodztwo=PL22', { token });
  await zapytaj('/api/przetarg/symulator-plynnosci/analiza', {
    metoda: 'POST', token, cialo: { swz: 'treść SWZ', kosztyMiesieczne: 1000 },
  });

  const get = zadania.find((z) => z.adres.includes('/podprogowe/ogloszenia'));
  assert.equal(get.metoda, 'GET');
  assert.ok(get.adres.endsWith('/api/przetarg/podprogowe/ogloszenia?limit=20&wojewodztwo=PL22'),
    'query string musi dojechać w całości');

  const post = zadania.find((z) => z.adres.includes('/symulator-plynnosci/analiza'));
  assert.equal(post.metoda, 'POST');
  assert.deepEqual(JSON.parse(post.cialo), { swz: 'treść SWZ', kosztyMiesieczne: 1000 });
});

test('status i ciało z Railway wracają nietknięte (także błędy walidacji)', async () => {
  const { token } = await zalozUzytkownika();
  podstawRailway({
    odpowiedzi: [odpowiedzJson(422, { error: { code: 'BAD_REQUEST', message: 'Brak pola swz' } })],
  });

  const { status, tekst } = await zapytaj('/api/przetarg/umowa/analiza', { metoda: 'POST', token, cialo: {} });
  assert.equal(status, 422, 'most nie przepisuje kodów — aplikacja ma widzieć prawdę modułu');
  assert.deepEqual(JSON.parse(tekst), { error: { code: 'BAD_REQUEST', message: 'Brak pola swz' } });
});

test('gdy tożsamość na Railway przepadła, most przemapowuje i ponawia DOKŁADNIE raz', async () => {
  const { user, token } = await zalozUzytkownika();
  await users.ustawMostRailway(user.id, 'rail-nieistniejace');

  const zadania = podstawRailway({
    rejestracja: { status: 201, user: { id: 'rail-nowe' } },
    odpowiedzi: [
      odpowiedzJson(401, { error: { code: 'UNAUTHORIZED', message: 'Konto nie istnieje' } }),
      odpowiedzJson(200, { dokumenty: [] }),
    ],
  });

  const { status } = await zapytaj('/api/przetarg/sejf/dokumenty', { token });
  assert.equal(status, 200, 'użytkownik nie może zostać wylogowany przez reset wolumenu po tamtej stronie');

  const doModulu = zadania.filter((z) => z.adres.includes('/api/przetarg/'));
  assert.equal(doModulu.length, 2, 'dokładnie jedno ponowienie — inaczej 401 zapętliłoby most');

  const zBazy = await users.findById(user.id);
  assert.equal(zBazy.most_railway_user_id, 'rail-nowe');
});

test('awaria Railway => 502 z czytelnym komunikatem, nie wyjątek i nie 401', async () => {
  const { token } = await zalozUzytkownika();
  globalThis.fetch = async (url, opcje) => {
    const adres = String(url);
    if (!adres.startsWith(env.MOST_RAILWAY_URL)) return oryginalnyFetch(url, opcje);
    if (adres.endsWith('/auth/register')) return odpowiedzJson(201, { token: 'x', user: { id: 'rail-1' } });
    throw new Error('ECONNREFUSED');
  };

  const { status, tekst } = await zapytaj('/api/przetarg/sejf/dokumenty', { token });
  assert.equal(status, 502);
  assert.equal(JSON.parse(tekst).error.code, 'MOST_NIEDOSTEPNY',
    'aplikacja ma pokazać stan błędu z ponowieniem, a nie wylogować użytkownika');
});

test('DUŻE ciało (upload do Sejfu) przechodzi — globalny limit 1 MB by je odrzucił', async () => {
  const { token } = await zalozUzytkownika();
  const zadania = podstawRailway();

  // 3 MB base64 — realny rozmiar podpisanego PDF-a z sejfu.
  const plik = 'A'.repeat(3 * 1024 * 1024);
  const { status } = await zapytaj('/api/przetarg/sejf/dokumenty', {
    metoda: 'POST', token, cialo: { nazwa: 'krk.pdf', plik_base64: plik },
  });

  assert.equal(status, 200);
  const przekazane = zadania.find((z) => z.adres.includes('/sejf/dokumenty'));
  assert.equal(JSON.parse(przekazane.cialo).plik_base64.length, plik.length,
    'bajty muszą dojechać w całości — most nie przepakowuje ciała');
});
