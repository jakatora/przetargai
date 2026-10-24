import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api/client';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { PRZYCZYNY, etykietaPrzyczyny } from '../lib/selekcja';

/** Lista odrzuconych z ostatnich 30 dni (Standard) z przyczyną i „To jednak pasuje” (spec §5.1). */
export default function OdrzuconeScreen({ navigation }) {
  const { t } = useJezyk();
  const styles = useStyle(tworzStyleOdrzuconych);
  const [przyczyna, setPrzyczyna] = useState(null);
  const [lista, setLista] = useState([]);
  const [kursor, setKursor] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [powod, setPowod] = useState(null);
  const [przywracane, setPrzywracane] = useState(null);
  const [blad, setBlad] = useState(null);
  // Ref, nie stan: dwa onEndReached w jednej klatce widzą ten sam stan i pobrałyby stronę dwa razy.
  const wToku = useRef(false);
  const numerZapytania = useRef(0);

  const wczytaj = useCallback(async (dalej = false) => {
    if (dalej && wToku.current) return;
    const numer = ++numerZapytania.current;
    wToku.current = true;
    setLadowanie(true);
    setBlad(null);
    try {
      const d = await api.pracownikOdrzucone({ przyczyna, before: dalej ? kursor : undefined });
      if (numer !== numerZapytania.current) return; // nowszy filtr już w drodze
      setPowod(d.powod ?? null);
      setLista((l) => (dalej ? [...l, ...(d.odrzucone ?? [])] : (d.odrzucone ?? [])));
      setKursor(d.next_before ?? null);
    } catch (err) {
      if (numer === numerZapytania.current) setBlad(err.message);
    } finally {
      if (numer === numerZapytania.current) { wToku.current = false; setLadowanie(false); }
    }
  }, [przyczyna, kursor]);

  // Nowy filtr = lista od początku; kursor celowo poza zależnościami (inaczej pętla).
  useEffect(() => { wczytaj(false); }, [przyczyna]); // eslint-disable-line react-hooks/exhaustive-deps

  async function przywroc(tenderId) {
    setPrzywracane(tenderId);
    try {
      await api.pracownikPrzywroc(tenderId);
      setLista((l) => l.filter((x) => x.tender_id !== tenderId));
    } catch (err) {
      Alert.alert(t('Nie udało się przywrócić przetargu', 'Could not restore the tender'), err.message);
    } finally {
      setPrzywracane(null);
    }
  }

  if (powod === 'plan') {
    return (
      <View style={styles.pusty}>
        <Text style={styles.tekst}>{t('Pełna lista odrzuconych jest w planie Standard.', 'The full rejected list is on the Standard plan.')}</Text>
        <Button title={t('Wróć', 'Back')} variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <FlatList
      data={lista}
      keyExtractor={(x) => x.tender_id}
      contentContainerStyle={styles.lista}
      ListHeaderComponent={(
        <View style={styles.filtry}>
          {[null, ...PRZYCZYNY].map((kod) => (
            <Pressable
              key={kod ?? 'wszystkie'}
              accessibilityRole="button"
              accessibilityState={{ selected: przyczyna === kod }}
              onPress={() => setPrzyczyna(kod)}
              style={[styles.chip, przyczyna === kod && styles.chipWybrany]}
            >
              <Text style={styles.chipTekst}>{kod ? t(etykietaPrzyczyny(kod)) : t('Wszystkie', 'All')}</Text>
            </Pressable>
          ))}
        </View>
      )}
      ListEmptyComponent={ladowanie ? <ActivityIndicator /> : blad ? (
        <View>
          <Text style={styles.tekst}>{blad}</Text>
          <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => wczytaj(false)} />
        </View>
      ) : (
        <Text style={styles.tekst}>{t('Brak odrzuconych w ostatnich 30 dniach.', 'No rejections in the last 30 days.')}</Text>
      )}
      renderItem={({ item }) => (
        <View style={styles.karta}>
          <Text style={styles.tytul}>{item.tytul}</Text>
          {item.zamawiajacy ? <Text style={styles.drobny}>{item.zamawiajacy}</Text> : null}
          {item.termin ? <Text style={styles.drobny}>{t(`Termin ofert: ${formatDate(item.termin)}`, `Bid deadline: ${formatDate(item.termin)}`)}</Text> : null}
          <Text style={styles.przyczyna}>{t(etykietaPrzyczyny(item.przyczyna))}</Text>
          {item.szczegol ? <Text style={styles.drobny}>{t(item.szczegol)}</Text> : null}
          {item.przyczyna === 'warunki' ? (
            <Text style={styles.drobny}>{t('Możesz wystartować z partnerem: Konsorcjum albo cudze zasoby (art. 118).', 'You can bid with a partner: consortium or third-party resources (art. 118).')}</Text>
          ) : null}
          <Button title={t('To jednak pasuje', 'This fits after all')} variant="ghost" loading={przywracane === item.tender_id} onPress={() => przywroc(item.tender_id)} />
        </View>
      )}
      onEndReached={() => { if (kursor && !blad) wczytaj(true); }}
      onEndReachedThreshold={0.4}
    />
  );
}

const tworzStyleOdrzuconych = tworzStyle((k) => ({
  lista: { padding: spacing.md },
  pusty: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  tekst: { fontSize: 15, color: k.text, textAlign: 'center', marginBottom: spacing.md },
  filtry: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: k.border },
  chipWybrany: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  chipTekst: { fontSize: 13, color: k.text },
  karta: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, marginBottom: spacing.sm },
  tytul: { fontSize: 15, fontWeight: '700', color: k.text },
  drobny: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs },
  przyczyna: { fontSize: 14, fontWeight: '700', color: k.ostrzezenieAkcent, marginTop: spacing.xs },
}));
