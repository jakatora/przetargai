import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { policzKary, formatujPLN } from '../lib/karyUmowne';

/**
 * „KALKULATOR KAR UMOWNYCH". Liczy karę za zwłokę i odstąpienie, łączny limit kar i po ilu
 * dniach zwłoki się go sięga. Do policzenia PRZED podpisem — kary potrafią zjeść cały zysk.
 * Cała arytmetyka w testowanym lib/karyUmowne.js.
 */

function Wiersz({ styles, etykieta, kwota, wariant }) {
  const suma = wariant === 'suma';
  return (
    <View style={[styles.wiersz, suma && styles.wierszSuma]}>
      <Text style={[styles.wierszEt, suma && styles.wierszEtMocny]}>{etykieta}</Text>
      <Text style={[styles.wierszKwota, suma && styles.wierszKwotaSuma]}>{kwota}</Text>
    </View>
  );
}

const oczysc = (t) => t.replace(/[^0-9., ]/g, '');

export default function KaryUmowneScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKar);
  const nazwa = route?.params?.nazwa ?? null;

  const [wartosc, setWartosc] = useState('');
  const [stawka, setStawka] = useState('');
  const [dni, setDni] = useState('');
  const [odstapienie, setOdstapienie] = useState('');
  const [limit, setLimit] = useState('');

  const w = policzKary({
    wartosc, stawkaZwlokiProc: stawka, dniZwloki: dni, odstapienieProc: odstapienie, limitProc: limit,
  });

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zanim podpiszesz: policz maksymalne ryzyko kar. Kara za zwłokę narasta z każdym dniem,
        a łączny limit (zwykle 20–30% wartości) wyznacza sufit tego, co możesz stracić.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <Text style={styles.sekcja}>Umowa i kary z projektu umowy</Text>
      <View style={styles.card}>
        <TextField label="Wartość umowy (zł)" value={wartosc} onChangeText={(t) => setWartosc(oczysc(t))}
          placeholder="0,00" keyboardType="decimal-pad" hint="Podstawa naliczania kar wg umowy (netto lub brutto — sprawdź w SWZ)." />
        <TextField label="Kara za zwłokę (% za każdy dzień)" value={stawka} onChangeText={(t) => setStawka(oczysc(t))}
          placeholder="np. 0,2" keyboardType="decimal-pad" />
        <TextField label="Liczba dni zwłoki (scenariusz)" value={dni} onChangeText={(t) => setDni(oczysc(t))}
          placeholder="np. 14" keyboardType="decimal-pad" />
        <TextField label="Kara za odstąpienie (% wartości)" value={odstapienie} onChangeText={(t) => setOdstapienie(oczysc(t))}
          placeholder="np. 10" keyboardType="decimal-pad" />
        <TextField label="Łączny limit kar (% wartości)" value={limit} onChangeText={(t) => setLimit(oczysc(t))}
          placeholder="np. 20" keyboardType="decimal-pad" hint="Górna granica sumy wszystkich kar. Puste = brak limitu w umowie." />
      </View>

      {w.maDane ? (
        <>
          <View style={[styles.hero, w.przekroczono && styles.heroAlarm]}>
            <Text style={[styles.heroEt, w.przekroczono && styles.heroEtAlarm]}>Maksymalna kara do zapłaty</Text>
            <Text style={[styles.heroKwota, w.przekroczono && styles.heroKwotaAlarm]}>{formatujPLN(w.doZaplaty)}</Text>
            {w.przekroczono ? (
              <Text style={styles.heroPod}>Suma kar ({formatujPLN(w.suma)}) przekracza limit — zapłacisz maksymalnie tyle.</Text>
            ) : (
              <Text style={styles.heroPod}>w tym scenariuszu zwłoki i odstąpienia</Text>
            )}
          </View>

          <View style={styles.card}>
            <Wiersz styles={styles} etykieta={`Kara za zwłokę (${stawka || 0}% × ${dni || 0} dni)`} kwota={formatujPLN(w.karaZwloki)} />
            <Wiersz styles={styles} etykieta={`Kara za odstąpienie (${odstapienie || 0}%)`} kwota={formatujPLN(w.karaOdstapienia)} />
            <Wiersz styles={styles} etykieta="Suma kar" kwota={formatujPLN(w.suma)} wariant="suma" />
            {w.limitKwota != null ? (
              <Wiersz styles={styles} etykieta={`Limit kar (${limit || 0}%)`} kwota={formatujPLN(w.limitKwota)} />
            ) : null}
          </View>

          {w.dniDoLimitu != null ? (
            <View style={styles.info}>
              <Text style={styles.infoTekst}>
                Limit kar wyczerpiesz samą zwłoką po <Text style={styles.infoMocny}>{w.dniDoLimitu} dniach</Text>.
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.podpowiedz}>
          Wpisz wartość umowy i stawki kar z projektu umowy, a policzymy maksymalne ryzyko.
        </Text>
      )}

      <Text style={styles.stopka}>
        Kary i limit czytaj z projektu umowy w SWZ. Rażąco wygórowaną karę można miarkować
        (art. 484 § 2 KC), a zapisy podnieść w pytaniach do SWZ. To pomocnik, nie porada prawna.
      </Text>
    </Screen>
  );
}

const tworzStyleKar = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcja: { fontSize: 12, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md },

  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.lg, alignItems: 'center', marginTop: spacing.lg },
  heroAlarm: { backgroundColor: k.dangerTlo, borderColor: k.danger },
  heroEt: { fontSize: 12, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroEtAlarm: { color: k.danger },
  heroKwota: { fontSize: 32, fontWeight: '900', color: k.blue, marginTop: 6, fontVariant: ['tabular-nums'] },
  heroKwotaAlarm: { color: k.danger },
  heroPod: { fontSize: 13, color: k.textMuted, marginTop: 6, textAlign: 'center', lineHeight: 18, fontVariant: ['tabular-nums'] },

  wiersz: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  wierszSuma: { borderTopWidth: 1, borderTopColor: k.border, marginTop: 2 },
  wierszEt: { fontSize: 14, color: k.textMuted, flex: 1, paddingRight: spacing.sm },
  wierszEtMocny: { color: k.text, fontWeight: '800' },
  wierszKwota: { fontSize: 14, color: k.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wierszKwotaSuma: { fontWeight: '900', fontSize: 16 },

  info: { marginTop: spacing.md, backgroundColor: k.ostrzezenieTlo, borderRadius: radius.md, padding: spacing.md },
  infoTekst: { fontSize: 13, color: k.ostrzezenieTekst, lineHeight: 19 },
  infoMocny: { fontWeight: '900' },

  podpowiedz: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.lg, fontStyle: 'italic' },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
