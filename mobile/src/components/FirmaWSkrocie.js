import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { skrotKartyFirmy, wypelnienieKarty } from '../lib/skrotKarty';

/**
 * „Firma w skrócie” (2026-11-12, runda 7): cztery wiersze karty firmy widoczne od razu w Koncie — użytkownik
 * widzi, na jakiej podstawie aplikacja wybiera przetargi, i jednym stuknięciem poprawia właściwy krok.
 * Bez danych (błąd sieci) komponent się nie pokazuje — pod spodem zostaje zwykły wiersz „Otwórz kartę firmy”.
 */
export default function FirmaWSkrocie({ navigation }) {
  const styles = useStyle(tworzStyleSkrotu);
  const { t } = useJezyk();
  const [karta, setKarta] = useState(null);

  useFocusEffect(useCallback(() => {
    let aktywny = true;
    api.kartaFirmy().then((d) => { if (aktywny && d?.karta) setKarta(d.karta); }).catch(() => {});
    return () => { aktywny = false; };
  }, []));

  if (!karta) return null;
  const wiersze = skrotKartyFirmy(karta);
  const ile = wypelnienieKarty(wiersze);

  return (
    <View style={styles.karta}>
      <View style={styles.naglowek}>
        <Text style={styles.tytul}>{t('Firma w skrócie', 'Company at a glance')}</Text>
        <Text style={[styles.stan, ile < wiersze.length && styles.stanBrak]}>
          {ile === wiersze.length ? t('Komplet', 'Complete') : t(`${ile} z ${wiersze.length}`, `${ile} of ${wiersze.length}`)}
        </Text>
      </View>
      <View style={styles.pasek}>
        {wiersze.map((w) => <View key={w.klucz} style={[styles.pasekKrok, w.wartosc && styles.pasekKrokPelny]} />)}
      </View>
      {wiersze.map((w) => (
        <Pressable
          key={w.klucz}
          style={({ pressed }) => [styles.wiersz, pressed && styles.wierszWcisniety]}
          onPress={() => navigation.navigate('KartaFirmy', { krok: w.krok })}
          accessibilityRole="button"
          accessibilityLabel={`${t(w.etykieta)}: ${w.wartosc ?? t('do uzupełnienia', 'to complete')}`}
        >
          <Text style={styles.etykieta}>{t(w.etykieta)}</Text>
          {w.wartosc
            ? <Text style={styles.wartosc} numberOfLines={2}>{w.wartosc}</Text>
            : <Text style={styles.uzupelnij}>{t('Uzupełnij →', 'Complete →')}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

const tworzStyleSkrotu = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.md },
  naglowek: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tytul: { fontSize: 16, fontWeight: '800', color: k.text },
  stan: { fontSize: 13, fontWeight: '700', color: k.sukcesAkcent },
  stanBrak: { color: k.blue },
  pasek: { flexDirection: 'row', gap: 4, marginTop: spacing.sm, marginBottom: spacing.xs },
  pasekKrok: { flex: 1, height: 4, borderRadius: 2, backgroundColor: k.border },
  pasekKrokPelny: { backgroundColor: k.blue },
  wiersz: { paddingVertical: spacing.sm + 2, borderTopWidth: 1, borderTopColor: k.border, minHeight: 48, justifyContent: 'center' },
  wierszWcisniety: { opacity: 0.6 },
  etykieta: { fontSize: 12, fontWeight: '700', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  wartosc: { fontSize: 15, color: k.text, marginTop: 2, lineHeight: 20 },
  uzupelnij: { fontSize: 15, fontWeight: '700', color: k.blue, marginTop: 2 },
}));
