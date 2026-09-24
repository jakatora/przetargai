import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { zbudujPulpit, stanPulpitu } from '../lib/pulpit';

/**
 * „MOJE POSTĘPOWANIA" (pulpit) — widok ETAPOWY zapisanych przetargów. Domyka triadę
 * feed → kalendarz → pulpit: ile ofert na jakim etapie i co pilne. Logika w lib/pulpit.js.
 */
export default function PulpitScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePulpitu);
  // Pulpit to widok zbiorczy zapisanych postępowań — chrome dwujęzyczne (P1-5).
  const { t } = useJezyk();
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blad, setBlad] = useState(false);

  const wczytaj = useCallback(async () => {
    try {
      const d = await api.getSaved();
      setSaved(d.saved || []);
      setBlad(false);
    } catch {
      // Offline — zostaje ostatnia lista; bez niej pokazujemy BŁĄD, nie „brak postępowań" (P1-8).
      setBlad(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  const { grupy, lacznie, wymagaUwagi } = zbudujPulpit(saved);

  const kolorEtapu = (wartosc) => {
    if (wartosc === 'wygrana') return kolory.sukcesAkcent;
    if (wartosc === 'przegrana') return kolory.danger;
    if (wartosc === 'zlozona') return kolory.ostrzezenieTekst;
    if (wartosc === 'przygotowuje') return kolory.blue;
    return kolory.textMuted;
  };
  const kolorCzasu = (p) => (p.minal ? kolory.danger : p.pilny ? kolory.ostrzezenieTekst : kolory.textMuted);

  const stan = stanPulpitu({ ladowanie: loading, blad, lacznie });

  if (stan === 'ladowanie') {
    return <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>;
  }

  if (stan === 'blad') {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📡</Text>
        <Text style={styles.emptyTitle}>{t('Nie udało się wczytać', 'Could not load')}</Text>
        <Text style={styles.emptyText}>
          {t('Sprawdź połączenie z internetem i spróbuj ponownie.', 'Check your internet connection and try again.')}
        </Text>
        <Pressable
          style={styles.akcjaBtn}
          onPress={() => { setLoading(true); wczytaj(); }}
          accessibilityRole="button"
        >
          <Text style={styles.akcjaBtnTekst}>{t('Spróbuj ponownie', 'Try again')}</Text>
        </Pressable>
      </View>
    );
  }

  if (stan === 'pusty') {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>{t('Brak prowadzonych postępowań', 'No procedures in progress')}</Text>
        <Text style={styles.emptyText}>
          {t(
            'Zapisz przetargi gwiazdką i ustaw etap („Rozważam", „Przygotowuję"…), a zbierzemy je tu w jeden widok — ile masz na jakim etapie i co pilne.',
            'Save tenders with the star and set a stage („Considering", „Preparing"…) — we will gather them here in one view: how many are at each stage and what is urgent.',
          )}
        </Text>
        <Pressable
          style={styles.akcjaBtn}
          onPress={() => navigation.navigate('MatchFeed')}
          accessibilityRole="button"
        >
          <Text style={styles.akcjaBtnTekst}>{t('Przeglądaj przetargi', 'Browse tenders')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Screen scroll>
      <View style={[styles.podsumowanie, wymagaUwagi > 0 && { borderColor: kolory.ostrzezenieTekst }]}>
        <Text style={styles.podsumLiczba}>
          {t(`${lacznie} ${lacznie === 1 ? 'postępowanie' : 'postępowań'}`, `${lacznie} ${lacznie === 1 ? 'procedure' : 'procedures'}`)}
        </Text>
        <Text style={[styles.podsumUwaga, { color: wymagaUwagi > 0 ? kolory.ostrzezenieTekst : kolory.textMuted }]}>
          {wymagaUwagi > 0
            ? t(`${wymagaUwagi} wymaga uwagi — pilny termin`, `${wymagaUwagi} need attention — deadline close`)
            : t('Nic pilnego na dziś', 'Nothing urgent today')}
        </Text>
      </View>

      {grupy.map((g) => (
        <View key={g.wartosc} style={styles.etap}>
          <View style={styles.etapNaglowek}>
            <View style={[styles.kropka, { backgroundColor: kolorEtapu(g.wartosc) }]} />
            <Text style={styles.etapTytul}>{g.etykieta}</Text>
            <Text style={styles.etapLicznik}>{g.liczba}</Text>
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
                <Text style={styles.data}>{p.maTermin ? formatDate(p.deadline) : t('Bez terminu', 'No deadline')}</Text>
                <Text style={[styles.czas, { color: kolorCzasu(p) }]}>{p.etykietaCzasu}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={styles.stopka}>
        {t(
          'Etap ustawiasz w szczegółach przetargu albo w „Zapisanych". Pilne = termin składania w ciągu 7 dni na otwartym etapie (Rozważam / Przygotowuję / Złożona).',
          'You set the stage in a tender’s details or under „Saved". Urgent = submission deadline within 7 days at an open stage (Considering / Preparing / Submitted).',
        )}
      </Text>
    </Screen>
  );
}

const tworzStylePulpitu = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  podsumowanie: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  podsumLiczba: { fontSize: 20, fontWeight: '900', color: k.text },
  podsumUwaga: { fontSize: 13, fontWeight: '700', marginTop: 2 },

  etap: { marginBottom: spacing.lg },
  etapNaglowek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  kropka: { width: 10, height: 10, borderRadius: 5 },
  etapTytul: { flex: 1, fontSize: 15, fontWeight: '800', color: k.text },
  etapLicznik: { fontSize: 13, fontWeight: '700', color: k.textMuted },

  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  tytul: { fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  org: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  stopkaKarty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  data: { fontSize: 13, color: k.textMuted, fontWeight: '600' },
  czas: { fontSize: 13, fontWeight: '800' },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  akcjaBtn: {
    marginTop: spacing.lg,
    backgroundColor: k.blue,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  akcjaBtnTekst: { color: k.white, fontSize: 15, fontWeight: '700' },
}));
