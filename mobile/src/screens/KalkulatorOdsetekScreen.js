import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { policzOdsetki, formatujPLN } from '../lib/odsetkiOpoznienie';

/**
 * „ODSETKI ZA OPÓŹNIENIE + REKOMPENSATA". Gdy zamawiający płaci po terminie, liczy należne
 * odsetki (kwota × stawka% × dni/365) i stałą rekompensatę 40/70/100 € (art. 10 ustawy o
 * przeciwdziałaniu nadmiernym opóźnieniom). Cała arytmetyka w testowanym lib/odsetkiOpoznienie.js.
 */

function Wiersz({ styles, etykieta, wartosc, wariant }) {
  const suma = wariant === 'suma';
  return (
    <View style={[styles.wiersz, suma && styles.wierszSuma]}>
      <Text style={[styles.wierszEt, suma && styles.wierszEtMocny]}>{etykieta}</Text>
      <Text style={[styles.wierszKwota, suma && styles.wierszKwotaSuma]}>{wartosc}</Text>
    </View>
  );
}

const oczyscKwote = (t) => t.replace(/[^0-9., ]/g, '');

export default function KalkulatorOdsetekScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleOdsetek);
  const nazwa = route?.params?.nazwa ?? null;

  const [kwota, setKwota] = useState('');
  const [termin, setTermin] = useState('');
  const [zaplata, setZaplata] = useState('');
  const [stawka, setStawka] = useState('');

  const w = policzOdsetki({ kwota, terminPlatnosci: termin, dataZaplaty: zaplata, stawkaRoczna: stawka });

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zamawiający zapłacił po terminie? Należą Ci się odsetki za każdy dzień opóźnienia
        oraz stała rekompensata za koszty odzyskiwania należności — bez proszenia i bez sądu.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={styles.card}>
        <TextField label="Kwota należności brutto (zł)" value={kwota} onChangeText={(t) => setKwota(oczyscKwote(t))}
          placeholder="0,00" keyboardType="decimal-pad" hint="Kwota z faktury, której dotyczy opóźnienie." />
        <TextField label="Termin płatności (RRRR-MM-DD)" value={termin} onChangeText={setTermin}
          placeholder="2026-05-01" autoCapitalize="none" hint="Data wymagalności z faktury/umowy." />
        <TextField label="Data zapłaty (RRRR-MM-DD)" value={zaplata} onChangeText={setZaplata}
          placeholder="2026-06-10" autoCapitalize="none" hint="Kiedy pieniądze faktycznie wpłynęły (lub dziś, jeśli wciąż nie zapłacił)." />
        <TextField label="Stawka odsetek (% w skali roku)" value={stawka} onChangeText={(t) => setStawka(oczyscKwote(t))}
          placeholder="np. 11,5" keyboardType="decimal-pad" hint="Odsetki za opóźnienie w transakcjach handlowych — sprawdź aktualną stawkę (obwieszczenie MRPiT)." />
      </View>

      {w.bladDaty ? (
        <Text style={styles.podpowiedz}>Sprawdź format dat — użyj RRRR-MM-DD (np. 2026-05-01).</Text>
      ) : w.maDane ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroEt}>Odsetki za opóźnienie</Text>
            <Text style={styles.heroKwota}>{formatujPLN(w.odsetki)}</Text>
            <Text style={styles.heroPod}>za {w.dniOpoznienia} {w.dniOpoznienia === 1 ? 'dzień' : 'dni'} opóźnienia</Text>
          </View>

          <View style={styles.card}>
            <Wiersz styles={styles} etykieta="Dni opóźnienia" wartosc={String(w.dniOpoznienia)} />
            <Wiersz styles={styles} etykieta="Odsetki (kwota × stawka% × dni/365)" wartosc={formatujPLN(w.odsetki)} wariant="suma" />
          </View>

          <View style={styles.rekomp}>
            <Text style={styles.rekompTytul}>+ Rekompensata za koszty odzyskiwania</Text>
            <Text style={styles.rekompKwota}>{w.rekompensataEUR} €</Text>
            <Text style={styles.rekompOpis}>
              Ryczałt niezależny od odsetek (art. 10 ustawy). Równowartość w zł liczysz po średnim
              kursie EUR z NBP z ostatniego dnia roboczego miesiąca poprzedzającego wymagalność.
            </Text>
          </View>
        </>
      ) : (
        <Text style={styles.podpowiedz}>
          Wpisz kwotę, termin płatności, datę zapłaty i stawkę — policzymy odsetki i rekompensatę.
        </Text>
      )}

      <Text style={styles.stopka}>
        Odsetki i rekompensata przysługują z mocy ustawy przy transakcjach handlowych (także z
        podmiotem publicznym). To pomocnik liczący — nie wystawia wezwania ani nie jest poradą prawną.
      </Text>
    </Screen>
  );
}

const tworzStyleOdsetek = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },

  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.lg, alignItems: 'center', marginTop: spacing.lg },
  heroEt: { fontSize: 12, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroKwota: { fontSize: 32, fontWeight: '900', color: k.blue, marginTop: 6, fontVariant: ['tabular-nums'] },
  heroPod: { fontSize: 13, color: k.textMuted, marginTop: 6, fontVariant: ['tabular-nums'] },

  wiersz: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  wierszSuma: { borderTopWidth: 1, borderTopColor: k.border, marginTop: 2 },
  wierszEt: { fontSize: 14, color: k.textMuted, flex: 1, paddingRight: spacing.sm },
  wierszEtMocny: { color: k.text, fontWeight: '800' },
  wierszKwota: { fontSize: 14, color: k.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wierszKwotaSuma: { fontWeight: '900', fontSize: 16 },

  rekomp: { backgroundColor: k.sukcesTlo, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  rekompTytul: { fontSize: 13, fontWeight: '800', color: k.sukcesAkcent, textTransform: 'uppercase', letterSpacing: 0.4 },
  rekompKwota: { fontSize: 24, fontWeight: '900', color: k.sukcesAkcent, marginTop: 4, fontVariant: ['tabular-nums'] },
  rekompOpis: { fontSize: 12, color: k.sukcesAkcent, opacity: 0.9, lineHeight: 17, marginTop: 6 },

  podpowiedz: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.lg, fontStyle: 'italic' },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
