import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { formatBudget } from '../lib/format';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { analizaCertyfikatu } from '../lib/certyfikatWykonawcy';

/**
 * Panel „CERTYFIKAT WYKONAWCY — jedna teczka zamiast stosu dokumentów". Od 12.07.2026 działa
 * ustawa o certyfikacji wykonawców: dobrowolny certyfikat zastępuje składanie tych samych
 * dokumentów w każdym przetargu. Ten kalkulator liczy, czy się opłaca (testowany
 * `lib/certyfikatWykonawcy.js`). Ceny certyfikatu nie zaszywamy — podajesz ją sam.
 */

function naLiczbe(txt) {
  if (typeof txt !== 'string') return 0;
  const o = txt.replace(/[^\d.,]/g, '').replace(',', '.');
  return o ? Number(o) || 0 : 0;
}

export default function CertyfikatWykonawcyScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleCert);

  const [starty, setStarty] = useState('');
  const [godziny, setGodziny] = useState('');
  const [stawka, setStawka] = useState('');
  const [koszt, setKoszt] = useState('');

  const gotowe = naLiczbe(starty) > 0 && naLiczbe(godziny) > 0 && naLiczbe(stawka) > 0;
  const w = gotowe
    ? analizaCertyfikatu({
        startowRocznie: naLiczbe(starty),
        godzinNaStart: naLiczbe(godziny),
        stawkaGodzinowa: naLiczbe(stawka),
        kosztCertyfikatuRocznie: naLiczbe(koszt),
      })
    : null;
  const kolorWynik = w ? (w.oplacaSie ? kolory.sukcesAkcent : kolory.textMuted) : kolory.text;

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Od 12 lipca 2026 możesz zdobyć dobrowolny certyfikat wykonawcy, który zastępuje składanie
        tych samych dokumentów (ZUS, US, KRK, wykazy) w każdym przetargu. Policz, czy Ci się
        opłaca — na podstawie tego, ile razy w roku kompletujesz te papiery.
      </Text>

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Twoja sytuacja</Text>
        <TextField label="Ile przetargów rocznie" value={starty} onChangeText={setStarty} placeholder="np. 20" keyboardType="numeric" />
        <TextField label="Godzin na komplet dokumentów (1 start)" value={godziny} onChangeText={setGodziny} placeholder="np. 8" keyboardType="numeric" hint="Ile czasu zajmuje zebranie ZUS/US/KRK/wykazów na jedno postępowanie." />
        <TextField label="Koszt godziny Twojej pracy (zł)" value={stawka} onChangeText={setStawka} placeholder="np. 100" keyboardType="numeric" />
        <TextField label="Roczny koszt certyfikatu (zł)" value={koszt} onChangeText={setKoszt} placeholder="np. 3000" keyboardType="numeric" hint="Podaj realną stawkę jednostki certyfikującej (nowość — sprawdź aktualny cennik)." />
      </View>

      {w ? (
        <View style={[styles.wynik, { borderColor: kolorWynik }]}>
          <Text style={[styles.wynikNaglowek, { color: kolorWynik }]}>
            {w.oplacaSie ? 'Certyfikat Ci się opłaca' : 'Na razie się nie opłaca'}
          </Text>
          <View style={styles.rzad}>
            <View style={styles.kom}>
              <Text style={styles.komEt}>Bez certyfikatu / rok</Text>
              <Text style={styles.komWart}>{formatBudget(w.kosztObecny)}</Text>
              <Text style={styles.komMaly}>{w.godzinyObecnie} h pracy</Text>
            </View>
            <View style={styles.kom}>
              <Text style={styles.komEt}>Z certyfikatem / rok</Text>
              <Text style={styles.komWart}>{formatBudget(w.kosztZCertyfikatem)}</Text>
              <Text style={styles.komMaly}>{w.godzinyZCertyfikatem} h pracy</Text>
            </View>
          </View>
          <Text style={[styles.oszcz, { color: kolorWynik }]}>
            {w.oszczednosc >= 0 ? 'Oszczędność' : 'Dopłata'}: {formatBudget(Math.abs(w.oszczednosc))} rocznie
          </Text>
          {w.progStartow ? (
            <Text style={styles.prog}>
              Certyfikat zwraca się od ok. {w.progStartow} przetargów rocznie.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.pusto}>Uzupełnij liczbę przetargów, godziny i stawkę, żeby zobaczyć wynik.</Text>
      )}

      <Text style={styles.stopka}>
        Rachunek uwzględnia oszczędność czasu na dokumentach; certyfikat daje też mniejsze ryzyko
        odrzucenia przez nieaktualny papier. Sprawdź aktualne zasady i cennik certyfikacji.
      </Text>
    </Screen>
  );
}

const tworzStyleCert = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.md },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },

  wynik: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginTop: spacing.md },
  wynikNaglowek: { fontSize: 17, fontWeight: '900', marginBottom: spacing.md },
  rzad: { flexDirection: 'row', gap: spacing.md },
  kom: { flex: 1 },
  komEt: { fontSize: 11, color: k.textMuted, marginBottom: 2 },
  komWart: { fontSize: 17, fontWeight: '900', color: k.text, fontVariant: ['tabular-nums'] },
  komMaly: { fontSize: 11, color: k.textMuted, marginTop: 2 },
  oszcz: { fontSize: 16, fontWeight: '800', marginTop: spacing.md },
  prog: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs, lineHeight: 18 },
}));
