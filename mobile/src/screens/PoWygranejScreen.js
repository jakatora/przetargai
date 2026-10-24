import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Share } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { KLUCZ_DANYCH_WYKONAWCY, szablonDanychWykonawcy, daneZOgloszenia } from '../lib/dokumentyOferty';
import {
  CHECKLISTA_PO_WYGRANEJ,
  generujZgloszeniePodwykonawcy,
  generujWniosekOZmianeTerminu,
  generujWniosekOZwrotZabezpieczenia,
} from '../lib/pismaPoWygranej';

/**
 * „PO WYGRANEJ" — checklista pierwszych dni kontraktu i trzy pisma w 1 klik:
 * zgłoszenie podwykonawcy (art. 464), wniosek o zmianę terminu (art. 455),
 * wniosek o zwrot zabezpieczenia (art. 453). Logika w `lib/pismaPoWygranej.js`;
 * dane firmy z magazynu „Dokumentów do oferty", dane umowy wpisujesz tu.
 */
export default function PoWygranejScreen({ route, navigation }) {
  const styles = useStyle(tworzStylePoWygranej);
  const { user } = useAuth();
  const match = route?.params?.match ?? null;
  const ogloszenie = useMemo(() => daneZOgloszenia(match?.tender), [match]);

  const [wykonawca, setWykonawca] = useState(() => szablonDanychWykonawcy(user));
  const [umowa, setUmowa] = useState({ tytul: ogloszenie.tytul ?? '', zamawiajacy: ogloszenie.zamawiajacy ?? '', numer: ogloszenie.numer ?? '', numerUmowy: '', dataUmowy: '' });
  const [pismo, setPismo] = useState('podwykonawca');
  const [podwykonawca, setPodwykonawca] = useState({ nazwa: '', adres: '', nip: '', zakres: '', wartosc: '' });
  const [rodzaj, setRodzaj] = useState('roboty');
  const [termin, setTermin] = useState({ podstawa: 'klauzula', nowyTermin: '', uzasadnienie: '', paragrafKlauzuli: '' });
  const [zabezp, setZabezp] = useState({ etap: 'po_odbiorze', kwotaZabezpieczenia: '', dataOdbioru: '', dataKoncaRekojmi: '', rachunek: '' });
  const [odhaczone, setOdhaczone] = useState(() => new Set());

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_DANYCH_WYKONAWCY)
      .then((s) => { if (s && aktywny) setWykonawca((w) => ({ ...w, ...JSON.parse(s) })); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  const dzisiaj = new Date().toISOString();
  const dok = useMemo(() => {
    if (pismo === 'termin') return generujWniosekOZmianeTerminu({ wykonawca, umowa, ...termin, dzisiaj });
    if (pismo === 'zabezpieczenie') return generujWniosekOZwrotZabezpieczenia({ wykonawca, umowa, ...zabezp, dzisiaj });
    return generujZgloszeniePodwykonawcy({ wykonawca, umowa, podwykonawca, rodzaj, dzisiaj });
  }, [pismo, wykonawca, umowa, podwykonawca, rodzaj, termin, zabezp, dzisiaj]);

  async function udostepnij() {
    try { await Share.share({ message: dok.tresc, title: dok.nazwa }); } catch { /* anulowane */ }
  }

  const Chipy = ({ lista, wartosc, ustaw }) => (
    <View style={styles.chipy}>
      {lista.map(([id, etykieta]) => {
        const aktywny = id === wartosc;
        return (
          <Pressable key={id} onPress={() => ustaw(id)} style={[styles.chip, aktywny && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywny }}>
            <Text style={[styles.chipTekst, aktywny && styles.chipTekstAktywny]}>{etykieta}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const pole = (obj, set) => (klucz) => (v) => set((o) => ({ ...o, [klucz]: v }));
  const pU = pole(umowa, setUmowa);
  const pP = pole(podwykonawca, setPodwykonawca);
  const pT = pole(termin, setTermin);
  const pZ = pole(zabezp, setZabezp);

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.heroEtykieta}>Po wygranej</Text>
        <Text style={styles.heroTytul}>{umowa.tytul || 'Pierwsze dni kontraktu'}</Text>
        <Text style={styles.heroWstep}>
          Gratulacje. Teraz liczą się terminy z umowy — poniżej lista, czego pilnować, i trzy pisma, które
          złożymy za Ciebie: podwykonawca, zmiana terminu, zwrot zabezpieczenia.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Czego pilnować ({odhaczone.size}/{CHECKLISTA_PO_WYGRANEJ.length})</Text>
      {CHECKLISTA_PO_WYGRANEJ.map((p) => {
        const ok = odhaczone.has(p.id);
        return (
          <Pressable key={p.id} onPress={() => setOdhaczone((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} style={[styles.punkt, ok && styles.punktOk]} accessibilityRole="checkbox" accessibilityState={{ checked: ok }}>
            <Text style={[styles.punktTytul, ok && styles.punktTytulOk]}>{ok ? '✓ ' : '○ '}{p.tytul}</Text>
            <Text style={styles.punktOpis}>{p.opis}</Text>
            {p.ekran ? <Button title="Otwórz narzędzie" variant="ghost" onPress={() => navigation.navigate(p.ekran, match ? { match } : undefined)} /> : null}
          </Pressable>
        );
      })}

      <Text style={styles.sectionTitle}>Dane umowy</Text>
      <TextField label="Zamawiający" value={umowa.zamawiajacy} onChangeText={pU('zamawiajacy')} />
      <TextField label="Przedmiot umowy" value={umowa.tytul} onChangeText={pU('tytul')} />
      <TextField label="Numer umowy" value={umowa.numerUmowy} onChangeText={pU('numerUmowy')} autoCapitalize="characters" />
      <TextField label="Data umowy" value={umowa.dataUmowy} onChangeText={pU('dataUmowy')} hint="RRRR-MM-DD" />

      <Text style={styles.sectionTitle}>Pismo</Text>
      <Chipy lista={[['podwykonawca', 'Zgłoszenie podwykonawcy'], ['termin', 'Zmiana terminu'], ['zabezpieczenie', 'Zwrot zabezpieczenia']]} wartosc={pismo} ustaw={setPismo} />

      {pismo === 'podwykonawca' ? (
        <View>
          <Chipy lista={[['roboty', 'Roboty budowlane (projekt umowy)'], ['uslugi', 'Usługi (kopia umowy)'], ['dostawy', 'Dostawy (kopia umowy)']]} wartosc={rodzaj} ustaw={setRodzaj} />
          <TextField label="Podwykonawca — nazwa" value={podwykonawca.nazwa} onChangeText={pP('nazwa')} />
          <TextField label="Adres" value={podwykonawca.adres} onChangeText={pP('adres')} />
          <TextField label="NIP" value={podwykonawca.nip} onChangeText={pP('nip')} keyboardType="phone-pad" />
          <TextField label="Zakres powierzonych prac" value={podwykonawca.zakres} onChangeText={pP('zakres')} multiline />
          <TextField label="Wartość umowy o podwykonawstwo (zł netto)" value={podwykonawca.wartosc} onChangeText={pP('wartosc')} keyboardType="decimal-pad" />
        </View>
      ) : null}

      {pismo === 'termin' ? (
        <View>
          <Chipy lista={[['klauzula', 'Umowa przewiduje zmianę (art. 455 ust. 1 pkt 1)'], ['nieprzewidywalne', 'Okoliczności nieprzewidywalne (pkt 4)']]} wartosc={termin.podstawa} ustaw={pT('podstawa')} />
          {termin.podstawa === 'klauzula' ? <TextField label="Paragraf umowy z klauzulą zmiany" value={termin.paragrafKlauzuli} onChangeText={pT('paragrafKlauzuli')} hint="np. § 12 ust. 2 pkt 3" /> : null}
          <TextField label="Nowy termin wykonania" value={termin.nowyTermin} onChangeText={pT('nowyTermin')} hint="RRRR-MM-DD" />
          <TextField label="Uzasadnienie — co się stało i dlaczego to nie Twoja wina" value={termin.uzasadnienie} onChangeText={pT('uzasadnienie')} multiline inputStyle={styles.wielolinia} />
        </View>
      ) : null}

      {pismo === 'zabezpieczenie' ? (
        <View>
          <Chipy lista={[['po_odbiorze', '70 % po odbiorze końcowym'], ['po_rekojmi', '30 % po rękojmi']]} wartosc={zabezp.etap} ustaw={pZ('etap')} />
          <TextField label="Kwota zabezpieczenia (zł)" value={zabezp.kwotaZabezpieczenia} onChangeText={pZ('kwotaZabezpieczenia')} keyboardType="decimal-pad" />
          {zabezp.etap === 'po_odbiorze'
            ? <TextField label="Data odbioru końcowego" value={zabezp.dataOdbioru} onChangeText={pZ('dataOdbioru')} hint="RRRR-MM-DD" />
            : <TextField label="Data końca rękojmi / gwarancji" value={zabezp.dataKoncaRekojmi} onChangeText={pZ('dataKoncaRekojmi')} hint="RRRR-MM-DD" />}
          <TextField label="Rachunek do zwrotu" value={zabezp.rachunek} onChangeText={pZ('rachunek')} keyboardType="numbers-and-punctuation" />
        </View>
      ) : null}

      <View style={styles.karta}>
        <Text style={styles.kartaTytul}>{dok.nazwa} · {dok.podstawa}</Text>
        <Text style={styles.podglad}>{dok.tresc}</Text>
      </View>
      <Button title="Udostępnij / skopiuj pismo" onPress={udostepnij} />
      <Text style={styles.stopka}>Dane firmy bierzemy z „Dokumentów do oferty". Pisma to szkice wg Pzp — przed wysłaniem sprawdź zapisy swojej umowy.</Text>
    </Screen>
  );
}

const tworzStylePoWygranej = tworzStyle((k) => ({
  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.lg, marginBottom: spacing.md },
  heroEtykieta: { fontSize: 12, fontWeight: '700', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.md, marginBottom: 6 },
  punkt: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  punktOk: { backgroundColor: k.sukcesTlo, borderColor: k.green },
  punktTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  punktTytulOk: { color: k.green },
  punktOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4 },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, paddingVertical: 8, paddingHorizontal: 12 },
  chipAktywny: { backgroundColor: k.blue, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.text, fontWeight: '600' },
  chipTekstAktywny: { color: k.white },
  wielolinia: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  karta: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm },
  kartaTytul: { fontSize: 14, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  podglad: { fontSize: 12, color: k.textMuted, lineHeight: 17 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, marginBottom: spacing.lg, fontStyle: 'italic' },
}));
