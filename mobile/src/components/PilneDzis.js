import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { pilneDzis } from '../lib/pilneDzis';

/**
 * Pasek „Pilne dziś” nad wyborem dnia (2026-11-12, runda 10): zapisane przetargi z terminem w ciągu 3 dni
 * i nieprzeczytane alerty. Gdy nic się nie pali albo lista zapisanych się nie wczytała — komponent znika
 * (żadnego pustego pudełka). `nieprzeczytane` daje ekran (ten sam licznik co dzwonek).
 */
export default function PilneDzis({ navigation, nieprzeczytane = 0 }) {
  const styles = useStyle(tworzStylePilnych);
  const { t } = useJezyk();
  const [zapisane, setZapisane] = useState([]);

  useFocusEffect(useCallback(() => {
    let aktywny = true;
    api.getSaved().then((d) => { if (aktywny && Array.isArray(d?.saved)) setZapisane(d.saved); }).catch(() => {});
    return () => { aktywny = false; };
  }, []));

  const pozycje = pilneDzis({ zapisane, nieprzeczytane });
  if (!pozycje.length) return null;

  return (
    <View style={styles.pudelko} accessibilityRole="summary">
      <Text style={styles.naglowek}>{t('Pilne dziś', 'Urgent today')}</Text>
      {pozycje.map((p) => (
        <Pressable
          key={p.klucz}
          style={({ pressed }) => [styles.wiersz, pressed && styles.wierszWcisniety]}
          onPress={() => (p.rodzaj === 'alerty' ? navigation.navigate('CentrumAlertow') : navigation.navigate('MatchDetail', { match: p.wpis }))}
          accessibilityRole="button"
          accessibilityLabel={`${typeof p.tytul === 'string' ? p.tytul : t(p.tytul)}. ${t(p.opis)}`}
        >
          <View style={[styles.znak, p.rodzaj === 'alerty' && styles.znakAlert]} />
          <View style={styles.tresc}>
            <Text style={styles.tytul} numberOfLines={2}>{typeof p.tytul === 'string' ? p.tytul : t(p.tytul)}</Text>
            <Text style={styles.opis}>{t(p.opis)}</Text>
          </View>
          <Text style={styles.strzalka}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

const tworzStylePilnych = tworzStyle((k) => ({
  pudelko: {
    marginBottom: spacing.md, padding: spacing.md, paddingBottom: spacing.xs, borderRadius: radius.lg,
    backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.ostrzezenieTekst,
  },
  naglowek: { fontSize: 13, fontWeight: '800', color: k.ostrzezenieTekst, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  wiersz: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: k.border },
  wierszWcisniety: { opacity: 0.6 },
  znak: { width: 8, height: 8, borderRadius: 4, backgroundColor: k.ostrzezenieTekst },
  znakAlert: { backgroundColor: k.blue },
  tresc: { flex: 1 },
  tytul: { fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  opis: { fontSize: 13, color: k.textMuted, marginTop: 1 },
  strzalka: { fontSize: 22, color: k.textMuted },
}));
