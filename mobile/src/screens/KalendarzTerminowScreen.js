import { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import Button from '../components/Button';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { ulozKalendarz, kartaNastepnegoKroku, opisPozycji } from '../lib/kalendarzPrzetargu';

/*
 * KALENDARZ TERMINÓW (etap 5, P1-7).
 *
 * Zapisany przetarg to nie jedna data, tylko trzy, a wykonawca przegapia zwykle
 * pierwszą i ostatnią: termin PYTAŃ do SWZ (po nim zamawiający nie musi już
 * odpowiedzieć) i koniec ZWIĄZANIA OFERTĄ (po nim oferta podlega odrzuceniu).
 * Termin składania widać wszędzie; te dwa nie były pokazywane nigdzie.
 *
 * Daty liczy backend (reguły ustawowe, strefa Europe/Warsaw, podstawa prawna),
 * bo to wiedza o przepisach. Tutaj zostaje wyłącznie prezentacja, a grupowanie
 * i tony żyją w lib/kalendarzPrzetargu.js (czyste, testowane).
 */

function kolorTonu(kolory, ton) {
  if (ton === 'danger') return kolory.danger;
  if (ton === 'ostrzezenie') return kolory.ostrzezenieAkcent;
  if (ton === 'sukces') return kolory.sukcesAkcent;
  return kolory.textMuted;
}

export default function KalendarzTerminowScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKalendarza);
  const { t, jezyk } = useJezyk();

  const [dane, setDane] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [blad, setBlad] = useState(null);

  const wczytaj = useCallback(async ({ odswiez = false } = {}) => {
    if (odswiez) setOdswiezanie(true);
    try {
      setDane(await api.getKalendarz());
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
      setOdswiezanie(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  if (ladowanie && !dane && !blad) {
    return (
      <Screen>
        <View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </Screen>
    );
  }

  if (blad && !dane) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Nie udało się wczytać kalendarza', 'Could not load the calendar')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => wczytaj()} style={styles.gap} />
      </Screen>
    );
  }

  const { grupy, nieznane, razem } = ulozKalendarz(dane?.przetargi ?? [], Date.now(), jezyk);
  const karta = kartaNastepnegoKroku(dane?.nastepny, jezyk);

  return (
    <ScrollView
      style={styles.tlo}
      contentContainerStyle={styles.tresc}
      refreshControl={
        <RefreshControl refreshing={odswiezanie} onRefresh={() => wczytaj({ odswiez: true })} tintColor={kolory.blue} />
      }
    >
      <Text style={styles.tytul}>{t('Kalendarz terminów', 'Deadline calendar')}</Text>

      {/* KARTA NASTĘPNEGO KROKU — główny element ekranu: co robię najbliżej i do kiedy. */}
      <View style={[styles.kartaKrok, { borderColor: kolorTonu(kolory, karta.ton) }]}>
        <Text style={styles.krokEtykieta}>{t('Następny krok', 'Next step')}</Text>
        <Text style={[styles.krokCo, { color: kolorTonu(kolory, karta.ton) }]}>{karta.co}</Text>
        {karta.tytulPrzetargu ? (
          <Text style={styles.krokPrzetarg} numberOfLines={2}>{karta.tytulPrzetargu}</Text>
        ) : null}
        {karta.kiedy ? <Text style={styles.krokKiedy}>{karta.kiedy}</Text> : null}
        {karta.zostalo ? (
          <Text style={[styles.krokZostalo, { color: kolorTonu(kolory, karta.ton) }]}>{karta.zostalo}</Text>
        ) : null}
        {dane?.strefa ? (
          <Text style={styles.strefa}>
            {t(`Godziny w czasie polskim (${dane.strefa})`, `Times in Polish time (${dane.strefa})`)}
          </Text>
        ) : null}
      </View>

      {!razem && !grupy.length ? (
        <View style={styles.pustka}>
          <Text style={styles.pustkaIkona}>📅</Text>
          <Text style={styles.pustkaTytul}>{t('Brak terminów', 'No deadlines')}</Text>
          <Text style={styles.pustkaTekst}>{t(dane?.pustka) || t(
            'Zapisz przetarg gwiazdką — pokażemy tu termin pytań do SWZ, termin składania ofert i koniec związania ofertą.',
            'Save a tender with the star — we will show the deadline for questions, for bid submission and the end of bid validity here.',
          )}</Text>
        </View>
      ) : null}

      {nieznane > 0 ? (
        <Text style={styles.nieznane}>
          {t(
            `${nieznane} terminów nie da się wyliczyć — rejestr ich nie podaje albo postępowanie nie podlega Pzp. Szczegóły przy przetargu.`,
            `${nieznane} deadlines cannot be derived — the register does not state them, or the procurement is outside the Polish PPL. See the tender for details.`,
          )}
        </Text>
      ) : null}

      {grupy.map((g) => (
        <View key={g.klucz} style={styles.grupa}>
          <Text style={styles.grupaTytul}>{g.etykieta}</Text>

          {g.pozycje.map((p) => {
            if (p.anulowany) {
              return (
                <View key={`anul-${p.tenderId}`} style={styles.karta}>
                  <Text style={styles.przetarg} numberOfLines={2}>{p.tytul}</Text>
                  <Text style={styles.anulowany}>
                    {t('Postępowanie anulowane — nie ma czego przygotowywać.', 'Procurement cancelled — nothing to prepare.')}
                  </Text>
                </View>
              );
            }

            const o = opisPozycji(p, jezyk);
            return (
              <Pressable
                key={`${p.tenderId}-${p.kod}`}
                style={styles.karta}
                onPress={() => navigation.navigate('KatalogDetail', {
                  tender: { id: p.tenderId, title: p.tytulPrzetargu, source: p.zrodlo },
                })}
                accessibilityRole="button"
                accessibilityLabel={`${o.co}. ${p.tytulPrzetargu ?? ''}. ${o.kiedy ?? ''}`}
              >
                <View style={styles.naglowekKarty}>
                  <View style={[styles.kropka, { backgroundColor: kolorTonu(kolory, p.ton) }]} />
                  <Text style={[styles.rodzaj, { color: kolorTonu(kolory, p.ton) }]}>{o.co}</Text>
                </View>

                <Text style={styles.przetarg} numberOfLines={2}>{p.tytulPrzetargu}</Text>
                {o.kiedy ? <Text style={styles.kiedy}>{o.kiedy}</Text> : null}
                {/*
                  Ujawnienie, że data jest WYLICZONA z przepisu, nie jest drobiazgiem:
                  wyliczona to maksimum ustawowe, a ogłoszenie może podać krótszy termin.
                */}
                <Text style={styles.zrodloDaty}>{o.zrodlo}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      {blad ? (
        <Pressable style={styles.pasekBledu} onPress={() => wczytaj()} accessibilityRole="button">
          <Text style={styles.pasekBleduTekst}>{blad} · {t('dotknij, aby ponowić', 'tap to retry')}</Text>
        </Pressable>
      ) : null}

      <Button
        title={t('Alerty i zmiany', 'Alerts and changes')}
        variant="ghost"
        onPress={() => navigation.navigate('CentrumAlertow')}
        style={styles.gap}
      />
    </ScrollView>
  );
}

const tworzStyleKalendarza = tworzStyle((k) => ({
  tlo: { flex: 1, backgroundColor: k.bg },
  tresc: { padding: spacing.lg, paddingBottom: spacing.xl },
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },

  kartaKrok: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    backgroundColor: k.surface,
    gap: 3,
  },
  krokEtykieta: { fontSize: 11, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase' },
  krokCo: { fontSize: 17, fontWeight: '800' },
  krokPrzetarg: { fontSize: 14, color: k.text, fontWeight: '700' },
  krokKiedy: { fontSize: 13, color: k.textMuted },
  krokZostalo: { fontSize: 13, fontWeight: '800' },
  strefa: { fontSize: 11, color: k.textMuted, marginTop: 4, fontStyle: 'italic' },

  nieznane: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: k.wyroznienie,
    fontSize: 12,
    color: k.textMuted,
    lineHeight: 18,
  },

  grupa: { marginTop: spacing.lg },
  grupaTytul: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase' },

  karta: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    gap: 3,
  },
  naglowekKarty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kropka: { width: 8, height: 8, borderRadius: 4 },
  rodzaj: { fontSize: 13, fontWeight: '800' },
  przetarg: { fontSize: 15, fontWeight: '700', color: k.text },
  kiedy: { fontSize: 13, color: k.text },
  zrodloDaty: { fontSize: 11, color: k.textMuted, lineHeight: 16, fontStyle: 'italic' },
  anulowany: { fontSize: 12, color: k.textMuted, fontWeight: '700' },

  pustka: { marginTop: spacing.xl, alignItems: 'center', gap: 6 },
  pustkaIkona: { fontSize: 36 },
  pustkaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  pustkaTekst: { fontSize: 13, color: k.textMuted, lineHeight: 19, textAlign: 'center' },

  pasekBledu: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: k.ostrzezenieTlo },
  pasekBleduTekst: { fontSize: 12, color: k.ostrzezenieTekst, fontWeight: '700' },
  gap: { marginTop: spacing.lg },
}));
