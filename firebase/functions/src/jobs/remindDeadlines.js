import { logger } from '../lib/logger.js';
import { saved, users } from '../db/repos.js';
import { sendPush } from '../services/push.js';

/**
 * Wysyła przypomnienia o zbliżających się terminach składania ofert (D-050).
 *
 * Bierze wpisy z „Zapisanych", które mają włączone przypomnienie i są wymagalne
 * (remind_at ≤ teraz, jeszcze niepowiadomione). Wysyła push na token użytkownika
 * i PRZESUWA na następny etap 7→3→1 (runda 11) — po ostatnim etapie kończy.
 *
 * Użytkownik bez push_token (np. nie nadał zgody) jest pomijany, ale wpis i tak
 * PRZESUWA etap — inaczej próbowalibyśmy w kółko. To świadomy kompromis: push.
 */

/** Treść przypomnienia wg etapu (7/3/1 dnia, 0 = ostatnie wezwanie). */
function opisEtapu(etap) {
  if (etap === 7) return 'Zostało 7 dni do składania ofert';
  if (etap === 3) return 'Zostały 3 dni do składania ofert';
  if (etap === 1) return 'Został 1 dzień do składania ofert';
  return 'Termin składania ofert już blisko';
}
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
        const naglowek = opisEtapu(wpis.remind_etap);
        await sendPush(token, {
          title: naglowek,
          body: wpis.tender_title || 'Zapisany przetarg — zbliża się termin składania ofert',
          data: { type: 'deadline_reminder', tender_id: wpis.tenderId, etap: String(wpis.remind_etap ?? '') },
        });
        sent++;
      }
      // Przesuwa na następny etap 7→3→1 albo kończy — nie „raz na przetarg", tylko raz na etap.
      await saved.advanceReminder(wpis.userId, wpis.tenderId);
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
