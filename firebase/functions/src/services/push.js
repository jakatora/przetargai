import { logger } from '../lib/logger.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Wysyła powiadomienia push przez Expo Push API.
 * Akceptuje wyłącznie tokeny Expo (ExponentPushToken[...]).
 */
export async function sendPush(tokens, { title, body, data = {} }) {
  const valid = (Array.isArray(tokens) ? tokens : [tokens])
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (!valid.length) return { sent: 0 };

  const messages = valid.map((to) => ({ to, title, body, data, sound: 'default' }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Expo Push API zwróciło błąd');
      return { sent: 0 };
    }
    return { sent: valid.length };
  } catch (err) {
    logger.error({ err: err.message }, 'Wysyłka powiadomień push nie powiodła się');
    return { sent: 0 };
  }
}
