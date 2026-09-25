import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { cleanupVolume, retencjaKopii } from '../scripts/prestart-cleanup.js';

/*
 * Prestart przy KAŻDYM starcie/deployu przycinał kopie do 2 (KEEP_BACKUPS = 2), choć
 * retencja to 7 (BACKUP_RETENTION) — każdy deploy kasował 5 dni kopii (2026-09-25).
 * Teraz: retencja z BACKUP_RETENTION (domyślnie 7), a głębiej tylko przy realnym braku
 * miejsca (jak `przytnijKopie` w services/backup.js) i NIGDY ostatnia kopia. Osierocone
 * snapshoty VACUUM INTO — nadal sprzątane.
 */

const KB = 1000;

function wolumen({ kopii, bajtyKopii = KB, bajtyBazy = KB }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-prestart-'));
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(dataDir, 'data.db'), Buffer.alloc(bajtyBazy));
  fs.writeFileSync(path.join(dataDir, 'data.db-wal'), Buffer.alloc(0));
  const nazwy = [];
  for (let i = 0; i < kopii; i++) {
    const nazwa = `backup-2026-09-${String(10 + i).padStart(2, '0')}T03-00-00-000Z.db.enc`;
    const p = path.join(backupDir, nazwa);
    fs.writeFileSync(p, Buffer.alloc(bajtyKopii));
    const t = new Date(Date.UTC(2026, 8, 10 + i, 3)).getTime() / 1000;
    fs.utimesSync(p, t, t); // mtime rośnie z datą w nazwie — i = kopii-1 to najnowsza
    nazwy.push(nazwa);
  }
  return { dataDir, backupDir, nazwy, sprzatnij: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

const kopie = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort();

test('retencjaKopii — BACKUP_RETENTION z env, domyślnie 7, śmieci => 7', () => {
  assert.equal(retencjaKopii(undefined), 7);
  assert.equal(retencjaKopii(''), 7);
  assert.equal(retencjaKopii('14'), 14);
  assert.equal(retencjaKopii('0'), 7);
  assert.equal(retencjaKopii('abc'), 7);
});

test('7 kopii i dużo wolnego miejsca → zostaje 7 (deploy nie kasuje tygodnia kopii)', () => {
  const w = wolumen({ kopii: 7 });
  try {
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, wolneBajty: 10 ** 12 });
    assert.deepEqual(kopie(w.backupDir), w.nazwy);
  } finally { w.sprzatnij(); }
});

test('domyślna retencja bez parametru = BACKUP_RETENTION z env (tu 3)', () => {
  const w = wolumen({ kopii: 5 });
  const poprzednia = process.env.BACKUP_RETENTION;
  process.env.BACKUP_RETENTION = '3';
  try {
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, wolneBajty: 10 ** 12 });
    assert.deepEqual(kopie(w.backupDir), w.nazwy.slice(2), 'zostają 3 najnowsze');
  } finally {
    if (poprzednia === undefined) delete process.env.BACKUP_RETENTION; else process.env.BACKUP_RETENTION = poprzednia;
    w.sprzatnij();
  }
});

test('ponad retencję → najstarsze kasowane nawet przy wolnym miejscu', () => {
  const w = wolumen({ kopii: 9 });
  try {
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, keepBackups: 7, wolneBajty: 10 ** 12 });
    assert.deepEqual(kopie(w.backupDir), w.nazwy.slice(2));
  } finally { w.sprzatnij(); }
});

test('mało miejsca → przycina najstarsze, aż starczy na bazę z zapasem', () => {
  // Potrzeba ≈ 1,25 × baza = 1250 B; wolne 0 => kasujemy 2 najstarsze (po 1000 B).
  const w = wolumen({ kopii: 7 });
  try {
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, keepBackups: 7, wolneBajty: 0 });
    assert.deepEqual(kopie(w.backupDir), w.nazwy.slice(2));
  } finally { w.sprzatnij(); }
});

test('brak miejsca nie do odzyskania → zostaje OSTATNIA (najnowsza) kopia, nigdy zero', () => {
  const w = wolumen({ kopii: 4, bajtyBazy: 10 * KB });
  try {
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, keepBackups: 7, wolneBajty: 0 });
    assert.deepEqual(kopie(w.backupDir), [w.nazwy.at(-1)]);
  } finally { w.sprzatnij(); }
});

test('osierocone snapshoty nadal sprzątane; baza i WAL nietknięte', () => {
  const w = wolumen({ kopii: 2 });
  try {
    fs.writeFileSync(path.join(w.backupDir, '.snapshot-2026.db'), 'x');
    fs.writeFileSync(path.join(w.dataDir, '.snapshot-stary.db'), 'x');
    cleanupVolume({ dataDir: w.dataDir, backupDir: w.backupDir, wolneBajty: 10 ** 12 });
    assert.ok(!fs.existsSync(path.join(w.backupDir, '.snapshot-2026.db')));
    assert.ok(!fs.existsSync(path.join(w.dataDir, '.snapshot-stary.db')));
    assert.ok(fs.existsSync(path.join(w.dataDir, 'data.db')));
    assert.ok(fs.existsSync(path.join(w.dataDir, 'data.db-wal')));
    assert.equal(kopie(w.backupDir).length, 2);
  } finally { w.sprzatnij(); }
});
