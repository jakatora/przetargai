import { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Pole tekstowe z etykietą, podpowiedzią i obsługą błędu walidacji.
 * `inputStyle` (opcjonalny) dokłada style do samego pola — np. wyższy obszar
 * dla wieloliniowego wklejania; `style` wciąż stylizuje kontener.
 */
export default function TextField({ label, hint, error, style, inputStyle, onFocus, onBlur, ...inputProps }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePola);
  // Widoczny stan fokusu (niebieska ramka) — ważny przy klawiaturze na webie i Windows.
  const [fokus, setFokus] = useState(false);
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, fokus && styles.inputFokus, error && styles.inputError, inputStyle]}
        placeholderTextColor={kolory.textMuted}
        accessibilityLabel={label}
        onFocus={(e) => { setFokus(true); onFocus?.(e); }}
        onBlur={(e) => { setFokus(false); onBlur?.(e); }}
        {...inputProps}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const tworzStylePola = tworzStyle((k) => ({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '700', color: k.text, marginBottom: 6 },
  input: {
    minHeight: 50,
    backgroundColor: k.surface,
    borderWidth: 1.5,
    borderColor: k.obramowaniePola,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: k.text,
  },
  inputFokus: { borderColor: k.blue, borderWidth: 2, paddingHorizontal: 13.5 },
  inputError: { borderColor: k.danger },
  hint: { fontSize: 13, color: k.textMuted, marginTop: 6, lineHeight: 18 },
  error: { fontSize: 13, color: k.danger, marginTop: 6, lineHeight: 18, fontWeight: '600' },
}));
