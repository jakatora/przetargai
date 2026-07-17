import { useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  FlatList,
  View,
  Text,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { api } from '../api/client';
import MatchCard from '../components/MatchCard';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { PROGI, KLUCZ_PROGU, filtrujPoProgu, normalizujProg } from '../lib/filtrOcen';
import { SORTOWANIA, KLUCZ_SORT, sortujDopasowania, filtrujTekst, normalizujSort } from '../lib/feedSort';
import * as storage from '../lib/storage';
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
  const [prog, setProg] = useState(0);
  const [sort, setSort] = useState('trafnosc');
  const [szukaj, setSzukaj] = useState('');
  // Zachęta do Standard oparta na realnych liczbach (D-055 — FOMO na Free).
  const [zacheta, setZacheta] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  // Próg filtra i sortowanie przeżywają restart aplikacji.
  useEffect(() => {
    let aktywny = true;
    Promise.all([storage.getItem(KLUCZ_PROGU), storage.getItem(KLUCZ_SORT)])
      .then(([p, s]) => { if (aktywny) { setProg(normalizujProg(p)); setSort(normalizujSort(s)); } })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  const zmienProg = useCallback((nowy) => {
    setProg(nowy);
    storage.setItem(KLUCZ_PROGU, String(nowy)).catch(() => {});
  }, []);

  const zmienSort = useCallback((nowy) => {
    setSort(nowy);
    storage.setItem(KLUCZ_SORT, nowy).catch(() => {});
  }, []);

  // Pipeline: próg → tekst → sortowanie. Wszystko po stronie aplikacji na
  // wczytanych dopasowaniach (feed jednego użytkownika jest mały).
  const widoczne = useMemo(() => {
    const poProgu = filtrujPoProgu(matches, prog);
    const poTekscie = filtrujTekst(poProgu, szukaj);
    return sortujDopasowania(poTekscie, sort);
  }, [matches, prog, szukaj, sort]);

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
      // Większa pierwsza strona (50 = maks backendu), żeby sortowanie i szukanie
      // objęły cały feed użytkownika bez „dociągnij" — jest go zwykle < 50.
      const data = await api.getMatches({ limit: 50 });
      setMatches(data.matches || []);
      setKursor(data.next_before ?? null);
      setError(null);
      // Statystyki poboczne — nie mogą wywalić feedu, gdy padną.
      api.getStatystyki().then((s) => setZacheta(s.zacheta)).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  async function przejdzNaStandard() {
    setUpgrading(true);
    try {
      const { url } = await api.createUpgradeLink();
      await WebBrowser.openBrowserAsync(url);
    } catch {
      /* brak linku — cicho, baner zostaje */
    } finally {
      setUpgrading(false);
    }
  }

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
        <View style={styles.headerAkcje}>
          <Pressable onPress={() => navigation.navigate('Saved')} hitSlop={12} accessibilityLabel="Zapisane przetargi">
            <Text style={styles.headerGwiazdka}>★</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Account')} hitSlop={12}>
            <Text style={styles.headerBtn}>Konto</Text>
          </Pressable>
        </View>
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
      data={widoczne}
      keyExtractor={(item) => item.id}
      contentContainerStyle={widoczne.length ? styles.list : styles.listEmpty}
      ListHeaderComponent={
        <View>
          {/* Zachęta do Standard oparta na realnych liczbach (D-055 — FOMO na Free). */}
          {zacheta?.pokaz ? (
            <Pressable style={styles.fomo} onPress={przejdzNaStandard} disabled={upgrading} accessibilityRole="button">
              <Text style={styles.fomoTytul}>{zacheta.tytul}</Text>
              <Text style={styles.fomoOpis}>{zacheta.opis}</Text>
              <Text style={styles.fomoCta}>{upgrading ? 'Otwieram…' : 'Przejdź na Standard — 49 zł/mc →'}</Text>
            </Pressable>
          ) : null}

          {/* Wyszukiwarka — po tytule i zamawiającym, z tolerancją odmian (D-051). */}
          <View style={styles.szukajRzad}>
            <Text style={styles.szukajIkona}>🔍</Text>
            <TextInput
              style={styles.szukajPole}
              value={szukaj}
              onChangeText={setSzukaj}
              placeholder="Szukaj po nazwie lub zamawiającym"
              placeholderTextColor={kolory.textMuted}
              autoCorrect={false}
              accessibilityLabel="Szukaj w przetargach"
            />
            {szukaj ? (
              <Pressable onPress={() => setSzukaj('')} hitSlop={10} accessibilityLabel="Wyczyść szukanie">
                <Text style={styles.szukajX}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Sortowanie — trwały wybór (D-051). */}
          <View style={styles.progi} accessibilityRole="radiogroup">
            {SORTOWANIA.map((opcja) => {
              const aktywny = sort === opcja.wartosc;
              return (
                <Pressable
                  key={opcja.wartosc}
                  onPress={() => zmienSort(opcja.wartosc)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.progChip, aktywny && styles.progChipAktywny]}
                >
                  <Text style={[styles.progTekst, aktywny && styles.progTekstAktywny]}>{opcja.etykieta}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Filtr minimalnego dopasowania — trwały wybór usera (D-047). */}
          <View style={styles.progi} accessibilityRole="radiogroup">
            {PROGI.map((opcja) => {
              const aktywny = prog === opcja.wartosc;
              return (
                <Pressable
                  key={opcja.wartosc}
                  onPress={() => zmienProg(opcja.wartosc)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.progChip, aktywny && styles.progChipAktywny]}
                >
                  <Text style={[styles.progTekst, aktywny && styles.progTekstAktywny]}>
                    {opcja.etykieta}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Licznik wyników (R14) — ile widać po filtrach; z podpowiedzią, gdy filtr zawęża. */}
          {widoczne.length > 0 ? (
            <Text style={styles.licznik}>
              {widoczne.length === matches.length
                ? `${widoczne.length} ${widoczne.length === 1 ? 'przetarg' : 'przetargów'}`
                : `${widoczne.length} z ${matches.length} przetargów`}
            </Text>
          ) : null}
          {/*
            Mamy starsze dane, ale odświeżenie się nie powiodło — mówimy o tym
            wprost, zamiast udawać, że lista jest aktualna.
          */}
          {error ? (
            <Pressable style={styles.pasekBledu} onPress={() => load('refresh')}>
              <Text style={styles.pasekBleduTekst}>
                Nie udało się odświeżyć. Pokazujemy ostatnio pobrane przetargi. Dotknij, aby spróbować ponownie.
              </Text>
            </Pressable>
          ) : null}
          {matches.length > 0 && widoczne.length === 0 ? (
            <Text style={styles.pustyFiltr}>
              {szukaj
                ? `Brak wyników dla „${szukaj}". Wyczyść szukanie lub zmień frazę.`
                : `Żadne z ${matches.length} dopasowań nie ma ${prog}%+ — obniż próg, aby je zobaczyć.`}
            </Text>
          ) : null}
        </View>
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
        // Pustka od FILTRA ma własny komunikat w nagłówku — ten ekran jest
        // wyłącznie dla faktycznie pustego konta.
        matches.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.title}>Brak dopasowanych przetargów</Text>
            <Text style={styles.text}>
              Gdy pojawią się nowe przetargi pasujące do profilu Twojej firmy,
              zobaczysz je tutaj. Sprawdź w zakładce „Konto”, czy profil ma
              ustawione słowa kluczowe.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

const tworzStyleFeedu = tworzStyle((k) => ({
  fomo: {
    backgroundColor: k.blue,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  fomoTytul: { fontSize: 16, fontWeight: '800', color: k.surface },
  fomoOpis: { fontSize: 13, color: k.surface, opacity: 0.92, lineHeight: 18 },
  fomoCta: { fontSize: 14, fontWeight: '800', color: k.surface, marginTop: 6 },
  szukajRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.border,
    borderRadius: radius.md, paddingHorizontal: 12, marginBottom: spacing.sm,
  },
  szukajIkona: { fontSize: 15 },
  szukajPole: { flex: 1, paddingVertical: 11, fontSize: 15, color: k.text },
  szukajX: { color: k.textMuted, fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },
  licznik: { fontSize: 13, color: k.textMuted, fontWeight: '700', marginBottom: spacing.sm },
  progi: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  progChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: k.border,
    backgroundColor: k.surface,
    alignItems: 'center',
  },
  progChipAktywny: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  progTekst: { fontSize: 13, fontWeight: '600', color: k.textMuted },
  progTekstAktywny: { color: k.blue },
  pustyFiltr: {
    color: k.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  pasekBledu: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pasekBleduTekst: { color: k.ostrzezenieTekst, fontSize: 13, lineHeight: 18 },
  stopka: { paddingVertical: spacing.lg },
  headerAkcje: { flexDirection: 'row', alignItems: 'center', gap: 18, marginRight: 16 },
  headerGwiazdka: { color: k.white, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  headerBtn: { color: k.white, fontWeight: '700', fontSize: 15 },
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
