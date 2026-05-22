import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { env, BACKUP_DIR } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { uploadToB2 } from './b2.js';

/**
 * Szyfruje bufor algorytmem AES-256-GCM.
 * Format pliku wynikowego: [12 B IV][16 B authTag][szyfrogram].
 */
function encrypt(buffer) {
  const key = Buffer.from(env.BACKUP_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Usuwa najstarsze kopie ponad limit BACKUP_RETENTION. */
function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db.enc'))
    .sort()
    .reverse();
  for (const old of files.slice(env.BACKUP_RETENTION)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}

/**
 * Tworzy zaszyfrowaną kopię zapasową bazy: spójny snapshot (VACUUM INTO),
 * szyfrowanie AES-256-GCM, zapis lokalny i wysyłka do Backblaze B2.
 */
export async function createBackup() {
  if (!env.BACKUP_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY.length < 64) {
    logger.warn('Backup pominięty — brak BACKUP_ENCRYPTION_KEY (wymagany 32-bajtowy hex)');
    return { ok: false, reason: 'no_encryption_key' };
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(BACKUP_DIR, `.snapshot-${stamp}.db`);

  // VACUUM INTO tworzy spójny snapshot także przy włączonym trybie WAL.
  db.exec(`VACUUM INTO '${snapshotPath.replace(/\\/g, '/')}'`);
  const raw = fs.readFileSync(snapshotPath);
  fs.unlinkSync(snapshotPath);

  const encrypted = encrypt(raw);
  const fileName = `backup-${stamp}.db.enc`;
  fs.writeFileSync(path.join(BACKUP_DIR, fileName), encrypted);

  let uploaded = false;
  try {
    uploaded = await uploadToB2(fileName, encrypted);
  } catch (err) {
    logger.error({ err: err.message }, 'Backup: wysyłka do B2 nie powiodła się (kopia lokalna OK)');
  }

  pruneOldBackups();
  logger.info({ fileName, bytes: encrypted.length, uploaded }, 'Kopia zapasowa utworzona');
  return { ok: true, fileName, bytes: encrypted.length, uploaded };
}

// Ręczne uruchomienie: `npm run backup`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  createBackup()
    .then((result) => {
      logger.info(result, 'Ręczny backup zakończony');
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'Backup: błąd krytyczny');
      process.exit(1);
    });
}
