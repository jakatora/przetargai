import { View, Text, TextInput } from 'react-native';
import { radius, spacing } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Pole tekstowe z etykietą, podpowiedzią i obsługą błędu walidacji.
 * `inputStyle` (opcjonalny) dokłada style do samego pola — np. wyższy obszar
 * dla wieloliniowego wklejania; `style` wciąż stylizuje kontener.
 */
export default function TextField({ label, hint, error, style, inputStyle, ...inputProps }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePola);
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, error && styles.inputError, inputStyle]}
        placeholderTextColor={kolory.textMuted}
        accessibilityLabel={label}
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
  label: { fontSize: 14, fontWeight: '600', color: k.text, marginBottom: 6 },
  input: {
    backgroundColor: k.surface,
    borderWidth: 1.5,
    borderColor: k.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: k.text,
  },
  inputError: { borderColor: k.danger },
  hint: { fontSize: 12, color: k.textMuted, marginTop: 4 },
  error: { fontSize: 12, color: k.danger, marginTop: 4 },
}));
