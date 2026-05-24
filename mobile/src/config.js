import Constants from 'expo-constants';

// W trybie deweloperskim adres IP maszyny dewelopera pobieramy z Expo (hostUri),
// dzięki czemu aplikacja na fizycznym telefonie trafia do lokalnego backendu.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

/**
 * Adres backendu PrzetargAI.
 * - DEV: http://<IP-maszyny>:3100 (wykrywane automatycznie z Expo).
 * - PROD: backend na Railway. Po podpięciu custom domain zmienić na
 *   https://api.przetargai.pl (DNS CNAME → Railway custom domain).
 */
export const API_URL = __DEV__ && devHost
  ? `http://${devHost}:3100`
  : 'https://backend-production-a43e3.up.railway.app';
