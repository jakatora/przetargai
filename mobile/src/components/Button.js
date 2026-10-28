import { Pressable, Text, ActivityIndicator } from 'react-native';
import { radius, DOTYK } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Przycisk z wariantami: primary | ghost | danger. Obsługuje stan ładowania.
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePrzycisku);
  const isDisabled = disabled || loading;
  const solid = variant === 'primary' || variant === 'danger';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        pressed && !isDisabled && (solid ? styles.pressedSolid : styles.pressedGhost),
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? kolory.naAkcencie : kolory.blue} />
      ) : (
        <Text style={[styles.text, solid ? styles.textLight : styles.textBlue]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const tworzStylePrzycisku = tworzStyle((k) => ({
  base: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: DOTYK,
  },
  primary: { backgroundColor: k.blue },
  ghost: { backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.border },
  danger: { backgroundColor: k.danger },
  // Wciśnięcie: lekkie przygaszenie i zmniejszenie (bez zmiany wymiarów w układzie).
  pressedSolid: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  pressedGhost: { backgroundColor: k.wyroznienie, borderColor: k.blue, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  text: { fontSize: 16, fontWeight: '700', textAlign: 'center', letterSpacing: -0.1 },
  textLight: { color: k.naAkcencie },
  textBlue: { color: k.blue },
}));
