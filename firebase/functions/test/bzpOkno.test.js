import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * OKNO POBIERANIA BZP — dlaczego cykl gubił trzy czwarte rynku (P0-2).
 *
 * Zmierzone 2026-09-23 (audyt) i potwierdzone 2026-09-24 własnym pomiarem na
 * żywym API: doba 2026-09-22 to 1 011 ogłoszeń, a adapter pobiera je w 17
 * zapytaniach w ~14 s. Czyli strategia „dzień po dniu + docinanie po TERYT"
 * jest dobra i mieści się w budżecie. Gubiliśmy dane z trzech innych powodów:
 *
 *  1. `403` (throttling BZP — ~9 szybkich zapytań) NIE był ponawiany, bo kod
 *     traktował całe 4xx jako „nasza wina". Jedno 403 zabierało CAŁĄ dobę.
 *  2. Dzień, który padł, był tylko logowany — ślad cyklu nie niósł ani słowa
 *     o tym, że w oknie brakuje doby. Z zewnątrz wyglądało to na sukces.
 *  3. Nie było budżetu czasu ani checkpointu: przebieg albo zdążył, albo
 *     ginął w połowie, a następny zaczynał od nowa od najstarszego dnia.
 */

process.env.ANTHROPIC_API_KEY = '';

const { pobierzOgloszeniaBzp, SUFIT_ZAPYTANIA, TEMPO_DOMYSLNE } =
  await import('../src/services/bzp.js');
const { pustyLicznik } = await import('../src/lib/licznikZrodla.js');

const oryginalnyFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oryginalnyFetch; });

const odpowiedz = (dane, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => dane,
  text: async () => JSON.stringify(dane),
});

const ogloszenia = (n, prefiks = 'x') =>
  Array.from({ length: n }, (_, i) => ({ bzpNumber: `${prefiks}-${i}`, orderObject: 'Robota', cpvCode: '45000000-7' }));

/** Tempo bez czekania — testy nie mogą spać sekundami. */
function tempoTestowe(dodatkowe = {}) {
  const spanie = [];
  return {
    spanie,
    tempo: { ...TEMPO_DOMYSLNE, spij: async (ms) => { spanie.push(ms); }, ...dodatkowe },
  };
}

test('TEMPO_DOMYSLNE: odstęp między zapytaniami i osobny, DŁUŻSZY backoff na 403', () => {
  assert.ok(TEMPO_DOMYSLNE.odstepMs > 0, 'bez odstępu BZP odcina po ~9 szybkich zapytaniach');
  assert.ok(TEMPO_DOMYSLNE.backoff403Ms >= 10_000,
    'throttling odpuszcza w sekundach, nie w milisekundach');
  assert.ok(TEMPO_DOMYSLNE.maksOdstepMs >= TEMPO_DOMYSLNE.odstepMs);
});

test('KRYTYCZNE: 403 (throttling) JEST ponawiane — inaczej znika cała doba', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    return wywolania < 3 ? odpowiedz({ blad: 'throttling' }, 403) : odpowiedz(ogloszenia(3));
  };

  const { tempo } = tempoTestowe();
  const licznik = pustyLicznik();
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-09-22', to: '2026-09-22', licznik, tempo });

  assert.equal(wywolania, 3, 'dwa razy 403, trzecia próba udana');
  assert.equal(wynik.length, 3);
  assert.equal(licznik.dni[0].blad, undefined);
});

