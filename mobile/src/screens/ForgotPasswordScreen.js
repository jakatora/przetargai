import { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { spacing } from '../theme';

/**
 * Ekran „Nie pamiętasz hasła?" — użytkownik podaje e-mail, my wysyłamy kod resetu. Backend
 * ZAWSZE odpowiada tak samo (anty-enumeracja), więc niezależnie od wyniku pokazujemy ten sam
 * komunikat i kierujemy do wpisania kodu. Sesji tu nie zmieniamy.
 */
export default function ForgotPasswordScreen({ navigation, route }) {
  const { forgotPassword } = useAuth();
  const styles = useStyle(tworzStyleForgot);
  const [email, setEmail] = useState(route?.params?.email ?? '');
  const [wyslano, setWyslano] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function wyslij() {
    setError(null);
    if (!email.trim()) { setError('Podaj adres e-mail konta.'); return; }
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setWyslano(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <Text style={styles.heading}>Odzyskaj hasło</Text>
      <Text style={styles.opis}>
        Podaj adres e-mail konta. Jeśli takie konto istnieje, wyślemy na nie jednorazowy kod do
        ustawienia nowego hasła (ważny 1 godzinę).
      </Text>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="twoj@email.pl"
        editable={!wyslano}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {wyslano ? (
        <>
          <View style={styles.info}>
            <Text style={styles.infoText}>
              Jeśli konto o tym adresie istnieje, wysłaliśmy na nie kod. Sprawdź skrzynkę (także
              spam) i wpisz kod na kolejnym ekranie.
            </Text>
          </View>
          <Button
            title="Mam kod — ustaw nowe hasło"
            onPress={() => navigation.navigate('ResetPassword', { email: email.trim() })}
          />
          <Text style={styles.link} onPress={wyslij} accessibilityRole="link">Wyślij kod ponownie</Text>
        </>
      ) : (
        <Button title="Wyślij kod resetu" onPress={wyslij} loading={loading} />
      )}

      <Text style={styles.link} onPress={() => navigation.goBack()} accessibilityRole="link">
        Wróć do logowania
      </Text>
    </Screen>
  );
}

const tworzStyleForgot = tworzStyle((k) => ({
  content: { flexGrow: 1, justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: k.text, marginBottom: spacing.sm },
  opis: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  error: { color: k.danger, fontSize: 14, marginBottom: spacing.sm },
  info: {
    backgroundColor: k.sukcesTlo, borderRadius: 12, borderWidth: 1, borderColor: k.sukcesAkcent,
    padding: spacing.md, marginBottom: spacing.md,
  },
  infoText: { fontSize: 13, color: k.sukcesAkcent, lineHeight: 19 },
  link: { color: k.blue, fontWeight: '700', textAlign: 'center', marginTop: spacing.lg },
}));
