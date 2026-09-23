import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Pełny przebieg `createBackup` na izolowanym katalogu kopii.
 *
 * BACKUP_DIR jest rozwiązywany w `config/env.js` w chwili importu, więc ustawiamy
 * go PRZED dynamicznym importem — statyczny `import` wykonałby się wcześniej.
 */
const KATALOG = fs.mkdtempSync(path.join(os.tmpdir(), 'przetargai-przebieg-'));
process.env.BACKUP_DIR = KATALOG;

const { createBackup, statusKopii, potrzebneWolneBajty } = await import('../src/services/backup.js');
const { DB_PATH } = await import('../src/config/env.js');

const nazwyW = () => fs.readdirSync(KATALOG).sort();
const kopie = () => nazwyW().filter((f) => f.startsWith('backup-'));
const snapshoty = () => nazwyW().filter((f) => f.startsWith('.snapshot-'));

function wyczysc() {
  for (const f of nazwyW()) fs.rmSync(path.join(KATALOG, f), { force: true });
}

/** Ile wolnego miejsca potrzebuje jeden przebieg przy obecnym rozmiarze bazy. */
function potrzebneNaPrzebieg() {
  const bajty = fs.statSync(DB_PATH).size
    + (fs.existsSync(`${DB_PATH}-wal`) ? fs.statSync(`${DB_PATH}-wal`).size : 0);
  return potrzebneWolneBajty(bajty);
}

test('createBackup — pełny dysk NIE zakleszcza retencji: przycina, potem robi kopię', async () => {
  wyczysc();
  const potrzebne = potrzebneNaPrzebieg();
  // Trzy stare kopie po pół zapotrzebowania — miejsce zwolnią dopiero DWIE z nich.
  for (const dzien of ['01', '02', '03']) {
    fs.writeFileSync(path.join(KATALOG, `backup-2026-09-${dzien}T01-00-00-000Z.db.enc`),
      Buffer.alloc(Math.ceil(potrzebne / 2), 1));
  }

  // Dysk zajęty do zera — dokładnie sytuacja z produkcji 2026-09-07…23.
  const wynik = await createBackup({ wolneBajty: 0 });

  assert.equal(wynik.ok, true, `backup powinien się udać po przycięciu, dostałem: ${JSON.stringify(wynik)}`);
  assert.deepEqual(kopie().filter((f) => f.startsWith('backup-2026-09-0')),
    ['backup-2026-09-03T01-00-00-000Z.db.enc'],
    'kasujemy od najstarszej, najnowsza stara kopia zostaje');
  assert.equal(kopie().length, 2, 'została najnowsza stara kopia + nowo utworzona');
  assert.deepEqual(snapshoty(), [], 'snapshot roboczy nie może zostać na dysku');
});

test('createBackup — gdy miejsca brak mimo przycięcia, zgłasza błąd i NIE kasuje ostatniej kopii', async () => {
  wyczysc();
  fs.writeFileSync(path.join(KATALOG, 'backup-2026-09-06T01-00-00-033Z.db.enc'), Buffer.alloc(10, 1));

  const wynik = await createBackup({ wolneBajty: 0 });

  assert.equal(wynik.ok, false);
  assert.equal(wynik.reason, 'brak_miejsca');
  assert.deepEqual(kopie(), ['backup-2026-09-06T01-00-00-033Z.db.enc'],
    'ostatnia poprawna kopia musi przeżyć nieudany przebieg');
  assert.deepEqual(snapshoty(), []);
});

test('createBackup — sprząta osierocone snapshoty z poprzednich, przerwanych przebiegów', async () => {
  wyczysc();
  fs.writeFileSync(path.join(KATALOG, '.snapshot-2026-09-07T01-00-00-015Z.db'), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(KATALOG, '.snapshot-2026-09-08T01-00-00-041Z.db'), Buffer.alloc(0));

  const wynik = await createBackup({ wolneBajty: potrzebneNaPrzebieg() });

  assert.equal(wynik.ok, true);
  assert.deepEqual(snapshoty(), [], 'po przebiegu nie zostaje żaden snapshot');
});

test('statusKopii — nieudany przebieg zostaje zapamiętany z przyczyną', async () => {
  wyczysc();
  await createBackup({ wolneBajty: 0 });

  const status = statusKopii();
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'brak_miejsca');
  assert.match(status.o, /^\d{4}-\d{2}-\d{2}T/, 'znacznik czasu pozwala zobaczyć, jak dawno backup nie wyszedł');
});
