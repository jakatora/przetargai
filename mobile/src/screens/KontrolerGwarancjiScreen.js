import { useState } from 'react';
import { View, Text, Pressable, Switch } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { ocenaGwarancji, werdykt } from '../lib/gwarancjaWadialna';

/**
 * Panel „KONTROLER GWARANCJI WADIALNEJ — wadium z banku, które nie utopi oferty".
 *
 * Treść gwarancji bankowej/ubezpieczeniowej musi LITERALNIE obejmować wszystkie przesłanki
 * zatrzymania wadium (art. 98 ust. 6 Pzp) — brak jednej = odrzucenie oferty. Ten ekran to
 * checklista: potwierdzasz każdy wymóg, a werdykt „gotowa / nie wnoś" liczy testowany
 * `lib/gwarancjaWadialna.js`. Kolor dokłada motyw.js z semantycznego `ton`.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function KontrolerGwarancjiScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKontrolera);
  const nazwa = route?.params?.nazwa ?? null;

  const [konsorcjum, setKonsorcjum] = useState(false);
  const [odp, setOdp] = useState({});

  function przelacz(klucz) {
    setOdp((o) => ({ ...o, [klucz]: !o[klucz] }));
  }

  const wynik = ocenaGwarancji(odp, { konsorcjum });
  const t = tonNaTokeny(wynik.ton, kolory);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Wnosisz wadium gwarancją bankową lub ubezpieczeniową? Sprawdź jej treść ZANIM trafi do
        oferty. Brak choćby jednej przesłanki z art. 98 ust. 6 Pzp — i oferta jest odrzucana.
        Potwierdź każdy wymóg poniżej.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Werdykt ── */}
      <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
        <Text style={[styles.werdyktText, { color: t.tekst }]}>{werdykt(wynik)}</Text>
      </View>

      {/* ── Oferta wspólna? ── */}
      <View style={styles.przelaczRzad}>
        <View style={styles.przelaczTresc}>
          <Text style={styles.przelaczTytul}>Oferta wspólna (konsorcjum)</Text>
          <Text style={styles.przelaczOpis}>Wtedy gwarancja musi obejmować wszystkich członków.</Text>
        </View>
        <Switch
          value={konsorcjum}
          onValueChange={setKonsorcjum}
          trackColor={{ true: kolory.blue, false: kolory.border }}
        />
      </View>

      {/* ── Checklista wymogów ── */}
      {wynik.wymogi.map((w) => {
        const spelnia = !!odp[w.klucz];
        return (
          <Pressable
            key={w.klucz}
            onPress={() => przelacz(w.klucz)}
            style={styles.wymog}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: spelnia }}
          >
            <View style={[
              styles.check,
              spelnia && { backgroundColor: kolory.green, borderColor: kolory.green },
              !spelnia && w.krytyczny && { borderColor: kolory.danger },
            ]}>
              {spelnia ? <Text style={styles.checkZnak}>✓</Text> : null}
            </View>
            <View style={styles.wymogTresc}>
              <View style={styles.wymogGlowa}>
                <Text style={styles.wymogEtykieta}>{w.etykieta}</Text>
                {w.krytyczny ? <Text style={styles.krytBadge}>krytyczny</Text> : null}
              </View>
              <Text style={styles.wymogOpis}>{w.opis}</Text>
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.stopka}>
        To kontrola pomocnicza treści gwarancji — nie zastępuje analizy prawnej. Najczęstszy
        błąd to pominięcie jednej z przesłanek pkt 1–3 albo za krótka ważność.
      </Text>
    </Screen>
  );
}

const tworzStyleKontrolera = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  werdykt: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginBottom: spacing.md },
  werdyktText: { fontSize: 16, fontWeight: '900', lineHeight: 22 },

  przelaczRzad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  przelaczTresc: { flex: 1 },
  przelaczTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przelaczOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },

  wymog: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  check: {
    width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: k.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkZnak: { color: k.white, fontSize: 16, fontWeight: '900', lineHeight: 20 },
  wymogTresc: { flex: 1 },
  wymogGlowa: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  wymogEtykieta: { fontSize: 14, fontWeight: '700', color: k.text, flexShrink: 1 },
  krytBadge: {
    fontSize: 10, fontWeight: '800', color: k.danger, backgroundColor: k.dangerTlo,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  wymogOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 3 },
}));
