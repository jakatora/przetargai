import { logger } from '../lib/logger.js';
import { users } from '../db/repos.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Kod błędu biletu Expo, który znaczy „ten telefon już nie istnieje dla nas"
 * (aplikacja odinstalowana, token unieważniony). Tylko on uzasadnia skasowanie
 * tokenu — InvalidCredentials czy MessageRateExceeded to problemy po NASZEJ
 * stronie albo chwilowe, a token użytkownika jest wtedy nadal dobry.
 */
const MARTWY_TOKEN = 'DeviceNotRegistered';

/** Domyślne sprzątanie: martwe tokeny znikają z kont w Firestore. */
async function zdejmijZBazy(tokeny) {
  const wyczyszczone = await users.zdejmijPushTokeny(tokeny);
  logger.info({ martwe: tokeny.length, wyczyszczone }, 'Push: martwe tokeny zdjęte z kont');
}

/**
 * Wysyła powiadomienia push przez Expo Push API.
 * Akceptuje wyłącznie tokeny Expo (ExponentPushToken[...]).
 *
 * Martwe tokeny (DeviceNotRegistered) są SPRZĄTANE tutaj, a nie u wołających
 * (2026-09-25): do tej pory zostawały na kontach na zawsze — każdy cykl płacił za
 * wysyłkę w próżnię, a logi zalewał ten sam błąd. Jedno miejsce obsługuje
 * wszystkich nadawców (dopasowania, przypomnienia, monitoring).
 *
 * @param {{zdejmijMartwe?: (tokeny: string[]) => Promise<unknown>}} [opcje]
 *   sprzątanie wstrzykiwane w testach bez emulatora; błąd sprzątania nigdy nie
 *   wywraca wysyłki (push już poszedł).
 * @returns {Promise<{sent: number, failed: number, bledy?: Record<string, number>, martweTokeny: string[]}>}
 *   `sent` = bilety ze statusem 'ok' (realnie przyjęte przez Expo), NIE sam HTTP 200.
 *   `martweTokeny` = tokeny z biletem DeviceNotRegistered (już zdjęte z bazy).
 */
export async function sendPush(tokens, { title, body, data = {} }, { zdejmijMartwe = zdejmijZBazy } = {}) {
  const valid = (Array.isArray(tokens) ? tokens : [tokens])
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (!valid.length) return { sent: 0, failed: 0, martweTokeny: [] };

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
      return { sent: 0, failed: valid.length, martweTokeny: [] };
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
    const martweTokeny = [];
    bilety.forEach((bilet, i) => {
      if (bilet?.status === 'ok') { sent++; return; }
      const kod = bilet?.details?.error || 'Unknown';
      bledy[kod] = (bledy[kod] ?? 0) + 1;
      // Bilety wracają w KOLEJNOŚCI wiadomości; Expo bywa, że podaje token wprost.
      const token = bilet?.details?.expoPushToken ?? valid[i];
      if (kod === MARTWY_TOKEN && token) martweTokeny.push(token);
    });
    // Gdyby Expo zwróciło mniej biletów niż wiadomości — brakujące traktujemy jak błąd.
    const failed = valid.length - sent;
    if (failed > 0) {
      logger.warn({ sent, failed, bledy },
        'Część powiadomień push NIE została dostarczona przez Expo (sprawdź klucz FCM / martwe tokeny)');
    }
    if (martweTokeny.length) {
      await Promise.resolve()
        .then(() => zdejmijMartwe(martweTokeny))
        .catch((err) => logger.error({ err: err.message }, 'Push: nie udało się zdjąć martwych tokenów'));
    }
    return { sent, failed, bledy, martweTokeny };
  } catch (err) {
    logger.error({ err: err.message }, 'Wysyłka powiadomień push nie powiodła się');
    return { sent: 0, failed: valid.length, martweTokeny: [] };
  }
}
