import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme';
import { useStyle, tworzStyle } from '../context/ThemeContext';

/**
 * Spójny kontener ekranu. `scroll` włącza przewijanie + unikanie klawiatury.
 * `stopka` (2026-11-10) — pasek przyklejony pod przewijaną treścią (np. „Biorę / Nie dla nas” w szczegółach
 * przetargu), z marginesem na dolną krawędź telefonu.
 */
export default function Screen({ children, scroll = false, style, contentStyle, stopka = null, refreshControl }) {
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
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
        {stopka ? <Stopka styles={styles}>{stopka}</Stopka> : null}
      </KeyboardAvoidingView>
    );
  }
  return <View style={[styles.flex, styles.content, style]}>{children}</View>;
}

function Stopka({ styles, children }) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.stopka, { paddingBottom: spacing.sm + bottom }]}>
      <View style={styles.stopkaKolumna}>{children}</View>
    </View>
  );
}

const tworzStyleEkranu = tworzStyle((k) => ({
  flex: { flex: 1, backgroundColor: k.bg },
  // Szerokie okno (web, Windows, tablet): treść w czytelnej kolumnie zamiast od krawędzi do krawędzi.
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  stopka: { backgroundColor: k.surface, borderTopWidth: 1, borderTopColor: k.border, paddingTop: spacing.sm, paddingHorizontal: spacing.lg },
  stopkaKolumna: { width: '100%', maxWidth: 760, alignSelf: 'center' },
}));
