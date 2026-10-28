import { useState, useMemo } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius, typografia, DOTYK } from '../theme';
import Ikona from '../components/Ikona';
import { KATALOG_NARZEDZI } from '../lib/narzedziaKatalog';

/**
 * „NARZĘDZIA" (hub) — jeden katalog wszystkich narzędzi apki, pogrupowany wg fazy pracy,
 * z wyszukiwarką. Przy ~30 narzędziach rozsypanych po ekranach to jedyny sposób, żeby je
 * odnaleźć. Dane: lib/narzedziaKatalog.js.
 */
function pasuje(n, fraza) {
  if (!fraza) return true;
  const t = (n.tytul + ' ' + (n.opis || '')).toLowerCase();
  return t.includes(fraza.toLowerCase());
}

export default function NarzedziaScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleNarzedzi);
  const [szukaj, setSzukaj] = useState('');

  const kategorie = useMemo(
    () => KATALOG_NARZEDZI
      .map((k) => ({ ...k, narzedzia: k.narzedzia.filter((n) => pasuje(n, szukaj.trim())) }))
      .filter((k) => k.narzedzia.length),
    [szukaj],
  );
  /*
   * Tłumaczymy CHROME ekranu, a nie katalog narzędzi — i to jest decyzja, nie
   * zaniechanie. Te narzędzia generują polskie pisma z Pzp (wezwania, odwołania,
   * zastrzeżenia tajemnicy). Angielska etykieta nad generatorem, który wypluwa
   * polski dokument prawny, wprowadzałaby w błąd mocniej, niż pomaga.
   */
  const { t } = useJezyk();


  const liczba = KATALOG_NARZEDZI.reduce((s, k) => s + k.narzedzia.length, 0);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        {t(
          `${liczba} narzędzi do prowadzenia przetargów — od decyzji „startować?" po odzyskanie zapłaty.`,
          `${liczba} tools for running tenders — from „should I bid?" to getting paid. The tools themselves work in Polish.`,
        )}
      </Text>

      <View style={styles.szukajRzad}>
        <Ikona nazwa="szukaj" rozmiar={18} kolor={kolory.textMuted} />
        <TextInput
          style={styles.szukajPole}
          value={szukaj}
          onChangeText={setSzukaj}
          placeholder={t('Szukaj narzędzia (np. wadium, termin, cena)', 'Search tools (e.g. bid bond, deadline, price)')}
          placeholderTextColor={kolory.textMuted}
          autoCorrect={false}
          accessibilityLabel={t('Szukaj narzędzia', 'Search tools')}
        />
        {szukaj ? (
          <Pressable accessibilityRole="button" onPress={() => setSzukaj('')} hitSlop={10} style={styles.szukajX} accessibilityLabel={t('Wyczyść', 'Clear')}>
            <Ikona nazwa="zamknij" rozmiar={16} kolor={kolory.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {kategorie.length === 0 ? (
        <Text style={styles.pusto}>{t(`Brak narzędzia dla „${szukaj}". Zmień frazę.`, `No tool matches „${szukaj}". Try another phrase.`)}</Text>
      ) : (
        kategorie.map((k) => (
          <View key={k.kategoria} style={styles.kategoria}>
            <Text style={styles.kategoriaTytul}>{k.kategoria}</Text>
            <View style={styles.karta}>
              {k.narzedzia.map((n, i) => (
                <Pressable
                  key={n.ekran}
                  onPress={() => navigation.navigate(n.ekran)}
                  style={({ pressed }) => [styles.wiersz, i > 0 && styles.wierszGorna, pressed && styles.wierszWcisniety]}
                  accessibilityRole="button"
                  accessibilityLabel={n.tytul}
                >
                  <View style={styles.wierszTresc}>
                    <Text style={styles.wierszTytul}>{n.tytul}</Text>
                    {n.opis ? <Text style={styles.wierszOpis}>{n.opis}</Text> : null}
                  </View>
                  <Ikona nazwa="dalej" rozmiar={16} kolor={kolory.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}

      <Text style={styles.stopka}>
        Część narzędzi działa najlepiej otwarta z konkretnego przetargu (wtedy podpowie kontekst) —
        znajdziesz je też w „Narzędzia do tej oferty" w szczegółach przetargu.
      </Text>
    </Screen>
  );
}

const tworzStyleNarzedzi = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  szukajRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.obramowaniePola,
    borderRadius: radius.md, paddingLeft: 12, minHeight: DOTYK + 4, marginBottom: spacing.lg,
  },
  szukajPole: { flex: 1, paddingVertical: 11, fontSize: 15, color: k.text },
  szukajX: { width: DOTYK, height: DOTYK, alignItems: 'center', justifyContent: 'center' },
  pusto: { fontSize: 14, color: k.textMuted, textAlign: 'center', paddingVertical: spacing.xl, fontStyle: 'italic' },

  kategoria: { marginBottom: spacing.lg },
  kategoriaTytul: { ...typografia.sekcja, color: k.text, marginBottom: spacing.sm },
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, overflow: 'hidden' },
  wiersz: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: DOTYK + 8, paddingVertical: 12, paddingHorizontal: spacing.md },
  wierszWcisniety: { backgroundColor: k.powierzchniaWtorna },
  wierszGorna: { borderTopWidth: 1, borderTopColor: k.border },
  wierszTresc: { flex: 1 },
  wierszTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  wierszOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
