import { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { sprawdzFormularz, formatujPLN } from '../lib/sprawdzarkaCeny';

/**
 * „SPRAWDZARKA FORMULARZA CENOWEGO". Liczy każdą pozycję poprawnie (ilość × cena, VAT, brutto)
 * i porównuje z wartością wpisaną w formularzu — wskazuje wiersze, które się nie zgadzają.
 * Błąd rachunkowy = poprawa albo odrzucenie. Cała arytmetyka w lib/sprawdzarkaCeny.js.
 */

const oczysc = (t) => t.replace(/[^0-9., ]/g, '');

function Pole({ styles, kolory, etykieta, value, onChangeText, flex }) {
  return (
    <View style={[styles.pole, flex ? { flex } : null]}>
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

export default function SprawdzarkaCenyScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSprawdzarki);
  const nazwa = route?.params?.nazwa ?? null;
  const licznik = useRef(1);

  const [wiersze, setWiersze] = useState([
    { id: 'w0', nazwa: '', ilosc: '', cenaJedn: '', vat: '23', wartoscPodana: '' },
  ]);

  const ustaw = (id, pole, v) => setWiersze((prev) => prev.map((w) => (w.id === id ? { ...w, [pole]: v } : w)));
  const dodaj = () => setWiersze((prev) => [...prev, { id: `w${licznik.current++}`, nazwa: '', ilosc: '', cenaJedn: '', vat: '23', wartoscPodana: '' }]);
  const usun = (id) => setWiersze((prev) => (prev.length > 1 ? prev.filter((w) => w.id !== id) : prev));

  const wynik = sprawdzFormularz(wiersze);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Przepisz pozycje formularza cenowego. Policzymy każdą poprawnie i pokażemy, gdzie Twoja
        wartość się NIE zgadza — błąd rachunkowy albo zła stawka VAT potrafi Cię wykluczyć.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {wynik.aktywnych > 0 ? (
        <View style={[styles.hero, wynik.liczbaBledow > 0 && { backgroundColor: kolory.dangerTlo, borderColor: kolory.danger }]}>
          <View style={styles.heroRzad}>
            <Text style={styles.heroLab}>Suma netto</Text><Text style={styles.heroVal}>{formatujPLN(wynik.sumaNetto)}</Text>
          </View>
          <View style={styles.heroRzad}>
            <Text style={styles.heroLab}>VAT</Text><Text style={styles.heroVal}>{formatujPLN(wynik.sumaVat)}</Text>
          </View>
          <View style={[styles.heroRzad, styles.heroFinal]}>
            <Text style={styles.heroLabFinal}>Suma brutto</Text><Text style={styles.heroValFinal}>{formatujPLN(wynik.sumaBrutto)}</Text>
          </View>
          {wynik.liczbaBledow > 0 ? (
            <Text style={styles.alarm}>
              ⚠ {wynik.liczbaBledow} {wynik.liczbaBledow === 1 ? 'niezgodność' : 'niezgodności'} — popraw wiersze oznaczone na czerwono.
            </Text>
          ) : (
            <Text style={styles.zgodne}>Wszystkie policzone pozycje zgadzają się rachunkowo ✓</Text>
          )}
        </View>
      ) : null}

      {wynik.pozycje.map((p, i) => {
        const w = wiersze[i];
        return (
          <View key={w.id} style={[styles.wiersz, p.bladWartosci && { borderColor: kolory.danger }]}>
            <View style={styles.wierszGora}>
              <TextInput
                style={styles.wierszNazwa}
                value={w.nazwa}
                onChangeText={(t) => ustaw(w.id, 'nazwa', t)}
                placeholder={`Pozycja ${i + 1}`}
                placeholderTextColor={kolory.textMuted}
                accessibilityLabel="Nazwa pozycji"
              />
              {wiersze.length > 1 ? (
                <Pressable onPress={() => usun(w.id)} hitSlop={10} accessibilityLabel="Usuń pozycję">
                  <Text style={styles.usun}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.polaRzad}>
              <Pole styles={styles} kolory={kolory} etykieta="Ilość" value={w.ilosc} onChangeText={(v) => ustaw(w.id, 'ilosc', v)} flex={1} />
              <Pole styles={styles} kolory={kolory} etykieta="Cena jedn. netto" value={w.cenaJedn} onChangeText={(v) => ustaw(w.id, 'cenaJedn', v)} flex={1.3} />
              <Pole styles={styles} kolory={kolory} etykieta="VAT %" value={w.vat} onChangeText={(v) => ustaw(w.id, 'vat', v)} flex={0.8} />
            </View>

            <Pole styles={styles} kolory={kolory} etykieta="Wartość netto z Twojego formularza (opcjonalnie)" value={w.wartoscPodana} onChangeText={(v) => ustaw(w.id, 'wartoscPodana', v)} />

            {p.maDane ? (
              <View style={styles.wynikWiersza}>
                <Text style={styles.wynikTekst}>
                  = {formatujPLN(p.obliczona)} netto · VAT {formatujPLN(p.vatKwota)} · brutto {formatujPLN(p.brutto)}
                </Text>
                {p.podana !== null ? (
                  p.bladWartosci ? (
                    <Text style={styles.bladWiersza}>✗ W formularzu masz {formatujPLN(p.podana)} — powinno być {formatujPLN(p.obliczona)}.</Text>
                  ) : (
                    <Text style={styles.okWiersza}>✓ Zgadza się z formularzem.</Text>
                  )
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <Button title="+ Dodaj pozycję" variant="ghost" onPress={dodaj} style={styles.dodaj} />

      <Text style={styles.stopka}>
        Sprawdzamy arytmetykę i VAT z Twoich danych — nie zna faktycznego formularza ani obmiaru.
        Zweryfikuj też jednostki i kompletność pozycji wg SWZ. To pomocnik, nie kosztorys.
      </Text>
    </Screen>
  );
}

const tworzStyleSprawdzarki = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },

  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.md, marginBottom: spacing.lg },
  heroRzad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  heroLab: { fontSize: 14, color: k.textMuted },
  heroVal: { fontSize: 15, fontWeight: '700', color: k.text, fontVariant: ['tabular-nums'] },
  heroFinal: { borderTopWidth: 1, borderTopColor: k.border, marginTop: 2, paddingTop: spacing.sm },
  heroLabFinal: { fontSize: 15, fontWeight: '800', color: k.text },
  heroValFinal: { fontSize: 18, fontWeight: '900', color: k.blue, fontVariant: ['tabular-nums'] },
  alarm: { fontSize: 13, fontWeight: '800', color: k.danger, marginTop: spacing.sm, lineHeight: 18 },
  zgodne: { fontSize: 13, fontWeight: '700', color: k.sukcesAkcent, marginTop: spacing.sm },

  wiersz: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.md },
  wierszGora: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wierszNazwa: { flex: 1, fontSize: 15, fontWeight: '800', color: k.text, paddingVertical: 4 },
  usun: { fontSize: 16, color: k.textMuted, fontWeight: '700', paddingHorizontal: 4 },

  polaRzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  pole: {},
  poleLabel: { fontSize: 11, fontWeight: '700', color: k.textMuted, marginBottom: 4 },
  poleInput: {
    borderWidth: 1.5, borderColor: k.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 10,
    fontSize: 15, color: k.text, backgroundColor: k.surface, fontVariant: ['tabular-nums'],
  },

  wynikWiersza: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: k.border },
  wynikTekst: { fontSize: 13, color: k.text, fontWeight: '600', fontVariant: ['tabular-nums'], lineHeight: 18 },
  bladWiersza: { fontSize: 13, fontWeight: '800', color: k.danger, marginTop: 4, lineHeight: 18 },
  okWiersza: { fontSize: 13, fontWeight: '700', color: k.sukcesAkcent, marginTop: 4 },

  dodaj: { marginTop: 2 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
