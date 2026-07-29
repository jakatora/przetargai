import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { zbudujAgende } from '../lib/agendaTerminow';

/**
 * „KALENDARZ TERMINÓW" — chronologiczna oś terminów składania ofert z ZAPISANYCH
 * przetargów, pogrupowana wg pilności. Kto prowadzi kilka ofert naraz, widzi jednym
 * rzutem oka „co i kiedy". Całe grupowanie/sortowanie żyje w testowanym lib/agendaTerminow.js.
 */
export default function KalendarzTerminowScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleAgendy);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);

  const wczytaj = useCallback(async () => {
    try {
      const d = await api.getSaved();
      setSaved(d.saved || []);
    } catch {
      /* offline — zostaje ostatnia lista */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  const { grupy, licznik } = zbudujAgende(saved);

  const kolorGrupy = (klucz) => {
    if (klucz === 'poTerminie') return kolory.danger;
    if (klucz === 'dzis') return kolory.ostrzezenieTekst;
    if (klucz === 'tydzien') return kolory.blue;
    return kolory.textMuted;
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>;
  }

  if (!licznik) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📅</Text>
        <Text style={styles.emptyTitle}>Brak terminów do pokazania</Text>
        <Text style={styles.emptyText}>
          Zapisz przetargi gwiazdką — te z terminem składania ofert ułożymy tu
          chronologicznie, żebyś jednym rzutem oka widział, co i kiedy Cię czeka.
        </Text>
      </View>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        {licznik} {licznik === 1 ? 'termin' : 'terminów'} z zapisanych przetargów — od najbliższego.
      </Text>

      {grupy.map((g) => (
        <View key={g.klucz} style={styles.grupa}>
          <View style={styles.grupaNaglowek}>
            <View style={[styles.kropka, { backgroundColor: kolorGrupy(g.klucz) }]} />
            <Text style={styles.grupaTytul}>{g.etykieta}</Text>
            <Text style={styles.grupaLicznik}>{g.pozycje.length}</Text>
          </View>

          {g.pozycje.map((p) => (
            <Pressable
              key={p.id}
              style={styles.karta}
              onPress={() => navigation.navigate('MatchDetail', { match: p.zrodlo })}
              accessibilityRole="button"
              accessibilityLabel={`${p.tytul}. ${p.etykietaCzasu}.`}
            >
              <Text style={styles.tytul} numberOfLines={2}>{p.tytul}</Text>
              {p.organizacja ? <Text style={styles.org} numberOfLines={1}>{p.organizacja}</Text> : null}
              <View style={styles.stopkaKarty}>
                <Text style={styles.data}>{formatDate(p.deadline)}</Text>
                <Text style={[styles.czas, { color: kolorGrupy(g.klucz) }]}>{p.etykietaCzasu}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={styles.stopka}>
        Pokazujemy terminy składania ofert z zapisanych przetargów. Włącz przypomnienie push
        w szczegółach przetargu, żeby nie polegać wyłącznie na tym widoku.
      </Text>
    </Screen>
  );
}

const tworzStyleAgendy = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  wstep: { fontSize: 13, color: k.textMuted, marginBottom: spacing.md },
  grupa: { marginBottom: spacing.lg },
  grupaNaglowek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  kropka: { width: 10, height: 10, borderRadius: 5 },
  grupaTytul: { flex: 1, fontSize: 15, fontWeight: '800', color: k.text },
  grupaLicznik: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  karta: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  tytul: { fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  org: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  stopkaKarty: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  data: { fontSize: 13, color: k.textMuted, fontWeight: '600' },
  czas: { fontSize: 13, fontWeight: '800' },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic' },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
}));
