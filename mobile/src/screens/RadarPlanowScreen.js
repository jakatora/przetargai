import { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import {
  TRYBY_RADARU, etykietaTerminu, tonPoziomu, opisPoziomu, formatujWartoscPlanu, podsumowanieRadaru,
} from '../lib/radarPlanow';

/*
 * RADAR PLANÓW POSTĘPOWAŃ (P2-4) — „wiedz o przetargu, zanim go ogłoszą".
 *
 * Wstępne ogłoszenia informacyjne z TED: zamawiający zapowiada zamówienie tygodnie
 * albo miesiące przed przetargiem. Firma, która zobaczy to wcześniej, zdąży
 * skompletować dokumenty, znaleźć partnera i zarezerwować ludzi — konkurencja
 * zaczyna dopiero w dniu ogłoszenia.
 *
 * Ranking i plan przygotowań liczy backend (bez AI); ekran tylko pokazuje. Kolory
 * wyłącznie z tokenów motywu przez `ton` z lib/radarPlanow.js.
 */

function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

function KartaPlanu({ pozycja, onPress, styles, kolory, t, jezyk }) {
  const termin = etykietaTerminu(pozycja, jezyk);
  const tonTerminu = tokenyTonu(termin.ton, kolory);
  const poziom = opisPoziomu(pozycja.poziom, jezyk);
  const tonDopasowania = tokenyTonu(tonPoziomu(pozycja.poziom), kolory);
  return (
    <Pressable
      style={styles.karta}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pozycja.przedmiot}. ${termin.tekst}.${poziom ? ` ${poziom}.` : ''}`}
    >
      {poziom ? (
        <View style={[styles.plakietka, { backgroundColor: tonDopasowania.tlo }]}>
          <Text style={[styles.plakietkaTekst, { color: tonDopasowania.tekst }]}>{poziom}</Text>
        </View>
      ) : null}
      <Text style={styles.tytul} numberOfLines={3}>{pozycja.przedmiot}</Text>
      {pozycja.zamawiajacy ? (
        <Text style={styles.meta} numberOfLines={1}>
          {pozycja.zamawiajacy}{pozycja.region_nazwa ? ` · ${pozycja.region_nazwa}` : ''}
        </Text>
      ) : null}
      <Text style={[styles.termin, { color: tonTerminu.tekst }]}>{termin.tekst}</Text>
      <Text style={styles.meta}>{formatujWartoscPlanu(pozycja.wartosc, pozycja.waluta, jezyk)}</Text>
      {pozycja.skraca_termin ? (
        <Text style={[styles.ostrzezenie, { color: kolory.ostrzezenieTekst }]}>
          {t('Termin składania ofert może być skrócony', 'The tender deadline may be shortened')}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function RadarPlanowScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleRadaru);
  const { t, jezyk } = useJezyk();

  const [tryb, setTryb] = useState('dla_mnie');
  const [dane, setDane] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [blad, setBlad] = useState(false);

  const wczytaj = useCallback(async (wybranyTryb) => {
    try {
      const odp = await api.radarPlanow({ tryb: wybranyTryb });
      setDane(odp);
      setBlad(false);
    } catch {
      // Znana lista zostaje; bez niej pokazujemy BŁĄD, nie „brak planów" (P1-8).
      setBlad(true);
    } finally {
      setLadowanie(false);
      setOdswiezanie(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(tryb); }, [wczytaj, tryb]));

  const zmienTryb = (nowy) => {
    if (nowy === tryb) return;
    setLadowanie(true);
    setDane(null);
    setTryb(nowy);
  };

  const przelacznik = (
    <View style={styles.przelacznik} accessibilityRole="tablist">
      {TRYBY_RADARU.map((opcja) => {
        const aktywny = tryb === opcja.wartosc;
        return (
          <Pressable
            key={opcja.wartosc}
            style={[styles.trybBtn, aktywny && { backgroundColor: kolory.blue }]}
            onPress={() => zmienTryb(opcja.wartosc)}
            accessibilityRole="tab"
            accessibilityState={{ selected: aktywny }}
          >
            <Text style={[styles.trybTekst, aktywny && { color: kolory.white }]}>
              {t(opcja.etykieta.pl, opcja.etykieta.en)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const naglowek = (
    <View>
      <Text style={styles.wstep}>
        {t(
          'Zamawiający zapowiadają zamówienia na tygodnie przed przetargiem. Zdążysz przygotować dokumenty, partnera i ludzi, zanim konkurencja się dowie.',
          'Buyers announce contracts weeks before the tender. You can prepare documents, a partner and staff before competitors find out.',
        )}
      </Text>
      {przelacznik}
      {dane?.podpowiedz ? (
        <View style={[styles.podpowiedz, { backgroundColor: kolory.neutralneTlo }]}>
          <Text style={styles.podpowiedzTekst}>{t(dane.podpowiedz.pl, dane.podpowiedz.en)}</Text>
          {dane.podpowiedz.kod === 'uzupelnij_profil' ? (
            <Pressable onPress={() => navigation.navigate('Account')} accessibilityRole="button">
              <Text style={[styles.link, { color: kolory.blue }]}>{t('Uzupełnij profil →', 'Complete your profile →')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {dane ? <Text style={styles.podsumowanie}>{podsumowanieRadaru(dane, jezyk)}</Text> : null}
    </View>
  );

  if (ladowanie && !dane) {
    return (
      <View style={styles.tlo}>
        <View style={styles.tresc}>{przelacznik}</View>
        <View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.tlo}
      contentContainerStyle={styles.tresc}
      data={dane?.pozycje ?? []}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={naglowek}
      renderItem={({ item }) => (
        <KartaPlanu
          pozycja={item}
          styles={styles}
          kolory={kolory}
          t={t}
          jezyk={jezyk}
          onPress={() => navigation.navigate('RadarPlanu', { id: item.id, tytul: item.przedmiot })}
        />
      )}
      refreshControl={(
        <RefreshControl
          refreshing={odswiezanie}
          onRefresh={() => { setOdswiezanie(true); wczytaj(tryb); }}
          tintColor={kolory.blue}
        />
      )}
      ListEmptyComponent={blad ? (
        <View style={styles.pusty}>
          <Text style={styles.pustyTytul}>{t('Nie udało się wczytać radaru', 'Could not load the radar')}</Text>
          <Text style={styles.pustyTekst}>{t('Sprawdź połączenie z internetem i spróbuj ponownie.', 'Check your internet connection and try again.')}</Text>
          <Pressable
            style={[styles.akcja, { backgroundColor: kolory.blue }]}
            onPress={() => { setLadowanie(true); wczytaj(tryb); }}
            accessibilityRole="button"
          >
            <Text style={[styles.akcjaTekst, { color: kolory.white }]}>{t('Spróbuj ponownie', 'Try again')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.pusty}>
          <Text style={styles.pustyTytul}>{t('Brak planów do pokazania', 'No plans to show')}</Text>
          {tryb === 'dla_mnie' ? (
            <Pressable
              style={[styles.akcja, { backgroundColor: kolory.blue }]}
              onPress={() => zmienTryb('wszystkie')}
              accessibilityRole="button"
            >
              <Text style={[styles.akcjaTekst, { color: kolory.white }]}>{t('Pokaż wszystkie plany', 'Show all plans')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      ListFooterComponent={dane?.zrodlo ? (
        <Text style={styles.stopka}>{t(dane.zrodlo.pl, dane.zrodlo.en)}</Text>
      ) : null}
    />
  );
}

const tworzStyleRadaru = tworzStyle((k) => ({
  tlo: { flex: 1, backgroundColor: k.bg },
  tresc: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginBottom: spacing.md },
  przelacznik: {
    flexDirection: 'row', backgroundColor: k.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: k.border, padding: 3, marginBottom: spacing.md,
  },
  trybBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md - 2, alignItems: 'center' },
  trybTekst: { fontSize: 14, fontWeight: '700', color: k.text },
  podpowiedz: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, gap: spacing.xs },
  podpowiedzTekst: { fontSize: 14, color: k.text, lineHeight: 20 },
  link: { fontSize: 14, fontWeight: '700' },
  podsumowanie: { fontSize: 13, color: k.textMuted, marginBottom: spacing.sm },
  karta: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.sm, gap: 4,
  },
  plakietka: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  plakietkaTekst: { fontSize: 12, fontWeight: '800' },
  tytul: { fontSize: 16, fontWeight: '700', color: k.text },
  meta: { fontSize: 13, color: k.textMuted },
  termin: { fontSize: 14, fontWeight: '700' },
  ostrzezenie: { fontSize: 12, fontWeight: '700' },
  pusty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  pustyTytul: { fontSize: 17, fontWeight: '700', color: k.text, textAlign: 'center' },
  pustyTekst: { fontSize: 14, color: k.textMuted, textAlign: 'center' },
  akcja: { marginTop: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xl, borderRadius: radius.md },
  akcjaTekst: { fontSize: 15, fontWeight: '700' },
  stopka: { fontSize: 12, color: k.textMuted, marginTop: spacing.lg, lineHeight: 17 },
}));
