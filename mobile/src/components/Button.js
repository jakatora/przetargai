import { Pressable, Text, ActivityIndicator } from 'react-native';
import { radius } from '../theme';
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
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? kolory.white : kolory.blue} />
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
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: k.blue },
  ghost: { backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.border },
  danger: { backgroundColor: k.danger },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: { fontSize: 16, fontWeight: '700' },
  textLight: { color: k.white },
  textBlue: { color: k.blue },
}));
