import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { JezykProvider } from './src/context/JezykContext';
import { SavedProvider } from './src/context/SavedContext';
import RootNavigator from './src/navigation/RootNavigator';
import GranicaBledu from './src/components/GranicaBledu';
import { celPush } from './src/lib/nawigacjaPush';
import { nawigujDoCelu } from './src/navigation/nawigacjaRef';
import { sledz } from './src/services/telemetria';
import { ZDARZENIA } from './src/lib/zdarzenia';

// Sposób prezentacji powiadomień, gdy aplikacja jest na pierwszym planie.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Ikony paska statusu w kolorze zgodnym z motywem (ciemne w jasnym, jasne w ciemnym). */
function PasekStatusu() {
  const { schemat } = useTheme();
  return <StatusBar style={schemat === 'ciemny' ? 'light' : 'dark'} />;
}

export default function App() {
  // Ślad startu aplikacji (analityka) — raz przy montowaniu.
  useEffect(() => {
    sledz(ZDARZENIA.APLIKACJA_START);
  }, []);

  // Dotknięcie powiadomienia push → nawigacja na właściwy ekran.
  useEffect(() => {
    const przejdz = (odpowiedz) => {
      const data = odpowiedz?.notification?.request?.content?.data;
      nawigujDoCelu(celPush(data));
    };

    // 1) Aplikacja żyła (foreground/background) i użytkownik dotknął powiadomienia.
    const sub = Notifications.addNotificationResponseReceivedListener(przejdz);

    // 2) COLD START: apkę OTWORZYŁO dotknięcie powiadomienia — odczytujemy je raz.
    let aktywny = true;
    Notifications.getLastNotificationResponseAsync()
      .then((odpowiedz) => { if (aktywny && odpowiedz) przejdz(odpowiedz); })
      .catch(() => {});

    return () => {
      aktywny = false;
      sub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      {/* Domyślnie jasne ikony (ekran błędu GranicaBledu ma ciemne tło). Pod dostawcą motywu
          PasekStatusu przestawia je zgodnie z motywem — nagłówki są na powierzchni (jasnej
          albo granatowej), więc ikony paska muszą być ciemne w jasnym motywie. */}
      <StatusBar style="light" />
      <GranicaBledu>
        <ThemeProvider>
          <PasekStatusu />
          <JezykProvider>
            <AuthProvider>
              <SavedProvider>
                <RootNavigator />
              </SavedProvider>
            </AuthProvider>
          </JezykProvider>
        </ThemeProvider>
      </GranicaBledu>
    </SafeAreaProvider>
  );
}
