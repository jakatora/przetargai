import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';

// Sposób prezentacji powiadomień, gdy aplikacja jest na pierwszym planie.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Nagłówki ekranów są brandowo niebieskie w obu motywach → jasne ikony.
          Wyjątkiem jest Login (bez nagłówka) — ustawia własny StatusBar. */}
      <StatusBar style="light" />
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
