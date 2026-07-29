import { View, ActivityIndicator } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import MatchFeedScreen from '../screens/MatchFeedScreen';
import MatchDetailScreen from '../screens/MatchDetailScreen';
import WynikKontroliScreen from '../screens/WynikKontroliScreen';
import PrzeswietlenieUmowyScreen from '../screens/PrzeswietlenieUmowyScreen';
import RadarSwzScreen from '../screens/RadarSwzScreen';
import SejfScreen from '../screens/SejfScreen';
import RejestratorOfertyScreen from '../screens/RejestratorOfertyScreen';
import SymulatorPlynnosciScreen from '../screens/SymulatorPlynnosciScreen';
import ZabezpieczenieZwrotScreen from '../screens/ZabezpieczenieZwrotScreen';
import PodprogoweDetailScreen from '../screens/PodprogoweDetailScreen';
import PodprogoweUstawieniaScreen from '../screens/PodprogoweUstawieniaScreen';
import Kreator118Screen from '../screens/Kreator118Screen';
import KrokDanePodmiotuScreen from '../screens/KrokDanePodmiotuScreen';
import AccountScreen from '../screens/AccountScreen';
import SavedScreen from '../screens/SavedScreen';
import BankReferencjiScreen from '../screens/BankReferencjiScreen';
import StraznikWezwaniaScreen from '../screens/StraznikWezwaniaScreen';
import KalkulatorPunktowScreen from '../screens/KalkulatorPunktowScreen';
import KontrolerGwarancjiScreen from '../screens/KontrolerGwarancjiScreen';
import ObronaCenyScreen from '../screens/ObronaCenyScreen';
import TerminZwiazaniaScreen from '../screens/TerminZwiazaniaScreen';
import WizjaLokalnaScreen from '../screens/WizjaLokalnaScreen';
import KonsorcjumScreen from '../screens/KonsorcjumScreen';
import CertyfikatWykonawcyScreen from '../screens/CertyfikatWykonawcyScreen';
import TajemnicaScreen from '../screens/TajemnicaScreen';
import SamooczyszczenieScreen from '../screens/SamooczyszczenieScreen';
import KalkulatorTerminowScreen from '../screens/KalkulatorTerminowScreen';

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
              name="Sejf"
              component={SejfScreen}
              options={{ title: 'Sejf dokumentów' }}
            />
            <Stack.Screen
              name="RejestratorOferty"
              component={RejestratorOfertyScreen}
              options={{ title: 'Rejestrator oferty' }}
            />
            <Stack.Screen
              name="SymulatorPlynnosci"
              component={SymulatorPlynnosciScreen}
              options={{ title: 'Symulator płynności' }}
            />
            <Stack.Screen
              name="ZabezpieczenieZwrot"
              component={ZabezpieczenieZwrotScreen}
              options={{ title: 'Odzyskiwacz zabezpieczenia' }}
            />
            <Stack.Screen
              name="PodprogoweDetail"
              component={PodprogoweDetailScreen}
              options={{ title: 'Zamówienie podprogowe' }}
            />
            <Stack.Screen
              name="PodprogoweUstawienia"
              component={PodprogoweUstawieniaScreen}
              options={{ title: 'Radar podprogowy' }}
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
              name="BankReferencji"
              component={BankReferencjiScreen}
              options={{ title: 'Bank referencji' }}
            />
            <Stack.Screen
              name="StraznikWezwania"
              component={StraznikWezwaniaScreen}
              options={{ title: 'Strażnik wezwania' }}
            />
            <Stack.Screen
              name="KalkulatorPunktow"
              component={KalkulatorPunktowScreen}
              options={{ title: 'Kalkulator punktów' }}
            />
            <Stack.Screen
              name="KontrolerGwarancji"
              component={KontrolerGwarancjiScreen}
              options={{ title: 'Gwarancja wadialna' }}
            />
            <Stack.Screen
              name="ObronaCeny"
              component={ObronaCenyScreen}
              options={{ title: 'Obrona ceny' }}
            />
            <Stack.Screen
              name="TerminZwiazania"
              component={TerminZwiazaniaScreen}
              options={{ title: 'Termin związania' }}
            />
            <Stack.Screen
              name="WizjaLokalna"
              component={WizjaLokalnaScreen}
              options={{ title: 'Wizja lokalna' }}
            />
            <Stack.Screen
              name="Konsorcjum"
              component={KonsorcjumScreen}
              options={{ title: 'Oświadczenie konsorcjum' }}
            />
            <Stack.Screen
              name="CertyfikatWykonawcy"
              component={CertyfikatWykonawcyScreen}
              options={{ title: 'Certyfikat wykonawcy' }}
            />
            <Stack.Screen
              name="Tajemnica"
              component={TajemnicaScreen}
              options={{ title: 'Tajemnica przedsiębiorstwa' }}
            />
            <Stack.Screen
              name="Samooczyszczenie"
              component={SamooczyszczenieScreen}
              options={{ title: 'Samooczyszczenie' }}
            />
            <Stack.Screen
              name="KalkulatorTerminow"
              component={KalkulatorTerminowScreen}
              options={{ title: 'Kalkulator terminów' }}
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
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ title: 'Odzyskaj hasło' }}
            />
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
              options={{ title: 'Nowe hasło' }}
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
