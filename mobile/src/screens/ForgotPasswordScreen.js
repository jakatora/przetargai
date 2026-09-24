import { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
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
  const { t } = useJezyk(); // ścieżka odzyskiwania konta też musi być dwujęzyczna (P1-5)
  const [email, setEmail] = useState(route?.params?.email ?? '');
  const [wyslano, setWyslano] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function wyslij() {
    setError(null);
    if (!email.trim()) { setError(t('Podaj adres e-mail konta.', 'Enter the account email address.')); return; }
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
      <Text style={styles.heading}>{t('Odzyskaj hasło', 'Recover your password')}</Text>
      <Text style={styles.opis}>
        {t(
          'Podaj adres e-mail konta. Jeśli takie konto istnieje, wyślemy na nie jednorazowy kod do ustawienia nowego hasła (ważny 1 godzinę).',
          'Enter the account email address. If such an account exists, we will send it a one-time code to set a new password (valid for 1 hour).',
        )}
      </Text>

      <TextField
        label={t('Email', 'Email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder={t('twoj@email.pl', 'you@email.com')}
        editable={!wyslano}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {wyslano ? (
        <>
          <View style={styles.info}>
            <Text style={styles.infoText}>
              {t(
                'Jeśli konto o tym adresie istnieje, wysłaliśmy na nie kod. Sprawdź skrzynkę (także spam) i wpisz kod na kolejnym ekranie.',
                'If an account with this address exists, we have sent it a code. Check your inbox (and spam) and enter the code on the next screen.',
              )}
            </Text>
          </View>
          <Button
            title={t('Mam kod — ustaw nowe hasło', 'I have the code — set a new password')}
            onPress={() => navigation.navigate('ResetPassword', { email: email.trim() })}
          />
          <Text style={styles.link} onPress={wyslij} accessibilityRole="link">{t('Wyślij kod ponownie', 'Send the code again')}</Text>
        </>
      ) : (
        <Button title={t('Wyślij kod resetu', 'Send reset code')} onPress={wyslij} loading={loading} />
      )}

      <Text style={styles.link} onPress={() => navigation.goBack()} accessibilityRole="link">
        {t('Wróć do logowania', 'Back to sign in')}
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
