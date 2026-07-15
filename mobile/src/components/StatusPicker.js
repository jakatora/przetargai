import { View, Text, Pressable } from 'react-native';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { STATUSY } from '../lib/statusPrzetargu';
import { spacing, radius } from '../theme';

/**
 * Wybór etapu pracy nad przetargiem (D-054). Chipy w rzędzie zawijanym.
 * `onChange(wartosc)` woła rodzic (optymistyczna aktualizacja + zapis w API).
 */
export default function StatusPicker({ wartosc, onChange, disabled }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleStatus);
  return (
    <View style={styles.rzad} accessibilityRole="radiogroup">
      {STATUSY.map((s) => {
        const aktywny = s.wartosc === wartosc;
        return (
          <Pressable
            key={s.wartosc}
            onPress={() => !disabled && onChange(s.wartosc)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: aktywny }}
            style={[styles.chip, aktywny && { backgroundColor: kolory.blue, borderColor: kolory.blue }]}
          >
            <Text style={[styles.tekst, aktywny && styles.tekstAktywny]}>{s.etykieta}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tworzStyleStatus = tworzStyle((k) => ({
  rzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill ?? 999,
    borderWidth: 1, borderColor: k.border, backgroundColor: k.surface,
  },
  tekst: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  tekstAktywny: { color: k.surface },
}));
