import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { podsumujStart, wczytajStart, zapiszStart } from '../lib/przewodnikStartu';

/**
 * „PRZEWODNIK STARTU: CZY JESTEŚ GOTOWY?" — checklista wejścia dla firmy zaczynającej z
 * przetargami (firma, brak wykluczenia, podpis, konto na platformie, dokumenty, profil).
 * Stan firmowy (jeden zapis). Logika w lib/przewodnikStartu.js.
 */
export default function PrzewodnikStartuScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePrzewodnika);

  const [wykonane, setWykonane] = useState(() => new Set());
  const [gotowe, setGotowe] = useState(false);

  useEffect(() => {
    let aktywny = true;
    wczytajStart(storage)
      .then((z) => { if (aktywny) { setWykonane(z); setGotowe(true); } })
      .catch(() => { if (aktywny) setGotowe(true); });
    return () => { aktywny = false; };
  }, []);

  function przelacz(klucz) {
    setWykonane((prev) => {
      const next = new Set(prev);
      if (next.has(klucz)) next.delete(klucz); else next.add(klucz);
      zapiszStart(storage, next).catch(() => {});
      return next;
    });
  }

  if (!gotowe) {
    return <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>;
  }

  const w = podsumujStart(wykonane);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zanim wystartujesz w pierwszym przetargu — sprawdź, czy masz komplet. To minimum bez
        którego nie da się złożyć oferty, plus rzeczy, które warto mieć gotowe.
      </Text>

      <View style={[styles.hero, w.gotowe && { backgroundColor: kolory.sukcesTlo, borderColor: kolory.sukcesAkcent }]}>
        <View style={styles.heroGora}>
          <Text style={[styles.heroTekst, w.gotowe && { color: kolory.sukcesAkcent }]}>
            {w.gotowe ? 'Gotowy do startu ✓' : `Masz ${w.zrobione}/${w.wszystkich}`}
          </Text>
          <Text style={[styles.heroProcent, w.gotowe && { color: kolory.sukcesAkcent }]}>{w.procent}%</Text>
        </View>
        <View style={styles.pasekTlo}>
          <View style={[styles.pasek, { width: `${w.procent}%` }, w.gotowe && { backgroundColor: kolory.sukcesAkcent }]} />
        </View>
        {w.gotowe ? (
          <Text style={styles.heroPod}>Masz komplet — możesz składać oferty. Powodzenia!</Text>
        ) : null}
      </View>

      {w.pozycje.map((p) => (
        <View key={p.klucz} style={styles.pozycja}>
          <Pressable
            onPress={() => przelacz(p.klucz)}
            style={styles.pozGora}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: p.wykonany }}
            accessibilityLabel={p.tytul}
          >
            <View style={[styles.check, p.wykonany && styles.checkOn]}>
              {p.wykonany ? <Text style={styles.checkZnak}>✓</Text> : null}
            </View>
            <View style={styles.tresc}>
              <Text style={[styles.tytul, p.wykonany && styles.tytulZrobiony]}>{p.tytul}</Text>
              <Text style={styles.opis}>{p.opis}</Text>
            </View>
          </Pressable>
          {p.ekran ? (
            <Pressable onPress={() => navigation.navigate(p.ekran)} hitSlop={6} accessibilityRole="button" style={styles.linkRzad}>
              <Text style={styles.link}>Otwórz w aplikacji →</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Text style={styles.stopka}>
        Podpis zaufany (profil zaufany) jest DARMOWY i wystarcza w przetargach krajowych — nie
        musisz kupować kwalifikowanego, dopóki nie startujesz powyżej progów unijnych.
      </Text>
    </Screen>
  );
}

const tworzStylePrzewodnika = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },

  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.md, marginBottom: spacing.lg },
  heroGora: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  heroTekst: { fontSize: 15, fontWeight: '800', color: k.blue },
  heroProcent: { fontSize: 18, fontWeight: '900', color: k.blue, fontVariant: ['tabular-nums'] },
  pasekTlo: { height: 10, borderRadius: 999, backgroundColor: k.neutralneTlo, overflow: 'hidden' },
  pasek: { height: 10, borderRadius: 999, backgroundColor: k.blue },
  heroPod: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm },

  pozycja: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  pozGora: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: k.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: k.blue, borderColor: k.blue },
  checkZnak: { color: k.white, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  tresc: { flex: 1 },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text, lineHeight: 20 },
  tytulZrobiony: { color: k.textMuted },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 3 },
  linkRzad: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: k.border, alignItems: 'flex-start' },
  link: { fontSize: 14, fontWeight: '800', color: k.blue },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
