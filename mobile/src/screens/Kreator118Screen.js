import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { WYJASNIENIE_ART_118 } from '../lib/kreator118Tresc';

/**
 * KROK 1 kreatora „Pożycz doświadczenie" (art. 118 Pzp) — ekran WYJAŚNIENIA ZASAD.
 * Podzadanie 5/12 ulepszenia „Pożycz doświadczenie: kreator polegania na zasobach
 * podmiotu trzeciego".
 *
 * WYŁĄCZNIE render treści merytorycznej (`WYJASNIENIE_ART_118`) — bez logiki
 * formularza, bez API, bez stanu. Tłumaczy prostym językiem, że warunku, którego
 * wykonawca nie spełnia własnym doświadczeniem, można dowieść zasobami innej firmy,
 * i pokazuje DWA filary, na których orzecznictwo KIO/TSUE opiera realność (a nie
 * fikcyjność) takiego udostępnienia. Generowanie zobowiązania, lista pułapek i
 * podpowiedzi z sieci kontaktów to KOLEJNE kroki kreatora (osobne ekrany).
 *
 * Ekran jest cienki: cała treść i jej niezmienniki żyją w `lib/kreator118Tresc.js`
 * (testowanym bez renderera), a tu tylko ją wyświetlamy.
 */
export default function Kreator118Screen() {
  const styles = useStyle(tworzStyleKreatora);
  const { naglowek, wprowadzenie, sekcje, kluczowe_zasady, podstawa_prawna } =
    WYJASNIENIE_ART_118;

  return (
    <Screen scroll>
      {/* Ramka wprowadzająca — pozytywne „nie odpadasz" (ścieżka ratunkowa). */}
      <View style={styles.hero}>
        <Text style={styles.heroKrok}>Krok 1 z 4 · Pożycz doświadczenie</Text>
        <Text style={styles.heroTytul}>{naglowek}</Text>
        <Text style={styles.heroWstep}>{wprowadzenie}</Text>
      </View>

      {/* Dwa filary — każdy jako karta z zakresem, treścią i „wnioskiem na wynos". */}
      <Text style={styles.sectionTitle}>Dwie żelazne zasady</Text>
      {sekcje.map((s, i) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.filarNaglowek}>
            <Text style={styles.filarNumer}>{i + 1}</Text>
            <Text style={styles.filarTytul}>{s.tytul}</Text>
          </View>
          {Array.isArray(s.dotyczy) && s.dotyczy.length > 0 ? (
            <View style={styles.dotyczyRzad}>
              {s.dotyczy.map((d) => (
                <View key={d} style={styles.dotyczyChip}>
                  <Text style={styles.dotyczyText}>{d}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.filarTresc}>{s.tresc}</Text>
          {s.wazne ? (
            <View style={styles.wazneBox}>
              <Text style={styles.wazneEtykieta}>Zapamiętaj</Text>
              <Text style={styles.wazneTekst}>{s.wazne}</Text>
            </View>
          ) : null}
        </View>
      ))}

      {/* Skrót zasad — szybkie „na wynos" przed przejściem dalej. */}
      <Text style={styles.sectionTitle}>W skrócie</Text>
      <View style={styles.card}>
        {kluczowe_zasady.map((z, i) => (
          <View key={i} style={[styles.zasadaRzad, i > 0 && styles.zasadaRzadGap]}>
            <Text style={styles.zasadaKropka}>•</Text>
            <Text style={styles.zasadaTekst}>{z}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.podstawa}>Podstawa prawna: {podstawa_prawna}.</Text>
      <Text style={styles.stopka}>
        Materiał informacyjny przygotowany na podstawie przepisów i orzecznictwa —
        nie zastępuje porady prawnej.
      </Text>
    </Screen>
  );
}

const tworzStyleKreatora = tworzStyle((k) => ({
  hero: {
    backgroundColor: k.wyroznienie,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroKrok: {
    fontSize: 12,
    fontWeight: '700',
    color: k.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  filarNaglowek: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  filarNumer: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: k.blue,
    color: k.white,
    textAlign: 'center',
    lineHeight: 26,
    fontSize: 14,
    fontWeight: '800',
    overflow: 'hidden',
  },
  filarTytul: { flex: 1, fontSize: 16, fontWeight: '700', color: k.text, lineHeight: 22 },
  dotyczyRzad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dotyczyChip: {
    backgroundColor: k.wyroznienie,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dotyczyText: { fontSize: 12, fontWeight: '600', color: k.blue },
  filarTresc: { fontSize: 14, color: k.text, lineHeight: 21, marginTop: spacing.sm },
  wazneBox: {
    backgroundColor: k.wyroznienie,
    borderLeftWidth: 3,
    borderLeftColor: k.blue,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  wazneEtykieta: {
    fontSize: 11,
    fontWeight: '800',
    color: k.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  wazneTekst: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: 3, fontWeight: '600' },
  zasadaRzad: { flexDirection: 'row', gap: spacing.sm },
  zasadaRzadGap: { marginTop: spacing.sm },
  zasadaKropka: { fontSize: 14, color: k.blue, fontWeight: '800', lineHeight: 21 },
  zasadaTekst: { flex: 1, fontSize: 14, color: k.text, lineHeight: 21 },
  podstawa: {
    fontSize: 12,
    color: k.textMuted,
    marginTop: spacing.md,
    lineHeight: 17,
  },
  stopka: {
    fontSize: 12,
    color: k.textMuted,
    lineHeight: 17,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
}));
