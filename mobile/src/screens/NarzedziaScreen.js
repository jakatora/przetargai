import { useState, useMemo } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
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

  const liczba = KATALOG_NARZEDZI.reduce((s, k) => s + k.narzedzia.length, 0);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>{liczba} narzędzi do prowadzenia przetargów — od decyzji „startować?" po odzyskanie zapłaty.</Text>

      <View style={styles.szukajRzad}>
        <Text style={styles.szukajIkona}>🔍</Text>
        <TextInput
          style={styles.szukajPole}
          value={szukaj}
          onChangeText={setSzukaj}
          placeholder="Szukaj narzędzia (np. wadium, termin, cena)"
          placeholderTextColor={kolory.textMuted}
          autoCorrect={false}
          accessibilityLabel="Szukaj narzędzia"
        />
        {szukaj ? (
          <Pressable onPress={() => setSzukaj('')} hitSlop={10} accessibilityLabel="Wyczyść">
            <Text style={styles.szukajX}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {kategorie.length === 0 ? (
        <Text style={styles.pusto}>Brak narzędzia dla „{szukaj}". Zmień frazę.</Text>
      ) : (
        kategorie.map((k) => (
          <View key={k.kategoria} style={styles.kategoria}>
            <Text style={styles.kategoriaTytul}>{k.kategoria}</Text>
            <View style={styles.karta}>
              {k.narzedzia.map((n, i) => (
                <Pressable
                  key={n.ekran}
                  onPress={() => navigation.navigate(n.ekran)}
                  style={[styles.wiersz, i > 0 && styles.wierszGorna]}
                  accessibilityRole="button"
                  accessibilityLabel={n.tytul}
                >
                  <View style={styles.wierszTresc}>
                    <Text style={styles.wierszTytul}>{n.tytul}</Text>
                    {n.opis ? <Text style={styles.wierszOpis}>{n.opis}</Text> : null}
                  </View>
                  <Text style={styles.chevron}>›</Text>
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
    backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.border,
    borderRadius: radius.md, paddingHorizontal: 12, marginBottom: spacing.md,
  },
  szukajIkona: { fontSize: 15 },
  szukajPole: { flex: 1, paddingVertical: 11, fontSize: 15, color: k.text },
  szukajX: { color: k.textMuted, fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },
  pusto: { fontSize: 14, color: k.textMuted, textAlign: 'center', paddingVertical: spacing.xl, fontStyle: 'italic' },

  kategoria: { marginBottom: spacing.lg },
  kategoriaTytul: { fontSize: 13, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, overflow: 'hidden' },
  wiersz: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  wierszGorna: { borderTopWidth: 1, borderTopColor: k.border },
  wierszTresc: { flex: 1 },
  wierszTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  wierszOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  chevron: { fontSize: 22, color: k.textMuted, fontWeight: '300' },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
