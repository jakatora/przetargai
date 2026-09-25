import { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { grupujAlerty, etykietaPlakietki, opisPustegoCentrum } from '../lib/centrumAlertow';
import { ogloszenieZAlertu } from '../lib/skrotOgloszenia';

/*
 * CENTRUM ALERTÓW I ZMIAN (etap 5).
 *
 * Po co ten ekran, skoro jest push: push potrafi zniknąć. Telefon go schowa, system
 * zdejmie powiadomienie, zgody nigdy nie było. Alert istniejący WYŁĄCZNIE jako push
 * to alert, którego można nie zobaczyć — a mowa o informacji typu „termin skrócony
 * o 6 dni", której przegapienie kosztuje kontrakt.
 *
 * Grupowanie i wybór języka żyją w lib/centrumAlertow.js (czyste, testowane).
 */

function kolorTonu(kolory, ton) {
  if (ton === 'danger') return kolory.danger;
  if (ton === 'ostrzezenie') return kolory.ostrzezenieAkcent;
  if (ton === 'sukces') return kolory.sukcesAkcent;
  return kolory.textMuted;
}

export default function CentrumAlertowScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleCentrum);
  const { t, jezyk } = useJezyk();

  const [alerty, setAlerty] = useState([]);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [blad, setBlad] = useState(null);

  const wczytaj = useCallback(async ({ odswiez = false } = {}) => {
    if (odswiez) setOdswiezanie(true);
    try {
      const dane = await api.getAlerty();
      setAlerty(dane.alerty ?? []);
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
      setOdswiezanie(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  const oznaczWszystkie = useCallback(async () => {
    try {
      await api.oznaczAlertyPrzeczytane();
      await wczytaj();
    } catch (err) {
      setBlad(err.message);
    }
  }, [wczytaj]);

  /**
   * Dotknięcie alertu oznacza go jako przeczytany I prowadzi dalej.
   *
   * Otwarcie alertu JEST jego przeczytaniem — osobny przycisk „oznacz jako
   * przeczytane" kazałby wykonać dwie czynności tam, gdzie intencja jest jedna.
   */
  const otworz = useCallback(async (alert) => {
    if (!alert.przeczytany) {
      // Oznaczenie nie może blokować nawigacji — gdy padnie, alert po prostu
      // zostaje nieprzeczytany, co jest bezpieczniejszym błędem niż zablokowany ekran.
      api.oznaczAlertPrzeczytany(alert.id).then(() => wczytaj()).catch(() => {});
    }
    const pierwsza = alert.pozycje?.[0];
    // Całe to, co alert wie: rejestr, zamawiający, termin — samo `{ id, title }`
    // dawało „BZP" przy TED, brak „Otwórz oryginał" i „Termin nieznany" (2026-09-25).
    if (pierwsza?.tenderId) navigation.navigate('KatalogDetail', { tender: ogloszenieZAlertu(pierwsza) });
  }, [navigation, wczytaj]);

  const { grupy, nieprzeczytane } = grupujAlerty(alerty, Date.now(), jezyk);

  if (ladowanie && !alerty.length && !blad) {
    return (
      <Screen>
        <View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </Screen>
    );
  }

  if (blad && !alerty.length) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Nie udało się wczytać alertów', 'Could not load alerts')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => wczytaj()} style={styles.gap} />
      </Screen>
    );
  }

  const plakietka = etykietaPlakietki(nieprzeczytane);

  return (
    <ScrollView
      style={styles.tlo}
      contentContainerStyle={styles.tresc}
      refreshControl={
        <RefreshControl refreshing={odswiezanie} onRefresh={() => wczytaj({ odswiez: true })} tintColor={kolory.blue} />
      }
    >
      <View style={styles.naglowek}>
        <Text style={styles.tytul}>{t('Alerty i zmiany', 'Alerts and changes')}</Text>
        {plakietka ? (
          <Text
            style={styles.plakietka}
            accessibilityLabel={t(`${nieprzeczytane} nieprzeczytanych alertów`, `${nieprzeczytane} unread alerts`)}
          >
            {plakietka}
          </Text>
        ) : null}
      </View>

      {nieprzeczytane > 0 ? (
        <Pressable onPress={oznaczWszystkie} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.akcjaGorna}>{t('Oznacz wszystkie jako przeczytane', 'Mark all as read')}</Text>
        </Pressable>
      ) : null}

      {!grupy.length ? (
        <View style={styles.pustka}>
          <Text style={styles.pustkaIkona}>🔕</Text>
          <Text style={styles.pustkaTytul}>{t('Brak alertów', 'No alerts')}</Text>
          <Text style={styles.pustkaTekst}>{opisPustegoCentrum(jezyk)}</Text>
        </View>
      ) : null}

      {grupy.map((g) => (
        <View key={g.klucz} style={styles.grupa}>
          <Text style={styles.grupaTytul}>{g.etykieta}</Text>

          {g.pozycje.map((a) => (
            <Pressable
              key={a.id}
              style={[styles.karta, !a.przeczytany && styles.kartaNowa]}
              onPress={() => otworz(a)}
              accessibilityRole="button"
              accessibilityLabel={`${a.tytul}. ${a.tresc}${a.przeczytany ? '' : `. ${t('Nieprzeczytany', 'Unread')}`}`}
            >
              <View style={styles.naglowekKarty}>
                <View style={[styles.kropka, { backgroundColor: kolorTonu(kolory, a.ton) }]} />
                <Text style={[styles.kartaTytul, !a.przeczytany && styles.kartaTytulNowy]} numberOfLines={2}>
                  {a.tytul}
                </Text>
              </View>

              <Text style={styles.kartaTresc}>{a.tresc}</Text>

              {a.pozycje.slice(0, 3).map((p) => (
                <View key={`${a.id}-${p.tenderId}-${p.typZmiany ?? 'nowe'}`} style={styles.pozycja}>
                  <Text style={styles.pozycjaTytul} numberOfLines={2}>{p.tytul ?? '—'}</Text>
                  {p.opis ? <Text style={styles.pozycjaOpis}>{p.opis}</Text> : null}
                </View>
              ))}

              {a.pozycje.length > 3 ? (
                <Text style={styles.wiecej}>
                  {t(`i jeszcze ${a.pozycje.length - 3}`, `and ${a.pozycje.length - 3} more`)}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}

      {blad ? (
        <Pressable style={styles.pasekBledu} onPress={() => wczytaj()} accessibilityRole="button">
          <Text style={styles.pasekBleduTekst}>{blad} · {t('dotknij, aby ponowić', 'tap to retry')}</Text>
        </Pressable>
      ) : null}

      <Button
        title={t('Zarządzaj obserwacjami', 'Manage saved searches')}
        variant="ghost"
        onPress={() => navigation.navigate('ZapisaneWyszukiwania')}
        style={styles.gap}
      />
    </ScrollView>
  );
}

const tworzStyleCentrum = tworzStyle((k) => ({
  tlo: { flex: 1, backgroundColor: k.bg },
  tresc: { padding: spacing.lg, paddingBottom: spacing.xl },
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  naglowek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  plakietka: {
    fontSize: 12,
    fontWeight: '800',
    color: k.white,
    backgroundColor: k.danger,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  akcjaGorna: { fontSize: 13, fontWeight: '800', color: k.blue, marginTop: spacing.sm },

  grupa: { marginTop: spacing.lg },
  grupaTytul: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase' },

  karta: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    gap: 4,
  },
  kartaNowa: { borderColor: k.blue },
  naglowekKarty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kropka: { width: 8, height: 8, borderRadius: 4 },
  kartaTytul: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text },
  kartaTytulNowy: { fontWeight: '800' },
  kartaTresc: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  pozycja: { marginTop: 6, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: k.border },
  pozycjaTytul: { fontSize: 13, fontWeight: '700', color: k.text },
  pozycjaOpis: { fontSize: 12, color: k.textMuted, lineHeight: 18 },
  wiecej: { fontSize: 12, color: k.textMuted, fontStyle: 'italic', marginTop: 4 },

  pustka: { marginTop: spacing.xl, alignItems: 'center', gap: 6 },
  pustkaIkona: { fontSize: 36 },
  pustkaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  pustkaTekst: { fontSize: 13, color: k.textMuted, lineHeight: 19, textAlign: 'center' },

  pasekBledu: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: k.ostrzezenieTlo },
  pasekBleduTekst: { fontSize: 12, color: k.ostrzezenieTekst, fontWeight: '700' },
  gap: { marginTop: spacing.lg },
}));
