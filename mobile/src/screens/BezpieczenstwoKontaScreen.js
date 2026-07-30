import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { ocenHaslo, walidujZmianeEmaila } from '../lib/bezpieczenstwoKonta';

/**
 * Ekran „Bezpieczeństwo konta" — zmiana hasła i adresu e-mail z poziomu aplikacji.
 *
 * Ekran jest CIENKI: reguły (siła nowego hasła, zgodność powtórzenia, poprawność
 * nowego e-maila i to, że różni się od obecnego) żyją w testowanym
 * `lib/bezpieczenstwoKonta.js`. Tu tylko formularze i wywołania AuthContext
 * (`zmienHaslo` utrwala nowy token, `zmienEmail` odświeża profil).
 */
export default function BezpieczenstwoKontaScreen() {
  const { user, zmienHaslo, zmienEmail } = useAuth();
  const styles = useStyle(tworzStyleBezpieczenstwa);

  // --- zmiana hasła ---
  const [aktualne, setAktualne] = useState('');
  const [nowe, setNowe] = useState('');
  const [powtorz, setPowtorz] = useState('');
  const [zmianaHasla, setZmianaHasla] = useState(false);

  // --- zmiana e-maila ---
  const [nowyEmail, setNowyEmail] = useState('');
  const [hasloEmail, setHasloEmail] = useState('');
  const [zmianaEmaila, setZmianaEmaila] = useState(false);

  const ocena = ocenHaslo(nowe, powtorz);

  async function wykonajZmianeHasla() {
    if (!aktualne) {
      Alert.alert('Podaj hasło', 'Wpisz aktualne hasło, aby potwierdzić zmianę.');
      return;
    }
    if (!ocena.poprawne) {
      Alert.alert('Sprawdź nowe hasło', ocena.komunikat);
      return;
    }
    setZmianaHasla(true);
    try {
      const wynik = await zmienHaslo(aktualne, nowe);
      setAktualne(''); setNowe(''); setPowtorz('');
      Alert.alert('Gotowe', wynik?.message || 'Hasło zostało zmienione.');
    } catch (err) {
      Alert.alert('Nie udało się zmienić hasła', err.message);
    } finally {
      setZmianaHasla(false);
    }
  }

  async function wykonajZmianeEmaila() {
    const walidacja = walidujZmianeEmaila(nowyEmail, user?.email);
    if (!walidacja.poprawne) {
      Alert.alert('Sprawdź adres e-mail', walidacja.komunikat);
      return;
    }
    if (!hasloEmail) {
      Alert.alert('Podaj hasło', 'Wpisz hasło, aby potwierdzić zmianę adresu.');
      return;
    }
    setZmianaEmaila(true);
    try {
      const wynik = await zmienEmail(walidacja.email, hasloEmail);
      setNowyEmail(''); setHasloEmail('');
      Alert.alert('Gotowe', wynik?.message || 'Adres e-mail został zmieniony.');
    } catch (err) {
      Alert.alert('Nie udało się zmienić adresu', err.message);
    } finally {
      setZmianaEmaila(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.sectionTitle}>Zmiana hasła</Text>
      <Text style={styles.sectionHint}>
        Po zmianie hasła pozostałe urządzenia zostaną wylogowane — ten telefon działa dalej.
      </Text>
      <TextField
        label="Aktualne hasło"
        value={aktualne}
        onChangeText={setAktualne}
        secureTextEntry
        placeholder="••••••••"
      />
      <TextField
        label="Nowe hasło"
        value={nowe}
        onChangeText={setNowe}
        secureTextEntry
        placeholder="min. 8 znaków"
        hint="Minimum 8 znaków."
      />
      <TextField
        label="Powtórz nowe hasło"
        value={powtorz}
        onChangeText={setPowtorz}
        secureTextEntry
        placeholder="••••••••"
        error={powtorz.length > 0 && nowe !== powtorz ? 'Hasła nie są takie same.' : undefined}
      />
      <Button
        title="Zmień hasło"
        onPress={wykonajZmianeHasla}
        loading={zmianaHasla}
        style={styles.gap}
      />

      <View style={styles.separator} />

      <Text style={styles.sectionTitle}>Zmiana adresu e-mail</Text>
      <Text style={styles.sectionHint}>
        Obecny adres: <Text style={styles.emailObecny}>{user?.email || '—'}</Text>.
        Na nowy adres logujesz się od razu po zmianie.
      </Text>
      <TextField
        label="Nowy adres e-mail"
        value={nowyEmail}
        onChangeText={setNowyEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="nowy@firma.pl"
      />
      <TextField
        label="Hasło (potwierdzenie)"
        value={hasloEmail}
        onChangeText={setHasloEmail}
        secureTextEntry
        placeholder="••••••••"
      />
      <Button
        title="Zmień adres e-mail"
        onPress={wykonajZmianeEmaila}
        loading={zmianaEmaila}
        style={styles.gap}
      />
    </Screen>
  );
}

const tworzStyleBezpieczenstwa = tworzStyle((k) => ({
  sectionTitle: { fontSize: 18, fontWeight: '800', color: k.text, marginBottom: spacing.xs },
  sectionHint: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  emailObecny: { fontWeight: '700', color: k.text },
  gap: { marginTop: spacing.md },
  separator: {
    height: 1,
    backgroundColor: k.border,
    marginVertical: spacing.xl,
    borderRadius: radius.sm,
  },
}));
