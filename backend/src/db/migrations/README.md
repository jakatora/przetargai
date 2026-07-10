# Migracje bazy

Pliki `NNN_nazwa.sql`, stosowane rosnąco po numerze. Uruchamiane automatycznie
przy starcie backendu (`migrate()` w `db/migrate.js`) oraz przez `npm run migrate`.

## Zasady

1. **Nigdy nie edytuj zastosowanej migracji.** Runner liczy sumę kontrolną i przerwie
   start, jeśli plik się zmienił. Poprawkę dopisz jako nową migrację.
2. **Każda migracja jest atomowa** — wykonuje się w transakcji. Błąd wycofuje całość.
3. **Nowa tabela idzie w dwa miejsca:** do `schema.sql` (bootstrap świeżej bazy)
   i do migracji (istniejące bazy). Sama migracja nie wystarczy dla nowych instalacji;
   sam `schema.sql` nie wystarczy dla produkcji.
4. **`ALTER TABLE ADD COLUMN` jest bezpieczny.** Zmiana `NOT NULL`, `CHECK` czy `UNIQUE`
   wymaga w SQLite przebudowy tabeli: `CREATE nowa` → `INSERT SELECT` → `DROP stara`
   → `ALTER RENAME` → odtworzenie indeksów. Całość w jednej migracji.
5. **Przed migracją produkcyjną zrób kopię.** `services/backup.js` + Backblaze B2.

## Uwaga: baza jest współdzielona

Ten sam plik SQLite obsługuje PrzetargAI **i** Fitter Welder Pro (`fitter_*`).
Żadna migracja PrzetargAI nie może dotykać tabel `fitter_*`.

## Nazewnictwo

```text
001_users_profil_bez_nip.sql
002_users_pola_agenta.sql
003_tenders_wzbogacenie_bzp.sql
```
