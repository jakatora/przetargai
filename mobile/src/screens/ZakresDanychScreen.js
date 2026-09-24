import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, Linking } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { tonNaKolor } from '../components/PodpisZrodla';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { tonStanu, opisSynchronizacji } from '../lib/zrodlaDanych';

/*
 * „Zakres danych" (P1-4) — ekran, który mówi, czego aplikacja NIE widzi.
 *
 * Produkt zbierający ogłoszenia z trzech rejestrów bardzo łatwo czyta się jako
 * „wszystkie przetargi w Polsce". To nieprawda i nie da się tego naprawić kodem:
 * BIP-y zamawiających, platformy zakupowe bez publicznego API i zamówienia
 * prywatne nie mają feedu, z którego dałoby się je legalnie pobrać. Wykonawca,
 * który uwierzy w komplet, przegapi postępowanie i obwini aplikację — słusznie.
 *
 * Dlatego ten ekran nie jest „statusem systemu" dla ciekawskich. To jest
 * zobowiązanie: stan każdego rejestru z czasem ostatniego sukcesu I lista
 * rzeczy poza zasięgiem.
 */

function Odznaka({ stan, styles, kolory, t }) {
  const ton = tonStanu(stan);
  const napis = {
    ok: { pl: 'Działa', en: 'Working' },
    opoznione: { pl: 'Opóźnione', en: 'Delayed' },
    awaria: { pl: 'Awaria', en: 'Failure' },
    wylaczone: { pl: 'Wyłączone', en: 'Off' },
    brak_danych: { pl: 'Brak śladu', en: 'No record' },
  }[stan] ?? { pl: '—', en: '—' };

  return (
    <Text style={[styles.odznaka, { color: tonNaKolor(kolory, ton), borderColor: tonNaKolor(kolory, ton) }]}>
      {t(napis)}
    </Text>
  );
}

export default function ZakresDanychScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleZakresu);
  const { t } = useJezyk();

  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);

  const wczytaj = useCallback(async () => {
    setLadowanie(true);
    try {
      setDane(await api.getZakresDanych());
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
    }
  }, []);

  useEffect(() => { wczytaj(); }, [wczytaj]);

  if (ladowanie && !dane) {
    return (
      <Screen>
        <View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </Screen>
    );
  }

  if (blad && !dane) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Nie udało się sprawdzić zakresu danych', 'Could not check data coverage')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} style={styles.gap} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{t('Skąd pochodzą przetargi', 'Where the tenders come from')}</Text>
      <Text style={styles.akapit}>
        {t(
          'Monitorujemy poniższe rejestry publiczne. Przy każdym widzisz, kiedy ostatnio udało się z niego pobrać dane.',
          'We monitor the public registers below. Each shows when data was last fetched from it successfully.',
        )}
      </Text>

      {(dane?.zrodla ?? []).map((z) => {
        const sync = opisSynchronizacji(z.ostatni_sukces_o, Date.now());
        return (
          <View key={z.kod} style={styles.karta}>
            <View style={styles.naglowekKarty}>
              <Text style={styles.nazwa}>{t(z.nazwa)}</Text>
              <Odznaka stan={z.stan} styles={styles} kolory={kolory} t={t} />
            </View>

            <Text style={styles.opis}>{t(z.zakres)}</Text>
            <Text style={[styles.stan, { color: tonNaKolor(kolory, tonStanu(z.stan)) }]}>{t(z.stan_opis)}</Text>

            <Text style={styles.meta}>
              {t('Ostatnie udane pobranie', 'Last successful fetch')}: {t(sync.tekst)}
            </Text>
            {/*
              Historia błędu zostaje widoczna nawet po udanym pobraniu — „padło raz
              w lipcu" i „padło dziś" to zupełnie inne informacje dla operatora.
            */}
            {z.ostatni_blad ? (
              <Text style={styles.metaBlad}>
                {t('Ostatni błąd', 'Last error')}: {z.ostatni_blad}
              </Text>
            ) : null}

            {z.pokrycie ? (
              <Text style={styles.pokrycie}>{t(z.pokrycie.opis)}</Text>
            ) : null}

            {z.rejestr ? (
              <Pressable onPress={() => Linking.openURL(z.rejestr).catch(() => {})} accessibilityRole="link">
                <Text style={styles.link}>{z.rejestr} ↗</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.tytulSekcji}>{t('Czego NIE obejmujemy', 'What we do NOT cover')}</Text>
      {(dane?.nieobjete ?? []).map((n) => (
        <View key={n.kod} style={styles.kartaBraku}>
          <Text style={styles.brakTytul}>{t(n.tytul)}</Text>
          <Text style={styles.brakOpis}>{t(n.opis)}</Text>
        </View>
      ))}

      {dane?.zastrzezenie ? (
        <View style={styles.zastrzezenie}>
          <Text style={styles.zastrzezenieTekst}>{t(dane.zastrzezenie)}</Text>
        </View>
      ) : null}

      <Button title={t('Odśwież', 'Refresh')} variant="ghost" onPress={wczytaj} style={styles.gap} />
    </Screen>
  );
}

const tworzStyleZakresu = tworzStyle((k) => ({
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  tytulSekcji: { fontSize: 17, fontWeight: '800', color: k.text, marginTop: spacing.lg },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  karta: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    gap: 4,
  },
  naglowekKarty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  nazwa: { flex: 1, fontSize: 15, fontWeight: '800', color: k.text },
  odznaka: {
    fontSize: 11,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  stan: { fontSize: 13, fontWeight: '700', lineHeight: 19 },
  meta: { fontSize: 12, color: k.textMuted },
  metaBlad: { fontSize: 12, color: k.danger },
  pokrycie: { fontSize: 12, color: k.textMuted, fontStyle: 'italic' },
  link: { fontSize: 12, color: k.blue, fontWeight: '700', marginTop: 2 },
  kartaBraku: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: k.wyroznienie,
  },
  brakTytul: { fontSize: 14, fontWeight: '800', color: k.text },
  brakOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 2 },
  zastrzezenie: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieAkcent,
    backgroundColor: k.ostrzezenieTlo,
  },
  zastrzezenieTekst: { fontSize: 13, color: k.ostrzezenieTekst, lineHeight: 19, fontWeight: '600' },
  gap: { marginTop: spacing.lg },
}));
