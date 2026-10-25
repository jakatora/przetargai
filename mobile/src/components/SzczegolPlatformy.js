import { useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import Button from './Button';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';

/**
 * Szczegół postępowania z platformazakupowa.pl NA ŻĄDANIE (2026-10-25): lista platformy daje tylko
 * tytuł, zamawiającego i termin; tryb, rodzaj, datę publikacji, wymagania i ZAŁĄCZNIKI (SWZ) dociąga
 * backend po dotknięciu i zapamiętuje przy ogłoszeniu — kolejni oglądający nie czekają. Plików nie
 * pobieramy sami: każdy załącznik to link, który otwiera się w przeglądarce (jedno dotknięcie).
 * Pokazuje się tylko dla `source === 'platformazakupowa'`.
 */
export default function SzczegolPlatformy({ tender }) {
  const styles = useStyle(tworzStyleSzczegolu);
  const { t } = useJezyk();
  const [stan, setStan] = useState({ laduje: false, szczegol: null, blad: null });
  const kod = tender?.zrodlo?.kod ?? tender?.source;
  if (kod !== 'platformazakupowa' || !tender?.id) return null;

  async function pobierz() {
    setStan({ laduje: true, szczegol: null, blad: null });
    try {
      const w = await api.szczegolPlatformy(tender.id);
      setStan({ laduje: false, szczegol: w.szczegol ?? null, blad: null });
    } catch (err) {
      setStan({ laduje: false, szczegol: null, blad: err.message });
    }
  }

  const sz = stan.szczegol;
  return (
    <View style={styles.box}>
      {!sz ? (
        <Button title={t('Pobierz tryb i załączniki z platformy', 'Fetch mode and attachments from the platform')} variant="ghost" loading={stan.laduje} onPress={pobierz} />
      ) : null}
      {stan.blad ? <Text style={styles.blad}>{stan.blad}</Text> : null}
      {sz ? (
        <View>
          {sz.tryb ? <Text style={styles.wiersz}><Text style={styles.etykieta}>{t('Tryb', 'Mode')}: </Text>{sz.tryb}{sz.rodzaj ? ` · ${sz.rodzaj}` : ''}</Text> : null}
          {sz.opublikowano ? <Text style={styles.wiersz}><Text style={styles.etykieta}>{t('Opublikowano', 'Published')}: </Text>{formatDate(sz.opublikowano)}</Text> : null}
          {sz.wymagania ? (
            <Text style={styles.wymagania} numberOfLines={8}>{sz.wymagania}</Text>
          ) : null}
          {sz.zalaczniki?.length ? (
            <View style={styles.zalaczniki}>
              <Text style={styles.etykieta}>{t('Załączniki', 'Attachments')} ({sz.zalaczniki.length})</Text>
              {sz.zalaczniki.map((z, i) => (
                <Pressable key={`${z.url ?? z.nazwa}-${i}`} accessibilityRole="link" disabled={!z.url} onPress={() => Linking.openURL(z.url).catch(() => {})} style={styles.zalacznik}>
                  <Text style={z.url ? styles.zalacznikLink : styles.zalacznikTekst} numberOfLines={2}>
                    {z.nazwa}{z.rozmiar_kb ? ` · ${z.rozmiar_kb >= 1024 ? `${(z.rozmiar_kb / 1024).toFixed(1)} MB` : `${z.rozmiar_kb} kB`}` : ''}
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.podpis}>{t('Otwierają się na platformazakupowa.pl — bez logowania.', 'They open on platformazakupowa.pl — no sign-in needed.')}</Text>
            </View>
          ) : (
            <Text style={styles.podpis}>{t('Platforma nie wymienia załączników przy tym postępowaniu.', 'The platform lists no attachments for this procedure.')}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const tworzStyleSzczegolu = tworzStyle((k) => ({
  box: { marginTop: spacing.sm },
  wiersz: { fontSize: 13, color: k.text, lineHeight: 19, marginBottom: 4 },
  etykieta: { fontWeight: '700', color: k.text, fontSize: 13 },
  wymagania: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.sm },
  zalaczniki: { marginTop: spacing.xs, gap: 6 },
  zalacznik: { backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: spacing.sm },
  zalacznikLink: { fontSize: 13, color: k.blue, fontWeight: '600' },
  zalacznikTekst: { fontSize: 13, color: k.text },
  podpis: { fontSize: 12, color: k.textMuted, marginTop: spacing.xs, lineHeight: 17 },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.xs },
}));
