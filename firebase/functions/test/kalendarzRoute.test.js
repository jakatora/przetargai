import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * KALENDARZ TERMINÓW (etap 5, P1-7) — trasy.
 *
 * Kalendarz buduje się z ZAPISANYCH przetargów: to jest lista, którą użytkownik sam
 * wybrał, więc tylko dla niej ma sens pilnowanie trzech dat. Wszystkie obliczenia
 * (reguły ustawowe, strefa, ICS) są czyste i mają własne testy — tutaj sprawdzamy
 * kontrakt trasy i kontrolę dostępu.
 */

process.env.ANTHROPIC_API_KEY = '';

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { createApp } = await import('../src/app.js');
const { tenders, saved, matches } = await import('../src/db/repos.js');
const { kalendarzeUzytkownika } = await import('../src/routes/kalendarz.js');
const { getFirestore } = await import('firebase-admin/firestore');

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
    body: JSON.stringify({ email: `kal-${process.pid}-${seq}-${Date.now()}@t.pl`, password: 'tajnehaslo123', keywords: ['test'] }),
  });
  const body = await odp.json();
  return { token: body.token, userId: body.user.id };
}
const auth = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

/** Zapisuje przetarg u użytkownika — dokładnie tą drogą, którą robi to aplikacja. */
async function zapiszPrzetarg(userId, { source = 'bzp', deadline = '2099-10-30T08:00:00.000Z', tytul = 'Remont drogi' } = {}) {
  seq += 1;
  const { tender } = await tenders.upsert({
    externalId: `kal-${process.pid}-${seq}`, title: tytul, organization: 'Gmina', source, deadline,
  });
  await matches.create({ userId, tenderId: tender.id, score: 80, reasoning: 'x', scorer: 'heurystyka', tender });
  await saved.add(userId, {
    tender_id: tender.id, tender_title: tytul, tender_deadline: deadline, tender_source: source,
  });
  return tender;
}

test('kalendarz bez tokenu nie oddaje danych', async () => {
  assert.equal((await fetch(`${BAZA}/kalendarz`)).status, 401);
  assert.equal((await fetch(`${BAZA}/kalendarz/ics`)).status, 401);
});

test('świeże konto dostaje pusty kalendarz z czytelnym wyjaśnieniem, a nie błąd', async () => {
  const { token } = await konto();
  const odp = await fetch(`${BAZA}/kalendarz`, { headers: auth(token) });

  assert.equal(odp.status, 200);
  const body = await odp.json();
  assert.deepEqual(body.przetargi, []);
  assert.equal(body.nastepny, null);
  assert.ok(body.pustka.pl && body.pustka.en, 'pusty ekran musi wiedzieć, co powiedzieć');
});

test('zapisany przetarg BZP daje trzy terminy z oznaczeniem, które są WYLICZONE', async () => {
  const { token, userId } = await konto();
  await zapiszPrzetarg(userId, { source: 'bzp' });

  const body = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();

  assert.equal(body.przetargi.length, 1);
  const k = body.przetargi[0];
  assert.deepEqual(k.pozycje.map((p) => p.kod), ['pytania', 'oferty', 'zwiazanie']);
  assert.equal(k.pozycje[1].zrodloDaty, 'ogloszenie');
  assert.equal(k.pozycje[0].zrodloDaty, 'wyliczony');
  assert.ok(k.pozycje[1].lokalnie.etykieta, 'data musi przyjść gotowa do pokazania, w czasie polskim');
  assert.equal(body.strefa, 'Europe/Warsaw');
});

test('Baza Konkurencyjności: termin ofert jest, dwa pozostałe uczciwie nieznane', async () => {
  const { token, userId } = await konto();
  await zapiszPrzetarg(userId, { source: 'baza_konkurencyjnosci' });

  const body = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();
  const k = body.przetargi[0];

  assert.equal(k.pozycje[0].znany, false);
  assert.ok(k.pozycje[0].brak.pl.length > 0);
  assert.equal(k.pozycje[1].znany, true);
});

test('NASTĘPNY KROK wskazuje najbliższą datę spośród WSZYSTKICH zapisanych przetargów', async () => {
  const { token, userId } = await konto();
  await zapiszPrzetarg(userId, { deadline: '2099-12-30T08:00:00.000Z', tytul: 'Późny' });
  await zapiszPrzetarg(userId, { deadline: '2099-10-30T08:00:00.000Z', tytul: 'Wcześniejszy' });

  const body = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();

  assert.ok(body.nastepny, 'karta „następny krok" to główny element ekranu');
  assert.equal(body.nastepny.tytul, 'Wcześniejszy');
  assert.equal(body.nastepny.kod, 'pytania', 'przed składaniem ofert wypada termin pytań');
  assert.equal(typeof body.nastepny.dniDo, 'number');
});

