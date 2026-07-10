import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Adres backendu PrzetargAI — ustalany w trzech krokach.
 *
 * 1. `EXPO_PUBLIC_API_URL` — jawne wskazanie backendu (emulator / rollback na
 *    Railway / inne środowisko) bez edytowania kodu. Zmienne `EXPO_PUBLIC_*`
 *    trafiają do bundla przy budowaniu.
 * 2. DEV bez zmiennej — lokalny backend na maszynie dewelopera. Adres bierzemy
 *    z Expo (`hostUri`), żeby aplikacja na fizycznym telefonie trafiła do laptopa;
 *    na web `hostUri` bywa niedostępne, więc czytamy hosta ze strony. Bez tego
 *    fallbacku wersja webowa w DEV uderzałaby w PRODUKCYJNY backend.
 * 3. Produkcja bez zmiennej — **Cloud Functions (D-043, wdrożone 2026-07-10)**.
 *    Płatności tam są PRAWDZIWE (Stripe LIVE, 49 zł/mc).
 *
 * Rollback (dopóki Railway żyje): zbuduj z
 * `EXPO_PUBLIC_API_URL=https://backend-production-a43e3.up.railway.app`.
 */
const zJawnejZmiennej = process.env.EXPO_PUBLIC_API_URL;

const devHost = Constants.expoConfig?.hostUri?.split(':')[0]
  ?? (Platform.OS === 'web' ? globalThis.location?.hostname : undefined);

const PRODUKCJA = 'https://europe-central2-przetargai.cloudfunctions.net/api';

export const API_URL = zJawnejZmiennej
  || (__DEV__ && devHost ? `http://${devHost}:3100` : PRODUKCJA);
