import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ANTHROPIC_API_KEY = '';

/*
 * Audyt 2026-07-10 (HIGH): `magic_links` miały zadeklarowaną politykę TTL na polu
 * `expires_at` — tekście ISO. Firestore usuwa dokumenty WYŁĄCZNIE po polach typu
 * Timestamp, więc polityka nie robiła NIC: zużyte i przeterminowane linki, dziennik
 * audytu z adresami IP i rejestr zdarzeń Stripe rosły w nieskończoność.
 *
 * Ten test pilnuje dwóch rzeczy naraz:
 *  1. kod zapisuje pole `ttl` jako Timestamp (a nie tekst),
 *  2. każda kolekcja z polem `ttl` ma odpowiadający jej wpis w firestore.indexes.json.
 */

const { polaczZEmulatorem } = await import('./emulator.js');
await polaczZEmulatorem();

const { magicLinks, auditLogs, stripeEvents, faktury } = await import('../src/db/repos.js');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEXES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json'), 'utf8'));

async function polettl(kolekcja, docId) {
  const snap = await getFirestore().collection(kolekcja).doc(docId).get();
  return snap.exists ? snap.data().ttl : undefined;
}

test('KRYTYCZNE: pole ttl zapisuje się jako Timestamp, nie jako tekst', async () => {
  // Tekst ISO wygląda tak samo w konsoli, ale polityka TTL go IGNORUJE.
  const { token } = await magicLinks.create({ userId: 'u1', purpose: 'upgrade', ttlMinutes: 10 });
  const ttl = await polettl('magic_links', token);

  assert.ok(ttl instanceof Timestamp, `ttl musi być Timestamp, jest: ${typeof ttl}`);
  assert.ok(ttl.toDate() > new Date(), 'ttl wskazuje przyszłość');
});

test('audit_logs: wpis dostaje ttl (zawiera adres IP — nie trzymamy go wiecznie)', async () => {
  await auditLogs.record({ userId: 'u1', action: 'test', ip: '203.0.113.1' });
  const snap = await getFirestore().collection('audit_logs').where('action', '==', 'test').limit(1).get();
  assert.equal(snap.empty, false);
  const ttl = snap.docs[0].data().ttl;
  assert.ok(ttl instanceof Timestamp, 'dziennik audytu bez TTL rośnie w nieskończoność');
});

test('stripe_events: domknięte zdarzenie dostaje ttl', async () => {
  const id = `evt_ttl_${process.pid}`;
  await stripeEvents.claim(id, 'test');
  await stripeEvents.markDone(id);
  const ttl = await polettl('stripe_events', id);
  assert.ok(ttl instanceof Timestamp);
});

test('invoices: rezerwacja faktury dostaje ttl', async () => {
  const sesja = `cs_ttl_${process.pid}`;
  await faktury.zarezerwuj(sesja);
  const ttl = await polettl('invoices', sesja);
  assert.ok(ttl instanceof Timestamp);
});

test('KRYTYCZNE: każda kolekcja z polem ttl ma zadeklarowaną politykę w firestore.indexes.json', () => {
  // Bez wpisu w konfiguracji pole `ttl` jest zwykłym polem — nic się nie kasuje.
  const zadeklarowane = new Set(
    (INDEXES.fieldOverrides ?? [])
      .filter((f) => f.ttl === true && f.fieldPath === 'ttl')
      .map((f) => f.collectionGroup),
  );

  for (const kolekcja of ['magic_links', 'audit_logs', 'stripe_events', 'invoices']) {
    assert.ok(zadeklarowane.has(kolekcja),
      `kolekcja ${kolekcja} zapisuje pole ttl, ale nie ma polityki TTL w firestore.indexes.json`);
  }
});

test('polityka TTL NIE jest zadeklarowana na polu tekstowym', () => {
  // Regresja: `expires_at` to tekst ISO. Deklaracja TTL na nim była martwa.
  const naTekstowym = (INDEXES.fieldOverrides ?? [])
    .filter((f) => f.ttl === true && f.fieldPath !== 'ttl');
  assert.deepEqual(naTekstowym, [],
    'TTL działa wyłącznie na polach Timestamp — użyj pola `ttl`');
});
