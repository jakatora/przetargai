import { useState } from 'react';
import { Text, Pressable } from 'react-native';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import CpvPicker from '../components/CpvPicker';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing } from '../theme';

function parseList(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

// Rejestracja bez NIP-u i bez nazwy firmy (feedback usera 2026-07-09 + plan §7):
// persona JDG zakłada konto samym e-mailem. Nazwę firmy można uzupełnić później
// w ustawieniach konta; NIP schodzi do momentu wystawienia faktury.
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const styles = useStyle(tworzStyleRejestracji);
  // Rejestracja jest bramą do produktu — po angielsku tak samo jak po polsku (P1-5).
  const { t } = useJezyk();
  const [form, setForm] = useState({
    email: '',
    password: '',
    password_confirm: '',
    keywords: '',
    cpv_codes: '',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sciagaOtwarta, setSciagaOtwarta] = useState(false);

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
      await signUp({
        email: form.email.trim(),
        password: form.password,
        keywords: parseList(form.keywords),
        cpv_codes: parseList(form.cpv_codes),
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.intro}>
        {t(
          'Załóż konto. Słowa kluczowe pozwalają AI dopasować przetargi do tego, czym się zajmujesz — możesz je zmienić w każdej chwili.',
          'Create an account. Keywords let the AI match tenders to what you actually do — you can change them any time.',
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
        placeholder="••••••••"
        hint={t('Minimum 8 znaków', 'At least 8 characters')}
      />
      <TextField
        label={t('Powtórz hasło', 'Repeat password')}
        value={form.password_confirm}
        onChangeText={set('password_confirm')}
        secureTextEntry
        placeholder="••••••••"
        hint={t('Wpisz to samo hasło jeszcze raz', 'Type the same password again')}
      />
      <TextField
        label={t('Słowa kluczowe', 'Keywords')}
        value={form.keywords}
        onChangeText={set('keywords')}
        placeholder={t('remont, budowa drogi, instalacje', 'renovation, road construction, installations')}
        hint={t('Po przecinku — czym się zajmujesz', 'Comma-separated — what you do')}
      />
      <TextField
        label={t('Kody CPV (opcjonalnie)', 'CPV codes (optional)')}
        value={form.cpv_codes}
        onChangeText={set('cpv_codes')}
        placeholder="45000000, 45300000"
        hint={t('Po przecinku — jeśli je znasz; nie są wymagane', 'Comma-separated — if you know them; not required')}
        style={styles.poleCpv}
      />
      <Pressable onPress={() => setSciagaOtwarta(true)} hitSlop={8} accessibilityRole="button">
        <Text style={styles.linkSciagi}>{t('Nie znasz kodów? Otwórz ściągę CPV →', 'Do not know the codes? Open the CPV cheat sheet →')}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={t('Załóż konto', 'Create account')} onPress={handleRegister} loading={loading} />

      <CpvPicker
        widoczny={sciagaOtwarta}
        onClose={() => setSciagaOtwarta(false)}
        wartosc={form.cpv_codes}
        onChange={set('cpv_codes')}
      />
    </Screen>
  );
}

const tworzStyleRejestracji = tworzStyle((k) => ({
  intro: { color: k.textMuted, fontSize: 15, marginBottom: spacing.lg, lineHeight: 22 },
  error: { color: k.danger, fontSize: 14, marginBottom: spacing.sm },
  poleCpv: { marginBottom: spacing.xs },
  linkSciagi: { color: k.blue, fontSize: 14, fontWeight: '600', marginBottom: spacing.md },
}));
