import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/*
 * Audyt 2026-07-09/10 (CRITICAL, druga warstwa obrony).
 *
 * Trasy `/api/fitter/scan-iso` i `/api/fitter/ai` są NIEUWIERZYTELNIONE, a każde
 * żądanie kosztuje realne pieniądze (skan ISO to wywołanie Sonneta z wizją).
 * `device_id` to dowolny tekst podany przez klienta. Bramka budżetu (D-025)
 * chroni przed katastrofą, ale odpala się dopiero po przepaleniu 500 dolarów.
 * Limiter na adres IP obchodzi się z wielu adresów.
 *
 * Dobowy limit per urządzenie nie odcina darmowych użytkowników — sprawia, że
 * nadużycie kosztuje atakującego tyle samo pracy, co uczciwe korzystanie.
 */

const DB_FILE = path.join(os.tmpdir(), `przetargai-quota-dev-${process.pid}.db`);
process.env.DATABASE_PATH = DB_FILE;
process.env.ANTHROPIC_API_KEY = '';

const { migrate } = await import('../src/db/migrate.js');
const { db } = await import('../src/db/index.js');
const { aiQuotaDevice, fitterPremium } = await import('../src/db/repos.js');

before(() => migrate());
after(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(`${DB_FILE}${s}`, { force: true });
});

test('limit darmowy: po wyczerpaniu doby rezerwacja odmawia', () => {
  const urzadzenie = `dev-free-${process.pid}`;
  const LIMIT = 3;

  const wyniki = [];
  for (let i = 0; i < 5; i++) wyniki.push(aiQuotaDevice.reserve(urzadzenie, 'fitter_scan', LIMIT));

  assert.deepEqual(wyniki, [true, true, true, false, false]);
  assert.equal(aiQuotaDevice.used(urzadzenie, 'fitter_scan'), LIMIT, 'licznik nie przekracza limitu');
});

test('operacje mają OSOBNE liczniki — czat nie zjada limitu skanów', () => {
  const urzadzenie = `dev-sep-${process.pid}`;
  assert.equal(aiQuotaDevice.reserve(urzadzenie, 'fitter_scan', 1), true);
  assert.equal(aiQuotaDevice.reserve(urzadzenie, 'fitter_scan', 1), false);
  assert.equal(aiQuotaDevice.reserve(urzadzenie, 'fitter_chat', 1), true, 'inna operacja ma własną pulę');
});

test('różne urządzenia nie dzielą limitu', () => {
  assert.equal(aiQuotaDevice.reserve(`a-${process.pid}`, 'fitter_scan', 1), true);
  assert.equal(aiQuotaDevice.reserve(`b-${process.pid}`, 'fitter_scan', 1), true);
});

test('limitDlaUrzadzenia: Premium dostaje wyraźnie więcej niż konto darmowe', () => {
  const premium = `dev-premium-${process.pid}`;
  fitterPremium.upsert({
    deviceId: premium, plan: 'monthly', status: 'active',
    customerId: null, subscriptionId: `sub-${process.pid}`, currentPeriodEnd: null,
  });

  const limitPremium = aiQuotaDevice.limitDlaUrzadzenia(premium, 'fitter_scan');
  const limitDarmowy = aiQuotaDevice.limitDlaUrzadzenia(`nieznane-${process.pid}`, 'fitter_scan');

  assert.ok(limitPremium > limitDarmowy, `premium ${limitPremium} musi być większy niż darmowy ${limitDarmowy}`);
  assert.ok(limitDarmowy >= 1, 'darmowy użytkownik musi móc spróbować choć raz');
});

test('subskrypcja anulowana nie daje limitu Premium', () => {
  const wygasly = `dev-canceled-${process.pid}`;
  fitterPremium.upsert({
    deviceId: wygasly, plan: 'monthly', status: 'canceled',
    customerId: null, subscriptionId: `sub-c-${process.pid}`, currentPeriodEnd: null,
  });

  assert.equal(
    aiQuotaDevice.limitDlaUrzadzenia(wygasly, 'fitter_scan'),
    aiQuotaDevice.limitDlaUrzadzenia(`obcy-${process.pid}`, 'fitter_scan'),
    'anulowany Premium ma limit darmowy',
  );
});
