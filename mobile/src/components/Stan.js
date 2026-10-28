import { View, Text } from 'react-native';
import Button from './Button';
import Ikona from './Ikona';
import { spacing, radius, typografia } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';

/*
 * Trzy wspólne stany ekranu listy (docs/design-system.md → „Stany"):
 *  - ładowanie: szkielet kart w miejscu treści (bez skoku układu po wczytaniu),
 *  - pusto: co się stało + jedna konkretna akcja,
 *  - błąd: co nie wyszło + „Spróbuj ponownie".
 * Ekrany podają własne teksty — komponent pilnuje tylko wyglądu i dostępności.
 */

/** Szkielet listy kart — widoczny zamiast kręciołka, gdy lista się wczytuje. */
export function StanLadowania({ karty = 3, styl }) {
  const styles = useStyle(tworzStyleStanu);
  const { t } = useJezyk();
  return (
    <View
      style={[styles.szkielet, styl]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('Wczytywanie…', 'Loading…')}
    >
      {Array.from({ length: karty }, (_, i) => (
        <View key={i} style={styles.szkieletKarta}>
          <View style={styles.szkieletWynik} />
          <View style={styles.szkieletTresc}>
            <View style={[styles.szkieletLinia, { width: '88%' }]} />
            <View style={[styles.szkieletLinia, { width: '64%' }]} />
            <View style={[styles.szkieletLinia, styles.szkieletLiniaCienka, { width: '40%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Pusty stan: ikona dokumentu, tytuł, opis i opcjonalna akcja (albo własna treść pod spodem). */
export function StanPusty({ tytul, opis, akcja, children, styl }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleStanu);
  return (
    <View style={[styles.srodek, styl]}>
      <View style={styles.ikonaTlo}>
        <Ikona nazwa="dokument" rozmiar={26} kolor={kolory.blue} />
      </View>
      <Text style={styles.tytul} accessibilityRole="header">{tytul}</Text>
      {opis ? <Text style={styles.opis}>{opis}</Text> : null}
      {children}
      {akcja ? <Button title={akcja.tytul} onPress={akcja.onPress} variant={akcja.wariant ?? 'primary'} style={styles.akcja} /> : null}
    </View>
  );
}

/** Błąd wczytania: komunikat i ponowienie. `opis` = treść błędu z API (już po polsku/angielsku). */
export function StanBledu({ tytul, opis, onPonow, styl }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleStanu);
  const { t } = useJezyk();
  return (
    <View style={[styles.srodek, styl]} accessibilityLiveRegion="polite">
      <View style={[styles.ikonaTlo, styles.ikonaTloBlad]}>
        <Ikona nazwa="uwaga" rozmiar={24} kolor={kolory.ostrzezenieAkcent} />
      </View>
      <Text style={styles.tytul} accessibilityRole="header">{tytul}</Text>
      {opis ? <Text style={styles.opis}>{opis}</Text> : null}
      {onPonow ? (
        <Button title={t('Spróbuj ponownie', 'Try again')} onPress={onPonow} variant="ghost" style={styles.akcja} />
      ) : null}
    </View>
  );
}

const tworzStyleStanu = tworzStyle((k) => ({
  szkielet: { padding: spacing.lg, gap: spacing.md },
  szkieletKarta: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  szkieletWynik: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: k.neutralneTlo },
  szkieletTresc: { flex: 1, gap: 10, paddingTop: 4 },
  szkieletLinia: { height: 12, borderRadius: 6, backgroundColor: k.neutralneTlo },
  szkieletLiniaCienka: { height: 10 },
  srodek: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  ikonaTlo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: k.wyroznienie,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ikonaTloBlad: { backgroundColor: k.ostrzezenieTlo },
  tytul: { ...typografia.sekcja, color: k.text, textAlign: 'center' },
  opis: { ...typografia.tresc, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm },
  akcja: { marginTop: spacing.lg, alignSelf: 'stretch' },
}));
