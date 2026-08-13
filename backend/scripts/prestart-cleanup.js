/**
 * Awaryjne zwolnienie miejsca na wolumenie Railway PRZED migracją i startem.
 *
 * Kontekst: wolumen `/data` (500 MB) potrafi zapełnić się zaszyfrowanymi
 * kopiami `backup-*.db.enc` (retencja 14, każda ≈ rozmiar bazy, NIEskompresowana)
 * oraz osieroconymi snapshotami VACUUM INTO (`.snapshot-*.db`), których
 * `pruneOldBackups` nie sprząta. Pełny dysk => `SQLITE_FULL` przy migracji =>
 * serwis nie wstaje. Ten skrypt uruchamiany jest jako `prestart`: zostawia
 * aktywną bazę + WAL/SHM oraz 2 najnowsze backupy, kasuje resztę, po czym
 * pozwala ruszyć backendowi.
 *
 * ZASADY:
 *  - fail-open: żaden błąd czyszczenia nie może przerwać startu (nie rzucamy);
 *  - NIGDY nie kasujemy `data.db` / `data.db-wal` / `data.db-shm`;
 *  - idempotentny: kolejne przebiegi po prostu nie mają czego usuwać.
 *
 * Zależności: wyłącznie wbudowane moduły `node:` — dzięki temu skrypt nie
 * ładuje `config/env.js` (walidacja Zod + process.exit), więc odpala się także
 * na atrapie katalogu w teście lokalnym.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Ile najnowszych `backup-*.db.enc` zachować (reszta do kasacji). */
const KEEP_BACKUPS = 2;

/** Rozmiar pliku w czytelnej postaci „<B> B (<MB> MB)” (MB = MiB, /1048576). */
function opiszRozmiar(bytes) {
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return `${bytes} B (${mb} MB)`;
}

/**
 * Bezpieczne usunięcie jednego pliku: loguje ścieżkę + rozmiar PRZED kasacją,
 * a błąd raportuje na stderr i zwraca false (nie przerywa pętli).
 * @returns {number} liczba zwolnionych bajtów (0 przy błędzie / braku pliku)
 */
function usunPlik(pelnaSciezka, powod) {
  let bytes = 0;
  try {
    bytes = fs.statSync(pelnaSciezka).size;
  } catch {
    // Plik zniknął między listowaniem a kasacją — nic do roboty.
    return 0;
  }
  console.log(`[prestart-cleanup] Usuwam (${powod}): ${pelnaSciezka} — ${opiszRozmiar(bytes)}`);
  try {
    fs.unlinkSync(pelnaSciezka);
    return bytes;
  } catch (err) {
    console.error(`[prestart-cleanup] BŁĄD kasacji ${pelnaSciezka}: ${err.message} — pomijam, kontynuuję`);
    return 0;
  }
}

/** Lista plików w katalogu (nazwy), lub [] gdy katalog nie istnieje/niedostępny. */
function listuj(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Właściwe czyszczenie. Fail-open na każdym kroku.
 * @param {{dataDir:string, backupDir:string, keepBackups?:number, dbBasename?:string}} opcje
 * @returns {{deletedFiles:number, freedBytes:number}}
 */
export function cleanupVolume({ dataDir, backupDir, keepBackups = KEEP_BACKUPS, dbBasename = 'data.db' }) {
  let deletedFiles = 0;
  let freedBytes = 0;

  // Nigdy nie ruszamy aktywnej bazy ani jej plików pomocniczych WAL/SHM.
  const chronione = new Set([dbBasename, `${dbBasename}-wal`, `${dbBasename}-shm`]);

  // 1) Stare zaszyfrowane kopie: `backup-*.db.enc` posortowane mtime malejąco,
  //    zachowaj `keepBackups` najnowszych, usuń resztę.
  try {
    const kopie = listuj(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.db.enc') && !chronione.has(f))
      .map((f) => {
        const pelna = path.join(backupDir, f);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(pelna).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return { pelna, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs); // najnowsze na początku

    for (const { pelna } of kopie.slice(keepBackups)) {
      const freed = usunPlik(pelna, 'stary backup ponad limit');
      if (freed > 0) {
        deletedFiles += 1;
        freedBytes += freed;
      }
    }
  } catch (err) {
    console.error(`[prestart-cleanup] BŁĄD przy kopiach zapasowych: ${err.message} — kontynuuję`);
  }

  // 2) Osierocone snapshoty VACUUM INTO: `.snapshot-*.db` (kropka wg backup.js)
  //    lub `snapshot-*.db`. Kasujemy w katalogu backupów i w korzeniu wolumenu.
  const snapshotRe = /^\.?snapshot-.*\.db$/;
  const katalogiSnap = backupDir === dataDir ? [dataDir] : [dataDir, backupDir];
  for (const dir of katalogiSnap) {
    try {
      for (const f of listuj(dir)) {
        if (!snapshotRe.test(f) || chronione.has(f)) continue;
        const freed = usunPlik(path.join(dir, f), 'osierocony snapshot');
        if (freed > 0) {
          deletedFiles += 1;
          freedBytes += freed;
        }
      }
    } catch (err) {
      console.error(`[prestart-cleanup] BŁĄD przy snapshotach w ${dir}: ${err.message} — kontynuuję`);
    }
  }

  return { deletedFiles, freedBytes };
}

/**
 * Ustala `dataDir`/`backupDir` tak jak `config/env.js` (bez jego importu).
 * Override przez `argv` (pierwszy pozycyjny) — używany w teście na atrapie /data;
 * wtedy backupDir = <override>/backups, ignorujemy env BACKUP_DIR.
 */
function ustalSciezki(argvDataDir) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const BACKEND_ROOT = path.resolve(__dirname, '..'); // scripts/ leży w backend/

  if (argvDataDir) {
    const dataDir = path.resolve(argvDataDir);
    return { dataDir, backupDir: path.join(dataDir, 'backups'), dbBasename: 'data.db' };
  }

  const dbPathRaw = process.env.DATABASE_PATH || './data/data.db';
  const dbPath = path.isAbsolute(dbPathRaw) ? dbPathRaw : path.resolve(BACKEND_ROOT, dbPathRaw);
  const dataDir = path.dirname(dbPath);
  const backupDir = process.env.BACKUP_DIR
    ? (path.isAbsolute(process.env.BACKUP_DIR)
      ? process.env.BACKUP_DIR
      : path.resolve(BACKEND_ROOT, process.env.BACKUP_DIR))
    : path.join(dataDir, 'backups');
  return { dataDir, backupDir, dbBasename: path.basename(dbPath) };
}

/** Uruchomienie jako `prestart` (albo ręcznie z override katalogu w argv[2]). */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const { dataDir, backupDir, dbBasename } = ustalSciezki(process.argv[2]);
    console.log(`[prestart-cleanup] Start — dataDir=${dataDir} backupDir=${backupDir}`);
    const { deletedFiles, freedBytes } = cleanupVolume({ dataDir, backupDir, dbBasename });
    console.log(`[prestart-cleanup] Gotowe — usunięto ${deletedFiles} plików, zwolniono ${opiszRozmiar(freedBytes)}`);
  } catch (err) {
    // Ostatnia bariera fail-open: pod ŻADNYM pozorem nie blokujemy startu.
    console.error(`[prestart-cleanup] BŁĄD krytyczny (ignoruję, start kontynuuje): ${err.message}`);
  }
  process.exit(0);
}
