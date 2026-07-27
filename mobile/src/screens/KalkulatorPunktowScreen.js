import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { formatBudget } from '../lib/format';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { analizaPunktow } from '../lib/kalkulatorPunktow';

/**
 * Panel „KALKULATOR PUNKTÓW — wygraj kryteriami, nie najniższą ceną".
 *
 * Pokazuje „cenę punktu": ile realnie warta jest Twoja przewaga w kryteriach pozacenowych,
 * czyli o ile DROŻSZĄ ofertę możesz dać i wciąż wygrać z konkurentem. Cała punktacja i cena
 * break-even są w testowanym `lib/kalkulatorPunktow.js`; ekran tylko zbiera wejście i renderuje.
 */

function naLiczbe(txt) {
  if (typeof txt !== 'string') return 0;
  const o = txt.replace(/[^\d.,]/g, '').replace(',', '.');
  return o ? Number(o) || 0 : 0;
}

const KRYT_START = () => ({ id: `k${Date.now()}${Math.round(Math.random() * 1e4)}`, nazwa: 'Gwarancja (mies.)', waga: '40', kierunek: 'max', moje: '', konkurent: '' });

export default function KalkulatorPunktowScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKalkulatora);
  const nazwa = route?.params?.nazwa ?? null;

  const [mojaCena, setMojaCena] = useState('');
  const [konkCena, setKonkCena] = useState('');
  const [wagaCeny, setWagaCeny] = useState('60');
  const [kryteria, setKryteria] = useState([KRYT_START()]);

  function ustawKryt(id, pole, wartosc) {
    setKryteria((lista) => lista.map((k) => (k.id === id ? { ...k, [pole]: wartosc } : k)));
  }
  function dodajKryt() { setKryteria((l) => [...l, KRYT_START()]); }
  function usunKryt(id) { setKryteria((l) => l.filter((k) => k.id !== id)); }

  const gotowe = naLiczbe(mojaCena) > 0 && naLiczbe(konkCena) > 0;
  const wynik = gotowe
    ? analizaPunktow({
        mojaCena: naLiczbe(mojaCena),
        konkurencyjnaCena: naLiczbe(konkCena),
        wagaCeny: naLiczbe(wagaCeny),
        kryteria: kryteria.map((k) => ({
          nazwa: k.nazwa, waga: naLiczbe(k.waga), kierunek: k.kierunek,
          moje: naLiczbe(k.moje), konkurent: naLiczbe(k.konkurent),
        })),
      })
    : null;

  const tonWynik = wynik ? (wynik.wygrywam ? kolory.sukcesAkcent : kolory.danger) : kolory.text;

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Nie musisz być najtańszy. Wpisz swoją ofertę i ofertę konkurenta, a policzymy „cenę
        punktu" — o ile drożej możesz dać przy swojej gwarancji/terminie i wciąż wygrać.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Ceny i waga ceny</Text>
        <TextField label="Twoja cena (zł)" value={mojaCena} onChangeText={setMojaCena} placeholder="np. 520000" keyboardType="numeric" />
        <TextField label="Cena konkurenta (zł)" value={konkCena} onChangeText={setKonkCena} placeholder="np. 500000" keyboardType="numeric" hint="Z otwarcia ofert albo szacunek — sprawdź, jak agresywnie gra konkurencja." />
        <TextField label="Waga ceny (pkt)" value={wagaCeny} onChangeText={setWagaCeny} placeholder="np. 60" keyboardType="numeric" hint="Ile punktów daje kryterium ceny (z SWZ), np. 60 na 100." />
      </View>

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Kryteria pozacenowe</Text>
        {kryteria.map((k) => (
          <View key={k.id} style={styles.kryt}>
            <View style={styles.krytGlowa}>
              <TextField label={null} value={k.nazwa} onChangeText={(v) => ustawKryt(k.id, 'nazwa', v)} placeholder="Nazwa kryterium" style={styles.krytNazwa} />
              <Pressable onPress={() => usunKryt(k.id)} hitSlop={8} accessibilityLabel="Usuń kryterium">
                <Text style={styles.usun}>Usuń</Text>
              </Pressable>
            </View>
            <View style={styles.krytChipy}>
              {[['max', 'Większe lepiej'], ['min', 'Mniejsze lepiej']].map(([v, et]) => {
                const akt = k.kierunek === v;
                return (
                  <Pressable key={v} onPress={() => ustawKryt(k.id, 'kierunek', v)} style={[styles.chip, akt && { backgroundColor: kolory.blue, borderColor: kolory.blue }]}>
                    <Text style={[styles.chipText, akt && { color: kolory.white }]}>{et}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.krytRzad}>
              <TextField label="Waga (pkt)" value={k.waga} onChangeText={(v) => ustawKryt(k.id, 'waga', v)} placeholder="40" keyboardType="numeric" style={styles.krytPole} />
              <TextField label="Twoje" value={k.moje} onChangeText={(v) => ustawKryt(k.id, 'moje', v)} placeholder="60" keyboardType="numeric" style={styles.krytPole} />
              <TextField label="Konkurent" value={k.konkurent} onChangeText={(v) => ustawKryt(k.id, 'konkurent', v)} placeholder="36" keyboardType="numeric" style={styles.krytPole} />
            </View>
          </View>
        ))}
        <Button title="+ Dodaj kryterium" variant="ghost" onPress={dodajKryt} style={styles.gap} />
      </View>

      {wynik ? (
        <View style={[styles.wynik, { borderColor: tonWynik }]}>
          <Text style={[styles.wynikNaglowek, { color: tonWynik }]}>
            {wynik.wygrywam ? 'Wygrywasz z tym konkurentem' : 'Przegrywasz z tym konkurentem'}
          </Text>
          <View style={styles.wynikRzad}>
            <View style={styles.wynikKom}>
              <Text style={styles.wynikEt}>Twoje punkty</Text>
              <Text style={styles.wynikPkt}>{wynik.mojePkt}</Text>
            </View>
            <View style={styles.wynikKom}>
              <Text style={styles.wynikEt}>Konkurent</Text>
              <Text style={styles.wynikPkt}>{wynik.konkPkt}</Text>
            </View>
            <View style={styles.wynikKom}>
              <Text style={styles.wynikEt}>Różnica</Text>
              <Text style={[styles.wynikPkt, { color: tonWynik }]}>{wynik.roznica > 0 ? '+' : ''}{wynik.roznica}</Text>
            </View>
          </View>

          <View style={styles.cenaBox}>
            {wynik.bezLimitu ? (
              <Text style={styles.cenaText}>
                Twoja przewaga jakością przewyższa całą wagę ceny — przy tych kryteriach wygrywasz z tym
                konkurentem PRZY KAŻDEJ cenie.
              </Text>
            ) : wynik.cenaBreakEven !== null ? (
              wynik.pctRoznica >= 0 ? (
                <Text style={styles.cenaText}>
                  Możesz dać cenę do <Text style={styles.cenaMocno}>{formatBudget(wynik.cenaBreakEven)}</Text>
                  {' '}(o {Math.round(wynik.pctRoznica * 100)}% drożej niż konkurent) i wciąż remisujesz.
                  Oto ile warta jest Twoja jakość.
                </Text>
              ) : (
                <Text style={styles.cenaText}>
                  Tracisz na kryteriach — żeby wygrać, musisz zejść z ceną do{' '}
                  <Text style={styles.cenaMocno}>{formatBudget(wynik.cenaBreakEven)}</Text>
                  {' '}({Math.round(wynik.pctRoznica * 100)}% względem konkurenta).
                </Text>
              )
            ) : null}
          </View>

          {wynik.rozbicie.length > 0 ? (
            <View style={styles.rozb}>
              <Text style={styles.rozbTytul}>Punkty po kryteriach</Text>
              <View style={styles.rozbRzad}>
                <Text style={[styles.rozbKom, styles.rozbNazwa]}>Kryterium</Text>
                <Text style={styles.rozbKom}>Ty</Text>
                <Text style={styles.rozbKom}>Konk.</Text>
              </View>
              <View style={styles.rozbRzad}>
                <Text style={[styles.rozbKom, styles.rozbNazwa]}>Cena</Text>
                <Text style={styles.rozbKom}>{wynik.mojaCenaPkt}</Text>
                <Text style={styles.rozbKom}>{wynik.konkCenaPkt}</Text>
              </View>
              {wynik.rozbicie.map((r, i) => (
                <View key={i} style={styles.rozbRzad}>
                  <Text style={[styles.rozbKom, styles.rozbNazwa]} numberOfLines={1}>{r.nazwa || `Kryterium ${i + 1}`}</Text>
                  <Text style={styles.rozbKom}>{Math.round(r.moje * 100) / 100}</Text>
                  <Text style={styles.rozbKom}>{Math.round(r.konkurent * 100) / 100}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={styles.pusto}>Wpisz obie ceny, żeby zobaczyć wynik i „cenę punktu".</Text>
      )}

      <Text style={styles.stopka}>
        Model zakłada typową punktację Pzp (cena proporcjonalna, kryteria relatywne do najlepszej
        oferty). Sprawdź w SWZ dokładne wzory — bywają progowe. To wsad do decyzji cenowej.
      </Text>
    </Screen>
  );
}

const tworzStyleKalkulatora = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.md },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
  gap: { marginTop: spacing.sm },

  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },

  kryt: { borderTopWidth: 1, borderTopColor: k.border, paddingTop: spacing.md, marginTop: spacing.sm },
  krytGlowa: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  krytNazwa: { flex: 1, marginBottom: 0 },
  krytChipy: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.bg },
  chipText: { fontSize: 12, fontWeight: '700', color: k.text },
  krytRzad: { flexDirection: 'row', gap: spacing.sm },
  krytPole: { flex: 1 },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger, marginBottom: spacing.sm },

  wynik: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.md, marginTop: spacing.md },
  wynikNaglowek: { fontSize: 17, fontWeight: '900', marginBottom: spacing.sm },
  wynikRzad: { flexDirection: 'row', gap: spacing.md },
  wynikKom: { flex: 1 },
  wynikEt: { fontSize: 11, color: k.textMuted, marginBottom: 2 },
  wynikPkt: { fontSize: 20, fontWeight: '900', color: k.text, fontVariant: ['tabular-nums'] },

  cenaBox: { backgroundColor: k.neutralneTlo, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  cenaText: { fontSize: 14, color: k.text, lineHeight: 21 },
  cenaMocno: { fontWeight: '900', color: k.text },

  rozb: { marginTop: spacing.md },
  rozbTytul: { fontSize: 13, fontWeight: '800', color: k.text, marginBottom: spacing.xs },
  rozbRzad: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  rozbKom: { width: 64, fontSize: 13, color: k.textMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rozbNazwa: { flex: 1, width: undefined, textAlign: 'left', color: k.text, fontWeight: '600' },
}));
