import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';

/**
 * Tworzy magic link do checkoutu subskrypcji — jednorazowy, krótkotrwały.
 * Aplikacja mobilna otwiera zwrócony URL w przeglądarce (strategia iOS bez IAP).
 */
export async function createUpgradeLink(userId) {
  const { token, expiresAt } = await magicLinks.create({
    userId,
    purpose: 'upgrade',
    ttlMinutes: env.MAGIC_LINK_TTL_MINUTES,
  });
  return {
    token,
    expiresAt,
    url: `${env.APP_URL}/upgrade?user_id=${encodeURIComponent(userId)}&token=${token}`,
  };
}

/**
 * Weryfikuje i zużywa magic link „upgrade".
 * Zużycie jest TRANSAKCYJNE (repos.consume) — wersja SQLite miała wyścig
 * find→markUsed, w którym dwa równoległe żądania mogły zużyć ten sam link.
 * @returns {Promise<boolean>} true gdy token poprawny, aktualny, nieużyty i należy do usera.
 */
export async function consumeUpgradeLink(userId, token) {
  if (!userId || !token) return false;
  const ownerId = await magicLinks.consume(token, 'upgrade');
  return ownerId === userId;
}
