import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { colors, spacing } from '../theme';

function parseList(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: '',
    company_nip: '',
    company_name: '',
    keywords: '',
    cpv_codes: '',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleRegister() {
    setError(null);
    if (!form.email.trim() || !form.password || !form.company_nip.trim() || !form.company_name.trim()) {
      setError('Uzupełnij email, hasło, NIP oraz nazwę firmy.');
      return;
    }
    if (form.password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.');
      return;
    }
    setLoading(true);
    try {
      await signUp({
        email: form.email.trim(),
        password: form.password,
        company_nip: form.company_nip.trim(),
        company_name: form.company_name.trim(),
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
        Załóż konto firmy. Słowa kluczowe i kody CPV pozwalają AI dopasować
        przetargi do Twojej branży.
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
        label="NIP firmy"
        value={form.company_nip}
        onChangeText={set('company_nip')}
        keyboardType="number-pad"
        placeholder="1234567890"
      />
      <TextField
        label="Nazwa firmy"
        value={form.company_name}
        onChangeText={set('company_name')}
        placeholder="np. Budownictwo Kowalski Sp. z o.o."
      />
      <TextField
        label="Słowa kluczowe"
        value={form.keywords}
        onChangeText={set('keywords')}
        placeholder="remont, budowa drogi, instalacje"
        hint="Po przecinku — branża i specjalizacja firmy"
      />
      <TextField
        label="Kody CPV (opcjonalnie)"
        value={form.cpv_codes}
        onChangeText={set('cpv_codes')}
        placeholder="45000000, 45300000"
        hint="Po przecinku — kody Wspólnego Słownika Zamówień"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Zarejestruj firmę" onPress={handleRegister} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.textMuted, fontSize: 15, marginBottom: spacing.lg, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14, marginBottom: spacing.sm },
});
