import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { wykryjWizje } from '../lib/wizjaLokalna';

/**
 * Panel „WYKRYWACZ OBOWIĄZKOWEJ WIZJI LOKALNEJ". Wkleja się treść SWZ/ogłoszenia, a parser
 * (testowany `lib/wizjaLokalna.js`) rozpoznaje, czy wizja jest OBOWIĄZKOWA (bez niej oferta
 * odrzucona — art. 226 ust. 1 pkt 18), tylko możliwa, czy brak wzmianki. Bez backendu.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function WizjaLokalnaScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWizji);
  const nazwa = route?.params?.nazwa ?? null;

  const [tekst, setTekst] = useState('');
  const [wynik, setWynik] = useState(null);

  function sprawdz() {
    setWynik(wykryjWizje(tekst));
  }

  const t = wynik ? tonNaTokeny(wynik.ton, kolory) : null;

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Obowiązkowa wizja lokalna, której nie odbędziesz, to odrzucenie oferty (art. 226 ust. 1
        pkt 18 Pzp) — łatwo ją przeoczyć w SWZ. Wklej treść SWZ/ogłoszenia, a sprawdzimy, czy
        wizja jest wymagana, tylko możliwa, czy w ogóle jej nie ma.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={styles.card}>
        <TextField
          label="Treść SWZ / ogłoszenia"
          value={tekst}
          onChangeText={setTekst}
          placeholder="Wklej tu fragment SWZ dotyczący wizji lokalnej (lub całość)…"
          multiline
          numberOfLines={6}
          inputStyle={styles.inputWielo}
        />
        <Button title="Sprawdź wizję lokalną" onPress={sprawdz} style={styles.gap} />
      </View>

      {wynik ? (
        <>
          <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
            <Text style={[styles.werdyktText, { color: t.tekst }]}>{wynik.etykieta}</Text>
            {wynik.obowiazkowa ? (
              <Text style={styles.instrukcja}>
                Zrób z tego zadanie krytyczne: zgłoś udział w wizji w terminie z SWZ, wpisz datę i
                miejsce do kalendarza PRZED innymi czynnościami — bez potwierdzenia udziału oferta
                przepada.
              </Text>
            ) : wynik.wystepuje ? (
              <Text style={styles.instrukcja}>
                Przeczytaj dokładnie zapis — jeśli jest „pod rygorem odrzucenia" albo „wymaga",
                traktuj jak obowiązkową i zgłoś udział.
              </Text>
            ) : null}
          </View>

          {wynik.dopasowania.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.kartaTytul}>Znalezione fragmenty</Text>
              {wynik.dopasowania.map((f, i) => (
                <Text key={i} style={styles.fragment}>„{f}"</Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <Text style={styles.stopka}>
        Parser wyłapuje typowe sformułowania — ostatecznie zawsze przeczytaj zapis SWZ w całości.
        Nic nie wysyłamy na zewnątrz.
      </Text>
    </Screen>
  );
}

const tworzStyleWizji = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
  gap: { marginTop: spacing.sm },

  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  inputWielo: { minHeight: 120, textAlignVertical: 'top' },

  werdykt: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginTop: spacing.md },
  werdyktText: { fontSize: 16, fontWeight: '900', lineHeight: 22 },
  instrukcja: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: spacing.sm },

  fragment: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.xs, fontStyle: 'italic' },
}));
