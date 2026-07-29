import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { obliczTermin, TRYBY, SZABLONY } from '../lib/kalkulatorTerminow';

/**
 * Panel „KALKULATOR TERMINÓW Pzp". Liczy datę graniczną „N dni od zdarzenia" z polskimi
 * dniami wolnymi (soboty/niedziele/święta stałe i ruchome) i przesunięciem z dnia wolnego
 * (art. 115 KC). Cały rachunek żyje w testowanym `lib/kalkulatorTerminow.js`.
 */
export default function KalkulatorTerminowScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKalkulatora);
  const nazwa = route?.params?.nazwa ?? null;

  const [data, setData] = useState('');
  const [dni, setDni] = useState('');
  const [tryb, setTryb] = useState('kalendarzowe');

  const wynik = obliczTermin({ dataZdarzenia: data, dni, tryb });

  function zastosujSzablon(s) {
    setDni(String(s.dni));
    setTryb(s.tryb);
  }

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Policz datę graniczną „N dni od zdarzenia" z uwzględnieniem polskich dni wolnych
        (soboty, niedziele, święta stałe i ruchome). Jeśli koniec wypada w dzień wolny,
        przesuwamy go na najbliższy dzień roboczy (art. 115 KC).
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={styles.card}>
        <TextField
          label="Data zdarzenia (RRRR-MM-DD)"
          value={data}
          onChangeText={setData}
          placeholder="2026-03-15"
          autoCapitalize="none"
          hint="Np. dzień przekazania informacji o wyniku albo publikacji SWZ."
        />
        <TextField
          label="Liczba dni"
          value={dni}
          onChangeText={(t) => setDni(t.replace(/[^0-9]/g, ''))}
          placeholder="5"
          keyboardType="number-pad"
        />

        <Text style={styles.etykieta}>Sposób liczenia</Text>
        <View style={styles.chipy}>
          {TRYBY.map((t) => {
            const aktywny = tryb === t.wartosc;
            return (
              <Pressable
                key={t.wartosc}
                onPress={() => setTryb(t.wartosc)}
                accessibilityRole="radio"
                accessibilityState={{ selected: aktywny }}
                style={[styles.chip, aktywny && styles.chipAktywny]}
              >
                <Text style={[styles.chipTekst, aktywny && styles.chipTekstAktywny]}>{t.etykieta}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {wynik.ok ? (
        <View style={[styles.wynikCard, { borderColor: kolory.blue }]}>
          <Text style={styles.wynikEtykieta}>Termin upływa</Text>
          <Text style={[styles.wynikData, { color: kolory.blue }]}>{wynik.data}</Text>
          <Text style={styles.wynikDzien}>{wynik.dzienTygodnia}</Text>
          {wynik.przesuniety ? (
            <Text style={styles.wynikNota}>
              Surowy termin ({wynik.dataSurowa}) wypadał w dzień wolny — przesunięto o
              {' '}{wynik.dniPrzesuniecia} {wynik.dniPrzesuniecia === 1 ? 'dzień' : 'dni'} na najbliższy dzień roboczy.
            </Text>
          ) : tryb === 'robocze' && wynik.dniWolnePominiete > 0 ? (
            <Text style={styles.wynikNota}>Po drodze pominięto {wynik.dniWolnePominiete} dni wolnych.</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.podpowiedz}>
          {wynik.powod === 'brak_daty'
            ? 'Podaj poprawną datę zdarzenia w formacie RRRR-MM-DD.'
            : 'Podaj liczbę dni (liczba całkowita od 1 w górę).'}
        </Text>
      )}

      <Text style={styles.sekcjaTytul}>Częste terminy — dotknij, aby wypełnić</Text>
      <View style={styles.card}>
        {SZABLONY.map((s) => (
          <Pressable key={s.klucz} onPress={() => zastosujSzablon(s)} style={styles.szablon} accessibilityRole="button">
            <Text style={styles.szablonTekst}>{s.etykieta}</Text>
          </Pressable>
        ))}
        <Text style={styles.szablonOpis}>
          Ustawi liczbę dni i sposób liczenia — potem wpisz datę zdarzenia (np. dzień
          przekazania informacji o wyborze oferty).
        </Text>
      </View>

      <Text style={styles.stopka}>
        Liczymy wg art. 111 i 115 KC oraz polskich dni ustawowo wolnych. Reżim terminu
        (ile dni, od czego) zweryfikuj w SWZ i ustawie — to pomocnik, nie porada prawna.
      </Text>
    </Screen>
  );
}

const tworzStyleKalkulatora = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  etykieta: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: spacing.md, marginBottom: spacing.sm },
  chipy: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5,
    borderColor: k.border, backgroundColor: k.surface, alignItems: 'center',
  },
  chipAktywny: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  chipTekst: { fontSize: 13, fontWeight: '600', color: k.textMuted },
  chipTekstAktywny: { color: k.blue },
  wynikCard: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  wynikEtykieta: { fontSize: 12, color: k.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  wynikData: { fontSize: 30, fontWeight: '900', marginTop: 4 },
  wynikDzien: { fontSize: 15, color: k.text, fontWeight: '700', marginTop: 2 },
  wynikNota: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  podpowiedz: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.md, fontStyle: 'italic' },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  szablon: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: k.border },
  szablonTekst: { fontSize: 14, fontWeight: '600', color: k.blue, lineHeight: 20 },
  szablonOpis: { fontSize: 12, color: k.textMuted, lineHeight: 18, marginTop: spacing.sm },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
