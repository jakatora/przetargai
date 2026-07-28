import { logger } from '../lib/logger.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Wysyła powiadomienia push przez Expo Push API.
 * Akceptuje wyłącznie tokeny Expo (ExponentPushToken[...]).
 *
 * @returns {Promise<{sent: number, failed: number, bledy?: Record<string, number>}>}
 *   `sent` = bilety ze statusem 'ok' (realnie przyjęte przez Expo), NIE sam HTTP 200.
 */
export async function sendPush(tokens, { title, body, data = {} }) {
  const valid = (Array.isArray(tokens) ? tokens : [tokens])
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (!valid.length) return { sent: 0, failed: 0 };

  const messages = valid.map((to) => ({ to, title, body, data, sound: 'default' }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Expo Push API zwróciło błąd HTTP');
      return { sent: 0, failed: valid.length };
    }

    /*
     * HTTP 200 NIE znaczy, że push doszedł. Expo zwraca tablicę biletów — każdy ze
     * statusem 'ok' albo 'error'. Do 2026-07-28 liczyliśmy 200 jako sukces, więc
     * błędy biletów ginęły po cichu: brak serwerowego klucza FCM (InvalidCredentials)
     * i martwe tokeny (DeviceNotRegistered) raportowały „wysłano", a nikt nic nie
     * dostawał. Teraz liczymy tylko bilety 'ok' i logujemy rozbicie błędów, żeby
     * problem z dostarczaniem był widoczny w logach, a nie niewidzialny.
     */
    const bilety = (await res.json().catch(() => ({})))?.data ?? [];
    let sent = 0;
    const bledy = {};
    for (const bilet of bilety) {
      if (bilet?.status === 'ok') { sent++; continue; }
      const kod = bilet?.details?.error || 'Unknown';
      bledy[kod] = (bledy[kod] ?? 0) + 1;
    }
    // Gdyby Expo zwróciło mniej biletów niż wiadomości — brakujące traktujemy jak błąd.
    const failed = valid.length - sent;
    if (failed > 0) {
      logger.warn({ sent, failed, bledy },
        'Część powiadomień push NIE została dostarczona przez Expo (sprawdź klucz FCM / martwe tokeny)');
    }
    return { sent, failed, bledy };
  } catch (err) {
    logger.error({ err: err.message }, 'Wysyłka powiadomień push nie powiodła się');
    return { sent: 0, failed: valid.length };
  }
}
