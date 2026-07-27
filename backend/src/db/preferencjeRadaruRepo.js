import { newId, nowIso } from '../lib/ids.js';

/*
 * Repozytorium `preferencje_radaru_podprogowego` (ulepszenie „Radar zamówień
 * podprogowych — poniżej 170 tys. zł", podzadanie 6/7 — monitor + endpointy).
 *
 * SAMODZIELNY moduł-fabryka (`createPreferencjeRadaruRepo(db)`), a NIE dopisek do
 * db/repos.js — z tego samego powodu co podprogoweRepo.js: repos.js/schema.sql
 * mają w drzewie roboczym niezacommitowany WIP innych funkcji (pułapka drzewa
 * roboczego z pamięci projektu), więc dokładanie się tam mieszałoby cudzą pracę do
 * tego commita. Połączenie wstrzykiwane (bez importu singletona `db`), więc import
 * modułu nie otwiera bazy — czysty do testów na `:memory:`.
 *
 * Użytkownik ustawia branżę i region RAZ; monitor (jobs/monitorPodprogowy.js) dla
 * KAŻDEJ zapisanej preferencji uruchamia wszystkie adaptery. `prog_netto` domyślnie
 * 170 000 zł (stan progu od 1.01.2026).
 *
 * DEDUP preferencji: kolumny `branza`/`region` trzymamy jako TRIMMED STRINGI (pusty
 * → '', nie NULL), więc UNIQUE(user_id, branza, region) i porównania `=` działają
 * deterministycznie (NULL psułby zarówno UNIQUE, jak i ścieżkę upsert).
 */

function lazy(db, sql) {
  let stmt = null;
  return () => (stmt ||= db.prepare(sql));
}

/** Trim; brak/pusty → '' (spójny klucz dedupu, patrz nagłówek). */
function txt(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

const PROG_DOMYSLNY = 170000;

/**
 * Tworzy repozytorium preferencji radaru na podanym połączeniu SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createPreferencjeRadaruRepo(db) {
  const _find = lazy(db, `
    SELECT * FROM preferencje_radaru_podprogowego
     WHERE user_id = ? AND branza = ? AND region = ?`);
  const _byId = lazy(db, 'SELECT * FROM preferencje_radaru_podprogowego WHERE id = ?');
  const _byIdUser = lazy(db, 'SELECT * FROM preferencje_radaru_podprogowego WHERE id = ? AND user_id = ?');
  const _insert = lazy(db, `
    INSERT INTO preferencje_radaru_podprogowego
      (id, user_id, branza, region, prog_netto, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const _update = lazy(db, `
    UPDATE preferencje_radaru_podprogowego
       SET prog_netto = ?, updated_at = ? WHERE id = ?`);
  const _listUser = lazy(db, 'SELECT * FROM preferencje_radaru_podprogowego WHERE user_id = ? ORDER BY created_at ASC');
  const _listAll = lazy(db, 'SELECT * FROM preferencje_radaru_podprogowego ORDER BY user_id ASC, created_at ASC');
  const _delete = lazy(db, 'DELETE FROM preferencje_radaru_podprogowego WHERE id = ? AND user_id = ?');

  return {
    /**
     * Zapisuje preferencję (upsert po parze branża/region użytkownika). Istniejąca
     * para → aktualizacja progu; nowa → wstawienie z domyślnym progiem 170 000 zł.
     * @param {{userId: string, branza?: string, region?: string, progNetto?: number}} dane
     * @returns {object} zapisany rekord preferencji
     */
    upsert({ userId, branza, region, progNetto } = {}) {
      if (!userId) throw new TypeError('preferencjeRadaru.upsert: `userId` wymagane');
      const b = txt(branza);
      const r = txt(region);
      const ts = nowIso();

      const existing = _find().get(userId, b, r);
      if (existing) {
        const prog = Number.isFinite(progNetto) ? progNetto : existing.prog_netto;
        _update().run(prog, ts, existing.id);
        return _byId().get(existing.id);
      }
      const id = newId();
      const prog = Number.isFinite(progNetto) ? progNetto : PROG_DOMYSLNY;
      _insert().run(id, userId, b, r, prog, ts, ts);
      return _byId().get(id);
    },

    /** Preferencje danego użytkownika (rosnąco po dacie utworzenia). */
    listForUser(userId) {
      return _listUser().all(userId);
    },

    /** WSZYSTKIE preferencje (dla cyklicznego monitora — przelot po wszystkich userach). */
    listAll() {
      return _listAll().all();
    },

    /** Preferencja właściciela po id (albo null) — skopowanie do usera. */
    findByIdForUser(id, userId) {
      return _byIdUser().get(id, userId) ?? null;
    },

    /** Usuwa preferencję właściciela; zwraca `true`, gdy coś skasowano. */
    remove(id, userId) {
      return _delete().run(id, userId).changes > 0;
    },
  };
}
