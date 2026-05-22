# Runbook — Reakcja na awarie

Najpierw ustal, co jest niedostępne: backend, BZP, płatności czy aplikacja.
Punkt wyjścia diagnostyki: `https://<backend>/health` oraz Sentry.

---

## Backend nie odpowiada

1. Railway → zakładka **Deployments** i **Logs** — sprawdź ostatni deploy i błędy.
2. `/health` zwraca `503` → problem z bazą: sprawdź, czy wolumen z `DATABASE_PATH`
   jest zamontowany.
3. Pętla restartów → sprawdź logi startu (najczęściej brakująca zmienna
   środowiskowa — backend przy złym `.env` kończy się kodem 1 z opisem pola).
4. Szybki rollback: Railway → **Deployments** → poprzedni → **Redeploy**.

## API BZP zwraca błędy

- Job `fetchTenders` loguje błąd i kończy się `{ ok: false }` — to nie wywraca
  backendu. Istniejące dopasowania działają dalej.
- Diagnostyka: `node src/services/bzp.js --ping` (patrz `bzp-api.md`).
- Trwała zmiana kontraktu API → zaktualizuj `bzp.js`, zapisz `[BLOCKER]`.

## Przekroczony budżet AI

- `GET /admin/ai-budget` pokazuje stan. Po przekroczeniu limitu twardego
  matching automatycznie przechodzi na scoring heurystyczny (bez AI).
- Działanie: zweryfikuj zużycie w konsoli Anthropic, w razie potrzeby podnieś
  `AI_BUDGET_HARD_USD` lub zostaw fallback heurystyczny do końca miesiąca.

## Webhook Stripe nie aktualizuje planu

1. Stripe → **Webhooks** → sprawdź dostarczenia i odpowiedzi endpointu.
2. Błąd podpisu (`400`) → niezgodny `STRIPE_WEBHOOK_SECRET` w Railway.
3. Plan można też ustawić ręcznie po potwierdzeniu płatności w Stripe.

## Uszkodzenie bazy / przywrócenie z kopii

Kopie zapasowe: katalog `backups/` (przy bazie) oraz Backblaze B2
(prefiks `przetargai/`). Plik `.db.enc` jest zaszyfrowany AES-256-GCM
w formacie `[12 B IV][16 B authTag][szyfrogram]`.

Odszyfrowanie kopii (wymaga `BACKUP_ENCRYPTION_KEY`):

```js
// node odszyfruj.js backup-XXXX.db.enc data-przywrocona.db
import fs from 'node:fs';
import crypto from 'node:crypto';

const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'hex');
const buf = fs.readFileSync(process.argv[2]);
const iv = buf.subarray(0, 12);
const tag = buf.subarray(12, 28);
const data = buf.subarray(28);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
fs.writeFileSync(process.argv[3], Buffer.concat([decipher.update(data), decipher.final()]));
console.log('Przywrócono bazę do', process.argv[3]);
```

Następnie zatrzymaj backend, podmień plik wskazany przez `DATABASE_PATH`
na odszyfrowaną kopię i uruchom backend ponownie.

## Eskalacja

Krytyczne, nierozwiązywalne problemy zapisuj w `blockers.md` jako
`[BLOCKER: HUMAN]` i kontynuuj niezależne zadania.
