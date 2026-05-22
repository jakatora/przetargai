import { env } from '../config/env.js';
import { magicLinks } from '../db/repos.js';
import { newToken } from '../lib/ids.js';

/**
 * Tworzy magic link do checkoutu subskrypcji — jednorazowy, krótkotrwały.
 * Aplikacja mobilna otwiera zwrócony URL w przeglądarce (strategia iOS bez IAP).
 */
export function createUpgradeLink(userId) {
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + env.MAGIC_LINK_TTL_MINUTES * 60_000).toISOString();
  magicLinks.create({ token, userId, purpose: 'upgrade', expiresAt });
  return {
    token,
    expiresAt,
    url: `${env.LANDING_URL}/upgrade?user_id=${encodeURIComponent(userId)}&token=${token}`,
  };
}

/**
 * Weryfikuje i zużywa magic link „upgrade".
 * @returns {boolean} true gdy token poprawny, aktualny i nieużyty.
 */
export function consumeUpgradeLink(userId, token) {
  if (!userId || !token) return false;
  const link = magicLinks.find(token);
  if (!link) return false;
  if (link.user_id !== userId || link.purpose !== 'upgrade') return false;
  if (link.used_at) return false;
  if (new Date(link.expires_at).getTime() < Date.now()) return false;
  magicLinks.markUsed(token);
  return true;
}
