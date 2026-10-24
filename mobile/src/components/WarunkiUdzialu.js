import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api/client';
import Button from './Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { ETYKIETY_WERDYKTU, ETYKIETY_STATUSU, opisPowodu } from '../lib/warunkiUdzialu';

/**
 * Sekcja „Warunki udziału” w szczegółach (spec §6.2). Porównanie kosztuje (AI), więc
 * na żądanie — chyba że przebieg już je zrobił (`match.warunki`).
 */
export default function WarunkiUdzialu({ match, plan, navigation, onUpgrade }) {
  const { t } = useJezyk();
  const styles = useStyle(tworzStyleWarunkow);
  const [wynik, setWynik] = useState(match?.warunki ? { warunki: match.warunki } : null);
  const [ladowanie, setLadowanie] = useState(false);
  const [pokazTekst, setPokazTekst] = useState(false);

  async function sprawdz() {
    setLadowanie(true);
    try {
      setWynik(await api.warunkiUdzialu(match.id));
    } catch {
      setWynik({ warunki: null, powod: 'niedostepne' });
    } finally {
      setLadowanie(false);
    }
  }

  const tytul = <Text style={styles.sekcja}>{t('Warunki udziału', 'Participation conditions')}</Text>;

  if (plan !== 'standard') {
    return (
      <View style={styles.box}>
        {tytul}
        <Text style={styles.tekst}>{t(opisPowodu('plan'))}</Text>
        <Pressable onPress={onUpgrade} accessibilityRole="button">
          <Text style={styles.cta}>{t('Przejdź na Standard — 99 zł/mc →', 'Upgrade to Standard — PLN 99/mo →')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!wynik) {
    return (
      <View style={styles.box}>
        {tytul}
        <Button title={t('Porównaj z moją firmą', 'Compare with my company')} variant="ghost" loading={ladowanie} onPress={sprawdz} />
      </View>
    );
  }

  const werdykt = wynik.warunki ? ETYKIETY_WERDYKTU[wynik.warunki.werdykt] : null;
  return (
    <View style={styles.box}>
      {tytul}
      {werdykt ? <Text style={[styles.werdykt, styles[werdykt.ton]]}>{t(werdykt.etykieta)}</Text> : null}
      {(wynik.warunki?.wymagania ?? []).map((w) => (
        <Text key={`${w.rodzaj}-${w.wymog}`} style={styles.tekst}>
          {`${ETYKIETY_STATUSU[w.status]?.znak ?? '?'} ${w.wymog}${w.komentarz ? ` — ${w.komentarz}` : ''}`}
        </Text>
      ))}
      {wynik.warunki?.werdykt === 'nie_spelniasz' ? (
        <Pressable onPress={() => navigation.navigate('Konsorcjum')} accessibilityRole="button">
          <Text style={styles.cta}>{t('Wystartuj z partnerem: konsorcjum albo cudze zasoby (art. 118) →', 'Bid with a partner: consortium or third-party resources (art. 118) →')}</Text>
        </Pressable>
      ) : null}
      {!wynik.warunki && opisPowodu(wynik.powod) ? <Text style={styles.tekst}>{t(opisPowodu(wynik.powod))}</Text> : null}
      {wynik.powod === 'brak_karty' ? (
        <Pressable onPress={() => navigation.navigate('KartaFirmy', { krok: 5 })} accessibilityRole="button">
          <Text style={styles.cta}>{t('Uzupełnij kartę firmy →', 'Complete your company card →')}</Text>
        </Pressable>
      ) : null}
      {wynik.tekst ? (
        <Pressable onPress={() => setPokazTekst((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: pokazTekst }}>
          <Text style={styles.cta}>{pokazTekst ? t('Ukryj treść z ogłoszenia', 'Hide notice text') : t('Pokaż treść z ogłoszenia', 'Show notice text')}</Text>
        </Pressable>
      ) : null}
      {pokazTekst && wynik.tekst ? <Text style={styles.cytat}>{wynik.tekst}</Text> : null}
    </View>
  );
}

const tworzStyleWarunkow = tworzStyle((k) => ({
  box: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface },
  sekcja: { fontSize: 16, fontWeight: '700', color: k.text, marginBottom: spacing.xs },
  tekst: { fontSize: 14, color: k.text, marginTop: spacing.xs, lineHeight: 20 },
  cytat: { fontSize: 13, color: k.textMuted, marginTop: spacing.sm, lineHeight: 19 },
  cta: { fontSize: 14, fontWeight: '700', color: k.blue, marginTop: spacing.sm },
  werdykt: { fontSize: 15, fontWeight: '700' },
  sukces: { color: k.sukcesAkcent },
  blad: { color: k.danger },
  ostrzezenie: { color: k.ostrzezenieAkcent },
}));
