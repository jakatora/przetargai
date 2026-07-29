import { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { symuluj, KIERUNKI } from '../lib/symulatorPunktacji';

/**
 * „SYMULATOR PUNKTACJI OFERTY". Liczy punkty w każdym kryterium i łącznie wg wzoru
 * proporcjonalnego Pzp — widać, gdzie tracisz punkty i czy warto docisnąć kryteria
 * pozacenowe zamiast schodzić z ceną. Cała arytmetyka w lib/symulatorPunktacji.js.
 */

const oczysc = (t) => t.replace(/[^0-9., ]/g, '');

/** Kompaktowe, etykietowane pole liczbowe (trójka w rzędzie). */
function Pole({ styles, kolory, etykieta, value, onChangeText }) {
  return (
    <View style={styles.pole}>
      <Text style={styles.poleLabel}>{etykieta}</Text>
      <TextInput
        style={styles.poleInput}
        value={value}
        onChangeText={(t) => onChangeText(oczysc(t))}
        placeholder="0"
        placeholderTextColor={kolory.textMuted}
        keyboardType="decimal-pad"
        accessibilityLabel={etykieta}
      />
    </View>
  );
}

export default function SymulatorPunktacjiScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSymulatora);
  const nazwa = route?.params?.nazwa ?? null;
  const licznik = useRef(2);

  const [kryteria, setKryteria] = useState([
    { id: 'c', nazwa: 'Cena', kierunek: 'min', waga: '60', twoja: '', najlepsza: '' },
    { id: 'k1', nazwa: 'Gwarancja', kierunek: 'max', waga: '40', twoja: '', najlepsza: '' },
  ]);

  const ustaw = (id, pole, v) =>
    setKryteria((prev) => prev.map((k) => (k.id === id ? { ...k, [pole]: v } : k)));
  const dodaj = () =>
    setKryteria((prev) => [...prev, { id: `k${licznik.current++}`, nazwa: '', kierunek: 'max', waga: '', twoja: '', najlepsza: '' }]);
  const usun = (id) =>
    setKryteria((prev) => (prev.length > 1 ? prev.filter((k) => k.id !== id) : prev));

  const wynik = symuluj(kryteria);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Sprawdź, ile punktów realnie zdobędziesz. Wpisz kryteria z SWZ (wagę w punktach),
        swoją wartość i najlepszą w rynku — pokażemy, gdzie tracisz punkty.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* Wynik — hero */}
      <View style={styles.hero}>
        <Text style={styles.heroEt}>Twój wynik</Text>
        <Text style={styles.heroKwota}>
          {String(wynik.sumaPkt).replace('.', ',')} / {String(wynik.sumaWag).replace('.', ',')} pkt
        </Text>
        <View style={styles.heroPasekTlo}>
          <View style={[styles.heroPasek, { width: `${Math.min(100, wynik.procent)}%` }]} />
        </View>
        <Text style={styles.heroPod}>{String(wynik.procent).replace('.', ',')}% możliwych punktów</Text>
      </View>

      {kryteria.map((k, i) => {
        const poz = wynik.pozycje[i];
        const maks = Number(String(k.waga).replace(',', '.')) || 0;
        const udzial = poz?.pkt != null && maks > 0 ? Math.min(100, (poz.pkt / maks) * 100) : 0;
        return (
          <View key={k.id} style={styles.krytCard}>
            <View style={styles.krytGora}>
              <TextInput
                style={styles.krytNazwa}
                value={k.nazwa}
                onChangeText={(t) => ustaw(k.id, 'nazwa', t)}
                placeholder="Nazwa kryterium"
                placeholderTextColor={kolory.textMuted}
                accessibilityLabel="Nazwa kryterium"
              />
              {kryteria.length > 1 ? (
                <Pressable onPress={() => usun(k.id)} hitSlop={10} accessibilityLabel="Usuń kryterium">
                  <Text style={styles.usun}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.kierunki}>
              {KIERUNKI.map((kr) => {
                const on = k.kierunek === kr.wartosc;
                return (
                  <Pressable
                    key={kr.wartosc}
                    onPress={() => ustaw(k.id, 'kierunek', kr.wartosc)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.kierChip, on && styles.kierChipOn]}
                  >
                    <Text style={[styles.kierTekst, on && styles.kierTekstOn]}>{kr.etykieta}</Text>
                    <Text style={[styles.kierPod, on && styles.kierTekstOn]}>{kr.przyklad}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.polaRzad}>
              <Pole styles={styles} kolory={kolory} etykieta="Waga (pkt)" value={k.waga} onChangeText={(v) => ustaw(k.id, 'waga', v)} />
              <Pole styles={styles} kolory={kolory} etykieta="Twoja" value={k.twoja} onChangeText={(v) => ustaw(k.id, 'twoja', v)} />
              <Pole styles={styles} kolory={kolory} etykieta="Najlepsza" value={k.najlepsza} onChangeText={(v) => ustaw(k.id, 'najlepsza', v)} />
            </View>

            <View style={styles.wynikRzad}>
              <View style={styles.pasekTlo}>
                <View style={[styles.pasek, { width: `${udzial}%` }]} />
              </View>
              <Text style={styles.pktTekst}>
                {poz?.pkt != null ? `${String(poz.pkt).replace('.', ',')} / ${String(maks).replace('.', ',')} pkt` : '— uzupełnij dane'}
              </Text>
            </View>
          </View>
        );
      })}

      <Button title="+ Dodaj kryterium" variant="ghost" onPress={dodaj} style={styles.dodaj} />

      <Text style={styles.stopka}>
        „Najlepsza" to najkorzystniejsza wartość spośród ofert (może być Twoja). Wzory
        proporcjonalne wg SWZ — sprawdź, czy zamawiający nie stosuje punktacji progowej
        (tabela). To pomocnik strategiczny, nie gwarancja wyniku.
      </Text>
    </Screen>
  );
}

const tworzStyleSymulatora = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },

  hero: {
    backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg,
  },
  heroEt: { fontSize: 12, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroKwota: { fontSize: 30, fontWeight: '900', color: k.blue, marginTop: 6, fontVariant: ['tabular-nums'] },
  heroPasekTlo: { alignSelf: 'stretch', height: 10, borderRadius: 999, backgroundColor: k.neutralneTlo, overflow: 'hidden', marginTop: spacing.md },
  heroPasek: { height: 10, borderRadius: 999, backgroundColor: k.blue },
  heroPod: { fontSize: 13, color: k.textMuted, marginTop: 8, fontVariant: ['tabular-nums'] },

  krytCard: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.md },
  krytGora: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  krytNazwa: { flex: 1, fontSize: 16, fontWeight: '800', color: k.text, paddingVertical: 4 },
  usun: { fontSize: 16, color: k.textMuted, fontWeight: '700', paddingHorizontal: 4 },

  kierunki: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  kierChip: { flex: 1, borderWidth: 1.5, borderColor: k.border, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: k.surface },
  kierChipOn: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  kierTekst: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  kierPod: { fontSize: 11, color: k.textMuted, marginTop: 1 },
  kierTekstOn: { color: k.blue },

  polaRzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  pole: { flex: 1 },
  poleLabel: { fontSize: 11, fontWeight: '700', color: k.textMuted, marginBottom: 4 },
  poleInput: {
    borderWidth: 1.5, borderColor: k.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 10,
    fontSize: 15, color: k.text, backgroundColor: k.surface, fontVariant: ['tabular-nums'],
  },

  wynikRzad: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pasekTlo: { flex: 1, height: 8, borderRadius: 999, backgroundColor: k.neutralneTlo, overflow: 'hidden' },
  pasek: { height: 8, borderRadius: 999, backgroundColor: k.sukcesAkcent },
  pktTekst: { fontSize: 13, fontWeight: '800', color: k.text, fontVariant: ['tabular-nums'], minWidth: 96, textAlign: 'right' },

  dodaj: { marginTop: 2 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
