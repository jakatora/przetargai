import { Pressable, View, Text } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { formatDate } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { opisWadium } from '../lib/wadium';

/** Przycisk zakładki — ★ zapisany (brand), ☆ do zapisania. Nie nawiguje. */
export function SaveStar({ tenderId, styles, kolory }) {
  const { isSaved, toggle } = useSaved();
  const zapisany = isSaved(tenderId);
  return (
    <Pressable
      onPress={() => { toggle(tenderId).catch(() => {}); }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityState={{ selected: zapisany }}
      accessibilityLabel={zapisany ? 'Usuń z zapisanych' : 'Zapisz przetarg'}
      style={styles.gwiazdka}
    >
      <Text style={[styles.gwiazdkaZnak, { color: zapisany ? kolory.blue : kolory.textMuted }]}>
        {zapisany ? '★' : '☆'}
      </Text>
    </Pressable>
  );
}

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

/** Karta dopasowanego przetargu na liście. `nowe` = dodany po ostatniej wizycie. */
export default function MatchCard({ match, onPress, nowe = false }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const tender = match.tender;
  /*
   * Przetargi po terminie zostają w feedzie (to historia użytkownika), ale muszą
   * być jawnie odróżnialne — inaczej ktoś szykuje ofertę na zamknięte postępowanie.
   * Pilne (do tygodnia) wyróżniamy, bo w tym produkcie liczy się czas reakcji.
   */
  const termin = opisTerminu(tender.deadline);
  const wadium = opisWadium(tender);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, termin.minal && styles.kartaMiniona]}
      accessibilityRole="button"
      accessibilityLabel={`${tender.title}. Dopasowanie ${match.confidence_score} procent. ${termin.etykieta}.`}
    >
      <SaveStar tenderId={tender.id} styles={styles} kolory={kolory} />
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
          <View style={styles.znacznikiRzad}>
            {nowe ? <Text style={styles.noweChip}>NOWE</Text> : null}
            <Text
              style={[
                styles.znacznik,
                termin.minal && styles.znacznikMiniony,
                termin.pilny && styles.znacznikPilny,
              ]}
            >
              {termin.etykieta}
            </Text>
            {wadium ? (
              <Text style={[styles.wadiumChip, wadium.ostrzezenie ? styles.wadiumChipWymaga : styles.wadiumChipBez]}>
                {wadium.ostrzezenie ? `Wadium ${wadium.wartosc}` : 'Bez wadium'}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  kartaMiniona: { opacity: 0.55 },
  znacznik: {
    fontSize: 12,
    fontWeight: '700',
    color: k.textMuted,
  },
  znacznikPilny: { color: k.ostrzezenieTekst },
  znacznikMiniony: { color: k.danger },
  noweChip: {
    fontSize: 11,
    fontWeight: '800',
    color: k.white,
    backgroundColor: k.blue,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
    letterSpacing: 0.5,
  },
  znacznikiRzad: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  wadiumChip: { fontSize: 11, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  wadiumChipWymaga: { backgroundColor: k.ostrzezenieTlo ?? '#fef3c7', color: k.ostrzezenieTekst },
  wadiumChipBez: { backgroundColor: (k.green ?? '#16a34a') + '22', color: k.green ?? '#16a34a' },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.7 },
  gwiazdka: { position: 'absolute', top: 6, right: 8, zIndex: 2, padding: 4 },
  gwiazdkaZnak: { fontSize: 22, lineHeight: 24, fontWeight: '700' },
  row: { flexDirection: 'row', gap: spacing.md, paddingRight: 26 },
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
