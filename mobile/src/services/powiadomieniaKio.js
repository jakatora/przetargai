import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { powiadomienieOTerminieKio } from '../lib/orkiestratorOdwolania';

/**
 * Planuje JEDNO lokalne powiadomienie o zbliżającym się terminie odwołania do
 * KIO — trigger przepływu z podzadania 13/13. Decyzję (czy, kiedy, jaka treść)
 * podejmuje czysta {@link ../lib/orkiestratorOdwolania.powiadomienieOTerminieKio};
 * tutaj tylko strona I/O: zgoda, kanał (Android) i zaplanowanie w expo.
 *
 * Lokalne — bez EAS/push tokenu (inaczej niż {@link ./push}); działa też offline.
 * Best-effort jak reszta powiadomień: brak zgody/konfiguracji NIE wywraca zmiany
 * statusu na „przegrana", która to powiadomienie wyzwala.
 *
 * @param {{ terminOdwolaniaKio?: string|null }|null} kontrola rekord kontroli
 *   (po {@link ../lib/orkiestratorOdwolania.uruchomSciezkeOdwolania})
 * @param {{ teraz?: number, progDniPrzypomnienia?: number }} [opcje]
 * @returns {Promise<string|null>} identyfikator zaplanowanego powiadomienia albo null
 */
export async function zaplanujPowiadomienieOTerminieKio(kontrola, opcje = {}) {
  try {
    const plan = powiadomienieOTerminieKio(kontrola, opcje);
    if (!plan) return null; // brak terminu albo już po terminie — nie ma czego planować

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

    // Data odpalenia nie może być w przeszłości — expo odpaliłoby od razu, ale
    // dokładamy minutę marginesu, gdy termin jest już „na teraz".
    const teraz = typeof opcje.teraz === 'number' ? opcje.teraz : Date.now();
    const data = new Date(Math.max(plan.uruchomOMs, teraz + 60 * 1000));

    return await Notifications.scheduleNotificationAsync({
      content: { title: plan.tytul, body: plan.tresc },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data },
    });
  } catch (err) {
    // Powiadomienia bywają niedostępne (tryb dev, brak zgody) — logujemy i idziemy dalej.
    console.warn('Powiadomienie o terminie KIO niedostępne:', err?.message);
    return null;
  }
}
