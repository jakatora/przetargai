import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { spacing } from '../theme';

/**
 * Ekran „Ustaw nowe hasło" — użytkownik wkleja kod z maila i podaje nowe hasło. Po sukcesie
 * backend zwraca token, więc `resetPassword` od razu loguje (RootNavigator przełącza na apkę).
 */
export default function ResetPasswordScreen({ navigation }) {
  const { resetPassword } = useAuth();
  const styles = useStyle(tworzStyleReset);
  const [token, setToken] = useState('');
  const [haslo, setHaslo] = useState('');
  const [haslo2, setHaslo2] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function ustaw() {
    setError(null);
    if (!token.trim()) { setError('Wklej kod z maila.'); return; }
    if (haslo.length < 8) { setError('Hasło musi mieć min. 8 znaków.'); return; }
    if (haslo !== haslo2) { setError('Hasła nie są takie same.'); return; }
    setLoading(true);
    try {
      await resetPassword(token.trim(), haslo);
      // Sukces — jesteśmy zalogowani, RootNavigator odmontuje ten ekran.
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <Text style={styles.heading}>Ustaw nowe hasło</Text>
      <Text style={styles.opis}>
        Wklej jednorazowy kod, który wysłaliśmy na Twój e-mail, i ustaw nowe hasło. Kod jest
        ważny 1 godzinę.
      </Text>

      <TextField
        label="Kod z maila"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="wklej kod"
      />
      <TextField
        label="Nowe hasło"
        value={haslo}
        onChangeText={setHaslo}
        secureTextEntry
        placeholder="min. 8 znaków"
      />
      <TextField
        label="Powtórz nowe hasło"
        value={haslo2}
        onChangeText={setHaslo2}
        secureTextEntry
        placeholder="••••••••"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Ustaw hasło i zaloguj" onPress={ustaw} loading={loading} />

      <Text style={styles.link} onPress={() => navigation.goBack()} accessibilityRole="link">
        Nie mam kodu — wyślij ponownie
      </Text>
    </Screen>
  );
}

const tworzStyleReset = tworzStyle((k) => ({
  content: { flexGrow: 1, justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: k.text, marginBottom: spacing.sm },
  opis: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  error: { color: k.danger, fontSize: 14, marginBottom: spacing.sm },
  link: { color: k.blue, fontWeight: '700', textAlign: 'center', marginTop: spacing.lg },
}));