test('ANULOWANY przetarg jest oznaczony i nie proponuje następnego kroku', async () => {
  const { token, userId } = await konto();
  const t = await zapiszPrzetarg(userId, { tytul: 'Unieważniony' });
  await tenders.oznaczAnulowany(t.bzp_external_id, { powod: 'unieważnione' });

  const body = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();

  assert.equal(body.przetargi[0].anulowany, true);
  assert.equal(body.przetargi[0].nastepny, null);
  assert.equal(body.nastepny, null, 'nie ma po co przygotowywać oferty na anulowane postępowanie');
});

test('kalendarz jednego przetargu jest dostępny osobno', async () => {
  const { token, userId } = await konto();
  const t = await zapiszPrzetarg(userId);

  const odp = await fetch(`${BAZA}/kalendarz/${t.id}`, { headers: auth(token) });
  assert.equal(odp.status, 200);
  const body = await odp.json();
  assert.equal(body.kalendarz.tenderId, t.id);
  assert.equal(body.kalendarz.pozycje.length, 3);
});

test('kalendarz nieistniejącego przetargu to 404', async () => {
  const { token } = await konto();
  assert.equal((await fetch(`${BAZA}/kalendarz/nie-ma-takiego`, { headers: auth(token) })).status, 404);
});

test('eksport ICS wraca jako plik kalendarza, nie jako JSON', async () => {
  const { token, userId } = await konto();
  await zapiszPrzetarg(userId, { tytul: 'Remont drogi gminnej' });

  const odp = await fetch(`${BAZA}/kalendarz/ics`, { headers: auth(token) });

  assert.equal(odp.status, 200);
  assert.match(odp.headers.get('content-type'), /text\/calendar/);
  assert.match(odp.headers.get('content-disposition') ?? '', /\.ics/);

  const tekst = await odp.text();
  assert.match(tekst, /^BEGIN:VCALENDAR/);
  assert.equal((tekst.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.match(tekst, /Remont drogi gminnej/);
});

test('ICS świeżego konta jest pusty, ale poprawny — kalendarz go przyjmie', async () => {
  const { token } = await konto();
  const tekst = await (await fetch(`${BAZA}/kalendarz/ics`, { headers: auth(token) })).text();

  assert.match(tekst, /^BEGIN:VCALENDAR/);
  assert.match(tekst, /END:VCALENDAR/);
  assert.equal((tekst.match(/BEGIN:VEVENT/g) ?? []).length, 0);
});

test('kalendarz pokazuje WYŁĄCZNIE własne zapisane przetargi', async () => {
  const a = await konto();
  const b = await konto();
  await zapiszPrzetarg(a.userId, { tytul: 'Tylko moje' });

  const cudzy = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(b.token) })).json();
  assert.deepEqual(cudzy.przetargi, []);
});

test('kalendarz niesie STAN PRZYPOMNIENIA, zeby dalo sie je wlaczyc bez opuszczania ekranu', async () => {
  /*
   * Kalendarz pokazuje TRZY terminy, ale push o zblizajacym sie terminie dotyczy
   * skladania ofert i wlacza sie go dzis wylacznie z ekranu „Zapisane". Ekran, ktory
   * mowi „zostaly 3 dni" i nie pozwala wlaczyc przypomnienia, kaze uzytkownikowi
   * pamietac o zajrzeniu tu jeszcze raz — czyli robi dokladnie to, czemu ma zapobiegac.
   */
  const { token, userId } = await konto();
  const t = await zapiszPrzetarg(userId);

  const przed = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();
  assert.equal(przed.przetargi[0].przypomnienie.wlaczone, false);
  assert.equal(przed.przetargi[0].przypomnienie.remind_at, null);

  await fetch(`${BAZA}/matches/${t.id}/reminder`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ enabled: true }),
  });

  const po = await (await fetch(`${BAZA}/kalendarz`, { headers: auth(token) })).json();
  assert.equal(po.przetargi[0].przypomnienie.wlaczone, true);
  assert.ok(po.przetargi[0].przypomnienie.remind_at, 'wlaczone przypomnienie ma znany moment wysylki');
  assert.equal(typeof po.przetargi[0].przypomnienie.etap, 'number');
});

