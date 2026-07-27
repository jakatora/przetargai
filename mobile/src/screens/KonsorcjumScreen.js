import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { sprawdzKonsorcjum, werdyktKonsorcjum } from '../lib/konsorcjum';

/**
 * Panel „STRAŻNIK OŚWIADCZENIA KONSORCJUM (art. 117 ust. 4)". Waliduje spójność podziału zadań:
 * konsorcjant, który POTWIERDZA warunek udziału (doświadczenie/uprawnienia), musi mieć
 * przypisane WYKONANIE tej części — inaczej KIO wychwytuje sprzeczność (odrzucenie). Cała
 * walidacja jest w testowanym `lib/konsorcjum.js`.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

const nowy = () => ({ id: `w${Date.now()}${Math.round(Math.random() * 1e4)}`, nazwa: '', potwierdza: '', wykonuje: '' });

export default function KonsorcjumScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKonsorcjum);
  const nazwa = route?.params?.nazwa ?? null;

  const [warunki, setWarunki] = useState([nowy()]);

  function ustaw(id, pole, v) {
    setWarunki((l) => l.map((w) => (w.id === id ? { ...w, [pole]: v } : w)));
  }
  function dodaj() { setWarunki((l) => [...l, nowy()]); }
  function usun(id) { setWarunki((l) => l.filter((w) => w.id !== id)); }

  const wynik = sprawdzKonsorcjum(warunki);
  const t = tonNaTokeny(wynik.ton, kolory);
  const idBledny = new Set(); // podświetl wiersze z błędem
  wynik.bledy.forEach((b) => {
    const trafiony = warunki.find((w) => (w.nazwa || 'Warunek') === b.warunek && w.potwierdza.trim() === b.potwierdza && w.wykonuje.trim() === b.wykonuje);
    if (trafiony) idBledny.add(trafiony.id);
  });

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Startujesz w konsorcjum? Kto POTWIERDZA warunek udziału (np. doświadczenie), ten musi
        WYKONAĆ przypisaną część — art. 117 ust. 4 Pzp. Przypisanie prac komuś innemu niż
        potwierdzający to sprzeczność, którą KIO wychwytuje. Sprawdź podział poniżej.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
        <Text style={[styles.werdyktText, { color: t.tekst }]}>{werdyktKonsorcjum(wynik)}</Text>
      </View>

      {warunki.map((w, i) => {
        const blad = idBledny.has(w.id);
        return (
          <View key={w.id} style={[styles.card, blad && { borderColor: kolory.danger, borderWidth: 2 }]}>
            <View style={styles.glowa}>
              <Text style={styles.numer}>Warunek {i + 1}</Text>
              <Pressable onPress={() => usun(w.id)} hitSlop={8} accessibilityLabel="Usuń warunek">
                <Text style={styles.usun}>Usuń</Text>
              </Pressable>
            </View>
            <TextField label="Nazwa warunku" value={w.nazwa} onChangeText={(v) => ustaw(w.id, 'nazwa', v)} placeholder="np. Doświadczenie — 2 roboty po 500 tys." />
            <View style={styles.rzad}>
              <TextField label="Potwierdza (firma)" value={w.potwierdza} onChangeText={(v) => ustaw(w.id, 'potwierdza', v)} placeholder="Firma A" style={styles.pole} />
              <TextField label="Wykonuje (firma)" value={w.wykonuje} onChangeText={(v) => ustaw(w.id, 'wykonuje', v)} placeholder="Firma A" style={styles.pole} />
            </View>
            {blad ? (
              <Text style={styles.bladText}>
                Sprzeczność: warunek potwierdza „{w.potwierdza || '—'}", a wykonuje „{w.wykonuje || '—'}".
                Przypisz wykonanie tej części potwierdzającemu.
              </Text>
            ) : null}
          </View>
        );
      })}

      <Button title="+ Dodaj warunek" variant="ghost" onPress={dodaj} style={styles.gap} />

      <Text style={styles.stopka}>
        Uwaga: to konsorcjum (art. 117) — inna instytucja niż poleganie na zasobach podmiotu
        trzeciego (art. 118). To pomocnik walidacji, nie generuje oświadczenia.
      </Text>
    </Screen>
  );
}

const tworzStyleKonsorcjum = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
  gap: { marginTop: spacing.sm },

  werdykt: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginBottom: spacing.sm },
  werdyktText: { fontSize: 15, fontWeight: '900', lineHeight: 21 },

  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  glowa: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  numer: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger },
  rzad: { flexDirection: 'row', gap: spacing.sm },
  pole: { flex: 1 },
  bladText: { fontSize: 12, color: k.danger, lineHeight: 18, marginTop: spacing.xs, fontWeight: '600' },
}));
