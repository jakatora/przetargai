import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createSejfDokumentow } from '../src/services/sejfDokumentow.js';
import { dataWaznosci } from '../src/services/waznoscDokumentow.js';
import { runSejfMonitor, powiadomOTerminie } from '../src/jobs/monitorSejf.js';

/*
 * Cykliczne przypomnienia z wyprzedzeniem — `runSejfMonitor` (podzadanie 6/7
 * ulepszenia „Sejf podmiotowych środków dowodowych z licznikiem świeżości").
 *
 * Job skanuje dokumenty WSZYSTKICH użytkowników i emituje alert dla każdego, który
 * wszedł w okno „zamów nowy" liczone przez `dzienAlertu` (data ważności − realny czas
 * urzędu). Sedno testujemy end-to-end na realnej (in-memory) bazie i realnej logice
 * świeżości/katalogu — wstrzykujemy TYLKO powiadomienie (bez sieci) i `dzien`
 * (żeby test był deterministyczny, nie zależny od zegara).
 *
 * Osie:
 *  • KRK w oknie czasu urzędu => alert do właściciela (z jego push_tokenem),
 *  • dokument z dużym zapasem dni => brak alertu,
 *  • KRK alarmuje WCZEŚNIEJ niż US przy tym samym zapasie dni (realny czas urzędu),
 *  • dokument bezterminowy => brak alertu (licznik świeżości go nie tyka),
 *  • skan WSZYSTKICH userów + trasowanie po właścicielu,
 *  • błąd powiadomienia jednego rekordu nie przerywa przebiegu.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

/** Świeża baza in-memory ze schematem i wskazanymi użytkownikami (z push-tokenami). */
function freshDb(users = [['u1', 'ExponentPushToken[u1]']]) {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec(schemaSql);
  const ins = d.prepare(
    'INSERT INTO users (id, email, password_hash, push_token, created_at, updated_at)'
    + " VALUES (?, ?, 'h', ?, 't', 't')",
  );
  for (const [id, token] of users) ins.run(id, `${id}@t.pl`, token ?? null);
  return d;
}

/** Repo użytkowników spięte z podaną bazą (findById — jak w produkcyjnym `users`). */
function usersRepoNa(d) {
  const stmt = d.prepare('SELECT * FROM users WHERE id = ?');
  return { findById: (id) => stmt.get(id) ?? null };
}

/** Spy na powiadomienie: liczy wywołania i zwraca „wysłano", gdy user ma push_token. */
function fakePowiadom() {
  const wywolania = [];
  const fn = async (user, ctx) => {
    wywolania.push({ user, ctx });
    return { sent: user?.push_token ? 1 : 0 };
  };
  fn.wywolania = wywolania;
  return fn;
}

test('KRK w oknie czasu urzędu => alert do właściciela', async () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  const wyst = '2026-01-01';
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: wyst }); // okres 180 z katalogu
  const dzien = dataWaznosci(wyst, 170); // 10 dni do końca ważności (< 21 = czas urzędu KRK)

  const powiadom = fakePowiadom();
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien });

  assert.equal(wynik.alerty, 1, JSON.stringify(wynik));
  assert.equal(wynik.powiadomienia, 1);
  assert.equal(powiadom.wywolania.length, 1);
  assert.equal(powiadom.wywolania[0].ctx.dok.typ_dokumentu, 'krk');
  assert.equal(powiadom.wywolania[0].ctx.dok.user_id, 'u1');
  assert.equal(powiadom.wywolania[0].user.push_token, 'ExponentPushToken[u1]', 'push do właściciela');
  d.close();
});

test('dokument z dużym zapasem dni => brak alertu', async () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: '2026-01-01' });
  const powiadom = fakePowiadom();

  // dzień = dzień wystawienia → pełne 180 dni zapasu, daleko poza oknem urzędu.
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien: '2026-01-01' });

  assert.equal(wynik.alerty, 0, 'świeży dokument nie alarmuje');
  assert.equal(powiadom.wywolania.length, 0);
  d.close();
});

