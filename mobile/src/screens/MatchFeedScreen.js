import { useState, useCallback, useLayoutEffect } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import MatchCard from '../components/MatchCard';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

export default function MatchFeedScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleFeedu);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dociaganie, setDociaganie] = useState(false);
  const [kursor, setKursor] = useState(null); // `next_before` z ostatniej strony
  const [error, setError] = useState(null);

  /**
   * Wczytuje pierwszą stronę.
   *
   * Błąd sieci NIE kasuje tego, co użytkownik już widzi (audyt 2026-07-10):
   * dawniej powrót na ekran w metrze albo nieudane pociągnięcie w dół wymazywało
   * całą listę i pokazywało pełnoekranowy błąd. Pełnoekranowy komunikat jest
   * uzasadniony tylko wtedy, gdy nie mamy CZEGO pokazać.
   */
  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      const data = await api.getMatches();
      setMatches(data.matches || []);
      setKursor(data.next_before ?? null);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /**
   * Dociąga kolejną stronę. Bez tego feed kończył się na pierwszej porcji, a starsze
   * dopasowania były nieosiągalne — po miesiącu korzystania znikała większość historii.
   */
  const dociagnijWiecej = useCallback(async () => {
    if (!kursor || dociaganie || refreshing) return;
    setDociaganie(true);
    try {
      const data = await api.getMatches({ before: kursor });
      setMatches((poprzednie) => [...poprzednie, ...(data.matches || [])]);
      setKursor(data.next_before ?? null);
    } catch {
      // Błąd dociągania nie może wywalić już wyświetlonej listy — próba przy kolejnym przewinięciu.
    } finally {
      setDociaganie(false);
    }
  }, [kursor, dociaganie, refreshing]);

  // Odświeżenie listy przy każdym wejściu na ekran.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Account')} hitSlop={12}>
          <Text style={styles.headerBtn}>Konto</Text>
        </Pressable>
      ),
    });
  }, [navigation, styles]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={kolory.blue} />
      </View>
    );
  }

  // Pełnoekranowy błąd TYLKO wtedy, gdy nie mamy nic do pokazania.
  if (error && !matches.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Nie udało się wczytać przetargów</Text>
        <Text style={styles.text}>{error}</Text>
        <Button
          title="Spróbuj ponownie"
          variant="ghost"
          onPress={() => { setLoading(true); load(); }}
          style={styles.retry}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={matches}
      keyExtractor={(item) => item.id}
      contentContainerStyle={matches.length ? styles.list : styles.listEmpty}
      ListHeaderComponent={
        // Mamy starsze dane, ale odświeżenie się nie powiodło — mówimy o tym
        // wprost, zamiast udawać, że lista jest aktualna.
        error ? (
          <Pressable style={styles.pasekBledu} onPress={() => load('refresh')}>
            <Text style={styles.pasekBleduTekst}>
              Nie udało się odświeżyć. Pokazujemy ostatnio pobrane przetargi. Dotknij, aby spróbować ponownie.
            </Text>
          </Pressable>
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={kolory.blue}
          colors={[kolory.blue]}
        />
      }
      renderItem={({ item }) => (
        <MatchCard
          match={item}
          onPress={() => navigation.navigate('MatchDetail', { match: item })}
        />
      )}
      onEndReached={dociagnijWiecej}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        dociaganie ? (
          <View style={styles.stopka}>
            <ActivityIndicator color={kolory.blue} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.title}>Brak dopasowanych przetargów</Text>
          <Text style={styles.text}>
            Gdy pojawią się nowe przetargi pasujące do profilu Twojej firmy,
            zobaczysz je tutaj. Sprawdź w zakładce „Konto”, czy profil ma
            ustawione słowa kluczowe.
          </Text>
        </View>
      }
    />
  );
}

const tworzStyleFeedu = tworzStyle((k) => ({
  pasekBledu: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pasekBleduTekst: { color: k.ostrzezenieTekst, fontSize: 13, lineHeight: 18 },
  stopka: { paddingVertical: spacing.lg },
  headerBtn: { color: k.white, fontWeight: '700', fontSize: 15, marginRight: 16 },
  list: { padding: spacing.lg },
  listEmpty: { flexGrow: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: { fontSize: 44, marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  text: {
    fontSize: 14,
    color: k.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  retry: { marginTop: spacing.lg, alignSelf: 'stretch' },
}));
