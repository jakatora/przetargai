import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = '';
const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();
const { users, tenders } = await import('../src/db/repos.js');
const { zbudujSygnal } = await import('../src/lib/sygnaly.js');
const { env } = await import('../src/config.js');

let seq = 0;
const nowy = (extra = {}) => users.create({ email: `rk${process.pid}-${++seq}@t.pl`, passwordHash: 'h', ...extra });

test('config: przełącznik i link aplikacji mają wartości domyślne', () => {
  assert.equal(env.PRACOWNIK_ENABLED, 'true');
  assert.equal(env.APP_LINK_URL, 'https://przetarg-ai.pl');
});

test('create: próba tylko na żądanie (rejestracja), testowe konta bez próby', async () => {
  const bez = await nowy();
  assert.equal(bez.proba_do, null);
  const zProba = await nowy({ probaDni: 7 });
  const dni = (Date.parse(zProba.proba_do) - Date.parse(zProba.created_at)) / 86_400_000;
  assert.equal(dni, 7);
});

test('zapiszKarte zapisuje profil i kartę; findById oddaje całość', async () => {
  const u = await nowy();
  const zapisany = await users.zapiszKarte(u.id, {
    companyName: 'Dachpol', keywords: ['dach'], cpvCodes: ['45261000'], regiony: ['18'], wartoscMax: 1e6,
    karta: { opis: 'Dachy', wykluczenia: ['drogi'], wartosc_min: 5e4, min_dni_oferta: 7,
      formalne: { obrot_roczny: 1e6, referencja_kwota: null, referencja_opis: null, uprawnienia: [] } },
  });
  assert.equal(zapisany.company_name, 'Dachpol');
  assert.deepEqual(zapisany.karta.wykluczenia, ['drogi']);
  assert.equal(zapisany.karta.min_dni_oferta, 7);
  assert.ok(zapisany.karta.zaktualizowano);
});

test('dodajSygnal: transakcyjnie, najnowszy pierwszy', async () => {
  const u = await nowy();
  const teraz = new Date().toISOString();
  await users.dodajSygnal(u.id, zbudujSygnal({ typ: 'zapis', tenderId: 'a', tytul: 'A', teraz }));
  await users.dodajSygnal(u.id, zbudujSygnal({ typ: 'odrzucenie', tenderId: 'b', tytul: 'B', przyczyna: 'teren', teraz }));
  const s = (await users.findById(u.id)).pracownik_sygnaly;
  assert.deepEqual(s.map((x) => x.tender_id), ['b', 'a']);
});

test('odlozPropozycje: wygasłe odłożenia są sprzątane', async () => {
  const u = await nowy();
  await users.odlozPropozycje(u.id, 'stary', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  await users.odlozPropozycje(u.id, 'nowy', '2099-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
  assert.deepEqual((await users.findById(u.id)).pracownik_odlozone.map((o) => o.klucz), ['nowy']);
});

test('maile próby: rezerwacja raz; zwolnienie pozwala ponowić', async () => {
  const u = await nowy({ probaDni: 7 });
  assert.equal(await users.zarezerwujMailProby(u.id, 'koniec'), true);
  assert.equal(await users.zarezerwujMailProby(u.id, 'koniec'), false);
  await users.zwolnijMailProby(u.id, 'koniec');
  assert.equal(await users.zarezerwujMailProby(u.id, 'koniec'), true);
  await users.potwierdzMailProby(u.id, 'koniec');
  assert.equal((await users.findById(u.id)).proba_maile.koniec.stan, 'wyslany');
});

test('przełącznik maili i znacznik przebiegu', async () => {
  const u = await nowy();
  await users.ustawPowiadomieniaEmail(u.id, false);
  await users.oznaczPrzebiegSelekcji(u.id, { o: '2026-10-21T10:00:00.000Z', wersja: 'abc' });
  const z = await users.findById(u.id);
  assert.equal(z.powiadomienia_pracownik_email, false);
  assert.equal(z.pracownik_ostatni_przebieg, '2026-10-21T10:00:00.000Z');
  assert.equal(z.pracownik_wersja, 'abc');
});

test('pula niesie fetched_at i rodzaj (potrzebne lejkowi)', async () => {
  await tenders.upsert({ externalId: `rk-pula-${process.pid}`, title: 'X', deadline: '2099-01-01T00:00:00.000Z', rodzaj: 'Dostawy' });
  tenders.odswiezPule();
  const pula = await tenders.openPool({ swiezaKopia: true });
  const t = pula.find((x) => x.title === 'X' && x.rodzaj === 'Dostawy');
  assert.ok(t?.fetched_at, 'fetched_at w puli');
});
