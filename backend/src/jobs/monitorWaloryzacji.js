import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { umowyMonitorowane, users } from '../db/repos.js';
import { pobierzAktualnyWskaznik } from '../services/gus.js';
import { ocenAlarmWaloryzacji } from '../lib/waloryzacjaAlarm.js';
import { sendPush } from '../services/push.js';

/*
 * Cykliczny monitoring waloryzacji W TRAKCIE kontraktu (ulepszenie „pilnowanie
 * waloryzacji i pułapek w umowie", podzadanie 11/12).
 *
 * Dla każdej monitorowanej umowy z progiem (i bez wysłanego jeszcze alarmu):
 *   1) pobiera aktualny wskaźnik cen GUS dla branży kontraktu,
 *   2) zapisuje go (obserwacja — apka pokaże „teraz" nawet bez alarmu),
 *   3) liczy wzrost względem wskaźnika bazowego i porównuje z progiem z umowy,
 *   4) po PRZEKROCZENIU progu — powiadamia właściciela i oznacza alarm jako
 *      wysłany, żeby nie powiadamiać w kółko.
 *
 * Wysyłkę GUS/push wstrzykujemy (parametry `pobierzWskaznik`/`powiadom`), żeby
 * job dało się przetestować bez sieci. Błąd pojedynczego rekordu (np. GUS
 * niedostępny) NIE przerywa całego przebiegu — łapiemy per rekord i próbujemy
 * dalej; nieudany rekord zostaje bez alarmu i wróci w następnym cyklu.
 */

/** Wartość procentowa po polsku (kropka → przecinek), na potrzeby treści powiadomienia. */
function pl(v) {
  return String(v).replace('.', ',');
}

/**
 * Domyślne powiadomienie: push do właściciela umowy (best-effort).
 * Zwraca `{ sent }` z liczbą wysłanych wiadomości (0, gdy brak tokenu/błąd).
 */
async function powiadomOAlarmie(user, { branza, wzrost, prog }) {
  if (!user?.push_token) return { sent: 0 };
  return sendPush(user.push_token, {
    title: 'Ceny przekroczyły próg waloryzacji',
    body: `Wzrost cen w branży „${branza}" (${pl(wzrost)}%) przekroczył próg z umowy `
      + `(${pl(prog)}%). Możesz wystąpić o waloryzację wynagrodzenia.`,
    data: { type: 'waloryzacja_alarm' },
  });
}

/**
 * Jeden przebieg monitoringu waloryzacji.
 * @param {{pobierzWskaznik?: (branza: string) => Promise<{wartosc: number, okres: string|null}|null>,
 *          powiadom?: (user: any, ctx: {branza: string, wzrost: number, prog: number}) => Promise<{sent: number}>}} [deps]
 * @returns {Promise<{ok: boolean, rekordy: number, sprawdzone: number, alarmy: number, powiadomienia: number, bledy: number, durationMs: number}>}
 */
export async function runWaloryzacjaMonitor({
  pobierzWskaznik = pobierzAktualnyWskaznik,
  powiadom = powiadomOAlarmie,
} = {}) {
  const startedAt = Date.now();
  const rekordy = umowyMonitorowane.doSprawdzenia();
  let sprawdzone = 0;
  let alarmy = 0;
  let powiadomienia = 0;
  let bledy = 0;

  for (const rec of rekordy) {
    try {
      const wsk = await pobierzWskaznik(rec.branza);
      // Brak danych GUS (nieznana branża / pusty wynik) — nie ma z czym porównać,
      // spróbujemy w następnym cyklu. Nie zmyślamy wskaźnika.
      if (!wsk || !(wsk.wartosc > 0)) continue;

      sprawdzone++;
      umowyMonitorowane.zapiszWskaznik(rec.id, wsk.wartosc, wsk.okres ?? null);

      const ocena = ocenAlarmWaloryzacji({
        wskaznikBazowy: rec.wskaznik_bazowy,
        wskaznikAktualny: wsk.wartosc,
        prog: rec.prog,
      });
      if (!ocena.przekroczony) continue;

      alarmy++;
      const user = users.findById(rec.user_id);
      const wynik = await powiadom(user, { branza: rec.branza, wzrost: ocena.wzrost, prog: ocena.prog });
      if (wynik?.sent) powiadomienia++;

      // Oznaczamy alarm jako wysłany NIEZALEŻNIE od tego, czy push doszedł: stan
      // w bazie jest źródłem prawdy (apka pokaże alarm przy otwarciu), a push to
      // best-effort. Inaczej brak tokenu => powiadamianie w kółko co cykl.
      umowyMonitorowane.oznaczAlarmWyslany(rec.id);
      logger.info({ umowa: rec.id, wzrost: ocena.wzrost, prog: ocena.prog }, 'monitorWaloryzacji: alarm o przekroczeniu progu');
    } catch (err) {
      bledy++;
      logger.error({ err: err.message, umowa: rec.id }, 'monitorWaloryzacji: błąd rekordu');
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    { rekordy: rekordy.length, sprawdzone, alarmy, powiadomienia, bledy, durationMs },
    'monitorWaloryzacji: zakończono',
  );
  return { ok: true, rekordy: rekordy.length, sprawdzone, alarmy, powiadomienia, bledy, durationMs };
}

// Ręczne uruchomienie: `node src/jobs/monitorWaloryzacji.js`
if (isMainModule(import.meta.url)) {
  const { migrate } = await import('../db/migrate.js');
  migrate();
  runWaloryzacjaMonitor()
    .then((result) => {
      logger.info(result, 'Ręczne uruchomienie monitorWaloryzacji zakończone');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err.message }, 'monitorWaloryzacji: błąd krytyczny');
      process.exit(1);
    });
}
