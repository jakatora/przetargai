import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import TextField from './TextField';
import Button from './Button';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { PODPOWIEDZI_PYTAN, MAKS_DLUGOSC_PYTANIA, czyMoznaPytacSwz, poprawnePytanie, opisStatusuOdpowiedzi } from '../lib/zapytajSwz';

/**
 * „Zapytaj SWZ” (2026-10-31, z analizy konkurencji: Mimira, SEZAM, Tendium). Wykonawca pyta wprost
 * („czy jest wadium?”) zamiast czytać 80 stron. Odpowiedź pochodzi z treści SWZ tego postępowania,
 * a cytaty backend sprawdza w tekście: wymyślony cytat wraca jako „nieudowodnione”. Bez zapisanej
 * treści SWZ komponent się nie pokazuje (karta analizy niżej mówi, jak ją dodać).
 */
export default function ZapytajSwz({ postepowanieId, trescSwz }) {
  const styles = useStyle(tworzStyleZapytajSwz);
  const { t } = useJezyk();
  const [pytanie, setPytanie] = useState('');
  const [laduje, setLaduje] = useState(false);
  const [blad, setBlad] = useState(null);
  const [odpowiedzi, setOdpowiedzi] = useState([]);

  if (!postepowanieId || !czyMoznaPytacSwz(trescSwz)) return null;

  async function zapytaj(tekst) {
    const p = String(tekst ?? '').trim();
    if (laduje || !poprawnePytanie(p)) return;
    setLaduje(true);
    setBlad(null);
    try {
      const wynik = await api.radarZapytajSwz(postepowanieId, p);
      setOdpowiedzi((stare) => [{ ...wynik, pytanie: p }, ...stare].slice(0, 5));
      setPytanie('');
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLaduje(false);
    }
  }

  return (
    <View style={styles.karta}>
      <Text style={styles.tytul}>{t('Zapytaj SWZ', 'Ask the tender documents')}</Text>
      <Text style={styles.opis}>
        {t('Zadaj pytanie, a odpowiemy z treści SWZ z cytatem, który sprawdzamy w dokumencie.', 'Ask a question and we answer from the documents with a quote we check in the text.')}
      </Text>
      <View style={styles.podpowiedzi}>
        {PODPOWIEDZI_PYTAN.map((p) => (
          <Pressable key={p.pl} accessibilityRole="button" disabled={laduje} onPress={() => zapytaj(t(p.pl, p.en))} style={styles.podpowiedz}>
            <Text style={styles.podpowiedzTekst}>{t(p.pl, p.en)}</Text>
          </Pressable>
        ))}
      </View>
      <TextField
        value={pytanie}
        onChangeText={setPytanie}
        placeholder={t('Albo wpisz własne pytanie…', 'Or type your own question…')}
        maxLength={MAKS_DLUGOSC_PYTANIA}
        onSubmitEditing={() => zapytaj(pytanie)}
        returnKeyType="send"
      />
      <Button title={t('Zapytaj', 'Ask')} onPress={() => zapytaj(pytanie)} loading={laduje} disabled={!poprawnePytanie(pytanie)} />
      {blad ? <Text style={styles.blad}>{blad}</Text> : null}

      {odpowiedzi.map((o, i) => {
        const opis = opisStatusuOdpowiedzi(o.status);
        return (
          <View key={`${o.pytanie}-${i}`} style={styles.odpowiedz}>
            <Text style={styles.pytanie}>{o.pytanie}</Text>
            <Text style={styles.trescOdp}>{o.odpowiedz}</Text>
            <Text style={[styles.status, styles[`ton_${opis.ton}`]]}>{t(opis.pl, opis.en)}</Text>
            {(o.cytaty ?? []).map((c, j) => (
              <Text key={j} style={[styles.cytat, !c.potwierdzony && styles.cytatNiepotwierdzony]}>
                {c.potwierdzony ? '✓ ' : '? '}„{c.tekst}”
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const tworzStyleZapytajSwz = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  tytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: 4 },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  podpowiedzi: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  podpowiedz: { borderWidth: 1, borderColor: k.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  podpowiedzTekst: { fontSize: 12, fontWeight: '600', color: k.blue },
  blad: { fontSize: 13, color: k.danger, lineHeight: 18, marginTop: spacing.sm },
  odpowiedz: { borderTopWidth: 1, borderTopColor: k.border, marginTop: spacing.md, paddingTop: spacing.sm },
  pytanie: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  trescOdp: { fontSize: 14, color: k.text, lineHeight: 20, marginTop: 4 },
  status: { fontSize: 12, fontWeight: '800', marginTop: 6 },
  ton_sukces: { color: k.sukcesAkcent },
  ton_ostrzezenie: { color: k.ostrzezenieTekst },
  ton_neutralne: { color: k.textMuted },
  cytat: { fontSize: 12, color: k.textMuted, fontStyle: 'italic', lineHeight: 17, marginTop: 4 },
  cytatNiepotwierdzony: { color: k.ostrzezenieTekst },
}));
