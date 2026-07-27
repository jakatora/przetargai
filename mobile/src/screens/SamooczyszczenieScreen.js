import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { ELEMENTY, ocenaSamooczyszczenia } from '../lib/samooczyszczenie';

/**
 * Panel „KREATOR SAMOOCZYSZCZENIA (art. 110 ust. 2 Pzp)". Wykonawca z „skazą" (rozwiązana umowa,
 * kary, zaległości, wcześniejsze wykluczenie) może NIE podlegać wykluczeniu, jeśli wykaże trzy
 * elementy łącznie. Ekran to checklista; ocena kompletności w testowanym `lib/samooczyszczenie.js`.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function SamooczyszczenieScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSamo);
  const nazwa = route?.params?.nazwa ?? null;

  const [odp, setOdp] = useState({});
  function przelacz(klucz) { setOdp((o) => ({ ...o, [klucz]: !o[klucz] })); }

  const w = ocenaSamooczyszczenia(odp);
  const t = tonNaTokeny(w.ton, kolory);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Masz w historii firmy skazę — rozwiązaną umowę, kary umowne, zaległości ZUS/US albo
        wcześniejsze wykluczenie? To nie musi kończyć startów. Art. 110 ust. 2 Pzp daje procedurę
        naprawczą: udowodnij trzy rzeczy łącznie, a zamawiający może odstąpić od wykluczenia.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
        <Text style={[styles.werdyktText, { color: t.tekst }]}>{w.zrobione}/3 elementów — {w.powod}</Text>
      </View>

      {ELEMENTY.map((e) => {
        const zrobione = !!odp[e.klucz];
        return (
          <Pressable key={e.klucz} onPress={() => przelacz(e.klucz)} style={styles.element} accessibilityRole="checkbox" accessibilityState={{ checked: zrobione }}>
            <View style={[styles.check, zrobione && { backgroundColor: kolory.green, borderColor: kolory.green }]}>
              {zrobione ? <Text style={styles.checkZnak}>✓</Text> : null}
            </View>
            <View style={styles.elementTresc}>
              <Text style={styles.elementEt}>{e.etykieta}</Text>
              <Text style={styles.elementOpis}>{e.opis}</Text>
            </View>
          </Pressable>
        );
      })}

      <Text style={styles.stopka}>
        Sedno: każdy element trzeba udowodnić DOWODAMI (ugoda, korespondencja z organami, nowe
        procedury), nie deklaracją. Ogólniki zamawiający uzna za niewystarczające. To pomocnik,
        nie porada prawna.
      </Text>
    </Screen>
  );
}

const tworzStyleSamo = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  werdykt: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginBottom: spacing.sm },
  werdyktText: { fontSize: 14, fontWeight: '800', lineHeight: 20 },

  element: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  check: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: k.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkZnak: { color: k.white, fontSize: 16, fontWeight: '900', lineHeight: 20 },
  elementTresc: { flex: 1 },
  elementEt: { fontSize: 15, fontWeight: '700', color: k.text },
  elementOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 3 },
}));
