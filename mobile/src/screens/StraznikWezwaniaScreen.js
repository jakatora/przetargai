import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import * as storage from '../lib/storage';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  pozostalyCzas,
  statusChecklisty,
  podpowiedzDoDokumentu,
} from '../lib/wezwanieUzupelnienie';

/**
 * Panel „STRAŻNIK WEZWANIA DO UZUPEŁNIENIA (jedna szansa, krótki termin)".
 *
 * Wezwanie z art. 128/274 Pzp jest JEDNOKROTNE i krótkie (często 3 dni). Ten ekran robi z
 * niego checklistę i odlicza czas — bo w ostatniej dobie liczą się godziny, nie dni, a
 * pomyłka (przegapienie, zły dokument, „ręcznie podpisany skan") to odrzucenie oferty i
 * czasem utrata wadium. Cały rachunek czasu i statusu jest w testowanym
 * `lib/wezwanieUzupelnienie.js`; kolor dokłada motyw.js z semantycznego `ton`.
 */

const KLUCZ = 'przetargai.wezwanie';

function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function StraznikWezwaniaScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleStraznika);
  const nazwa = route?.params?.nazwa ?? null;

  const [termin, setTermin] = useState('');
  const [dokumenty, setDokumenty] = useState([]);
  const [nowy, setNowy] = useState('');

  useEffect(() => {
    storage.getItem(KLUCZ).then((s) => {
      if (!s) return;
      try {
        const dane = JSON.parse(s);
        if (dane && typeof dane === 'object') {
          if (typeof dane.termin === 'string') setTermin(dane.termin);
          if (Array.isArray(dane.dokumenty)) setDokumenty(dane.dokumenty);
        }
      } catch { /* uszkodzony zapis — ignorujemy */ }
    }).catch(() => {});
  }, []);

  const zapisz = useCallback((t, dok) => {
    storage.setItem(KLUCZ, JSON.stringify({ termin: t, dokumenty: dok })).catch(() => {});
  }, []);

  function ustawTermin(t) { setTermin(t); zapisz(t, dokumenty); }

  function dodaj() {
    const n = nowy.trim();
    if (!n) return;
    const lista = [...dokumenty, { id: `d${Date.now()}${Math.round(Math.random() * 1e4)}`, nazwa: n, gotowy: false }];
    setDokumenty(lista); setNowy(''); zapisz(termin, lista);
  }

  function przelacz(id) {
    const lista = dokumenty.map((d) => (d.id === id ? { ...d, gotowy: !d.gotowy } : d));
    setDokumenty(lista); zapisz(termin, lista);
  }

  function usun(id) {
    const lista = dokumenty.filter((d) => d.id !== id);
    setDokumenty(lista); zapisz(termin, lista);
  }

  const czas = pozostalyCzas(termin);
  const tCzas = tonNaTokeny(czas.ton, kolory);
  const status = statusChecklisty(dokumenty);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Wezwanie do uzupełnienia (art. 128/274 Pzp) przychodzi RAZ i ma krótki termin. Wpisz
        termin i rozłóż wezwanie na checklistę — odliczymy czas i przypilnujemy, żeby nic nie
        zostało z niewłaściwym dokumentem albo bez podpisu.
      </Text>
      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Odliczanie ── */}
      <View style={[styles.zegar, { borderColor: tCzas.tekst }]}>
        <Text style={styles.zegarEtykieta}>Do upływu terminu</Text>
        <Text style={[styles.zegarCzas, { color: tCzas.tekst }]}>{czas.etykieta}</Text>
      </View>

      {/* ── Termin ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Termin z wezwania</Text>
        <TextField
          label="Data (RRRR-MM-DD) lub data z godziną"
          value={termin}
          onChangeText={ustawTermin}
          placeholder="2026-01-20 lub 2026-01-20T15:00"
          autoCapitalize="none"
          hint="Sama data = termin upływa z końcem dnia. Termin jest jednokrotny — nie licz na drugą szansę."
        />
      </View>

      {/* ── Checklista dokumentów ── */}
      <View style={styles.card}>
        <View style={styles.postepGlowa}>
          <Text style={styles.kartaTytul}>Dokumenty do złożenia</Text>
          {status.wszystkie > 0 ? (
            <Text style={[styles.postepBadge, status.komplet && { color: kolory.sukcesAkcent }]}>
              {status.gotowe}/{status.wszystkie} gotowych
            </Text>
          ) : null}
        </View>
        <View style={styles.dodajRzad}>
          <TextField
            label={null}
            value={nowy}
            onChangeText={setNowy}
            placeholder="np. Zaświadczenie ZUS o niezaleganiu"
            style={styles.dodajPole}
          />
          <Button title="Dodaj" variant="ghost" onPress={dodaj} style={styles.dodajBtn} />
        </View>

        {dokumenty.length === 0 ? (
          <Text style={styles.pusto}>Dodaj dokumenty wskazane w wezwaniu — każdy oznacz jako gotowy, gdy jest podpisany i aktualny.</Text>
        ) : (
          dokumenty.map((d) => {
            const podp = podpowiedzDoDokumentu(d.nazwa);
            return (
              <View key={d.id} style={styles.dok}>
                <Pressable onPress={() => przelacz(d.id)} style={styles.dokKlik} accessibilityRole="checkbox" accessibilityState={{ checked: d.gotowy }}>
                  <View style={[styles.check, d.gotowy && { backgroundColor: kolory.green, borderColor: kolory.green }]}>
                    {d.gotowy ? <Text style={styles.checkZnak}>✓</Text> : null}
                  </View>
                  <View style={styles.dokTresc}>
                    <Text style={[styles.dokNazwa, d.gotowy && styles.dokNazwaGotowa]}>{d.nazwa}</Text>
                    {podp ? <Text style={styles.dokPodp}>{podp}</Text> : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => usun(d.id)} hitSlop={8} accessibilityLabel="Usuń pozycję">
                  <Text style={styles.usun}>Usuń</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>

      {status.komplet && !czas.poTerminie ? (
        <View style={styles.komplet}>
          <Text style={styles.kompletText}>
            Komplet gotowy. Zanim wyślesz — sprawdź jeszcze raz FORMĘ podpisu każdego pliku
            (kwalifikowany/zaufany) i aktualność zaświadczeń na dziś.
          </Text>
        </View>
      ) : null}

      <Text style={styles.stopka}>
        Odliczamy do chwili, którą podasz — zweryfikuj godzinę i strefę na platformie. To
        checklista pomocnicza, nie wysyłamy nic do zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleStraznika = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  pusto: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.sm },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },

  zegar: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 2, padding: spacing.md,
    alignItems: 'center', marginBottom: spacing.sm,
  },
  zegarEtykieta: { fontSize: 12, color: k.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  zegarCzas: { fontSize: 26, fontWeight: '900', marginTop: 4, letterSpacing: 0.3, textAlign: 'center' },

  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },

  postepGlowa: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postepBadge: { fontSize: 13, fontWeight: '800', color: k.textMuted, fontVariant: ['tabular-nums'] },

  dodajRzad: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  dodajPole: { flex: 1, marginBottom: 0 },
  dodajBtn: { paddingHorizontal: spacing.md },

  dok: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  dokKlik: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  check: {
    width: 24, height: 24, borderRadius: radius.sm, borderWidth: 2, borderColor: k.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkZnak: { color: k.white, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  dokTresc: { flex: 1 },
  dokNazwa: { fontSize: 14, fontWeight: '700', color: k.text, lineHeight: 19 },
  dokNazwaGotowa: { textDecorationLine: 'line-through', color: k.textMuted },
  dokPodp: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: 2 },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger },

  komplet: {
    backgroundColor: k.sukcesTlo, borderRadius: radius.md, borderWidth: 1, borderColor: k.sukcesAkcent,
    padding: spacing.md, marginTop: spacing.md,
  },
  kompletText: { fontSize: 13, color: k.sukcesAkcent, lineHeight: 19, fontWeight: '600' },
}));
