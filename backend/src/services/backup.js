import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { env, BACKUP_DIR, DB_PATH } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { uploadToB2 } from './b2.js';

/**
 * Zapas ponad rozmiar bazy, który musi być wolny, żeby backup miał szansę się udać.
 *
 * Snapshot (`VACUUM INTO`) i zaszyfrowana kopia nie leżą na dysku jednocześnie —
 * snapshot jest kasowany zaraz po wczytaniu do pamięci. Szczyt zużycia to więc
 * mniej więcej rozmiar bazy, a po przebiegu tyle samo ZOSTAJE jako nowa kopia.
 */
const MARGINES = 1.25;

/** Ile miejsca musi być wolne, żeby przyjąć kopię bazy o rozmiarze `bajtyBazy`. */
export function potrzebneWolneBajty(bajtyBazy) {
  return Math.ceil(bajtyBazy * MARGINES);
}

/** Wolne miejsce na wolumenie, na którym leży katalog kopii. */
export function zmierzWolneBajty(dir) {
  const st = fs.statfsSync(dir);
  return st.bavail * st.bsize;
}

const jestKopia = (f) => f.startsWith('backup-') && f.endsWith('.db.enc');
const jestSnapshotem = (f) => f.startsWith('.snapshot-');

function bajtyPliku(sciezka) {
  try {
    return fs.statSync(sciezka).size;
  } catch {
    return 0;
  }
}

/**
 * Kasuje niedokończone snapshoty po przerwanych przebiegach.
 *
 * Do 2026-09-23 snapshot był usuwany WYŁĄCZNIE na ścieżce sukcesu, więc każdy
 * nieudany backup zostawiał plik na zawsze. Na produkcji uzbierało się ich 20,
 * w tym jeden 18,9 MB — na wolumenie, któremu brakowało miejsca.
 */
export function wyczyscOsieroconeSnapshoty(dir) {
  let usuniete = 0;
  let zwolnioneBajty = 0;
  for (const nazwa of fs.readdirSync(dir).filter(jestSnapshotem)) {
    const sciezka = path.join(dir, nazwa);
    zwolnioneBajty += bajtyPliku(sciezka);
    fs.unlinkSync(sciezka);
    usuniete += 1;
  }
  return { usuniete, zwolnioneBajty };
}

/**
 * Przycina kopie PRZED utworzeniem nowej — inaczej pełny dysk zakleszcza retencję.
 *
 * Dwa kryteria, w tej kolejności:
 *  1. retencja — wszystko powyżej `retencja` najnowszych kopii idzie do kasacji;
 *  2. pojemność — jeśli mimo to brakuje miejsca, kasujemy kolejne najstarsze,
 *     dopóki wolnego nie będzie `potrzebneBajty`.
 *
 * OSTATNIEJ kopii nie ruszamy nigdy. Backup, który dla zrobienia miejsca kasuje
 * jedyne zabezpieczenie bazy, jest gorszy niż backup, który się nie wykonał —
 * zwłaszcza że poświadczeń B2 na produkcji nie ma i kopie na wolumenie są jedyne.
 */
export function przytnijKopie(dir, { retencja, potrzebneBajty, wolneBajty }) {
  const odNajstarszej = fs.readdirSync(dir).filter(jestKopia).sort();
  const usuniete = [];
  let wolne = wolneBajty;

  const doKasacji = Math.max(0, odNajstarszej.length - retencja);
  const kasuj = (nazwa) => {
    const sciezka = path.join(dir, nazwa);
    wolne += bajtyPliku(sciezka);
    fs.unlinkSync(sciezka);
    usuniete.push(nazwa);
  };

  let i = 0;
  while (i < doKasacji) kasuj(odNajstarszej[i++]);
  // Zostawiamy co najmniej jedną kopię — stąd `length - 1`.
  while (wolne < potrzebneBajty && i < odNajstarszej.length - 1) kasuj(odNajstarszej[i++]);

  return {
    usuniete,
    zostalo: odNajstarszej.length - usuniete.length,
    wolneBajtyPo: wolne,
    wystarczaMiejsca: wolne >= potrzebneBajty,
  };
}

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

/**
 * Ostatni wynik kopii — żeby cicha awaria nie trwała tygodniami.
 *
 * Na produkcji backupy nie powstawały od 2026-09-07 do 2026-09-23. Błąd leciał
 * wyłącznie do logów schedulera, których nikt nie czyta; `/health` twierdził „ok".
 */
let ostatniWynik = { stan: 'brak_przebiegu' };

