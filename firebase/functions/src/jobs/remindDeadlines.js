import { logger } from '../lib/logger.js';
import { saved, users } from '../db/repos.js';
import { sendPush } from '../services/push.js';

/**
 * Wysyła przypomnienia o zbliżających się terminach składania ofert (D-050).
 *
 * Bierze wpisy z „Zapisanych", które mają włączone przypomnienie i są wymagalne
 * (remind_at ≤ teraz, jeszcze niepowiadomione). Wysyła push na token użytkownika
 * i oznacza jako powiadomione — dokładnie raz na przetarg.
 *
 * Użytkownik bez push_token (np. nie nadał zgody) jest pomijany, ale wpis
 * ZOSTAJE oznaczony jako powiadomiony — inaczej próbowalibyśmy w kółko przy
 * każdym przebiegu. To świadomy kompromis: przypomnienie to funkcja pushowa.
 */
export async function runReminderCheck() {
  const startedAt = Date.now();
  const due = await saved.dueReminders();
  if (!due.length) return { ok: true, due: 0, sent: 0, durationMs: Date.now() - startedAt };

  // Token pobieramy raz na użytkownika (jeden user może mieć kilka wymagalnych).
  const tokenCache = new Map();
  const tokenFor = async (userId) => {
    if (!tokenCache.has(userId)) {
      const u = await users.findById(userId).catch(() => null);
      tokenCache.set(userId, u?.push_token ?? null);
    }
    return tokenCache.get(userId);
  };

  let sent = 0;
  for (const wpis of due) {
    try {
      const token = await tokenFor(wpis.userId);
      if (token) {
        await sendPush(token, {
          title: 'Zbliża się termin przetargu',
          body: wpis.tender_title
            ? `Termin składania ofert: ${wpis.tender_title}`
            : 'Zbliża się termin składania ofert dla zapisanego przetargu',
          data: { type: 'deadline_reminder', tender_id: wpis.tenderId },
        });
        sent++;
      }
      await saved.markReminded(wpis.userId, wpis.tenderId);
    } catch (err) {
      // Nie przerywamy całej partii przez jedno nieudane przypomnienie.
      logger.error({ err: err.message, userId: wpis.userId, tenderId: wpis.tenderId },
        'Przypomnienie o terminie nie zostało wysłane');
    }
  }

  const wynik = { ok: true, due: due.length, sent, durationMs: Date.now() - startedAt };
  logger.info(wynik, 'runReminderCheck: zakończono');
  return wynik;
}
