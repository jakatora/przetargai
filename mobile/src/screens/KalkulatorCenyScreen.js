import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { policzCene, formatujPLN, STAWKI_VAT } from '../lib/kalkulatorCeny';

/**
 * „KALKULATOR CENY OFERTOWEJ". Buduje cenę od kosztów (bezpośrednie → narzut kosztów
 * pośrednich → zysk → VAT → brutto) i pokazuje profesjonalne, „ofertowe" rozbicie.
 * Cała arytmetyka w testowanym lib/kalkulatorCeny.js.
 */

/** Wiersz rozbicia — etykieta z lewej, kwota (tabularnie) z prawej. */
function Wiersz({ styles, etykieta, kwota, wariant = 'zwykly' }) {
  const suma = wariant === 'suma';
  const finalny = wariant === 'final';
  return (
    <View style={[styles.wiersz, suma && styles.wierszSuma, finalny && styles.wierszFinal]}>
      <Text style={[styles.wierszEt, (suma || finalny) && styles.wierszEtMocny, finalny && styles.wierszEtFinal]}>
        {etykieta}
      </Text>
      <Text style={[styles.wierszKwota, suma && styles.wierszKwotaSuma, finalny && styles.wierszKwotaFinal]}>
        {kwota}
      </Text>
    </View>
  );
}

const oczysc = (t) => t.replace(/[^0-9., ]/g, '');

