import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { formatBudget } from '../lib/format';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { SKLADNIKI, analizaObrony, werdyktObrony } from '../lib/obronaCeny';

/**
 * Panel „ASYSTENT OBRONY CENY (rażąco niska cena)".
 *
 * Gdy przychodzi wezwanie z art. 224 Pzp, o utrzymaniu oferty decydują DOWODY. Ten ekran
 * rozbija cenę na składniki (muszą sumować się do oferty), sprawdza stawkę pracy vs minimum i
 * pilnuje, żeby każdy istotny składnik miał dowód — bo wyjaśnienia bez dowodów są z automatu
 * niewystarczające. Cała ocena jest w testowanym `lib/obronaCeny.js`.
 */

function naLiczbe(txt) {
  if (typeof txt !== 'string') return 0;
  const o = txt.replace(/[^\d.,]/g, '').replace(',', '.');
  return o ? Number(o) || 0 : 0;
}

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function ObronaCenyScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleObrony);
  const nazwa = route?.params?.nazwa ?? null;

  const [cena, setCena] = useState('');
  const [roboczogodziny, setRoboczogodziny] = useState('');
  const [minStawka, setMinStawka] = useState('30.50');
  const [skladniki, setSkladniki] = useState({});
  const [dowody, setDowody] = useState({});

  function ustawSkl(klucz, v) { setSkladniki((s) => ({ ...s, [klucz]: v })); }
  function przelaczDowod(klucz) { setDowody((d) => ({ ...d, [klucz]: !d[klucz] })); }

  const wynik = analizaObrony({
    cena: naLiczbe(cena),
    roboczogodziny: naLiczbe(roboczogodziny),
    minStawkaGodz: naLiczbe(minStawka),
    skladniki: Object.fromEntries(SKLADNIKI.map((s) => [s.klucz, naLiczbe(skladniki[s.klucz])])),
    dowody,
  });
  const t = tonNaTokeny(wynik.ton, kolory);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Dostałeś wezwanie do wyjaśnienia rażąco niskiej ceny? O utrzymaniu oferty decydują
        DOWODY (art. 224 ust. 5). Rozbij cenę na składniki, sprawdź stawkę pracy i dołącz dowód
        do każdego składnika — inaczej wyjaśnienie z automatu nie wystarczy.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Werdykt ── */}
      <View style={[styles.werdykt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
        <Text style={[styles.werdyktText, { color: t.tekst }]}>{werdyktObrony(wynik)}</Text>
      </View>

      {/* ── Cena i praca ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Cena i koszty pracy</Text>
        <TextField label="Cena oferty (zł)" value={cena} onChangeText={setCena} placeholder="np. 200000" keyboardType="numeric" />
        <View style={styles.rzad}>
          <TextField label="Roboczogodziny (łącznie)" value={roboczogodziny} onChangeText={setRoboczogodziny} placeholder="np. 2500" keyboardType="numeric" style={styles.pole} />
          <TextField label="Min. stawka (zł/h)" value={minStawka} onChangeText={setMinStawka} placeholder="30.50" keyboardType="numeric" style={styles.pole} />
        </View>
        {wynik.stawkaGodz !== null ? (
          <Text style={[styles.stawka, wynik.ponizejMinimum && { color: kolory.danger, fontWeight: '800' }]}>
            Twoja stawka pracy: {wynik.stawkaGodz} zł/h
            {wynik.ponizejMinimum ? ' — PONIŻEJ minimum!' : ' — powyżej minimum ✓'}
          </Text>
        ) : null}
      </View>

      {/* ── Rozbicie + dowody ── */}
      <View style={styles.card}>
        <View style={styles.postepGlowa}>
          <Text style={styles.kartaTytul}>Rozbicie ceny i dowody</Text>
          <Text style={styles.suma}>
            Σ {formatBudget(wynik.suma)}
          </Text>
        </View>
        {!wynik.zgodna && naLiczbe(cena) > 0 ? (
          <Text style={styles.niezgodne}>
            Składniki nie sumują się do ceny (różnica {formatBudget(Math.abs(wynik.roznicaDoCeny))}).
          </Text>
        ) : null}

        {SKLADNIKI.map((sk) => {
          const wartosc = naLiczbe(skladniki[sk.klucz]);
          const maDowod = !!dowody[sk.klucz];
          const wymagaDowodu = wartosc > 0;
          return (
            <View key={sk.klucz} style={styles.skl}>
              <TextField
                label={sk.etykieta}
                value={skladniki[sk.klucz] ?? ''}
                onChangeText={(v) => ustawSkl(sk.klucz, v)}
                placeholder="0"
                keyboardType="numeric"
              />
              <Pressable
                onPress={() => przelaczDowod(sk.klucz)}
                style={styles.dowodRzad}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: maDowod }}
              >
                <View style={[
                  styles.check,
                  maDowod && { backgroundColor: kolory.green, borderColor: kolory.green },
                  !maDowod && wymagaDowodu && { borderColor: kolory.danger },
                ]}>
                  {maDowod ? <Text style={styles.checkZnak}>✓</Text> : null}
                </View>
                <Text style={styles.dowodOpis}>{sk.dowod}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* ── Problemy ── */}
      {wynik.problemy.length > 0 ? (
        <View style={styles.problemy}>
          {wynik.problemy.map((p, i) => {
            const tp = tonNaTokeny(p.ton, kolory);
            return (
              <Text key={i} style={[styles.problem, { color: tp.tekst }]}>• {p.tekst}</Text>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.stopka}>
        To pomocnik do skompletowania wyjaśnień — nie zastępuje analizy prawnej. Sedno: każdy
        istotny składnik musi mieć dowód, a stawka pracy nie może być poniżej minimum.
      </Text>
    </Screen>
  );
}

const tworzStyleObrony = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  werdykt: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginBottom: spacing.md },
  werdyktText: { fontSize: 16, fontWeight: '900', lineHeight: 22 },

  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  rzad: { flexDirection: 'row', gap: spacing.sm },
  pole: { flex: 1 },
  stawka: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs, fontVariant: ['tabular-nums'] },

  postepGlowa: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suma: { fontSize: 14, fontWeight: '800', color: k.text, fontVariant: ['tabular-nums'] },
  niezgodne: { fontSize: 12, color: k.ostrzezenieTekst, marginBottom: spacing.sm, lineHeight: 17 },

  skl: { borderTopWidth: 1, borderTopColor: k.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  dowodRzad: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 2 },
  check: {
    width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: k.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkZnak: { color: k.white, fontSize: 14, fontWeight: '900', lineHeight: 16 },
  dowodOpis: { flex: 1, fontSize: 12, color: k.textMuted, lineHeight: 17 },

  problemy: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.md, gap: spacing.xs,
  },
  problem: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
}));