test('KRK alarmuje wcześniej niż US przy tym samym zapasie dni (realny czas urzędu)', async () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  const wyst = '2026-01-01';
  const okres = 100;
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: wyst, okresWaznosciDni: okres });
  sejf.utworz('u1', { typ: 'us', dataWystawienia: wyst, okresWaznosciDni: okres });
  const dzien = dataWaznosci(wyst, okres - 14); // oba mają dokładnie 14 dni zapasu

  const powiadom = fakePowiadom();
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien });

  // KRK (czas urzędu 21) przy 14 dniach JUŻ w oknie; US (czas urzędu 7) jeszcze nie.
  assert.equal(wynik.alerty, 1, 'tylko KRK, mimo identycznego zapasu dni');
  assert.equal(powiadom.wywolania.length, 1);
  assert.equal(powiadom.wywolania[0].ctx.dok.typ_dokumentu, 'krk');
  d.close();
});

test('dokument bezterminowy (wykaz robót) => brak alertu', async () => {
  const d = freshDb();
  const sejf = createSejfDokumentow(d);
  sejf.utworz('u1', { typ: 'wykaz_robot_uslugi', dataWystawienia: '2020-01-01' });
  const powiadom = fakePowiadom();

  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien: '2030-01-01' });

  assert.equal(wynik.alerty, 0, 'bezterminowy nie ma daty ważności — brak alertu');
  assert.equal(powiadom.wywolania.length, 0);
  d.close();
});

test('skanuje dokumenty WSZYSTKICH userów i trasuje alert po właścicielu', async () => {
  const d = freshDb([['u1', 'ExponentPushToken[u1]'], ['u2', 'ExponentPushToken[u2]']]);
  const sejf = createSejfDokumentow(d);
  const wyst = '2026-01-01';
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: wyst });
  sejf.utworz('u2', { typ: 'krk', dataWystawienia: wyst });
  const dzien = dataWaznosci(wyst, 170); // oba w oknie

  const powiadom = fakePowiadom();
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien });

  assert.equal(wynik.alerty, 2);
  assert.equal(wynik.powiadomienia, 2);
  const wlasciciele = powiadom.wywolania.map((w) => w.ctx.dok.user_id).sort();
  assert.deepEqual(wlasciciele, ['u1', 'u2'], 'każdy user dostał alert o swoim dokumencie');
  d.close();
});

test('dokument bez push_tokenu => alert policzony, ale powiadomienie nie wychodzi', async () => {
  const d = freshDb([['u1', null]]); // brak push_tokenu
  const sejf = createSejfDokumentow(d);
  const wyst = '2026-01-01';
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: wyst });
  const dzien = dataWaznosci(wyst, 170);

  const powiadom = fakePowiadom();
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien });

  assert.equal(wynik.alerty, 1, 'stan w bazie to źródło prawdy — alert istnieje');
  assert.equal(wynik.powiadomienia, 0, 'bez tokenu push nie wychodzi (best-effort)');
  d.close();
});

test('błąd powiadomienia jednego rekordu nie przerywa przebiegu', async () => {
  const d = freshDb([['u1', 'ExponentPushToken[u1]'], ['u2', 'ExponentPushToken[u2]']]);
  const sejf = createSejfDokumentow(d);
  const wyst = '2026-01-01';
  sejf.utworz('u1', { typ: 'krk', dataWystawienia: wyst });
  sejf.utworz('u2', { typ: 'krk', dataWystawienia: wyst });
  const dzien = dataWaznosci(wyst, 170);

  let doszlyDoU2 = 0;
  const powiadom = async (user) => {
    if (user.id === 'u1') throw new Error('Expo push 500');
    doszlyDoU2++;
    return { sent: 1 };
  };
  const wynik = await runSejfMonitor({ sejf, usersRepo: usersRepoNa(d), powiadom, dzien });

  assert.ok(wynik.bledy >= 1, 'błąd rekordu policzony');
  assert.equal(wynik.ok, true, 'przebieg kończy się mimo błędu rekordu');
  assert.equal(doszlyDoU2, 1, 'drugi rekord i tak obsłużony');
  d.close();
});

test('powiadomOTerminie — bez push_tokenu nie rusza sieci i zwraca sent 0', async () => {
  // Guard jak w monitorWaloryzacji: brak tokenu => nie dotykamy Expo Push API.
  const wynik = await powiadomOTerminie({ id: 'u1', push_token: null }, {
    dok: { nazwaTypu: 'Zaświadczenie KRK', dniDoWaznosci: 10, online: { nazwa: 'e-KRK', url: 'https://ekrk.ms.gov.pl' } },
  });
  assert.deepEqual(wynik, { sent: 0 });
});
