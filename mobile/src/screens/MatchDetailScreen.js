import { useState } from 'react';
import { View, Text, StyleSheet, Alert, Linking } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { ScoreBadge } from '../components/MatchCard';
import { colors, spacing, radius } from '../theme';
import { formatDate, formatBudget, daysUntil } from '../lib/format';

function Row({ label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function MatchDetailScreen({ route }) {
  const { match } = route.params;
  const tender = match.tender;
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);

  const budget = formatBudget(tender.budget, tender.currency);
  const days = daysUntil(tender.deadline);
  const deadlineText = formatDate(tender.deadline)
    + (days !== null && days >= 0 ? `  ·  za ${days} dni` : '');

  async function handleFeedback(helpful) {
    setSending(true);
    try {
      await api.sendFeedback(match.id, helpful);
      setFeedback(helpful ? 'up' : 'down');
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setSending(false);
    }
  }

  async function openInBzp() {
    if (!tender.url) return;
    try {
      const canOpen = await Linking.canOpenURL(tender.url);
      if (canOpen) await Linking.openURL(tender.url);
      else Alert.alert('Nie można otworzyć linku', tender.url);
    } catch {
      Alert.alert('Nie można otworzyć linku', tender.url);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <ScoreBadge score={match.confidence_score} size="lg" />
        <Text style={styles.title}>{tender.title}</Text>
      </View>

      <View style={styles.card}>
        <Row label="Zamawiający" value={tender.organization || 'brak danych'} />
        <Row label="Termin składania ofert" value={deadlineText} />
        {budget ? <Row label="Szacowana wartość" value={budget} /> : null}
        <Row label="Kod CPV" value={tender.cpv || 'brak danych'} last />
      </View>

      <Text style={styles.sectionTitle}>Dlaczego to dopasowanie?</Text>
      <View style={styles.card}>
        <Text style={styles.reasoning}>{match.reasoning || 'Brak uzasadnienia.'}</Text>
      </View>

      {tender.url ? (
        <Button
          title="Otwórz ogłoszenie w BZP"
          onPress={openInBzp}
          style={styles.gap}
        />
      ) : null}

      <Text style={styles.sectionTitle}>Czy to dopasowanie było trafne?</Text>
      {feedback ? (
        <Text style={styles.feedbackDone}>
          {feedback === 'up'
            ? 'Dziękujemy! Cieszymy się, że trafione.'
            : 'Dziękujemy za informację — wykorzystamy ją do poprawy dopasowań.'}
        </Text>
      ) : (
        <View style={styles.feedbackRow}>
          <Button
            title="👍 Trafne"
            variant="ghost"
            onPress={() => handleFeedback(true)}
            loading={sending}
            style={styles.feedbackBtn}
          />
          <Button
            title="👎 Nietrafne"
            variant="ghost"
            onPress={() => handleFeedback(false)}
            loading={sending}
            style={styles.feedbackBtn}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text, lineHeight: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: '600' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reasoning: { fontSize: 15, color: colors.text, lineHeight: 22 },
  gap: { marginTop: spacing.lg },
  feedbackRow: { flexDirection: 'row', gap: spacing.md },
  feedbackBtn: { flex: 1 },
  feedbackDone: { fontSize: 14, color: colors.green, fontWeight: '600' },
});
