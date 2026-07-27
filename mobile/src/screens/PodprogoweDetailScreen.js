import { View, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { etykietaZrodla, flagiPodprogowe, etykietaWartosciNetto } from '../lib/podprogowe';

/**
 * Szczegóły znaleziska podprogowego (ulepszenie „Radar zamówień podprogowych",
 * podzadanie 7/7). Wchodzi się tu z bandu „łatwiejszy start" w MatchFeedScreen.
 *
 * Pokazuje to, po co użytkownik tu przyszedł: JAK wygląda mini-procedura tego
 * zakupu (streszczenie regulaminu zakupowego zamawiającego + link do samego
 * regulaminu na BIP) oraz ILE zostało do terminu składania. Ekran NIC nie liczy —
 * rekord przychodzi gotowy z backendu (repo `zamowienia_podprogowe`), a reguły
 * „kod/liczba → słowo" i kolor odliczania żyją w testowanym `lib/podprogowe.js` +
 * `lib/termin.js`. Kolory wyłącznie z tokenów motyw.js (bez nowych brązów).
 */

/** Akcent banera odliczania wg pilności terminu składania (jak w Radarze SWZ). */
function akcentTerminu(termin, k) {
  if (termin.minal) return k.danger;
  if (termin.pilny) return k.ostrzezenieAkcent;
  if (termin.stan === 'brak') return k.textMuted;
  return k.sukcesAkcent;
}

async function otworzLink(url) {
  if (!url) return;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    /* nie udało się otworzyć przeglądarki — nic nie robimy */
  }
}

export default function PodprogoweDetailScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSzczegolow);
  const { ogloszenie } = route.params;

  const flagi = flagiPodprogowe(ogloszenie.flagi);
  const wartosc = etykietaWartosciNetto(ogloszenie.wartosc_netto, ogloszenie.waluta);
  const termin = opisTerminu(ogloszenie.termin_skladania);
  const akcent = akcentTerminu(termin, kolory);

  return (
    <Screen scroll>
      <View style={styles.naglowek}>
        {ogloszenie.latwiejszy_start ? (
          <Text style={styles.badgeStart}>Łatwiejszy start</Text>
        ) : null}
        <Text style={styles.zrodlo}>{etykietaZrodla(ogloszenie.zrodlo)}</Text>
      </View>

      <Text style={styles.tytul}>{ogloszenie.tytul}</Text>
      {ogloszenie.zamawiajacy ? <Text style={styles.zamawiajacy}>{ogloszenie.zamawiajacy}</Text> : null}

      {/* ── Odliczanie do terminu składania ── */}
      <View style={[styles.baner, { borderColor: akcent }]}>
        <Text style={[styles.banerTytul, { color: akcent }]}>{termin.etykieta}</Text>
        <Text style={styles.banerMeta}>
          {ogloszenie.termin_skladania
            ? `Termin składania ofert: ${formatDate(ogloszenie.termin_skladania)}`
            : 'Zamawiający nie podał terminu składania — sprawdź w ogłoszeniu.'}
        </Text>
      </View>

      {/* ── Fakty ── */}
      <View style={styles.card}>
        {wartosc ? (
          <View style={styles.wiersz}>
            <Text style={styles.wierszEtykieta}>Szacowana wartość</Text>
            <Text style={styles.wierszWartosc}>{wartosc}</Text>
          </View>
        ) : null}
        {ogloszenie.branza ? (
          <View style={styles.wiersz}>
            <Text style={styles.wierszEtykieta}>Branża</Text>
            <Text style={styles.wierszWartosc}>{ogloszenie.branza}</Text>
          </View>
        ) : null}
        {ogloszenie.region ? (
          <View style={styles.wiersz}>
            <Text style={styles.wierszEtykieta}>Region</Text>
            <Text style={styles.wierszWartosc}>{ogloszenie.region}</Text>
          </View>
        ) : null}
        <View style={[styles.wiersz, styles.wierszOstatni]}>
          <Text style={styles.wierszEtykieta}>Data publikacji</Text>
          <Text style={styles.wierszWartosc}>
            {ogloszenie.data_publikacji ? formatDate(ogloszenie.data_publikacji) : 'brak danych'}
          </Text>
        </View>
      </View>

      {flagi.length ? (
        <View style={styles.flagiRzad}>
          {flagi.map((f) => (
            <Text key={f.klucz} style={styles.flagaChip}>{f.etykieta}</Text>
          ))}
        </View>
      ) : null}

      {/* ── Mini-procedura: streszczenie regulaminu ── */}
      <Text style={styles.sekcjaTytul}>Jak wygląda mini-procedura</Text>
      <View style={styles.card}>
        {ogloszenie.regulamin_streszczenie ? (
          <Text style={styles.streszczenie}>{ogloszenie.regulamin_streszczenie}</Text>
        ) : (
          <Text style={styles.streszczenieBrak}>
            {ogloszenie.regulamin_url
              ? 'Streszczenie regulaminu jeszcze niegotowe — otwórz regulamin zakupowy poniżej.'
              : 'Nie znaleźliśmy regulaminu zakupowego zamawiającego. Sprawdź warunki w samym ogłoszeniu.'}
          </Text>
        )}
      </View>

      {ogloszenie.regulamin_url ? (
        <Button
          title="Otwórz regulamin zakupowy"
          variant="ghost"
          onPress={() => otworzLink(ogloszenie.regulamin_url)}
          style={styles.gap}
        />
      ) : null}

      {ogloszenie.link ? (
        <Button
          title={`Otwórz ogłoszenie (${etykietaZrodla(ogloszenie.zrodlo)})`}
          onPress={() => otworzLink(ogloszenie.link)}
          style={styles.gap}
        />
      ) : null}

      <Text style={styles.stopka}>
        Zamówienia podprogowe to zakupy poniżej progu Pzp — zwykle bez wadium i bez KIO,
        z prostszą procedurą wpisaną w regulamin zakupowy zamawiającego. Radar jest
        pomocniczy i nie zastępuje śledzenia źródłowego ogłoszenia.
      </Text>
    </Screen>
  );
}

const tworzStyleSzczegolow = tworzStyle((k) => ({
  naglowek: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  badgeStart: {
    fontSize: 11,
    fontWeight: '800',
    color: k.sukcesAkcent,
    backgroundColor: k.sukcesTlo,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  zrodlo: { fontSize: 12, fontWeight: '700', color: k.textMuted },
  tytul: { fontSize: 22, fontWeight: '800', color: k.text, lineHeight: 28 },
  zamawiajacy: { fontSize: 14, color: k.textMuted, marginTop: 4, marginBottom: spacing.md },

  baner: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: k.surface,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  banerTytul: { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  banerMeta: { fontSize: 13, color: k.textMuted, marginTop: 4, lineHeight: 19 },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  wiersz: { paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: k.border },
  wierszOstatni: { borderBottomWidth: 0 },
  wierszEtykieta: { fontSize: 12, color: k.textMuted, marginBottom: 2 },
  wierszWartosc: { fontSize: 15, color: k.text, fontWeight: '600' },

  flagiRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  flagaChip: {
    fontSize: 11,
    fontWeight: '700',
    color: k.blue,
    backgroundColor: k.wyroznienie,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  streszczenie: { fontSize: 15, color: k.text, lineHeight: 22 },
  streszczenieBrak: { fontSize: 14, color: k.textMuted, lineHeight: 20, fontStyle: 'italic' },

  gap: { marginTop: spacing.md },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
