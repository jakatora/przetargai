import { useState } from 'react';
import { View, Text, Pressable, Switch } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { PRZESLANKI, ocenaZastrzezenia } from '../lib/tajemnica';

/**
 * Panel „TARCZA TAJEMNICY PRZEDSIĘBIORSTWA". Dla każdego dokumentu, który chcesz zastrzec,
 * potwierdź trzy przesłanki (art. 11 ust. 2 uznk) — inaczej KIO odtajni. Elementów jawnych z
 * mocy ustawy (cena, nazwa) zastrzec się nie da. Ocena w testowanym `lib/tajemnica.js`.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

const nowy = () => ({ id: `d${Date.now()}${Math.round(Math.random() * 1e4)}`, nazwa: '', jawny: false });

export default function TajemnicaScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleTajemnicy);
  const nazwa = route?.params?.nazwa ?? null;

  const [dokumenty, setDokumenty] = useState([nowy()]);

  function ustaw(id, pole, v) { setDokumenty((l) => l.map((d) => (d.id === id ? { ...d, [pole]: v } : d))); }
  function dodaj() { setDokumenty((l) => [...l, nowy()]); }
  function usun(id) { setDokumenty((l) => l.filter((d) => d.id !== id)); }

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Po otwarciu ofert konkurencja przeczyta m.in. kosztorys, wykaz osób i wyjaśnienia ceny.
        Chcesz coś zastrzec jako tajemnicę? Musisz wykazać TRZY przesłanki — inaczej KIO odtajni,
        a Ty stracisz czas. Ceny i nazwy firmy zastrzec się nie da.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {dokumenty.map((d, i) => {
        const w = ocenaZastrzezenia(d);
        const t = tonNaTokeny(w.ton, kolory);
        return (
          <View key={d.id} style={styles.card}>
            <View style={styles.glowa}>
              <Text style={styles.numer}>Dokument {i + 1}</Text>
              <Pressable onPress={() => usun(d.id)} hitSlop={8} accessibilityLabel="Usuń dokument">
                <Text style={styles.usun}>Usuń</Text>
              </Pressable>
            </View>
            <TextField label="Co chcesz zastrzec" value={d.nazwa} onChangeText={(v) => ustaw(d.id, 'nazwa', v)} placeholder="np. Wykaz osób, kalkulacja ceny" />

            <View style={styles.przelaczRzad}>
              <View style={styles.przelaczTresc}>
                <Text style={styles.przelaczTytul}>To element jawny z mocy ustawy?</Text>
                <Text style={styles.przelaczOpis}>Cena, nazwa/firma wykonawcy — tego nie można zastrzec (art. 222 ust. 5).</Text>
              </View>
              <Switch value={d.jawny} onValueChange={(v) => ustaw(d.id, 'jawny', v)} trackColor={{ true: kolory.danger, false: kolory.border }} />
            </View>

            {!d.jawny ? PRZESLANKI.map((p) => {
              const spelnia = !!d[p.klucz];
              return (
                <Pressable key={p.klucz} onPress={() => ustaw(d.id, p.klucz, !spelnia)} style={styles.przeslanka} accessibilityRole="checkbox" accessibilityState={{ checked: spelnia }}>
                  <View style={[styles.check, spelnia && { backgroundColor: kolory.green, borderColor: kolory.green }]}>
                    {spelnia ? <Text style={styles.checkZnak}>✓</Text> : null}
                  </View>
                  <View style={styles.przeslankaTresc}>
                    <Text style={styles.przeslankaEt}>{p.etykieta}</Text>
                    <Text style={styles.przeslankaOpis}>{p.opis}</Text>
                  </View>
                </Pressable>
              );
            }) : null}

            <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
              <Text style={[styles.werdyktText, { color: t.tekst }]}>{w.powod}</Text>
            </View>
          </View>
        );
      })}

      <Button title="+ Dodaj dokument" variant="ghost" onPress={dodaj} style={styles.gap} />

      <Text style={styles.stopka}>
        Zastrzeżenie i jego uzasadnienie musisz złożyć najpóźniej w terminie składania ofert. To
        pomocnik oceny — nie generuje uzasadnienia.
      </Text>
    </Screen>
  );
}

const tworzStyleTajemnicy = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
  gap: { marginTop: spacing.sm },

  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  glowa: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  numer: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger },

  przelaczRzad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
  przelaczTresc: { flex: 1 },
  przelaczTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przelaczOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },

  przeslanka: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  check: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: k.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkZnak: { color: k.white, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  przeslankaTresc: { flex: 1 },
  przeslankaEt: { fontSize: 14, fontWeight: '700', color: k.text },
  przeslankaOpis: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: 2 },

  werdykt: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, marginTop: spacing.md },
  werdyktText: { fontSize: 13, fontWeight: '700', lineHeight: 19 },
}));
