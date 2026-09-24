import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
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
  const { t } = useJezyk(); // ostatni krok odzyskiwania konta — też dwujęzyczny (P1-5)
  const [token, setToken] = useState('');
  const [haslo, setHaslo] = useState('');
  const [haslo2, setHaslo2] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function ustaw() {
    setError(null);
    if (!token.trim()) { setError(t('Wklej kod z maila.', 'Paste the code from the email.')); return; }
    if (haslo.length < 8) { setError(t('Hasło musi mieć min. 8 znaków.', 'The password needs at least 8 characters.')); return; }
    if (haslo !== haslo2) { setError(t('Hasła nie są takie same.', 'The passwords do not match.')); return; }
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
      <Text style={styles.heading}>{t('Ustaw nowe hasło', 'Set a new password')}</Text>
      <Text style={styles.opis}>
        {t(
          'Wklej jednorazowy kod, który wysłaliśmy na Twój e-mail, i ustaw nowe hasło. Kod jest ważny 1 godzinę.',
          'Paste the one-time code we sent to your email and set a new password. The code is valid for 1 hour.',
        )}
      </Text>

      <TextField
        label={t('Kod z maila', 'Code from the email')}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('wklej kod', 'paste the code')}
      />
      <TextField
        label={t('Nowe hasło', 'New password')}
        value={haslo}
        onChangeText={setHaslo}
        secureTextEntry
        placeholder={t('min. 8 znaków', 'at least 8 characters')}
      />
      <TextField
        label={t('Powtórz nowe hasło', 'Repeat the new password')}
        value={haslo2}
        onChangeText={setHaslo2}
        secureTextEntry
        placeholder="••••••••"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={t('Ustaw hasło i zaloguj', 'Set password and sign in')} onPress={ustaw} loading={loading} />

      <Text style={styles.link} onPress={() => navigation.goBack()} accessibilityRole="link">
        {t('Nie mam kodu — wyślij ponownie', 'No code — send it again')}
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
