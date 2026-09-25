import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from '../config/env.js';
import { logger } from './logger.js';

/*
 * Magazyn ORYGINAŁÓW plików na dysku — wspólny dla Sejfu dokumentów i Czarnej skrzynki.
 *
 * DLACZEGO obok bazy (2026-09-25): domyślny katalog liczony był od `process.cwd()`, czyli
 * na Railway `/app/data/...`. `/app` jest NIETRWAŁY — znika przy każdym deployu — więc
 * oryginały zaświadczeń (KRK/ZUS/US) i dowody awarii platformy (zrzuty, oryginał oferty)
 * przepadały po cichu, a rekordy w bazie (na trwałym `/data`) dalej twierdziły, że plik
 * jest. Katalog wolumenu = katalog pliku bazy (DATABASE_PATH), tak samo jak BACKUP_DIR.
 *
 * DO BAZY TRAFIA NAZWA PLIKU (`<id>.<format>`), nie ścieżka serwera: ścieżka zależy od
 * miejsca montowania wolumenu, a klientowi nie wolno jej pokazywać. Stare rekordy mają
 * ścieżki absolutne — `usun` i `nazwaPliku` biorą z nich samą nazwę (basename), więc
 * obsługujemy oba kształty i nie da się nimi wyjść poza katalog magazynu.
 */

/** Katalog trwałego wolumenu danych = katalog pliku bazy. */
export function katalogWolumenu() {
  return path.dirname(DB_PATH);
}

/**
 * Publiczna postać lokalizacji pliku: sama nazwa (bez katalogu serwera) albo null.
 * Zachowuje „prawdziwość" pola (mobile czyta `plik_url` jako „jest plik").
 * @param {string|null|undefined} klucz nazwa albo (stary rekord) ścieżka absolutna
 */
export function nazwaPliku(klucz) {
  if (klucz === null || klucz === undefined || klucz === '') return null;
  const nazwa = path.basename(String(klucz));
  return nazwa && nazwa !== '.' && nazwa !== '..' ? nazwa : null;
}

function naBufor(bajty) {
  if (Buffer.isBuffer(bajty)) return bajty;
  if (bajty instanceof Uint8Array) return Buffer.from(bajty);
  return Buffer.from(String(bajty ?? ''), 'utf8');
}

/**
 * Magazyn w podanym katalogu: zapisuje SUROWE bajty bez modyfikacji.
 * @param {string} katalog
 * @returns {{katalog: string,
 *   zapisz: (id: string, format: string, bajty: Buffer|Uint8Array|string) => Promise<string>,
 *   czytaj: (id: string, format: string) => Promise<Buffer>,
 *   usun: (klucz: string|null) => boolean}}
 */
export function utworzMagazynNaDysku(katalog) {
  return {
    katalog,
    /** Zapisuje oryginał 1:1 i zwraca KLUCZ do bazy — samą nazwę pliku. */
    async zapisz(id, format, bajty) {
      fs.mkdirSync(katalog, { recursive: true });
      const nazwa = `${id}.${format}`;
      fs.writeFileSync(path.join(katalog, nazwa), naBufor(bajty)); // oryginał 1:1, bez żadnej obróbki
      return nazwa;
    },
    async czytaj(id, format) {
      return fs.readFileSync(path.join(katalog, `${id}.${format}`));
    },
    /**
     * Kasuje plik po kluczu z bazy. Fail-open: brak pliku / błąd dysku nie rzuca (rekord
     * w bazie jest już usunięty — sierota na dysku to mniejsze zło niż 500 dla użytkownika).
     * @returns {boolean} czy plik istniał i został usunięty
     */
    usun(klucz) {
      const nazwa = nazwaPliku(klucz);
      if (!nazwa) return false;
      const sciezka = path.join(katalog, nazwa);
      try {
        if (!fs.existsSync(sciezka)) return false;
        fs.rmSync(sciezka, { force: true });
        return true;
      } catch (err) {
        logger.warn({ plik: nazwa, err: err.message }, 'magazynPlikow: nie udało się usunąć pliku');
        return false;
      }
    },
  };
}
