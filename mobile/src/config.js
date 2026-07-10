import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Adres backendu PrzetargAI — ustalany w trzech krokach.
 *
 * 1. `EXPO_PUBLIC_API_URL` — jawne wskazanie backendu. Tym przełączamy aplikację
 *    na emulator Firebase, na wdrożone funkcje albo z powrotem na Railway,
 *    bez edytowania kodu. Zmienne `EXPO_PUBLIC_*` trafiają do bundla przy budowaniu.
 * 2. DEV bez zmiennej — lokalny backend na maszynie dewelopera. Adres bierzemy
 *    z Expo (`hostUri`), żeby aplikacja na fizycznym telefonie trafiła do laptopa;
 *    na web `hostUri` bywa niedostępne, więc czytamy hosta ze strony. Bez tego
 *    fallbacku wersja webowa w DEV uderzałaby w PRODUKCYJNY backend.
 * 3. Produkcja bez zmiennej — dotychczasowy backend na Railway.
 *
 * ⚠️ Po migracji na Firebase (D-024) produkcyjnym adresem będzie URL funkcji.
 * Przełączenie następuje razem z wygaszeniem crona i webhooka na Railway —
 * patrz `runbooks/wdrozenie-firebase.md`, etap 6.
 */
const zJawnejZmiennej = process.env.EXPO_PUBLIC_API_URL;

const devHost = Constants.expoConfig?.hostUri?.split(':')[0]
  ?? (Platform.OS === 'web' ? globalThis.location?.hostname : undefined);

const RAILWAY = 'https://backend-production-a43e3.up.railway.app';

export const API_URL = zJawnejZmiennej
  || (__DEV__ && devHost ? `http://${devHost}:3100` : RAILWAY);
