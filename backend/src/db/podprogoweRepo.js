import { newId, nowIso } from '../lib/ids.js';

/*
 * Repozytorium `zamowienia_podprogowe` (ulepszenie „Radar zamówień podprogowych —
 * poniżej 170 tys. zł", podzadanie 3/7).
 *
 * SAMODZIELNY moduł (fabryka `createPodprogoweRepo(db)`), a NIE dopisek do
 * db/repos.js — świadomie, bo repos.js/schema.sql mają w drzewie roboczym duży
 * niezacommitowany WIP innych funkcji (pułapka drzewa roboczego z pamięci projektu);
 * dokładanie się tam mieszałoby cudzą pracę do tego commita. Fabryka bierze
 * połączenie przez wstrzyknięcie (bez importu singletona `db`), więc:
 *   • import modułu NIE otwiera bazy aplikacji (czysty do testów na `:memory:`),
 *   • konsument (monitor/endpointy z podzadania 6/7) tworzy repo przez
 *     `createPodprogoweRepo(db)` z db/index.js.
 *
 * Zapytania przygotowywane leniwie (po migracji), więc utworzenie repo nie wymaga,
 * by tabela już istniała.
 */

function lazy(db, sql) {
  let stmt = null;
  return () => (stmt ||= db.prepare(sql));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Wiersz DB → rekord domenowy (bool z INTEGER, obiekt flag z JSON-a). */
function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    latwiejszy_start: !!row.latwiejszy_start,
    flagi: parseJson(row.flagi, {}),
  };
}

/**
 * Tworzy repozytorium ogłoszeń podprogowych na podanym połączeniu SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createPodprogoweRepo(db) {
  const _insert = lazy(db, `
    INSERT INTO zamowienia_podprogowe (
      id, zrodlo, id_zewnetrzny, tytul, zamawiajacy, branza, region,
      wartosc_netto, waluta, termin_skladania, link, regulamin_url,
      regulamin_streszczenie, latwiejszy_start, flagi, data_publikacji,
      hash_dedup, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hash_dedup) DO NOTHING`);
  const _byHash = lazy(db, `SELECT * FROM zamowienia_podprogowe WHERE hash_dedup = ?`);
  const _byId = lazy(db, `SELECT * FROM zamowienia_podprogowe WHERE id = ?`);
  const _count = lazy(db, `SELECT COUNT(*) AS n FROM zamowienia_podprogowe`);

  return {
    /**
     * Wstawia ogłoszenie, jeśli jego `hash_dedup` jeszcze nie występuje. Dedupuje
     * między źródłami i między cyklami monitora. Zwraca { rekord, created }.
     * @param {object} rekord znormalizowany rekord z `normalizujPodprogowe`
     */
    upsert(rekord) {
      const hash = rekord.hash_dedup;
      const existing = _byHash().get(hash);
      if (existing) return { rekord: mapRow(existing), created: false };

      const id = newId();
      const ts = nowIso();
      const res = _insert().run(
        id,
        rekord.zrodlo,
        rekord.id_zewnetrzny ?? null,
        // `tytul` jest NOT NULL w schemacie; kwalifikujące się ogłoszenie realnie
        // ma tytuł, ale zabezpieczamy insert placeholderem zamiast wywalać ścieżkę.
        (rekord.tytul ?? '').toString().trim() || '(bez tytułu)',
        rekord.zamawiajacy ?? null,
        rekord.branza ?? null,
        rekord.region ?? null,
        rekord.wartosc_netto ?? null,
        rekord.waluta ?? 'PLN',
        rekord.termin_skladania ?? null,
        rekord.link ?? null,
        rekord.regulamin_url ?? null,
        rekord.regulamin_streszczenie ?? null,
        rekord.latwiejszy_start ? 1 : 0,
        JSON.stringify(rekord.flagi ?? {}),
        rekord.data_publikacji ?? null,
        hash,
        ts,
        ts,
      );
      // Wyścig: ten sam hash wpadł między SELECT a INSERT → ON CONFLICT DO NOTHING
      // (changes = 0); oddaj istniejący wiersz.
      if (!res.changes) return { rekord: mapRow(_byHash().get(hash)), created: false };
      return { rekord: mapRow(_byId().get(id)), created: true };
    },

    /** Rekord po `hash_dedup` (albo null). */
    byHash(hash) {
      return mapRow(_byHash().get(hash));
    },

    /** Liczba ogłoszeń w tabeli. */
    count() {
      return _count().get().n;
    },
  };
}
