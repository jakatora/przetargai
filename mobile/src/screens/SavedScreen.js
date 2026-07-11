import { useState, useCallback } from 'react';
import {
  FlatList, View, Text, Pressable, ActivityIndicator, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { ScoreBadge } from '../components/MatchCard';

export default function SavedScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleZapisanych);
  const { toggle } = useSaved();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const wczytaj = useCallback(async () => {
    try {
      const d = await api.getSaved();
      setItems(d.saved || []);
    } catch {
      /* offline — zostaje ostatnia lista */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  async function usun(tenderId) {
    setItems((prev) => prev.filter((s) => s.tender.id !== tenderId));
    toggle(tenderId).catch(() => wczytaj()); // przy błędzie przywróć z serwera
  }

  async function przelaczPrzypomnienie(item, wartosc) {
    // Optymistycznie; przy błędzie cofamy.
    setItems((prev) => prev.map((s) =>
      s.tender.id === item.tender.id ? { ...s, reminder_enabled: wartosc } : s));
    try {
      const stan = await api.setReminder(item.tender.id, wartosc);
      setItems((prev) => prev.map((s) =>
        s.tender.id === item.tender.id
          ? { ...s, reminder_enabled: stan.reminder_enabled, remind_at: stan.remind_at }
          : s));
    } catch {
      setItems((prev) => prev.map((s) =>
        s.tender.id === item.tender.id ? { ...s, reminder_enabled: !wartosc } : s));
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>;
  }

  function renderItem({ item }) {
    const tender = item.tender;
    const termin = opisTerminu(tender.deadline);
    const maTermin = !!tender.deadline && !termin.minal;
    return (
      // Karta to zwykły View: NAWIGUJE tylko górny wiersz. Gdyby cała karta była
      // Pressable, przełącznik przypomnienia (na web) otwierałby szczegóły.
      <View style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('MatchDetail', { match: item })}
          accessibilityRole="button"
          accessibilityLabel={`${tender.title}. ${termin.etykieta}.`}
        >
          <ScoreBadge score={item.confidence_score} />
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={2}>{tender.title}</Text>
            {tender.organization ? <Text style={styles.org} numberOfLines={1}>{tender.organization}</Text> : null}
            <Text style={styles.deadline}>Termin: {formatDate(tender.deadline)}</Text>
            <Text style={[styles.znacznik, termin.minal && styles.miniony, termin.pilny && styles.pilny]}>
              {termin.etykieta}
            </Text>
          </View>
          <Pressable onPress={() => usun(tender.id)} hitSlop={12} accessibilityLabel="Usuń z zapisanych" style={styles.gwiazdka}>
            <Text style={[styles.gwiazdkaZnak, { color: kolory.blue }]}>★</Text>
          </Pressable>
        </Pressable>

        <View style={styles.przypomnienie}>
          <View style={styles.przypInfo}>
            <Text style={styles.przypTytul}>Przypomnij przed terminem</Text>
            <Text style={styles.przypOpis}>
              {maTermin
                ? (item.reminder_enabled
                  ? 'Powiadomimy Cię ok. 2 dni przed terminem składania ofert.'
                  : 'Push, żebyś nie przegapił terminu.')
                : 'Ten przetarg nie ma terminu, o którym można przypomnieć.'}
            </Text>
          </View>
          <Switch
            value={item.reminder_enabled}
            onValueChange={(v) => przelaczPrzypomnienie(item, v)}
            disabled={!maTermin}
            trackColor={{ true: kolory.blue }}
          />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={items.length ? styles.list : styles.listEmpty}
      renderItem={renderItem}
      ListEmptyComponent={(
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>☆</Text>
          <Text style={styles.emptyTitle}>Brak zapisanych przetargów</Text>
          <Text style={styles.emptyText}>
            Dotknij gwiazdki przy przetargu, aby zapisać go tutaj i włączyć przypomnienie o terminie.
          </Text>
        </View>
      )}
    />
  );
}

const tworzStyleZapisanych = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.lg },
  listEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: k.text },
  org: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  deadline: { fontSize: 12, color: k.textMuted, marginTop: 6 },
  znacznik: { marginTop: spacing.xs, fontSize: 12, fontWeight: '700', color: k.textMuted },
  pilny: { color: k.ostrzezenieTekst },
  miniony: { color: k.danger },
  gwiazdka: { padding: 2 },
  gwiazdkaZnak: { fontSize: 22, lineHeight: 24, fontWeight: '700' },
  przypomnienie: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  przypInfo: { flex: 1 },
  przypTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przypOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  emptyIcon: { fontSize: 48, color: k.textMuted, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
}));
