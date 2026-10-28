import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { spacing } from '../theme';
import { useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Spójny kontener ekranu. `scroll` włącza przewijanie + unikanie klawiatury.
 */
export default function Screen({ children, scroll = false, style, contentStyle }) {
  const styles = useStyle(tworzStyleEkranu);
  if (scroll) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }
  return <View style={[styles.flex, styles.content, style]}>{children}</View>;
}

const tworzStyleEkranu = tworzStyle((k) => ({
  flex: { flex: 1, backgroundColor: k.bg },
  // Szerokie okno (web, Windows, tablet): treść w czytelnej kolumnie zamiast od krawędzi do krawędzi.
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
}));
