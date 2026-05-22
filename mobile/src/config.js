import Constants from 'expo-constants';

// W trybie deweloperskim adres IP maszyny dewelopera pobieramy z Expo (hostUri),
// dzięki czemu aplikacja na fizycznym telefonie trafia do lokalnego backendu.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

/**
 * Adres backendu PrzetargAI.
 * - DEV: http://<IP-maszyny>:3100 (wykrywane automatycznie),
 * - PROD: ustaw publiczny adres API po wdrożeniu na Railway.
 */
export const API_URL = __DEV__ && devHost
  ? `http://${devHost}:3100`
  : 'https://api.przetargai.pl';
