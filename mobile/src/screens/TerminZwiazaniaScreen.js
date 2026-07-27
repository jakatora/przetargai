import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { analizaZwiazania, MAKS_TERMINY } from '../lib/terminZwiazania';

/**
 * Panel „STRAŻNIK TERMINU ZWIĄZANIA OFERTĄ" (art. 220 Pzp). Odlicza czas do końca terminu
 * związania i sprawdza, czy wadium pokrywa cały ten okres — bo upływ terminu = odrzucenie
 * oferty (art. 226 ust. 1 pkt 4), a wygasłe wadium = to samo. Cały rachunek jest w testowanym
 * `lib/terminZwiazania.js`.
 */

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function TerminZwiazaniaScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleTerminu);
  const nazwa = route?.params?.nazwa ?? null;

  const [termin, setTermin] = useState('');
  const [wadium, setWadium] = useState('');

  const w = analizaZwiazania({ terminZwiazania: termin, wadiumWazneDo: wadium });
  const t = tonNaTokeny(w.ton, kolory);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Jesteś związany ofertą do daty z SWZ. Gdy postępowanie się przeciąga, przyjdzie wezwanie
        do przedłużenia — przegapione albo z wygasłym wadium = wypadasz z gry. Wpisz termin i
        ważność wadium, a przypilnujemy pokrycia.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={[styles.zegar, { borderColor: t.tekst }]}>
        <Text style={styles.zegarEtykieta}>Termin związania ofertą</Text>
        <Text style={[styles.zegarCzas, { color: t.tekst }]}>{w.etykieta}</Text>
      </View>

      <View style={styles.card}>
        <TextField
          label="Termin związania (RRRR-MM-DD)"
          value={termin}
          onChangeText={setTermin}
          placeholder="2026-03-15"
          autoCapitalize="none"
          hint="Data z SWZ, do której jesteś związany ofertą."
        />
        <TextField
          label="Wadium ważne do (RRRR-MM-DD)"
          value={wadium}
          onChangeText={setWadium}
          placeholder="2026-03-15"
          autoCapitalize="none"
          hint="Musi pokrywać cały termin związania (i jego przedłużenie)."
        />
      </View>

      {w.komunikat ? (
        <View style={[styles.komunikat, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
          <Text style={[styles.komunikatText, { color: t.tekst }]}>{w.komunikat}</Text>
          {w.wadiumPokrywa === true ? (
            <Text style={styles.pokrycieOk}>Wadium pokrywa termin związania ✓</Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sekcjaTytul}>Ile najwyżej może trwać (art. 220 ust. 1)</Text>
      <View style={styles.card}>
        {MAKS_TERMINY.map((m) => (
          <Text key={m.klucz} style={styles.maks}>• {m.etykieta}</Text>
        ))}
        <Text style={styles.maksOpis}>
          Jeśli SWZ wskazuje dłuższy termin niż dopuszczalny dla wartości — to wada postępowania,
          którą można podnieść.
        </Text>
      </View>

      <Text style={styles.stopka}>
        Odliczamy do dnia, który podasz — zweryfikuj datę w SWZ. To pomocnik, nie wysyłamy nic do
        zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleTerminu = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  zegar: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  zegarEtykieta: { fontSize: 12, color: k.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  zegarCzas: { fontSize: 24, fontWeight: '900', marginTop: 4, textAlign: 'center' },

  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  komunikat: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, marginTop: spacing.md },
  komunikatText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  pokrycieOk: { fontSize: 13, color: k.sukcesAkcent, marginTop: spacing.sm, fontWeight: '700' },

  maks: { fontSize: 13, color: k.text, lineHeight: 20 },
  maksOpis: { fontSize: 12, color: k.textMuted, lineHeight: 18, marginTop: spacing.sm },
}));
