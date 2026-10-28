import { View, Text, Pressable } from 'react-native';
import Ikona from './Ikona';
import { spacing, DOTYK } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Wiersz listy akcji (narzędzia, ustawienia): tytuł, opcjonalny opis i strzałka „dalej".
 * Zastępuje kolumny przycisków-duchów — lista wierszy w jednej karcie czyta się szybciej
 * i zajmuje połowę miejsca. Ostatni wiersz w karcie dostaje `ostatni` (bez linii pod spodem).
 */
export default function WierszAkcji({ tytul, opis, onPress, ostatni = false, niebezpieczny = false, prawo }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWiersza);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={opis ? `${tytul}. ${opis}` : tytul}
      style={({ pressed }) => [styles.wiersz, !ostatni && styles.linia, pressed && styles.wcisniety]}
    >
      <View style={styles.tresc}>
        <Text style={[styles.tytul, niebezpieczny && { color: kolory.danger }]}>{tytul}</Text>
        {opis ? <Text style={styles.opis}>{opis}</Text> : null}
      </View>
      {prawo ?? <Ikona nazwa="dalej" rozmiar={16} kolor={kolory.textMuted} />}
    </Pressable>
  );
}

const tworzStyleWiersza = tworzStyle((k) => ({
  wiersz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: DOTYK + 8,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  linia: { borderBottomWidth: 1, borderBottomColor: k.border },
  wcisniety: { backgroundColor: k.powierzchniaWtorna },
  tresc: { flex: 1 },
  tytul: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: k.text },
  opis: { fontSize: 13, lineHeight: 18, color: k.textMuted, marginTop: 2 },
}));
