import { useState } from 'react';
import { Text, Pressable } from 'react-native';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import CpvPicker from '../components/CpvPicker';
import { useStyle, tworzStyle } from '../context/ThemeContext';
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
      setError('Uzupełnij email i hasło.');
      return;
    }
    if (form.password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.');
      return;
    }
    if (form.password !== form.password_confirm) {
      setError('Hasła się różnią — wpisz dwa razy to samo hasło.');
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
        Załóż konto. Słowa kluczowe pozwalają AI dopasować przetargi do tego,
        czym się zajmujesz — możesz je zmienić w każdej chwili.
      </Text>

      <TextField
        label="Email"
        value={form.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="twoj@email.pl"
      />
      <TextField
        label="Hasło"
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry
        placeholder="••••••••"
        hint="Minimum 8 znaków"
      />
      <TextField
        label="Powtórz hasło"
        value={form.password_confirm}
        onChangeText={set('password_confirm')}
        secureTextEntry
        placeholder="••••••••"
        hint="Wpisz to samo hasło jeszcze raz"
      />
      <TextField
        label="Słowa kluczowe"
        value={form.keywords}
        onChangeText={set('keywords')}
        placeholder="remont, budowa drogi, instalacje"
        hint="Po przecinku — czym się zajmujesz"
      />
      <TextField
        label="Kody CPV (opcjonalnie)"
        value={form.cpv_codes}
        onChangeText={set('cpv_codes')}
        placeholder="45000000, 45300000"
        hint="Po przecinku — jeśli je znasz; nie są wymagane"
        style={styles.poleCpv}
      />
      <Pressable onPress={() => setSciagaOtwarta(true)} hitSlop={8} accessibilityRole="button">
        <Text style={styles.linkSciagi}>Nie znasz kodów? Otwórz ściągę CPV →</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Załóż konto" onPress={handleRegister} loading={loading} />

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
