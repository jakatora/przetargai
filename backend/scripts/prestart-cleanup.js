/**
 * Awaryjne zwolnienie miejsca na wolumenie Railway PRZED migracją i startem.
 *
 * Kontekst: wolumen `/data` (500 MB) potrafi zapełnić się zaszyfrowanymi
 * kopiami `backup-*.db.enc` (retencja 14, każda ≈ rozmiar bazy, NIEskompresowana)
 * oraz osieroconymi snapshotami VACUUM INTO (`.snapshot-*.db`), których
 * `pruneOldBackups` nie sprząta. Pełny dysk => `SQLITE_FULL` przy migracji =>
 * serwis nie wstaje. Ten skrypt uruchamiany jest jako `prestart`: zostawia
 * aktywną bazę + WAL/SHM oraz kopie w ramach retencji, sprząta osierocone
 * snapshoty, po czym pozwala ruszyć backendowi.
 *
 * RETENCJA (2026-09-25): wcześniej stałe KEEP_BACKUPS = 2 przycinało kopie przy
 * KAŻDYM starcie/deployu, choć retencja to 7 (BACKUP_RETENTION) — każdy deploy
 * zjadał 5 dni kopii, a na produkcji bez B2 kopie na wolumenie są jedyne. Teraz:
 *  1) ponad retencję (BACKUP_RETENTION, domyślnie 7) kasujemy najstarsze,
 *  2) GŁĘBIEJ tylko przy realnym braku miejsca (wolne < 1,25 × baza, jak
 *     `przytnijKopie` w services/backup.js) i NIGDY ostatniej kopii.
 *
 * ZASADY:
 *  - fail-open: żaden błąd czyszczenia nie może przerwać startu (nie rzucamy);
 *  - NIGDY nie kasujemy `data.db` / `data.db-wal` / `data.db-shm`;
 *  - NIGDY nie kasujemy ostatniej (najnowszej) kopii;
 *  - idempotentny: kolejne przebiegi po prostu nie mają czego usuwać.
 *
 * Zależności: wyłącznie wbudowane moduły `node:` — dzięki temu skrypt nie
 * ładuje `config/env.js` (walidacja Zod + process.exit), więc odpala się także
 * na atrapie katalogu w teście lokalnym. Z tego samego powodu NIE importujemy
 * `przytnijKopie` z services/backup.js (ciągnie env.js i otwiera bazę) — reguła
 * „brak miejsca” jest tu zduplikowana minimalnie; MARGINES musi być ten sam.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Retencja kopii, gdy BACKUP_RETENTION nie ustawione / błędne — jak w config/env.js. */
const RETENCJA_DOMYSLNA = 7;

/** Zapas ponad rozmiar bazy, który musi być wolny — ten sam co MARGINES w services/backup.js. */
const MARGINES = 1.25;

/**
 * Retencja z wartości zmiennej BACKUP_RETENTION (dodatnia liczba całkowita), inaczej 7.
 * @param {string|undefined} wartosc
 */
export function retencjaKopii(wartosc) {
  const n = Number(wartosc);
  return Number.isInteger(n) && n > 0 ? n : RETENCJA_DOMYSLNA;
}

/** Wolne bajty na wolumenie katalogu; null gdy nie da się zmierzyć (wtedy nie tniemy głębiej). */
function zmierzWolneBajty(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

function bajtyPliku(sciezka) {
  try {
    return fs.statSync(sciezka).size;
  } catch {
    return 0;
  }
}

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
 * @param {{dataDir:string, backupDir:string, keepBackups?:number, dbBasename?:string,
 *   wolneBajty?:number|null}} opcje
 *   keepBackups — retencja (domyślnie BACKUP_RETENTION z env, inaczej 7);
 *   wolneBajty — wolne miejsce PRZED czyszczeniem (wstrzykiwane w testach; domyślnie statfs).
 * @returns {{deletedFiles:number, freedBytes:number}}
 */
export function cleanupVolume({
  dataDir,
  backupDir,
  keepBackups = retencjaKopii(process.env.BACKUP_RETENTION),
  dbBasename = 'data.db',
  wolneBajty,
}) {
  let deletedFiles = 0;
  let freedBytes = 0;

  // Nigdy nie ruszamy aktywnej bazy ani jej plików pomocniczych WAL/SHM.
  const chronione = new Set([dbBasename, `${dbBasename}-wal`, `${dbBasename}-shm`]);

  // 1) Osierocone snapshoty VACUUM INTO: `.snapshot-*.db` (kropka wg backup.js)
  //    lub `snapshot-*.db`. Kasujemy w katalogu backupów i w korzeniu wolumenu.
  //    NAJPIERW one — to czyste śmieci, a zwolnione miejsce oszczędza kopie w kroku 2.
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

  // 2) Kopie `backup-*.db.enc` od najstarszej (mtime rosnąco): ponad retencję zawsze,
  //    poniżej retencji WYŁĄCZNIE przy braku miejsca — i nigdy ostatnia kopia.
  try {
    const odNajstarszej = listuj(backupDir)
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
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.pelna.localeCompare(b.pelna));

    const bazaSciezka = path.join(dataDir, dbBasename);
    const potrzebne = Math.ceil((bajtyPliku(bazaSciezka) + bajtyPliku(`${bazaSciezka}-wal`)) * MARGINES);
    // Wstrzyknięte „wolne” to stan PRZED czyszczeniem — doliczamy zwolnione snapshoty;
    // statfs mierzymy teraz, więc już je uwzględnia. Brak pomiaru => nie tniemy głębiej.
    let wolne = wolneBajty !== undefined && wolneBajty !== null
      ? wolneBajty + freedBytes
      : zmierzWolneBajty(backupDir);

    const kasuj = ({ pelna }, powod) => {
      const freed = usunPlik(pelna, powod);
      if (freed > 0) {
        deletedFiles += 1;
        freedBytes += freed;
        if (wolne !== null) wolne += freed;
      }
    };

    let i = 0;
    const ponadRetencje = Math.max(0, odNajstarszej.length - keepBackups);
    while (i < ponadRetencje) kasuj(odNajstarszej[i++], `kopia ponad retencję ${keepBackups}`);
    // `length - 1`: ostatniej (najnowszej) kopii nie ruszamy nigdy — na produkcji bez B2
    // to jedyne zabezpieczenie bazy.
    while (wolne !== null && wolne < potrzebne && i < odNajstarszej.length - 1) {
      kasuj(odNajstarszej[i++], `brak miejsca (wolne ${wolne} B < potrzebne ${potrzebne} B)`);
    }
  } catch (err) {
    console.error(`[prestart-cleanup] BŁĄD przy kopiach zapasowych: ${err.message} — kontynuuję`);
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
