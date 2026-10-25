import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Share } from 'react-native';
import { udostepnijTekst } from '../lib/udostepnianie';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { KLUCZ_DANYCH_WYKONAWCY, szablonDanychWykonawcy, daneZOgloszenia } from '../lib/dokumentyOferty';
import { PODSTAWY_ZWROTU, FORMY_WADIUM, kwotaWadiumZOgloszenia, generujWniosekOZwrotWadium } from '../lib/wniosekZwrotWadium';

/**
 * „WNIOSEK O ZWROT WADIUM W 1 KLIK" (art. 98 ust. 2 Pzp). Po przegranej, odrzuceniu
 * albo wycofaniu oferty wadium wraca dopiero NA WNIOSEK — tu składa się sam z danych
 * firmy i ogłoszenia (kwota z ogłoszenia, gdy znana). Logika w `lib/wniosekZwrotWadium.js`.
 */
export default function ZwrotWadiumScreen({ route }) {
  const styles = useStyle(tworzStyleZwrotu);
  const { user } = useAuth();
  const match = route?.params?.match ?? null;
  const przetarg = useMemo(() => daneZOgloszenia(match?.tender), [match]);

  const [wykonawca, setWykonawca] = useState(() => szablonDanychWykonawcy(user));
  const [podstawa, setPodstawa] = useState(route?.params?.podstawa ?? 'wybor_innej');
  const [forma, setForma] = useState('przelew');
  const [kwota, setKwota] = useState(() => { const k = kwotaWadiumZOgloszenia(match?.tender); return k ? String(k) : ''; });
  const [rachunek, setRachunek] = useState('');
  const [bank, setBank] = useState('');
  const [gwarant, setGwarant] = useState('');
  const [numerGwarancji, setNumerGwarancji] = useState('');
  const [udostepniono, setUdostepniono] = useState(false);

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_DANYCH_WYKONAWCY)
      .then((s) => { if (s && aktywny) setWykonawca((w) => ({ ...w, ...JSON.parse(s) })); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  const pismo = useMemo(
    () => generujWniosekOZwrotWadium({ wykonawca, przetarg, podstawa, dzisiaj: new Date().toISOString(), wadium: { kwota, forma, rachunek, bank, gwarant, numerGwarancji } }),
    [wykonawca, przetarg, podstawa, kwota, forma, rachunek, bank, gwarant, numerGwarancji],
  );

  async function udostepnij() {
    try {
      await udostepnijTekst({ message: pismo.tresc, title: pismo.nazwa });
      setUdostepniono(true);
    } catch {
      /* anulowane */
    }
  }

  const Chipy = ({ lista, wartosc, ustaw }) => (
    <View style={styles.chipy}>
      {lista.map((x) => {
        const aktywny = x.id === wartosc;
        return (
          <Pressable key={x.id} onPress={() => ustaw(x.id)} style={[styles.chip, aktywny && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywny }}>
            <Text style={[styles.chipTekst, aktywny && styles.chipTekstAktywny]}>{x.etykieta}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.heroEtykieta}>Wniosek o zwrot wadium</Text>
        <Text style={styles.heroTytul}>{przetarg.tytul ?? 'Odzyskaj wadium w 7 dni'}</Text>
        <Text style={styles.heroWstep}>
          Po odrzuceniu, wycofaniu oferty albo wyborze innej firmy zamawiający zwraca wadium dopiero na Twój
          wniosek (art. 98 ust. 2 Pzp) — w 7 dni od jego złożenia. Pismo składa się samo.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Dlaczego należy się zwrot</Text>
      <Chipy lista={PODSTAWY_ZWROTU} wartosc={podstawa} ustaw={setPodstawa} />

      <Text style={styles.sectionTitle}>Jak wniesiono wadium</Text>
      <Chipy lista={FORMY_WADIUM} wartosc={forma} ustaw={setForma} />
      <TextField label="Kwota wadium (zł)" value={kwota} onChangeText={setKwota} keyboardType="decimal-pad" hint={kwotaWadiumZOgloszenia(match?.tender) ? 'Wstawiona z ogłoszenia — sprawdź' : 'Z ogłoszenia lub SWZ'} />
      {forma === 'przelew' ? (
        <View>
          <TextField label="Numer rachunku do zwrotu" value={rachunek} onChangeText={setRachunek} keyboardType="numbers-and-punctuation" hint="26 cyfr — ten, z którego poszło wadium, albo inny firmowy" />
          <TextField label="Bank (opcjonalnie)" value={bank} onChangeText={setBank} />
        </View>
      ) : (
        <View>
          <TextField label="Gwarant (bank / ubezpieczyciel)" value={gwarant} onChangeText={setGwarant} />
          <TextField label="Numer gwarancji" value={numerGwarancji} onChangeText={setNumerGwarancji} autoCapitalize="characters" />
        </View>
      )}

      <Text style={styles.sectionTitle}>Gotowe pismo</Text>
      <View style={styles.karta}>
        <Text style={styles.podglad}>{pismo.tresc}</Text>
      </View>
      <Button title="Udostępnij / skopiuj wniosek" onPress={udostepnij} />
      {udostepniono ? <Text style={styles.ok}>Udostępniono. Podpisz elektronicznie i wyślij przez platformę postępowania — 7 dni liczy się od wpływu.</Text> : null}
      <Text style={styles.stopka}>Dane firmy bierzemy z „Dokumentów do oferty" — jeśli są puste, uzupełnij je tam raz.</Text>
    </Screen>
  );
}

const tworzStyleZwrotu = tworzStyle((k) => ({
  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.lg, marginBottom: spacing.md },
  heroEtykieta: { fontSize: 12, fontWeight: '700', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.md, marginBottom: 6 },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, paddingVertical: 8, paddingHorizontal: 12 },
  chipAktywny: { backgroundColor: k.blue, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.text, fontWeight: '600' },
  chipTekstAktywny: { color: k.white },
  karta: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  podglad: { fontSize: 12, color: k.textMuted, lineHeight: 17 },
  ok: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, marginBottom: spacing.lg, fontStyle: 'italic' },
}));
