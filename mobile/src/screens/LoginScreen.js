import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { spacing } from '../theme';

/** Separator tysięcy bez Intl (Hermes bywa okrojony) — „12 345". */
function formatLiczba(n) {
  return String(n ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const { schemat } = useTheme();
  const styles = useStyle(tworzStyleLogowania);
  // Pierwszy ekran aplikacji dla osoby, która już ma konto (P1-5).
  const { t } = useJezyk();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Dowód społeczny (bez logowania) — zachęca do rejestracji. Błąd = po prostu nie pokazujemy.
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let aktywny = true;
    api.publicStats().then((s) => { if (aktywny) setStats(s); }).catch(() => {});
    return () => { aktywny = false; };
  }, []);

  async function handleLogin() {
    setError(null);
    if (!email.trim() || !password) {
      setError(t('Podaj adres email i hasło.', 'Enter your email and password.'));
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      // Sukces — RootNavigator przełączy widok, ekran zostanie odmontowany.
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      {/* Jedyny ekran bez niebieskiego nagłówka — ikony paska muszą kontrastować z tłem. */}
      <StatusBar style={schemat === 'ciemny' ? 'light' : 'dark'} />

      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>P</Text>
        </View>
        <Text style={styles.appName}>PrzetargAI</Text>
        <Text style={styles.tagline}>{t('Monitoring przetargów publicznych', 'Public tender monitoring')}</Text>
      </View>

      {stats?.lacznie ? (
        <View style={styles.spoleczny}>
          <Text style={styles.spolecznyLiczba}>
            {t(`${formatLiczba(stats.lacznie)} przetargów w bazie`, `${formatLiczba(stats.lacznie)} tenders in the database`)}
          </Text>
          <Text style={styles.spolecznyOpis}>
            {stats.nowe24h > 0
              ? t(`W ostatniej dobie przybyło ${stats.nowe24h} nowych. `, `${stats.nowe24h} new ones arrived in the last 24 hours. `)
              : stats.nowe7dni > 0
                ? t(`W tym tygodniu przybyło ${stats.nowe7dni} nowych. `, `${stats.nowe7dni} new ones arrived this week. `)
                : ''}
            {t('Załóż konto i nie przegap swoich.', 'Create an account so you do not miss yours.')}
          </Text>
        </View>
      ) : null}

      <Text style={styles.heading}>{t('Zaloguj się', 'Sign in')}</Text>
      <TextField
        label={t('Email', 'Email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder={t('twoj@email.pl', 'you@email.com')}
      />
      <TextField
        label={t('Hasło', 'Password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={t('Zaloguj się', 'Sign in')} onPress={handleLogin} loading={loading} />

      <Text
        style={styles.linkHaslo}
        onPress={() => navigation.navigate('ForgotPassword', { email: email.trim() })}
        accessibilityRole="link"
      >
        {t('Nie pamiętasz hasła?', 'Forgot your password?')}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('Nie masz jeszcze konta?', 'No account yet?')}</Text>
        <Text style={styles.link} onPress={() => navigation.navigate('Register')}>
          {' '}{t('Zarejestruj firmę', 'Register your company')}
        </Text>
      </View>
    </Screen>
  );
}

const tworzStyleLogowania = tworzStyle((k) => ({
  content: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: k.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: k.white, fontSize: 36, fontWeight: '800' },
  appName: { fontSize: 26, fontWeight: '800', color: k.text, marginTop: 12 },
  tagline: { fontSize: 14, color: k.textMuted, marginTop: 4 },
  spoleczny: {
    backgroundColor: k.wyroznienie ?? k.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: k.blue,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  spolecznyLiczba: { fontSize: 17, fontWeight: '800', color: k.blue },
  spolecznyOpis: { fontSize: 13, color: k.text, marginTop: 4, lineHeight: 19 },
  heading: { fontSize: 20, fontWeight: '700', color: k.text, marginBottom: spacing.md },
  error: { color: k.danger, fontSize: 14, marginBottom: spacing.sm },
  linkHaslo: { color: k.blue, fontWeight: '700', textAlign: 'center', marginTop: spacing.md },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  footerText: { color: k.textMuted },
  link: { color: k.blue, fontWeight: '700' },
}));
