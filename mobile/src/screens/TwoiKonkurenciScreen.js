import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { kwotaKrotko } from '../lib/ktoWygrywa';
import { opisWygranych, czyMoznaOtworzycProfil } from '../lib/profilKonkurenta';

/**
 * Twoi konkurenci (2026-10-31, z analizy konkurencji: Tender Vision, Pressinfo). Bez szukania:
 * firmy, które najczęściej wygrywają w branżach (CPV) i regionach z Karty firmy. Dotknięcie firmy
 * otwiera jej profil (co jeszcze wygrywa i u kogo). Dane: ogłoszenia o wyniku w BZP i TED.
 */
export default function TwoiKonkurenciScreen({ navigation }) {
  const styles = useStyle(tworzStyleKonkurentow);
  const { kolory } = useTheme();
  const { t } = useJezyk();
  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [proba, setProba] = useState(0);

  useEffect(() => {
    let aktywny = true;
    setBlad(null);
    api.twoiKonkurenci()
      .then((d) => { if (aktywny) setDane(d); })
      .catch((err) => { if (aktywny) setBlad(err.message); });
    return () => { aktywny = false; };
  }, [proba]);

  if (blad) {
    return (
      <Screen>
        <Text style={styles.blad}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => setProba((p) => p + 1)} />
      </Screen>
    );
  }
  if (!dane) return <Screen><ActivityIndicator color={kolory.blue} style={styles.spinner} /></Screen>;

  if (!dane.dostepne || !dane.konkurenci?.length) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Twoi konkurenci', 'Your competitors')}</Text>
        <Text style={styles.opis}>
          {dane.dostepne
            ? t('W Twoich branżach i regionach jest jeszcze za mało rozstrzygnięć, żeby wskazać stałych zwycięzców.', 'There are not enough award notices in your industries and regions yet to name regular winners.')
            : t('Dodaj kody CPV w Karcie firmy — pokażemy, kto najczęściej wygrywa w Twoich branżach i regionach.', 'Add CPV codes in your company card and we will show who wins most often in your industries and regions.')}
        </Text>
        <Button title={t('Otwórz kartę firmy', 'Open company card')} variant="ghost" onPress={() => navigation.navigate('KartaFirmy')} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{t('Twoi konkurenci', 'Your competitors')}</Text>
      <Text style={styles.opis}>
        {dane.zakresy.map((z) => `${z.branza} (${z.zakres === 'region' ? t('Twoje regiony', 'your regions') : t('cała Polska', 'all of Poland')})`).join(', ')}
      </Text>

      {dane.konkurenci.map((k, i) => {
        const daSie = czyMoznaOtworzycProfil(k);
        return (
          <Pressable
            key={k.nip ?? k.nazwa}
            style={styles.wiersz}
            accessibilityRole="button"
            disabled={!daSie}
            onPress={() => navigation.navigate('ProfilKonkurenta', { nip: k.nip ?? null, nazwa: k.nazwa })}
          >
            <Text style={styles.nazwa} numberOfLines={2}>{`${i + 1}. ${k.nazwa}`}</Text>
            <Text style={styles.opis}>{[opisWygranych(k.wygrane, t), kwotaKrotko(k.wartosc, t), k.branze.join(', ')].filter(Boolean).join(' · ')}</Text>
            {daSie ? <Text style={styles.link}>{t('Profil konkurenta →', 'Competitor profile →')}</Text> : null}
          </Pressable>
        );
      })}

      <Text style={styles.zrodlo}>{t('Dane z ogłoszeń o wyniku w BZP i TED, liczone przy każdym przeliczeniu benchmarku rynku. Twoja firma (po NIP-ie) jest pominięta.', 'Data from award notices in BZP and TED, refreshed with the market benchmark. Your own company (by tax ID) is excluded.')}</Text>
    </Screen>
  );
}

const tworzStyleKonkurentow = tworzStyle((k) => ({
  spinner: { marginTop: spacing.lg },
  blad: { fontSize: 14, color: k.danger, lineHeight: 20, marginBottom: spacing.md },
  tytul: { fontSize: 22, fontWeight: '800', color: k.text, lineHeight: 28 },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4 },
  wiersz: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  nazwa: { fontSize: 15, fontWeight: '700', color: k.text },
  link: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: 4 },
  zrodlo: { fontSize: 12, color: k.textMuted, marginTop: spacing.lg, fontStyle: 'italic' },
}));