test('po 403 adapter ZWALNIA na resztę okna (nie wchodzi drugi raz na tę samą minę)', async () => {
  let wywolania = 0;
  globalThis.fetch = async () => {
    wywolania++;
    // Pierwsze zapytanie doby 1 dostaje 403, dalej wszystko idzie normalnie.
    return wywolania === 1 ? odpowiedz({}, 403) : odpowiedz(ogloszenia(2));
  };

  const { tempo, spanie } = tempoTestowe();
  await pobierzOgloszeniaBzp({ from: '2026-09-21', to: '2026-09-22', licznik: pustyLicznik(), tempo });

  const odstepyPo403 = spanie.filter((ms) => ms === TEMPO_DOMYSLNE.backoff403Ms);
  assert.equal(odstepyPo403.length, 1, 'samo ponowienie po 403 czeka backoffem');
  const ostatni = spanie.at(-1);
  assert.ok(ostatni > TEMPO_DOMYSLNE.odstepMs,
    'po trafieniu w throttling odstęp między zapytaniami rośnie do końca okna');
});

test('dzień, który PADŁ, jest raportowany w liczniku — nie tylko w logu', async () => {
  globalThis.fetch = async (u) => (String(u).includes('2026-09-21')
    ? odpowiedz({ blad: 'nie ma' }, 404)
    : odpowiedz(ogloszenia(4)));

  const { tempo } = tempoTestowe();
  const licznik = pustyLicznik();
  const wynik = await pobierzOgloszeniaBzp({ from: '2026-09-21', to: '2026-09-22', licznik, tempo });

  assert.equal(wynik.length, 4, 'awaria jednej doby nie zabiera pozostałych');
  const feralny = licznik.dni.find((d) => d.dzien === '2026-09-21');
  assert.match(feralny.blad, /404/, 'brak tej informacji w śladzie cyklu = cicha niekompletność');
  assert.equal(feralny.pobrano, 0);
  assert.equal(licznik.dni.find((d) => d.dzien === '2026-09-22').pobrano, 4);
});

test('doba na suficie jest oznaczona jako UCIĘTA (sygnał, że TERYT przestaje wystarczać)', async () => {
  globalThis.fetch = async () => odpowiedz(ogloszenia(SUFIT_ZAPYTANIA, 'sufit'));

  const { tempo } = tempoTestowe();
  const licznik = pustyLicznik();
  await pobierzOgloszeniaBzp({ from: '2026-09-22', to: '2026-09-22', licznik, tempo });

  const doba = licznik.dni[0];
  assert.equal(doba.ucietySufit, true);
  assert.equal(doba.zapytania, 17, '1 zapytanie doby + 16 województw');
});

test('BUDŻET CZASU kończy okno czysto, a nieprzetworzone dni są RAPORTOWANE', async () => {
  globalThis.fetch = async () => odpowiedz(ogloszenia(2));

  let zegar = 0;
  const { tempo } = tempoTestowe({ teraz: () => { zegar += 10_000; return zegar; } });
  const licznik = pustyLicznik();

  const wynik = await pobierzOgloszeniaBzp({
    from: '2026-09-17', to: '2026-09-22', licznik, tempo, budzetMs: 15_000,
  });

  assert.ok(wynik.length > 0, 'to, co zdążyło się pobrać, i tak trafia do bazy');
  assert.ok(licznik.pominieteDni.length > 0,
    'dni poza budżetem muszą być widoczne — inaczej kolejny przebieg nie wie, co dokończyć');
  assert.equal(
    licznik.dni.length + licznik.pominieteDni.length,
    6,
    'każdy dzień okna jest albo przetworzony, albo jawnie pominięty',
  );
});

test('lista `dni` nadpisuje zakres from/to — to podstawa wznawiania po checkpoincie', async () => {
  const pytane = [];
  globalThis.fetch = async (u) => {
    pytane.push(new URL(String(u)).searchParams.get('PublicationDateFrom').slice(0, 10));
    return odpowiedz(ogloszenia(1));
  };

  const { tempo } = tempoTestowe();
  await pobierzOgloszeniaBzp({
    from: '2026-09-01', to: '2026-09-22', dni: ['2026-09-22', '2026-09-18'], licznik: pustyLicznik(), tempo,
  });

  assert.deepEqual(pytane, ['2026-09-22', '2026-09-18'],
    'wznowienie pobiera DOKŁADNIE brakujące doby, w podanej kolejności');
});
