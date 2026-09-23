import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  wyczyscOsieroconeSnapshoty,
  przytnijKopie,
  potrzebneWolneBajty,
} from '../src/services/backup.js';

/*
 * Regresja z produkcji (Railway, wolumen `backend-volume`, 2026-09-07 … 2026-09-23).
 *
 * `pruneOldBackups()` biegło PO zapisaniu nowej kopii. Gdy dysk się zapełnił,
 * `VACUUM INTO` rzucało „database or disk is full" — funkcja kończyła się wyjątkiem,
 * więc przycinanie NIGDY nie dochodziło do skutku. Każdej nocy przez 17 dni:
 * nieudany backup → osierocony `.snapshot-*` → dysk dalej pełny. Zakleszczenie,
 * z którego system nie mógł wyjść sam, a przy okazji ZAPISY aplikacji też padały.
 *
 * Stan zastany na wolumenie: 8 kopii (352 MB), 1 niedokończony snapshot (18,9 MB)
 * i 19 pustych snapshotów po kolejnych nieudanych przebiegach.
 */

/** Katalog kopii z plikami o zadanych rozmiarach. Zwraca ścieżkę. */
function katalogKopii(pliki) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-kopie-'));
  for (const [nazwa, bajty] of Object.entries(pliki)) {
    fs.writeFileSync(path.join(dir, nazwa), Buffer.alloc(bajty, 1));
  }
  return dir;
}

const nazwyW = (dir) => fs.readdirSync(dir).sort();

test('wyczyscOsieroconeSnapshoty — kasuje niedokończone snapshoty, nie rusza kopii', () => {
  const dir = katalogKopii({
    '.snapshot-2026-09-07T01-00-00-015Z.db': 1024,
    '.snapshot-2026-09-08T01-00-00-041Z.db': 0,
    '.snapshot-2026-09-08T01-00-00-041Z.db-journal': 0,
    'backup-2026-09-06T01-00-00-033Z.db.enc': 2048,
  });

  const wynik = wyczyscOsieroconeSnapshoty(dir);

  assert.equal(wynik.usuniete, 3);
  assert.equal(wynik.zwolnioneBajty, 1024);
  assert.deepEqual(nazwyW(dir), ['backup-2026-09-06T01-00-00-033Z.db.enc']);
});

test('przytnijKopie — usuwa najstarsze ponad retencję, zachowuje najnowsze', () => {
  const dir = katalogKopii({
    'backup-2026-09-01T01-00-00-000Z.db.enc': 100,
    'backup-2026-09-02T01-00-00-000Z.db.enc': 100,
    'backup-2026-09-03T01-00-00-000Z.db.enc': 100,
  });

  const wynik = przytnijKopie(dir, { retencja: 2, potrzebneBajty: 0, wolneBajty: 1_000_000 });

  assert.deepEqual(wynik.usuniete, ['backup-2026-09-01T01-00-00-000Z.db.enc']);
  assert.equal(wynik.zostalo, 2);
  assert.deepEqual(nazwyW(dir), [
    'backup-2026-09-02T01-00-00-000Z.db.enc',
    'backup-2026-09-03T01-00-00-000Z.db.enc',
  ]);
});

test('przytnijKopie — na ciasnym dysku tnie PONIŻEJ retencji, aż starczy miejsca', () => {
  const dir = katalogKopii({
    'backup-2026-09-01T01-00-00-000Z.db.enc': 100,
    'backup-2026-09-02T01-00-00-000Z.db.enc': 100,
    'backup-2026-09-03T01-00-00-000Z.db.enc': 100,
  });

  // Retencja pozwala trzymać 3, ale wolne jest tylko 50 B przy zapotrzebowaniu 250 B.
  // Zwolnienie dwóch najstarszych kopii daje 50 + 100 + 100 = 250 B.
  const wynik = przytnijKopie(dir, { retencja: 3, potrzebneBajty: 250, wolneBajty: 50 });

  assert.equal(wynik.wystarczaMiejsca, true);
  assert.equal(wynik.wolneBajtyPo, 250);
  assert.deepEqual(nazwyW(dir), ['backup-2026-09-03T01-00-00-000Z.db.enc']);
});

test('przytnijKopie — NIGDY nie kasuje ostatniej kopii, choćby miejsca dalej brakowało', () => {
  const dir = katalogKopii({ 'backup-2026-09-06T01-00-00-033Z.db.enc': 100 });

  const wynik = przytnijKopie(dir, { retencja: 5, potrzebneBajty: 10_000, wolneBajty: 0 });

  assert.equal(wynik.wystarczaMiejsca, false);
  assert.equal(wynik.zostalo, 1);
  assert.deepEqual(nazwyW(dir), ['backup-2026-09-06T01-00-00-033Z.db.enc'],
    'ostatnia poprawna kopia to jedyne zabezpieczenie bazy — przycinanie nie może jej zjeść');
});

test('potrzebneWolneBajty — rezerwuje zapas ponad rozmiar bazy', () => {
  // Snapshot (VACUUM INTO) i zaszyfrowana kopia nie leżą na dysku jednocześnie,
  // ale kopia ZOSTAJE — więc zapotrzebowanie liczymy od rozmiaru bazy z marginesem.
  assert.equal(potrzebneWolneBajty(100), 125);
  assert.ok(potrzebneWolneBajty(50_000_000) > 50_000_000);
});
