import { View, ActivityIndicator } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import MatchFeedScreen from '../screens/MatchFeedScreen';
import MatchDetailScreen from '../screens/MatchDetailScreen';
import WynikKontroliScreen from '../screens/WynikKontroliScreen';
import PrzeswietlenieUmowyScreen from '../screens/PrzeswietlenieUmowyScreen';
import RadarSwzScreen from '../screens/RadarSwzScreen';
import Kreator118Screen from '../screens/Kreator118Screen';
import KrokDanePodmiotuScreen from '../screens/KrokDanePodmiotuScreen';
import AccountScreen from '../screens/AccountScreen';
import SavedScreen from '../screens/SavedScreen';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { user, restoring } = useAuth();
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleNawigatora);

  // Nagłówek jest brandowo niebieski w OBU motywach; motyw zmienia tła treści.
  const screenOptions = {
    headerStyle: { backgroundColor: kolory.blue },
    headerTintColor: kolory.white,
    headerTitleStyle: { fontWeight: '700' },
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: kolory.bg },
  };

  // Motyw nawigacji: tło pod przejściami ekranów musi zgadzać się z paletą,
  // inaczej przy animacji mignie domyślna biel.
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: kolory.blue,
      background: kolory.bg,
      card: kolory.surface,
      text: kolory.text,
      border: kolory.border,
    },
  };

  if (restoring) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={kolory.blue} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={screenOptions}>
        {user ? (
          <>
            <Stack.Screen
              name="MatchFeed"
              component={MatchFeedScreen}
              options={{ title: 'Twoje przetargi' }}
            />
            <Stack.Screen
              name="MatchDetail"
              component={MatchDetailScreen}
              options={{ title: 'Szczegóły przetargu' }}
            />
            <Stack.Screen
              name="WynikKontroli"
              component={WynikKontroliScreen}
              options={{ title: 'Szansa na odwołanie' }}
            />
            <Stack.Screen
              name="PrzeswietlenieUmowy"
              component={PrzeswietlenieUmowyScreen}
              options={{ title: 'Prześwietlenie umowy' }}
            />
            <Stack.Screen
              name="RadarSwz"
              component={RadarSwzScreen}
              options={{ title: 'Radar SWZ' }}
            />
            <Stack.Screen
              name="Kreator118"
              component={Kreator118Screen}
              options={{ title: 'Pożycz doświadczenie' }}
            />
            <Stack.Screen
              name="KrokDanePodmiotu"
              component={KrokDanePodmiotuScreen}
              options={{ title: 'Pożycz doświadczenie' }}
            />
            <Stack.Screen
              name="Saved"
              component={SavedScreen}
              options={{ title: 'Zapisane' }}
            />
            <Stack.Screen
              name="Account"
              component={AccountScreen}
              options={{ title: 'Twoje konto' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Register"
              component={RegisterScreen}
              options={{ title: 'Rejestracja firmy' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const tworzStyleNawigatora = tworzStyle((k) => ({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: k.bg,
  },
}));
