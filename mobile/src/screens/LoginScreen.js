import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { colors, spacing } from '../theme';

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Podaj adres email i hasło.');
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
      <StatusBar style="dark" />

      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>P</Text>
        </View>
        <Text style={styles.appName}>PrzetargAI</Text>
        <Text style={styles.tagline}>Monitoring przetargów publicznych</Text>
      </View>

      <Text style={styles.heading}>Zaloguj się</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="twoj@email.pl"
      />
      <TextField
        label="Hasło"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Zaloguj się" onPress={handleLogin} loading={loading} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Nie masz jeszcze konta?</Text>
        <Text style={styles.link} onPress={() => navigation.navigate('Register')}>
          {' '}Zarejestruj firmę
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.white, fontSize: 36, fontWeight: '800' },
  appName: { fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 12 },
  tagline: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  error: { color: colors.danger, fontSize: 14, marginBottom: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  footerText: { color: colors.textMuted },
  link: { color: colors.blue, fontWeight: '700' },
});
