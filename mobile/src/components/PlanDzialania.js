import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { zbudujPlanDzialania } from '../lib/planDzialania';

/** Plan działania do oferty (spec §6.3) — kroki z terminami, każdy otwiera istniejące narzędzie. */
export default function PlanDzialania({ match, plan, navigation, onUpgrade }) {
  const { t } = useJezyk();
  const styles = useStyle(tworzStylePlanu);
  const [terminPytan, setTerminPytan] = useState(null);
  const [swzPowiazana, setSwzPowiazana] = useState(false);
  const tenderId = match?.tender?.id ?? match?.tender_id;

  useEffect(() => {
    if (plan !== 'standard' || !match?.id) return undefined;
    let aktywny = true;
    api.getMatch(match.id).then((d) => { if (aktywny) setTerminPytan(d.match?.termin_pytan ?? null); }).catch(() => {});
    if (tenderId) api.powiazanieSwz(tenderId).then((d) => { if (aktywny) setSwzPowiazana(Boolean(d?.powiazanie)); }).catch(() => {});
    return () => { aktywny = false; };
  }, [plan, match?.id, tenderId]);

  const kroki = zbudujPlanDzialania({ match, terminPytan, swzPowiazana, etap: match?.status ?? null });

  return (
    <View style={styles.box}>
      <Text style={styles.sekcja}>{t('Plan działania do oferty', 'Action plan to your bid')}</Text>
      {plan !== 'standard' ? (
        <View>
          {kroki.slice(0, 3).map((k) => <Text key={k.klucz} style={[styles.krok, styles.zablokowany]}>{`• ${t(k.tytul)}`}</Text>)}
          <Pressable onPress={onUpgrade} accessibilityRole="button">
            <Text style={styles.cta}>{t('Pełny plan z terminami jest w planie Standard →', 'The full plan with deadlines is on the Standard plan →')}</Text>
          </Pressable>
        </View>
      ) : kroki.map((k) => (
        <Pressable
          key={k.klucz}
          disabled={!k.parametry}
          onPress={() => navigation.navigate(k.ekran, k.parametry ?? {})}
          accessibilityRole="button"
          accessibilityState={{ checked: k.wykonany, disabled: !k.parametry }}
          style={styles.wiersz}
        >
          <Text style={[styles.krok, k.wykonany && styles.wykonany, k.pilny && styles.pilny]}>
            {`${k.wykonany ? '✓' : '○'} ${t(k.tytul)}`}
          </Text>
          {k.termin && k.klucz !== 'decyzja' ? (
            <Text style={[styles.termin, k.minal && styles.minal]}>
              {k.minal
                ? t(`termin minął ${formatDate(k.termin)}`, `deadline passed ${formatDate(k.termin)}`)
                : t(`do ${formatDate(k.termin)}`, `by ${formatDate(k.termin)}`)}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const tworzStylePlanu = tworzStyle((k) => ({
  box: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface },
  sekcja: { fontSize: 16, fontWeight: '700', color: k.text, marginBottom: spacing.xs },
  wiersz: { paddingVertical: spacing.xs },
  krok: { fontSize: 14, color: k.text },
  wykonany: { color: k.textMuted, textDecorationLine: 'line-through' },
  pilny: { color: k.ostrzezenieAkcent, fontWeight: '700' },
  zablokowany: { color: k.textMuted },
  termin: { fontSize: 12, color: k.textMuted, marginLeft: spacing.md },
  minal: { color: k.danger },
  cta: { fontSize: 14, fontWeight: '700', color: k.blue, marginTop: spacing.sm },
}));
