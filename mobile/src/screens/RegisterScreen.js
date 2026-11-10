import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing } from '../theme';

// Rejestracja bez NIP-u i bez nazwy firmy (feedback usera 2026-07-09 + plan §7): persona JDG zakłada konto samym
// e-mailem. Od 2026-11-10 (przegląd oczami pracownika) także BEZ słów kluczowych i CPV — strona obiecuje „tylko
// e-mail i hasło”, a o firmę i tak pyta ekran powitalny zaraz po rejestracji (najszybciej po NIP-ie). Dwa razy
// to samo pytanie zniechęcało na samym starcie.
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const styles = useStyle(tworzStyleRejestracji);
  // Rejestracja jest bramą do produktu — po angielsku tak samo jak po polsku (P1-5).
  const { t } = useJezyk();
  const [form, setForm] = useState({ email: '', password: '', password_confirm: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleRegister() {
    setError(null);
    if (!form.email.trim() || !form.password) {
      setError(t('Uzupełnij email i hasło.', 'Fill in your email and password.'));
      return;
    }
    if (form.password.length < 8) {
      setError(t('Hasło musi mieć co najmniej 8 znaków.', 'The password needs at least 8 characters.'));
      return;
    }
    if (form.password !== form.password_confirm) {
      setError(t('Hasła się różnią — wpisz dwa razy to samo hasło.', 'The passwords differ — type the same one twice.'));
      return;
    }
    setLoading(true);
    try {
      await signUp({ email: form.email.trim(), password: form.password, keywords: [], cpv_codes: [] });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.intro}>
        {t(
          'Załóż konto — wystarczy e-mail i hasło. Czym zajmuje się Twoja firma, ustawisz w następnym kroku, najszybciej po numerze NIP.',
          'Create an account — an email and a password are enough. You will set what your company does in the next step, fastest by its NIP number.',
        )}
      </Text>

      <TextField
        label={t('Email', 'Email')}
        value={form.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder={t('twoj@email.pl', 'you@email.com')}
      />
      <TextField
        label={t('Hasło', 'Password')}
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry
        hint={t('Minimum 8 znaków', 'At least 8 characters')}
      />
      <TextField
        label={t('Powtórz hasło', 'Repeat password')}
        value={form.password_confirm}
        onChangeText={set('password_confirm')}
        secureTextEntry
        hint={t('Wpisz to samo hasło jeszcze raz', 'Type the same password again')}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={t('Załóż konto', 'Create account')} onPress={handleRegister} loading={loading} />
    </Screen>
  );
}

const tworzStyleRejestracji = tworzStyle((k) => ({
  intro: { color: k.textMuted, fontSize: 15, marginBottom: spacing.lg, lineHeight: 22 },
  error: { color: k.danger, fontSize: 14, marginBottom: spacing.sm },
}));
