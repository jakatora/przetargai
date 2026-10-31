import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { kwotaKrotko } from '../lib/ktoWygrywa';
import { etykietaRodzaju, opisNajnizszejCeny, opisWygranych } from '../lib/profilKonkurenta';

/**
 * Profil konkurenta (2026-10-31, z analizy konkurencji: Tender Vision, przetargi.info, Pressinfo).
 * Wejście z karty „Kto wygrywa”: co ta firma wygrywa u WSZYSTKICH zamawiających — u kogo, w jakich
 * branżach i regionach, za ile, przy ilu ofertach i czy wygrywa najniższą ceną. Dane: ogłoszenia
 * o wyniku w BZP (po NIP-ie) i TED (po nazwie).
 */
export default function ProfilKonkurentaScreen({ route }) {
  const styles = useStyle(tworzStyleProfilu);
  const { kolory } = useTheme();
  const { t } = useJezyk();
  const { nip = null, nazwa = null } = route?.params ?? {};
  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [proba, setProba] = useState(0);

  useEffect(() => {
    let aktywny = true;
    setBlad(null);
    api.profilKonkurenta({ nip, nazwa })
      .then((d) => { if (aktywny) setDane(d); })
      .catch((err) => { if (aktywny) setBlad(err.message); });
    return () => { aktywny = false; };
  }, [nip, nazwa, proba]);

  if (blad) {
    return (
      <Screen>
        <Text style={styles.blad}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => setProba((p) => p + 1)} />
      </Screen>
    );
  }
  if (!dane) {
    return <Screen><ActivityIndicator color={kolory.blue} style={styles.spinner} /></Screen>;
  }

  const tytul = dane.nazwa ?? nazwa ?? t('Wykonawca', 'Contractor');
  if (!dane.znaleziono) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{tytul}</Text>
        <Text style={styles.opis}>{t('Nie mamy jeszcze rozstrzygnięć, w których ta firma wygrała.', 'We have no award notices won by this company yet.')}</Text>
      </Screen>
    );
  }

  const najnizsza = opisNajnizszejCeny(dane.najnizsza_cena, t);
  return (
    <Screen scroll>
      <Text style={styles.tytul}>{tytul}</Text>
      <Text style={styles.podtytul}>
        {[dane.nip ? `NIP ${dane.nip}` : null, dane.maly === true ? t('mała firma', 'small company') : null].filter(Boolean).join(' · ')}
      </Text>

      <View style={styles.karta}>
        <Text style={styles.liczba}>{opisWygranych(dane.wygrane, t)}</Text>
        <Text style={styles.opis}>
          {[kwotaKrotko(dane.wartosc, t), dane.od ? t(`od ${formatDate(dane.od)}`, `since ${formatDate(dane.od)}`) : null,
            t(`u ${dane.liczba_zamawiajacych} zamawiających`, `with ${dane.liczba_zamawiajacych} buyers`)].filter(Boolean).join(' · ')}
        </Text>
        {Number.isFinite(dane.mediana_ofert) ? (
          <Text style={styles.opis}>{t(`Zwykle wygrywa przy ${dane.mediana_ofert} ofertach`, `Usually wins against ${dane.mediana_ofert} bids`)}</Text>
        ) : null}
        {najnizsza ? <Text style={styles.opis}>{najnizsza}</Text> : null}
      </View>

      <Text style={styles.sekcja}>{t('U kogo wygrywa', 'Who awards it')}</Text>
      {dane.zamawiajacy.map((z) => (
        <View key={z.nip ?? z.nazwa} style={styles.wiersz}>
          <Text style={styles.nazwa} numberOfLines={2}>{z.nazwa ?? t('Zamawiający', 'Buyer')}</Text>
          <Text style={styles.opis}>{[opisWygranych(z.wygrane, t), kwotaKrotko(z.wartosc, t)].filter(Boolean).join(' · ')}</Text>
        </View>
      ))}

      {dane.branze.length || dane.wojewodztwa.length || dane.rodzaje.length ? (
        <>
          <Text style={styles.sekcja}>{t('Gdzie i w czym', 'Where and what')}</Text>
          {dane.branze.length ? <Text style={styles.opis}>{dane.branze.map((b) => `${b.nazwa} (${b.wygrane})`).join(', ')}</Text> : null}
          {dane.wojewodztwa.length ? <Text style={styles.opis}>{dane.wojewodztwa.map((w) => `${w.nazwa} (${w.wygrane})`).join(', ')}</Text> : null}
          {dane.rodzaje.length ? <Text style={styles.opis}>{dane.rodzaje.map((r) => `${etykietaRodzaju(r.rodzaj, t)} (${r.wygrane})`).join(', ')}</Text> : null}
        </>
      ) : null}

      <Text style={styles.sekcja}>{t('Ostatnie wygrane', 'Latest wins')}</Text>
      {dane.ostatnie.map((o, i) => (
        <View key={`${o.tytul}-${i}`} style={styles.wiersz}>
          <Text style={styles.nazwa} numberOfLines={2}>{o.tytul ?? t('Postępowanie', 'Procedure')}</Text>
          <Text style={styles.opis} numberOfLines={2}>
            {[o.opublikowano ? formatDate(o.opublikowano) : null, o.zamawiajacy, kwotaKrotko(o.cena, t),
              Number.isFinite(o.liczba_ofert) ? t(`${o.liczba_ofert} ofert`, `${o.liczba_ofert} bids`) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ))}

      {dane.firm_o_tej_nazwie ? (
        <Text style={styles.uwaga}>
          {t(`Tę nazwę ma ${dane.firm_o_tej_nazwie} firm z różnymi NIP-ami — pokazujemy tylko wygrane bez NIP-u (TED).`,
            `${dane.firm_o_tej_nazwie} companies share this name — only wins without a tax ID (TED) are shown.`)}
        </Text>
      ) : null}
      <Text style={styles.zrodlo}>{t('Dane z ogłoszeń o wyniku w BZP i TED. Kwoty tylko ze spójnych ogłoszeń.', 'Data from award notices in BZP and TED. Amounts only from consistent notices.')}</Text>
    </Screen>
  );
}

const tworzStyleProfilu = tworzStyle((k) => ({
  spinner: { marginTop: spacing.lg },
  blad: { fontSize: 14, color: k.danger, lineHeight: 20, marginBottom: spacing.md },
  tytul: { fontSize: 22, fontWeight: '800', color: k.text, lineHeight: 28 },
  podtytul: { fontSize: 13, color: k.textMuted, marginTop: 4 },
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  liczba: { fontSize: 18, fontWeight: '800', color: k.text },
  sekcja: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.xs },
  wiersz: { marginTop: spacing.sm },
  nazwa: { fontSize: 14, fontWeight: '700', color: k.text },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 2 },
  uwaga: { fontSize: 12, color: k.ostrzezenieTekst, lineHeight: 17, marginTop: spacing.md },
  zrodlo: { fontSize: 12, color: k.textMuted, marginTop: spacing.lg, fontStyle: 'italic' },
}));
