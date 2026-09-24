import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * TRASY ZAPISANYCH WYSZUKIWAŃ I CENTRUM ALERTÓW (etap 5) — przez prawdziwy serwer HTTP.
 *
 * Testujemy przez HTTP, nie przez repo, bo tu mieszkają dwa ryzyka, których warstwa
 * danych nie widzi: KONTROLA DOSTĘPU (czy 404 dla cudzego zasobu jest naprawdę 404,
 * a nie cudzą treścią) i WALIDACJA (czy 400 leci zanim cokolwiek trafi do bazy).
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { MAKS_WYSZUKIWAN, MAKS_ALERTOW } = await import('../src/lib/zapisaneWyszukiwania.js');

const app = await createApp();
const serwer = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const BAZA = `http://127.0.0.1:${serwer.address().port}`;
test.after(() => serwer.close());

let seq = 0;
async function konto() {
  seq += 1;
  const odp = await fetch(`${BAZA}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `wysz-${process.pid}-${seq}-${Date.now()}@t.pl`,
      password: 'tajnehaslo123',
      keywords: ['test'],
    }),
  });
  return (await odp.json()).token;
}
const auth = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

const zapisz = (token, body) => fetch(`${BAZA}/wyszukiwania`, {
  method: 'POST', headers: auth(token), body: JSON.stringify(body),
});

test('bez tokenu żadna trasa monitoringu nie odpowiada danymi', async () => {
  for (const sciezka of ['/wyszukiwania', '/wyszukiwania/czestotliwosci', '/alerty']) {
    const odp = await fetch(`${BAZA}${sciezka}`);
    assert.equal(odp.status, 401, `${sciezka} bez tokenu`);
  }
});

test('zapis wyszukiwania: filtry wracają ZNORMALIZOWANE, z odciskiem i propozycją nazwy', async () => {
  const token = await konto();
  const odp = await zapisz(token, {
    nazwa: '  Drogi   małopolskie  ',
    filtry: { zrodlo: 'bzp', region: 'małopolskie', cpv: '45-233-000', limit: 50 },
    czestotliwosc: 'dzienna',
  });

  assert.equal(odp.status, 201);
  const { wyszukiwanie } = await odp.json();
  assert.equal(wyszukiwanie.nazwa, 'Drogi małopolskie');
  assert.equal(wyszukiwanie.filtry.region, '12');
  assert.equal(wyszukiwanie.filtry.cpv, '45233000');
  assert.ok(!Object.hasOwn(wyszukiwanie.filtry, 'limit'));
  assert.ok(wyszukiwanie.odcisk);
  assert.equal(wyszukiwanie.alert_wlaczony, true);
});

test('wyszukiwanie bez nazwy jest odrzucane, a odpowiedź podaje gotową propozycję', async () => {
  const token = await konto();
  const odp = await zapisz(token, { nazwa: '   ', filtry: { zrodlo: 'ted' } });

  assert.equal(odp.status, 400);
  const body = await odp.json();
  assert.ok(body.error?.details?.propozycja?.pl, 'odmowa bez propozycji zostawia użytkownika z niczym');
});

test('lista zwraca tylko WŁASNE wyszukiwania', async () => {
  const a = await konto();
  const b = await konto();
  await zapisz(a, { nazwa: 'Moje A', filtry: { zrodlo: 'bzp' } });

  const listaA = await (await fetch(`${BAZA}/wyszukiwania`, { headers: auth(a) })).json();
  const listaB = await (await fetch(`${BAZA}/wyszukiwania`, { headers: auth(b) })).json();
  assert.equal(listaA.wyszukiwania.length, 1);
  assert.equal(listaB.wyszukiwania.length, 0);
});

test('cudze wyszukiwanie to 404 — nie 403 i na pewno nie cudza treść', async () => {
  const a = await konto();
  const b = await konto();
  const { wyszukiwanie } = await (await zapisz(a, { nazwa: 'Sekret', filtry: { zrodlo: 'bzp' } })).json();

  for (const [metoda, body] of [['PATCH', { nazwa: 'Przejęte' }], ['DELETE', {}]]) {
    const odp = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, {
      method: metoda, headers: auth(b), body: JSON.stringify(body),
    });
    assert.equal(odp.status, 404, `${metoda} na cudzym wpisie`);
  }
  const podglad = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, { headers: auth(b) });
  assert.equal(podglad.status, 404);
});

test('edycja zmienia nazwę i przełącza alert; filtry da się podmienić w całości', async () => {
  const token = await konto();
  const { wyszukiwanie } = await (await zapisz(token, { nazwa: 'Przed', filtry: { zrodlo: 'bzp' } })).json();

  const odp = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ nazwa: 'Po', alert_wlaczony: false, filtry: { zrodlo: 'ted' }, czestotliwosc: 'tygodniowa' }),
  });

  assert.equal(odp.status, 200);
  const po = (await odp.json()).wyszukiwanie;
  assert.equal(po.nazwa, 'Po');
  assert.equal(po.alert_wlaczony, false);
  assert.equal(po.czestotliwosc, 'tygodniowa');
  assert.equal(po.filtry.zrodlo, 'ted');
  assert.notEqual(po.odcisk, wyszukiwanie.odcisk, 'zmiana filtrów MUSI przeliczyć odcisk');
});

test('usunięcie działa raz; powtórka to 404', async () => {
  const token = await konto();
  const { wyszukiwanie } = await (await zapisz(token, { nazwa: 'Kosz', filtry: { zrodlo: 'bzp' } })).json();

  const pierwsze = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, { method: 'DELETE', headers: auth(token), body: '{}' });
  assert.equal(pierwsze.status, 200);
  const drugie = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, { method: 'DELETE', headers: auth(token), body: '{}' });
  assert.equal(drugie.status, 404);
});

test('duplikat filtrów jest odrzucany 409 i wskazuje istniejący wpis', async () => {
  const token = await konto();
  const pierwszy = await (await zapisz(token, { nazwa: 'Pierwsze', filtry: { zrodlo: 'bzp', cpv: '45000000' } })).json();

  const odp = await zapisz(token, { nazwa: 'Drugie, te same filtry', filtry: { zrodlo: 'bzp', cpv: '45000000' } });
  assert.equal(odp.status, 409);
  const body = await odp.json();
  assert.equal(body.error.details.kod, 'duplikat');
  assert.equal(body.error.details.istniejaceId, pierwszy.wyszukiwanie.id);
});

test('samo przełączenie nazwy NIE jest duplikatem samego siebie', async () => {
  const token = await konto();
  const { wyszukiwanie } = await (await zapisz(token, { nazwa: 'A', filtry: { zrodlo: 'bzp', cpv: '71000000' } })).json();

  const odp = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ nazwa: 'B' }),
  });
  assert.equal(odp.status, 200);
});

test('limit liczby wyszukiwań jest egzekwowany przez trasę, nie tylko opisany', async () => {
  const token = await konto();
  for (let i = 0; i < MAKS_WYSZUKIWAN; i += 1) {
    // Różne CPV = różne odciski, więc odbić może tylko limit.
    const odp = await zapisz(token, { nazwa: `W${i}`, filtry: { cpv: String(10000000 + i) }, alert_wlaczony: false });
    assert.equal(odp.status, 201, `zapis ${i} powinien przejść`);
  }
  const ponad = await zapisz(token, { nazwa: 'Za dużo', filtry: { cpv: '99999999' }, alert_wlaczony: false });
  assert.equal(ponad.status, 409);
  assert.equal((await ponad.json()).error.details.kod, 'limit_wyszukiwan');
});

test('limit WŁĄCZONYCH alertów odbija zapis z alertem, ale przepuszcza bez alertu', async () => {
  const token = await konto();
  for (let i = 0; i < MAKS_ALERTOW; i += 1) {
    const odp = await zapisz(token, { nazwa: `A${i}`, filtry: { cpv: String(30000000 + i) }, alert_wlaczony: true });
    assert.equal(odp.status, 201);
  }
  const zAlertem = await zapisz(token, { nazwa: 'Jeszcze alert', filtry: { cpv: '39999999' }, alert_wlaczony: true });
  assert.equal(zAlertem.status, 409);
  assert.equal((await zAlertem.json()).error.details.kod, 'limit_alertow');

  const bezAlertu = await zapisz(token, { nazwa: 'Bez alertu', filtry: { cpv: '39999998' }, alert_wlaczony: false });
  assert.equal(bezAlertu.status, 201);
});

test('słownik częstotliwości pochodzi z backendu — aplikacja nie wymyśla własnych', async () => {
  const token = await konto();
  const odp = await (await fetch(`${BAZA}/wyszukiwania/czestotliwosci`, { headers: auth(token) })).json();
  assert.ok(Array.isArray(odp.czestotliwosci) && odp.czestotliwosci.length >= 3);
  assert.ok(odp.czestotliwosci.every((c) => c.etykieta?.pl && c.etykieta?.en));
  assert.equal(odp.limity.wyszukiwan, MAKS_WYSZUKIWAN);
  assert.equal(odp.limity.alertow, MAKS_ALERTOW);
});

test('podgląd wyszukiwania oddaje AKTUALNE trafienia z katalogu, bez zapisu czegokolwiek', async () => {
  const token = await konto();
  const { wyszukiwanie } = await (await zapisz(token, { nazwa: 'Podgląd', filtry: { termin: 'wszystkie' } })).json();

  const odp = await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}/podglad?limit=3`, { headers: auth(token) });
  assert.equal(odp.status, 200);
  const body = await odp.json();
  assert.ok(Array.isArray(body.tenders));
  assert.ok(Object.hasOwn(body, 'count'));

  // Podgląd nie może udawać przebiegu monitoringu.
  const po = await (await fetch(`${BAZA}/wyszukiwania/${wyszukiwanie.id}`, { headers: auth(token) })).json();
  assert.equal(po.wyszukiwanie.ostatnio_sprawdzone_o, null);
});

test('centrum alertów: pusta lista dla świeżego konta, z licznikiem nieprzeczytanych', async () => {
  const token = await konto();
  const body = await (await fetch(`${BAZA}/alerty`, { headers: auth(token) })).json();
  assert.deepEqual(body.alerty, []);
  assert.equal(body.nieprzeczytane, 0);
});

test('oznaczenie wszystkich jako przeczytane działa także na pustej liście', async () => {
  const token = await konto();
  const odp = await fetch(`${BAZA}/alerty/przeczytane`, { method: 'POST', headers: auth(token), body: '{}' });
  assert.equal(odp.status, 200);
  assert.equal((await odp.json()).oznaczone, 0);
});
