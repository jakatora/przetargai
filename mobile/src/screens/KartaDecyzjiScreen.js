import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { ocenStart, CZYNNIKI, WERDYKTY } from '../lib/kartaDecyzji';

/**
 * „STARTOWAĆ CZY ODPUŚCIĆ?" — karta decyzji. Scala sygnały (dopasowanie, warunki,
 * konkurencyjność, płynność, wadium, termin, marża, umowa) w jeden werdykt GO/ROZWAŻ/ODPUŚĆ
 * z czerwonymi flagami, zanim wykonawca włoży pracę w ofertę. Logika w lib/kartaDecyzji.js.
 */
export default function KartaDecyzjiScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const match = route?.params?.match ?? null;
  const nazwa = match?.tender?.title ?? route?.params?.nazwa ?? null;

  // Prefill dopasowania z oceny AI (jeśli weszliśmy z konkretnego przetargu).
  const [odp, setOdp] = useState(() => {
    const s = match?.confidence_score;
    if (s == null) return {};
    return { dopasowanie: s >= 70 ? 'wysokie' : s >= 40 ? 'srednie' : 'niskie' };
  });

  const w = ocenStart(odp);
  const ton =
    w.werdykt === 'start' ? { tlo: kolory.sukcesTlo, akc: kolory.sukcesAkcent }
    : w.werdykt === 'rozwaz' ? { tlo: kolory.ostrzezenieTlo, akc: kolory.ostrzezenieTekst }
    : { tlo: kolory.dangerTlo, akc: kolory.danger };

  const wybierz = (klucz, wart) => setOdp((prev) => ({ ...prev, [klucz]: wart }));

  return (
    <Screen scroll>
      {nazwa ? <Text style={styles.postepowanie} numberOfLines={2}>{nazwa}</Text> : null}
      <Text style={styles.wstep}>
        Zaznacz, jak wygląda każdy sygnał — od razu ocenię, czy warto startować, i wskażę
        czerwone flagi. Lepiej odpuścić na tym ekranie niż po tygodniu pracy nad ofertą.
      </Text>

      {w.odpowiedziano > 0 ? (
        <View style={[styles.hero, { backgroundColor: ton.tlo, borderColor: ton.akc }]}>
          <Text style={[styles.heroEt, { color: ton.akc }]}>Werdykt</Text>
          <Text style={[styles.heroWerdykt, { color: ton.akc }]}>{WERDYKTY[w.werdykt].etykieta}</Text>
          <Text style={styles.heroOpis}>{WERDYKTY[w.werdykt].opis}</Text>
          <Text style={styles.heroMeta}>Ocena {w.procent}% · odpowiedziano {w.odpowiedziano}/{w.wszystkich}</Text>
          {w.zBlokada ? (
            <View style={[styles.flagi, { borderColor: kolory.danger }]}>
              <Text style={[styles.flagiTytul, { color: kolory.danger }]}>Czerwone flagi</Text>
              {w.blokady.map((b) => (
                <Text key={b.klucz} style={[styles.flaga, { color: kolory.danger }]}>• {b.tekst}</Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.heroPusty}>
          <Text style={styles.heroPustyTekst}>Odpowiedz na pytania poniżej — werdykt pojawi się tutaj.</Text>
        </View>
      )}

      {CZYNNIKI.map((c) => (
        <View key={c.klucz} style={styles.czynnik}>
          <Text style={styles.pytanie}>{c.pytanie}</Text>
          {c.opcje.map((o) => {
            const on = odp[c.klucz] === o.w;
            const blok = Boolean(o.blokada);
            return (
              <Pressable
                key={o.w}
                onPress={() => wybierz(c.klucz, o.w)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.opcja, on && (blok ? styles.opcjaBlok : styles.opcjaOn)]}
              >
                <View style={[styles.kropka, on && (blok ? styles.kropkaBlok : styles.kropkaOn)]} />
                <Text style={[styles.opcjaTekst, on && styles.opcjaTekstOn]}>{o.e}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Text style={styles.stopka}>
        To wsparcie decyzji na podstawie Twojej samooceny — nie zastępuje analizy SWZ ani rachunku.
        Poszczególne sygnały policz dokładniej w kalkulatorach (płynność, cena, punkty).
      </Text>
    </Screen>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, lineHeight: 20 },
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginTop: spacing.sm, marginBottom: spacing.md },

  hero: { borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  heroEt: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  heroWerdykt: { fontSize: 34, fontWeight: '900', marginTop: 4, letterSpacing: 0.5 },
  heroOpis: { fontSize: 14, color: k.text, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  heroMeta: { fontSize: 13, color: k.textMuted, marginTop: 8, fontVariant: ['tabular-nums'] },
  flagi: { alignSelf: 'stretch', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1 },
  flagiTytul: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  flaga: { fontSize: 13, lineHeight: 19, fontWeight: '600' },

  heroPusty: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.lg },
  heroPustyTekst: { fontSize: 13, color: k.textMuted, textAlign: 'center', lineHeight: 19 },

  czynnik: { marginBottom: spacing.lg },
  pytanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  opcja: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1.5, borderColor: k.border, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 14, backgroundColor: k.surface, marginBottom: spacing.sm,
  },
  opcjaOn: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  opcjaBlok: { borderColor: k.danger, backgroundColor: k.dangerTlo },
  kropka: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: k.border },
  kropkaOn: { borderColor: k.blue, backgroundColor: k.blue },
  kropkaBlok: { borderColor: k.danger, backgroundColor: k.danger },
  opcjaTekst: { flex: 1, fontSize: 14, color: k.textMuted, fontWeight: '600', lineHeight: 19 },
  opcjaTekstOn: { color: k.text },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
