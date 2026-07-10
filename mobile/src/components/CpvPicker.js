import { useMemo, useState } from 'react';
import {
  View, Text, Modal, TextInput, FlatList, Pressable,
} from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import {
  KATALOG_CPV, kodyZTekstu, przelaczKod, szukajWKatalogu,
} from '../lib/cpvKatalog';
import Button from './Button';

/**
 * Ściąga kodów CPV. Jedno źródło prawdy to TEKST pola profilu (`wartosc`):
 * tap na pozycji od razu woła `onChange(przelaczKod(...))`, więc modal nie
 * trzyma własnej kopii zaznaczeń i nie może się z polem rozjechać.
 */
export default function CpvPicker({ widoczny, onClose, wartosc, onChange }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSciagi);
  const [zapytanie, setZapytanie] = useState('');
  const zaznaczone = useMemo(() => new Set(kodyZTekstu(wartosc)), [wartosc]);

  const pozycje = useMemo(() => {
    const wyniki = szukajWKatalogu(zapytanie);
    if (wyniki === null) {
      // Cały katalog: dział jako nagłówek sekcji + jego pozycje.
      return KATALOG_CPV.flatMap((dzial) => [
        { typ: 'dzial', kod: dzial.kod, nazwa: dzial.nazwa },
        ...(dzial.dzieci ?? []).map((d) => ({ typ: 'kod', kod: d.kod, nazwa: d.nazwa })),
      ]);
    }
    return wyniki.map((w) => ({ typ: 'kod', kod: w.kod, nazwa: w.nazwa }));
  }, [zapytanie]);

  function renderPozycja({ item }) {
    const wybrany = zaznaczone.has(item.kod);
    return (
      <Pressable
        onPress={() => onChange(przelaczKod(wartosc, item.kod))}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: wybrany }}
        accessibilityLabel={`${item.nazwa}, kod ${item.kod}`}
        style={({ pressed }) => [
          styles.wiersz,
          item.typ === 'dzial' && styles.wierszDzialu,
          pressed && styles.wierszWcisniety,
        ]}
      >
        <View style={[styles.kratka, wybrany && styles.kratkaWybrana]}>
          {wybrany ? <Text style={styles.ptaszek}>✓</Text> : null}
        </View>
        <View style={styles.opis}>
          <Text style={[styles.nazwa, item.typ === 'dzial' && styles.nazwaDzialu]}>
            {item.nazwa}
          </Text>
          <Text style={styles.kod}>{item.kod}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Modal visible={widoczny} animationType="slide" onRequestClose={onClose}>
      <View style={styles.ekran}>
        <View style={styles.naglowek}>
          <Text style={styles.tytul}>Ściąga kodów CPV</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Zamknij ściągę">
            <Text style={styles.zamknij}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.podtytul}>
          Zaznacz, czym się zajmujesz — kod ogólny (dział) łapie szeroko,
          węższy daje pewniejsze dopasowania. Nazwy uproszczone.
        </Text>

        <TextInput
          style={styles.szukaj}
          value={zapytanie}
          onChangeText={setZapytanie}
          placeholder="Szukaj: malowanie, meble, 4531…"
          placeholderTextColor={kolory.textMuted}
          autoCorrect={false}
          accessibilityLabel="Szukaj w katalogu CPV"
        />

        <FlatList
          data={pozycje}
          keyExtractor={(item) => item.kod}
          renderItem={renderPozycja}
          style={styles.lista}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <Text style={styles.pusto}>
              Nic nie znaleziono. Spróbuj prościej (np. „sprzątanie", „drogi")
              albo zostaw pole CPV puste — słowa kluczowe też działają.
            </Text>
          )}
        />

        <View style={styles.stopka}>
          <Button
            title={zaznaczone.size > 0 ? `Gotowe (${zaznaczone.size})` : 'Gotowe'}
            onPress={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

const tworzStyleSciagi = tworzStyle((k) => ({
  ekran: { flex: 1, backgroundColor: k.bg, paddingTop: spacing.lg },
  naglowek: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  zamknij: { fontSize: 22, color: k.textMuted, fontWeight: '600' },
  podtytul: {
    fontSize: 13,
    color: k.textMuted,
    lineHeight: 19,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  szukaj: {
    backgroundColor: k.surface,
    borderWidth: 1.5,
    borderColor: k.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: k.text,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  lista: { flex: 1, marginTop: spacing.sm },
  wiersz: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: k.bg,
  },
  wierszDzialu: { backgroundColor: k.wyroznienie, marginTop: spacing.sm },
  wierszWcisniety: { opacity: 0.6 },
  kratka: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: k.border,
    backgroundColor: k.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm + 4,
  },
  kratkaWybrana: { backgroundColor: k.blue, borderColor: k.blue },
  ptaszek: { color: k.white, fontSize: 14, fontWeight: '800', lineHeight: 16 },
  opis: { flex: 1 },
  nazwa: { fontSize: 15, color: k.text },
  nazwaDzialu: { fontWeight: '700' },
  kod: { fontSize: 12, color: k.textMuted, marginTop: 1, fontVariant: ['tabular-nums'] },
  pusto: {
    color: k.textMuted,
    fontSize: 14,
    lineHeight: 20,
    padding: spacing.lg,
    textAlign: 'center',
  },
  stopka: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: k.border,
    backgroundColor: k.surface,
  },
}));