export default function KalkulatorCenyScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleCeny);
  const nazwa = route?.params?.nazwa ?? null;

  const [material, setMaterial] = useState('');
  const [robocizna, setRobocizna] = useState('');
  const [inne, setInne] = useState('');
  const [narzut, setNarzut] = useState('');
  const [zysk, setZysk] = useState('');
  const [vat, setVat] = useState(23);

  const w = policzCene({ material, robocizna, inne, narzutProc: narzut, zyskProc: zysk, vatProc: vat });

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zbuduj cenę od kosztów, a nie „na oko". Zobaczysz pełne rozbicie i realny zysk —
        cenę, która wygrywa, a nie topi.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <Text style={styles.sekcja}>Koszty bezpośrednie</Text>
      <View style={styles.card}>
        <TextField label="Materiał / dostawy (zł)" value={material} onChangeText={(t) => setMaterial(oczysc(t))}
          placeholder="0,00" keyboardType="decimal-pad" />
        <TextField label="Robocizna (zł)" value={robocizna} onChangeText={(t) => setRobocizna(oczysc(t))}
          placeholder="0,00" keyboardType="decimal-pad" />
        <TextField label="Sprzęt / podwykonawcy (zł)" value={inne} onChangeText={(t) => setInne(oczysc(t))}
          placeholder="0,00" keyboardType="decimal-pad" />
      </View>

      <Text style={styles.sekcja}>Narzut i zysk</Text>
      <View style={styles.card}>
        <TextField label="Narzut kosztów pośrednich (%)" value={narzut} onChangeText={(t) => setNarzut(oczysc(t))}
          placeholder="np. 10" keyboardType="decimal-pad" hint="Koszty ogólne firmy: biuro, zarząd, ubezpieczenia." />
        <TextField label="Zysk (%)" value={zysk} onChangeText={(t) => setZysk(oczysc(t))}
          placeholder="np. 15" keyboardType="decimal-pad" hint="Marża liczona od kosztu wytworzenia." />

        <Text style={styles.podEtykieta}>Stawka VAT</Text>
        <View style={styles.vatRzad}>
          {STAWKI_VAT.map((s) => {
            const aktywna = vat === s;
            return (
              <Pressable key={s} onPress={() => setVat(s)} accessibilityRole="radio"
                accessibilityState={{ selected: aktywna }}
                style={[styles.vatChip, aktywna && styles.vatChipOn]}>
                <Text style={[styles.vatTekst, aktywna && styles.vatTekstOn]}>{s}%</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {w.maDane ? (
        <>
          {/* HERO — cena brutto */}
          <View style={styles.hero}>
            <Text style={styles.heroEt}>Cena ofertowa brutto</Text>
            <Text style={styles.heroKwota}>{formatujPLN(w.brutto)}</Text>
            <Text style={styles.heroPod}>
              netto {formatujPLN(w.netto)}  +  VAT {vat}% {formatujPLN(w.vat)}
            </Text>
          </View>

          {/* Rozbicie */}
          <View style={styles.card}>
            <Wiersz styles={styles} etykieta="Koszty bezpośrednie" kwota={formatujPLN(w.bezposrednie)} />
            <Wiersz styles={styles} etykieta={`Koszty pośrednie (${narzut || 0}%)`} kwota={`+ ${formatujPLN(w.posrednie)}`} />
            <Wiersz styles={styles} etykieta="Koszt wytworzenia" kwota={formatujPLN(w.kosztWytworzenia)} wariant="suma" />
            <Wiersz styles={styles} etykieta={`Zysk (${zysk || 0}%)`} kwota={`+ ${formatujPLN(w.zysk)}`} />
            <Wiersz styles={styles} etykieta="Cena netto" kwota={formatujPLN(w.netto)} wariant="suma" />
            <Wiersz styles={styles} etykieta={`VAT (${vat}%)`} kwota={`+ ${formatujPLN(w.vat)}`} />
            <Wiersz styles={styles} etykieta="Cena brutto" kwota={formatujPLN(w.brutto)} wariant="final" />
          </View>

          <View style={styles.marzaChip}>
            <Text style={styles.marzaTekst}>
              Twój zysk: {formatujPLN(w.zysk)}  ·  {String(w.udzialZyskuProc).replace('.', ',')}% ceny netto
            </Text>
          </View>
        </>
      ) : (
        <Text style={styles.podpowiedz}>
          Wpisz przynajmniej jeden koszt bezpośredni, a policzymy cenę netto i brutto z pełnym rozbiciem.
        </Text>
      )}

      <Text style={styles.stopka}>
        Pomocnik liczy cenę z Twoich danych — nie zna faktycznych stawek ani obmiaru. Przy niskiej
        cenie przygotuj uzasadnienie (art. 224). To narzędzie, nie kosztorys ani porada.
      </Text>
    </Screen>
  );
}

const tworzStyleCeny = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcja: {
    fontSize: 12, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md },
  podEtykieta: { fontSize: 14, fontWeight: '600', color: k.text, marginTop: spacing.sm, marginBottom: spacing.sm },
  vatRzad: { flexDirection: 'row', gap: spacing.sm },
  vatChip: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: k.border, backgroundColor: k.surface, alignItems: 'center',
  },
  vatChipOn: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  vatTekst: { fontSize: 14, fontWeight: '700', color: k.textMuted, fontVariant: ['tabular-nums'] },
  vatTekstOn: { color: k.blue },

  // HERO
  hero: {
    backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue,
    padding: spacing.lg, alignItems: 'center', marginTop: spacing.lg,
  },
  heroEt: { fontSize: 12, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroKwota: { fontSize: 34, fontWeight: '900', color: k.blue, marginTop: 6, fontVariant: ['tabular-nums'] },
  heroPod: { fontSize: 13, color: k.textMuted, marginTop: 6, fontVariant: ['tabular-nums'] },

  // Rozbicie
  wiersz: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  wierszSuma: { borderTopWidth: 1, borderTopColor: k.border, marginTop: 2 },
  wierszFinal: { borderTopWidth: 2, borderTopColor: k.blue, marginTop: 2, paddingTop: spacing.sm },
  wierszEt: { fontSize: 14, color: k.textMuted, flex: 1, paddingRight: spacing.sm },
  wierszEtMocny: { color: k.text, fontWeight: '700' },
  wierszEtFinal: { color: k.text, fontWeight: '800', fontSize: 15 },
  wierszKwota: { fontSize: 14, color: k.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wierszKwotaSuma: { fontWeight: '800' },
  wierszKwotaFinal: { fontSize: 18, fontWeight: '900', color: k.blue },

  marzaChip: {
    marginTop: spacing.md, alignSelf: 'flex-start', backgroundColor: k.sukcesTlo,
    borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14,
  },
  marzaTekst: { fontSize: 13, fontWeight: '800', color: k.sukcesAkcent, fontVariant: ['tabular-nums'] },

  podpowiedz: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.lg, fontStyle: 'italic' },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
