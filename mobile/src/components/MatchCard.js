import { Pressable, View, Text } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { formatDate } from '../lib/format';
import { opisTerminu } from '../lib/termin';

/** Kolorowy znacznik wyniku dopasowania (0–100). */
export function ScoreBadge({ score, size = 'md' }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const color = score >= 80 ? kolory.green : score >= 60 ? kolory.blue : kolory.textMuted;
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
  const styles = useStyle(tworzStyleKarty);
  const tender = match.tender;
  /*
   * Przetargi po terminie zostają w feedzie (to historia użytkownika), ale muszą
   * być jawnie odróżnialne — inaczej ktoś szykuje ofertę na zamknięte postępowanie.
   * Pilne (do tygodnia) wyróżniamy, bo w tym produkcie liczy się czas reakcji.
   */
  const termin = opisTerminu(tender.deadline);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, termin.minal && styles.kartaMiniona]}
      accessibilityRole="button"
      accessibilityLabel={`${tender.title}. Dopasowanie ${match.confidence_score} procent. ${termin.etykieta}.`}
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
          <Text
            style={[
              styles.znacznik,
              termin.minal && styles.znacznikMiniony,
              termin.pilny && styles.znacznikPilny,
            ]}
          >
            {termin.etykieta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  kartaMiniona: { opacity: 0.55 },
  znacznik: {
    marginTop: spacing.xs,
    fontSize: 12,
    fontWeight: '700',
    color: k.textMuted,
  },
  znacznikPilny: { color: k.ostrzezenieTekst },
  znacznikMiniony: { color: k.danger },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
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
  scoreNum: { color: k.white, fontWeight: '800', fontSize: 18 },
  scoreNumBig: { fontSize: 26 },
  scorePct: { color: k.white, fontSize: 8, fontWeight: '600', textAlign: 'center' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: k.text },
  org: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  deadline: { fontSize: 12, color: k.textMuted, marginTop: 6 },
}));
