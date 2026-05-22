import { useState, useCallback, useLayoutEffect } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import MatchCard from '../components/MatchCard';
import Button from '../components/Button';
import { colors, spacing } from '../theme';

export default function MatchFeedScreen({ navigation }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      setError(null);
      const data = await api.getMatches();
      setMatches(data.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.blue} />
      </View>
    );
  }

  if (error) {
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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={colors.blue}
          colors={[colors.blue]}
        />
      }
      renderItem={({ item }) => (
        <MatchCard
          match={item}
          onPress={() => navigation.navigate('MatchDetail', { match: item })}
        />
      )}
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

const styles = StyleSheet.create({
  headerBtn: { color: colors.white, fontWeight: '700', fontSize: 15 },
  list: { padding: spacing.lg },
  listEmpty: { flexGrow: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: { fontSize: 44, marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  text: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  retry: { marginTop: spacing.lg, alignSelf: 'stretch' },
});
