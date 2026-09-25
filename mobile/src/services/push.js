import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

/**
 * Rejestruje urządzenie do powiadomień push i zwraca token Expo (lub null).
 * Działa łagodnie — brak zgody lub konfiguracji EAS nie wywraca aplikacji.
 */
export async function registerForPushNotifications() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Powiadomienia',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId
      ?? Constants.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenResponse.data;
  } catch (err) {
    // Brak projektu EAS w trybie dev jest oczekiwany — logujemy i kontynuujemy.
    console.warn('Powiadomienia push niedostępne:', err?.message);
    return null;
  }
}

/**
 * Sprząta powiadomienia KONTA z urządzenia przy wylogowaniu / zmianie konta
 * (2026-09-25). Jedyne lokalnie planowane powiadomienia to terminy KIO konkretnej
 * firmy (services/powiadomieniaKio) — po wylogowaniu odpaliłyby się następnemu
 * użytkownikowi telefonu. Zdejmujemy też już wyświetlone (tytuły przetargów
 * poprzedniej firmy w szufladzie). Best-effort: na web moduł bywa niedostępny.
 */
export async function anulujPowiadomieniaKonta() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch { /* brak modułu (web) — nie ma czego anulować */ }
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch { /* j.w. */ }
}