/** Stan kopii zapasowych na potrzeby `/health` i panelu admina. */
export function statusKopii() {
  return { ...ostatniWynik };
}

function zapamietaj(wynik) {
  ostatniWynik = { ...wynik, o: new Date().toISOString() };
  return wynik;
}

/**
 * Tworzy zaszyfrowaną kopię zapasową bazy: spójny snapshot (VACUUM INTO),
 * szyfrowanie AES-256-GCM, zapis lokalny i wysyłka do Backblaze B2.
 *
 * Nie rzuca przy braku miejsca — zwraca `{ ok: false, reason }`, żeby harmonogram
 * zapisał rozpoznaną przyczynę zamiast gołego wyjątku.
 *
 * @param {{wolneBajty?: number}} [opts] zmierzone wolne miejsce (domyślnie: odczyt z systemu plików)
 */
export async function createBackup({ wolneBajty } = {}) {
  if (!env.BACKUP_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY.length < 64) {
    logger.warn('Backup pominięty — brak BACKUP_ENCRYPTION_KEY (wymagany 32-bajtowy hex)');
    return zapamietaj({ ok: false, reason: 'no_encryption_key' });
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // 1. Śmieci po przerwanych przebiegach — zanim zaczniemy cokolwiek liczyć.
  const osierocone = wyczyscOsieroconeSnapshoty(BACKUP_DIR);
  if (osierocone.usuniete > 0) {
    logger.warn(osierocone, 'Backup: sprzątnięto snapshoty po przerwanych przebiegach');
  }

  // 2. Przycinanie PRZED zapisem — to ono ma zapewnić miejsce na nową kopię.
  const bajtyBazy = bajtyPliku(DB_PATH) + bajtyPliku(`${DB_PATH}-wal`);
  const potrzebne = potrzebneWolneBajty(bajtyBazy);
  const wolne = wolneBajty ?? zmierzWolneBajty(BACKUP_DIR);
  const przyciecie = przytnijKopie(BACKUP_DIR, {
    retencja: env.BACKUP_RETENTION,
    potrzebneBajty: potrzebne,
    wolneBajty: wolne,
  });
  if (przyciecie.usuniete.length > 0) {
    logger.info({ usuniete: przyciecie.usuniete.length, zostalo: przyciecie.zostalo },
      'Backup: przycięto stare kopie');
  }

  if (!przyciecie.wystarczaMiejsca) {
    const szczegoly = {
      potrzebneBajty: potrzebne,
      wolneBajty: przyciecie.wolneBajtyPo,
      kopie: przyciecie.zostalo,
    };
    logger.error(szczegoly,
      'Backup NIEUDANY — brak miejsca mimo przycięcia; zwiększ wolumen albo obniż BACKUP_RETENTION');
    return zapamietaj({ ok: false, reason: 'brak_miejsca', ...szczegoly });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(BACKUP_DIR, `.snapshot-${stamp}.db`);

  let raw;
  try {
    // VACUUM INTO tworzy spójny snapshot także przy włączonym trybie WAL.
    db.exec(`VACUUM INTO '${snapshotPath.replace(/\\/g, '/')}'`);
    raw = fs.readFileSync(snapshotPath);
  } catch (err) {
    logger.error({ err: err.message }, 'Backup NIEUDANY — snapshot bazy się nie powiódł');
    return zapamietaj({ ok: false, reason: 'snapshot_nieudany', blad: err.message });
  } finally {
    // Nieudany VACUUM zostawia plik częściowy — bez tego rośnie na dysku w nieskończoność.
    fs.rmSync(snapshotPath, { force: true });
  }

  const encrypted = encrypt(raw);
  const fileName = `backup-${stamp}.db.enc`;
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, fileName), encrypted);
  } catch (err) {
    fs.rmSync(path.join(BACKUP_DIR, fileName), { force: true });
    logger.error({ err: err.message }, 'Backup NIEUDANY — zapis zaszyfrowanej kopii się nie powiódł');
    return zapamietaj({ ok: false, reason: 'zapis_nieudany', blad: err.message });
  }

  let uploaded = false;
  try {
    uploaded = await uploadToB2(fileName, encrypted);
  } catch (err) {
    logger.error({ err: err.message }, 'Backup: wysyłka do B2 nie powiodła się (kopia lokalna OK)');
  }

  logger.info({ fileName, bytes: encrypted.length, uploaded }, 'Kopia zapasowa utworzona');
  return zapamietaj({
    ok: true,
    fileName,
    bytes: encrypted.length,
    uploaded,
    kopie: przyciecie.zostalo + 1,
  });
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
