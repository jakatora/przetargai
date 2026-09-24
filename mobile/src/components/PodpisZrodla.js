import { View, Text, Pressable, Linking, Alert } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { podpisZrodla, ostrzezenieZrodla, linkDoOryginalu, etykietaOtwarcia } from '../lib/zrodlaDanych';

/** Ton semantyczny → token koloru z motywu. Ekran nie zna hexów. */
export function tonNaKolor(kolory, ton) {
  if (ton === 'ok') return kolory.sukcesAkcent;
  if (ton === 'uwaga') return kolory.ostrzezenieAkcent;
  if (ton === 'blad') return kolory.danger;
  return kolory.textMuted;
}

/**
 * Jedna linijka „skąd i jak świeże" pod ogłoszeniem (P1-3).
 *
 * Wykonawca musi wiedzieć, z którego rejestru pochodzi wpis i kiedy ten rejestr
 * ostatnio u nas odpowiedział. Bez drugiej informacji pusta lista wygląda tak
 * samo przy spokojnym tygodniu i przy padniętym pobieraniu — a to są przeciwne
 * decyzje: raz czekasz, raz idziesz sprawdzić rejestr sam.
 */
export default function PodpisZrodla({ zrodlo, kompakt = false }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePodpisu);
  const { t, jezyk } = useJezyk();

  const podpis = podpisZrodla(zrodlo, Date.now());
  const ostrzezenie = ostrzezenieZrodla(zrodlo);

  return (
    <View style={styles.rzad}>
      <Text
        style={[styles.tekst, { color: tonNaKolor(kolory, podpis.ton) }, kompakt && styles.kompakt]}
        numberOfLines={1}
        accessibilityLabel={`${t({ pl: 'Źródło', en: 'Source' })}: ${podpis.tekst[jezyk] ?? podpis.tekst.pl}`}
      >
        {t(podpis.tekst)}
      </Text>
      {ostrzezenie && !kompakt ? (
        <Text style={[styles.ostrzezenie, { color: tonNaKolor(kolory, ostrzezenie.ton) }]}>
          {t(ostrzezenie.tekst)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Przycisk „Otwórz oryginał w …". Nazywa rejestr, bo to zmienia oczekiwanie:
 * BZP, TED i Baza Konkurencyjności wyglądają i działają zupełnie inaczej.
 */
export function PrzyciskOryginalu({ tender, styl }) {
  const styles = useStyle(tworzStylePodpisu);
  const { t } = useJezyk();
  const adres = linkDoOryginalu(tender);
  if (!adres) return null;

  const otworz = async () => {
    try {
      const mozna = await Linking.canOpenURL(adres);
      if (mozna) await Linking.openURL(adres);
      else Alert.alert(t('Nie można otworzyć linku', 'Cannot open link'), adres);
    } catch {
      Alert.alert(t('Nie można otworzyć linku', 'Cannot open link'), adres);
    }
  };

  return (
    <Pressable onPress={otworz} accessibilityRole="link" style={[styles.link, styl]}>
      <Text style={styles.linkTekst}>{t(etykietaOtwarcia(tender?.zrodlo))} ↗</Text>
    </Pressable>
  );
}

/**
 * To samo postępowanie bywa ogłoszone w dwóch rejestrach (projekt unijny trafia
 * i do BZP, i do Bazy Konkurencyjności). Ofertę składa się tam, gdzie wskazuje
 * ogłoszenie — więc wykonawca musi widzieć OBA adresy, nie tylko ten, z którego
 * akurat pobraliśmy wpis.
 */
export function ZrodlaAlternatywne({ zrodla }) {
  const styles = useStyle(tworzStylePodpisu);
  const { t } = useJezyk();
  const lista = (zrodla ?? []).filter((z) => z?.url);
  if (!lista.length) return null;

  return (
    <View style={styles.alternatywne}>
      <Text style={styles.alternatywneTytul}>
        {t('To samo postępowanie w innym rejestrze', 'The same procedure in another register')}
      </Text>
      {lista.map((z) => (
        <PrzyciskOryginalu key={z.url} tender={{ url: z.url, zrodlo: z }} styl={styles.linkWewnatrz} />
      ))}
    </View>
  );
}

const tworzStylePodpisu = tworzStyle((k) => ({
  rzad: { marginTop: spacing.xs },
  tekst: { fontSize: 12, fontWeight: '600' },
  kompakt: { fontSize: 11 },
  ostrzezenie: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  link: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.blue,
    alignSelf: 'flex-start',
  },
  linkWewnatrz: { marginTop: spacing.xs },
  linkTekst: { color: k.blue, fontWeight: '700', fontSize: 14 },
  alternatywne: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: k.wyroznienie,
  },
  alternatywneTytul: { fontSize: 13, fontWeight: '800', color: k.text },
}));
