import { Pressable, View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { formatDate } from '../lib/format';

/** Kolorowy znacznik wyniku dopasowania (0–100). */
export function ScoreBadge({ score, size = 'md' }) {
  const color = score >= 80 ? colors.green : score >= 60 ? colors.blue : colors.textMuted;
  const big = size === 'lg';
  return (
    <View
      style={[
        styles.score,
        { backgroundColor: color, width: big ? 72 : 54, height: big ? 72 : 54 },
      ]}
    >
      <Text style={[styles.scoreNum, big && styles.scoreNumBig]}>{score}</Text>
      <Text style={styles.scorePct}>% dopasowania</Text>
    </View>
  );
}

/** Karta dopasowanego przetargu na liście. */
export default function MatchCard({ match, onPress }) {
  const tender = match.tender;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <ScoreBadge score={match.confidence_score} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {tender.title}
          </Text>
          {tender.organization ? (
            <Text style={styles.org} numberOfLines={1}>
              {tender.organization}
            </Text>
          ) : null}
          <Text style={styles.deadline}>
            Termin składania ofert: {formatDate(tender.deadline)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', gap: spacing.md },
  score: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: { color: colors.white, fontWeight: '800', fontSize: 18 },
  scoreNumBig: { fontSize: 26 },
  scorePct: { color: colors.white, fontSize: 8, fontWeight: '600', textAlign: 'center' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  org: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  deadline: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
});