test('kalendarz JEDNEGO ogloszenia tez mowi, czy przypomnienie jest wlaczone', async () => {
  const { token, userId } = await konto();
  const t = await zapiszPrzetarg(userId);

  const body = await (await fetch(`${BAZA}/kalendarz/${t.id}`, { headers: auth(token) })).json();
  assert.equal(body.kalendarz.przypomnienie.wlaczone, false);
});

test('ogloszenie NIEZAPISANE nie udaje, ze ma przypomnienie', async () => {
  const { token, userId } = await konto();
  // Przetarg istnieje w bazie, ale ten uzytkownik go nie zapisal.
  const inny = await konto();
  const t = await zapiszPrzetarg(inny.userId);
  void userId;

  const body = await (await fetch(`${BAZA}/kalendarz/${t.id}`, { headers: auth(token) })).json();
  assert.equal(body.kalendarz.przypomnienie.wlaczone, false);
  assert.equal(body.kalendarz.przypomnienie.mozliwe, false, 'bez zapisania nie ma czego przypominac');
});

/*
 * ZMIANA W ŹRÓDLE MUSI DOTRZEĆ DO „ZAPISANYCH" (naprawa 2026-09-25).
 *
 * `saved.add` kopiuje `tender_deadline`, przypomnienia liczyły się z kopii,
 * a `zaktualizujZeZrodla` aktualizowało tylko `tenders/`. Zamawiający w BK skraca
 * termin z +20 do +4 dni → kalendarz dalej pokazywał +20, a przypomnienie
 * „7 dni przed" wypadało PO nowym terminie.
 */
test('REGRESJA: skrócenie terminu w BK dociera do Zapisanych, kalendarza i przypomnienia', async () => {
  const { userId } = await konto();
  const stary = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const nowy = new Date(Date.now() + 4 * 86_400_000).toISOString();
  const t = await zapiszPrzetarg(userId, { source: 'baza_konkurencyjnosci', deadline: stary });
  const przed = await saved.setReminder(userId, t.id, true);
  assert.equal(przed.reminder_enabled, true);

  await tenders.zaktualizujZeZrodla({ externalId: t.bzp_external_id, deadline: nowy });

  const [kal] = await kalendarzeUzytkownika(userId, new Date().toISOString());
  assert.equal(kal.pozycje.find((p) => p.kod === 'oferty')?.at, nowy, 'kalendarz pokazuje NOWY termin');

  const wpis = (await saved.list(userId)).find((s) => s.id === t.id);
  assert.equal(wpis.tender_deadline, nowy, 'kopia w Zapisanych nadpisana');
  assert.equal(wpis.reminder_enabled, true);
  assert.ok(wpis.remind_at < nowy, 'przypomnienie wypada PRZED nowym terminem');
  assert.ok(wpis.remind_at > new Date().toISOString(), 'i w przyszłości, nie wstecz');

  const m = await matches.detail(userId, t.id);
  assert.equal(m.tender_deadline, nowy, 'feed dopasowań też nie trzyma starego terminu');
});

test('kalendarz bierze termin z DOKUMENTU przetargu, nawet gdy kopia w Zapisanych jest stara', async () => {
  const { userId } = await konto();
  const t = await zapiszPrzetarg(userId, { deadline: '2099-10-30T08:00:00.000Z' });
  await getFirestore().collection('tenders').doc(t.id).update({ deadline: '2099-10-10T08:00:00.000Z' });

  const [kal] = await kalendarzeUzytkownika(userId, new Date().toISOString());
  assert.equal(kal.pozycje.find((p) => p.kod === 'oferty')?.at, '2099-10-10T08:00:00.000Z');
});

test('anulowanie w źródle wyłącza przypomnienie zapisanego przetargu i znakuje kopie', async () => {
  const { userId } = await konto();
  const t = await zapiszPrzetarg(userId, { source: 'baza_konkurencyjnosci', deadline: new Date(Date.now() + 20 * 86_400_000).toISOString() });
  await saved.setReminder(userId, t.id, true);

  await tenders.oznaczAnulowany(t.bzp_external_id, { powod: 'CANCELLED' });

  const wpis = (await saved.list(userId)).find((s) => s.id === t.id);
  assert.equal(wpis.reminder_enabled, false, 'nie przypominamy o postępowaniu, którego już nie ma');
  assert.equal(wpis.tender_anulowany, true);
  assert.equal((await saved.dueReminders('2100-01-01T00:00:00.000Z')).some((d) => d.tenderId === t.id), false);
  assert.equal((await matches.detail(userId, t.id)).tender_anulowany, true);
});
