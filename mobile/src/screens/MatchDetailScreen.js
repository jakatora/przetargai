import { useState } from 'react';
import { View, Text, Alert, Linking } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { ScoreBadge } from '../components/MatchCard';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { opisOceny, opisTerminu } from '../lib/termin';
import { opisCpv } from '../lib/cpv';
import { formatDate, formatBudget } from '../lib/format';

function Row({ styles, label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function MatchDetailScreen({ route }) {
  const styles = useStyle(tworzStyleSzczegolow);
  const { match } = route.params;
  const tender = match.tender;
  const ocena = opisOceny(match.scorer);
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);

  const budget = formatBudget(tender.budget, tender.currency);
  const cpv = opisCpv(tender.cpv);
  // Jedno źródło prawdy o terminie — wcześniej `daysUntil` nie odróżniał
  // terminu minionego od nieznanego i po prostu nic nie pokazywał.
  const termin = opisTerminu(tender.deadline);
  const deadlineText = `${formatDate(tender.deadline)}  ·  ${termin.etykieta}`;

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
        <Row styles={styles} label="Zamawiający" value={tender.organization || 'brak danych'} />
        <Row styles={styles} label="Termin składania ofert" value={deadlineText} />
        {budget ? <Row styles={styles} label="Szacowana wartość" value={budget} /> : null}
        <Row styles={styles} label={cpv.etykieta} value={cpv.wartosc} last />
      </View>

      <Text style={styles.sectionTitle}>Dlaczego to dopasowanie?</Text>
      <View style={styles.card}>
        <Text style={styles.reasoning}>{match.reasoning || 'Brak uzasadnienia.'}</Text>
        {/*
          Backend zapisuje, czy ocenił model, czy sama heurystyka — ale aplikacja
          tego nie pokazywała. Mechaniczne trafienie w słowo kluczowe wyglądało
          identycznie jak ocena AI (audyt 2026-07-10). To kwestia zaufania:
          użytkownik ma prawo wiedzieć, na czym opiera się liczba na karcie.
        */}
        <View style={styles.zrodloOceny}>
          <Text style={styles.zrodloEtykieta}>{ocena.etykieta}</Text>
          <Text style={styles.zrodloOpis}>{ocena.opis}</Text>
        </View>
      </View>

      {tender.url ? (
        <Button
          // Od D-039 ogłoszenia płyną z wielu źródeł — etykieta mówi, DOKĄD prowadzi link.
          title={`Otwórz ogłoszenie w ${tender.source === 'ted' ? 'TED (UE)' : 'BZP'}`}
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

const tworzStyleSzczegolow = tworzStyle((k) => ({
  zrodloOceny: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  zrodloEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue },
  zrodloOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: k.text, lineHeight: 24 },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: k.textMuted, marginBottom: 2 },
  rowValue: { fontSize: 15, color: k.text, fontWeight: '600' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reasoning: { fontSize: 15, color: k.text, lineHeight: 22 },
  gap: { marginTop: spacing.lg },
  feedbackRow: { flexDirection: 'row', gap: spacing.md },
  feedbackBtn: { flex: 1 },
  feedbackDone: { fontSize: 14, color: k.green, fontWeight: '600' },
}));
