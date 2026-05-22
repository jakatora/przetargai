import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { colors, spacing, radius } from '../theme';

function parseList(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function AccountScreen() {
  const { user, signOut, refreshUser, setUser } = useAuth();
  const [keywords, setKeywords] = useState((user.keywords || []).join(', '));
  const [cpv, setCpv] = useState((user.cpv_codes || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const isStandard = user.premium_tier === 'standard';

  async function handleSave() {
    setSaving(true);
    try {
      const data = await api.updateProfile({
        keywords: parseList(keywords),
        cpv_codes: parseList(cpv),
      });
      setUser(data.user);
      Alert.alert('Zapisano', 'Profil firmy został zaktualizowany.');
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const link = await api.createUpgradeLink();
      await WebBrowser.openBrowserAsync(link.url);
      // Po powrocie z przeglądarki odświeżamy plan (webhook mógł go zmienić).
      await refreshUser();
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setUpgrading(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Wylogowanie', 'Czy na pewno chcesz się wylogować?', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Wyloguj', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <Screen scroll>
      <View style={styles.card}>
        <Text style={styles.company}>{user.company_name}</Text>
        <Text style={styles.muted}>NIP: {user.company_nip}</Text>
        <Text style={styles.muted}>{user.email}</Text>
        <View style={[styles.badge, isStandard ? styles.badgeStandard : styles.badgeFree]}>
          <Text style={styles.badgeText}>Plan {isStandard ? 'Standard' : 'Free'}</Text>
        </View>
      </View>

      {isStandard ? (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>Plan Standard aktywny ✓</Text>
          <Text style={styles.upgradeText}>
            Masz nielimitowane dopasowania przetargów oraz powiadomienia push.
          </Text>
        </View>
      ) : (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>Przejdź na Standard</Text>
          <Text style={styles.upgradeText}>
            Nielimitowane dopasowania i powiadomienia push o nowych przetargach
            — 199 zł / miesiąc netto.
          </Text>
          <Button
            title="Przejdź na Standard"
            onPress={handleUpgrade}
            loading={upgrading}
            style={styles.gap}
          />
        </View>
      )}

      <Text style={styles.sectionTitle}>Profil firmy</Text>
      <Text style={styles.sectionHint}>
        Na podstawie tych danych AI dopasowuje przetargi do Twojej firmy.
      </Text>
      <TextField
        label="Słowa kluczowe"
        value={keywords}
        onChangeText={setKeywords}
        placeholder="remont, budowa drogi, instalacje"
        hint="Po przecinku"
        multiline
      />
      <TextField
        label="Kody CPV"
        value={cpv}
        onChangeText={setCpv}
        placeholder="45000000, 45300000"
        hint="Po przecinku"
      />
      <Button title="Zapisz profil" onPress={handleSave} loading={saving} />

      <View style={styles.signOut}>
        <Button title="Wyloguj się" variant="ghost" onPress={confirmSignOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  company: { fontSize: 19, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeFree: { backgroundColor: '#e7ebf3' },
  badgeStandard: { backgroundColor: '#dcfce7' },
  badgeText: { fontSize: 13, fontWeight: '700', color: colors.text },
  upgradeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.blue,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  upgradeTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  upgradeText: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 21 },
  gap: { marginTop: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sectionHint: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },
  signOut: { marginTop: spacing.lg, marginBottom: spacing.xl },
});
