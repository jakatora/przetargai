import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import * as storage from '../lib/storage';
import { formatDate, formatBudget } from '../lib/format';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  RODZAJE,
  statusReferencji,
  etykietaWaznosci,
  sortujReferencje,
} from '../lib/bankReferencji';

/**
 * Panel „BANK REFERENCJI Z DATĄ WAŻNOŚCI DOŚWIADCZENIA".
 *
 * Wykonawca odpada z przetargów nie przez cenę, tylko przez warunek udziału: nie wie, że
 * doświadczenie ma „termin przydatności" (roboty 5 lat, dostawy/usługi 3 lata przed terminem
 * składania) i orientuje się w dniu składania oferty, że kluczowa robota już się nie liczy.
 * Ten ekran prowadzi rejestr zrealizowanych kontraktów i przy każdym pokazuje LICZNIK
 * ważności — co jeszcze można wykazać, a co właśnie wypadło z okna.
 *
 * Ekran NIC nie liczy: ważność, status i kolejność liczy testowany `lib/bankReferencji.js`,
 * kolor dokłada motyw.js na podstawie semantycznego `ton`. Dane trzymamy LOKALNIE (sejf
 * urządzenia) — to wrażliwy rejestr firmy, nie musi opuszczać telefonu.
 */

const KLUCZ = 'przetargai.bankReferencji';
const RODZAJE_LISTA = Object.keys(RODZAJE); // ['roboty','dostawy','uslugi']

/** Semantyczny ton (z lib) → para tokenów motyw.js (tło + tekst), AA. */
function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

/** Pole liczbowe → liczba albo undefined (parsowanie WEJŚCIA, nie logika biznesowa). */
function naLiczbe(txt) {
  if (typeof txt !== 'string') return undefined;
  const o = txt.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!o) return undefined;
  const n = Number(o);
  return Number.isFinite(n) ? n : undefined;
}

export default function BankReferencjiScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleBanku);

  const [referencje, setReferencje] = useState([]);
  const [przedmiot, setPrzedmiot] = useState('');
  const [rodzaj, setRodzaj] = useState('roboty');
  const [wartosc, setWartosc] = useState('');
  const [zamawiajacy, setZamawiajacy] = useState('');
  const [dataZakonczenia, setDataZakonczenia] = useState('');
  const [blad, setBlad] = useState(null);

  useEffect(() => {
    storage.getItem(KLUCZ).then((s) => {
      if (!s) return;
      try {
        const lista = JSON.parse(s);
        if (Array.isArray(lista)) setReferencje(lista);
      } catch {
        /* uszkodzony zapis — ignorujemy, zaczynamy z pustym */
      }
    }).catch(() => {});
  }, []);

  const zapisz = useCallback((lista) => {
    setReferencje(lista);
    storage.setItem(KLUCZ, JSON.stringify(lista)).catch(() => {});
  }, []);

  function dodaj() {
    const p = przedmiot.trim();
    if (!p) { setBlad('Podaj przedmiot kontraktu (co zostało wykonane).'); return; }
    if (statusReferencji({ dataZakonczenia, rodzaj }).status === 'nieznana') {
      setBlad('Podaj poprawną datę zakończenia w formacie RRRR-MM-DD (np. 2024-06-01).');
      return;
    }
    setBlad(null);
    const nowa = {
      id: `r${Date.now()}${Math.round(Math.random() * 1e4)}`,
      przedmiot: p,
      rodzaj,
      wartosc: naLiczbe(wartosc) ?? null,
      zamawiajacy: zamawiajacy.trim() || null,
      dataZakonczenia: dataZakonczenia.trim(),
    };
    zapisz([nowa, ...referencje]);
    setPrzedmiot(''); setWartosc(''); setZamawiajacy(''); setDataZakonczenia('');
  }

  function usun(id) {
    zapisz(referencje.filter((r) => r.id !== id));
  }

  const posortowane = sortujReferencje(referencje);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Twoje doświadczenie ma „termin przydatności": roboty budowlane liczą się z ostatnich
        5 lat, dostawy i usługi z 3 lat przed terminem składania oferty. Zapisz tu zrealizowane
        kontrakty, a przy każdym pokażemy, czy jeszcze można je wykazać — zanim odkryjesz to w
        dniu składania.
      </Text>

      {/* ── Formularz dodania ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Dodaj zrealizowany kontrakt</Text>
        <TextField
          label="Przedmiot"
          value={przedmiot}
          onChangeText={setPrzedmiot}
          placeholder="np. Przebudowa dachu szkoły podstawowej"
        />
        <Text style={styles.polLabel}>Rodzaj</Text>
        <View style={styles.chipy}>
          {RODZAJE_LISTA.map((r) => {
            const aktywny = rodzaj === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRodzaj(r)}
                style={[styles.chip, aktywny && { backgroundColor: kolory.blue, borderColor: kolory.blue }]}
                accessibilityLabel={RODZAJE[r].etykieta}
              >
                <Text style={[styles.chipText, aktywny && { color: kolory.white }]}>
                  {RODZAJE[r].etykieta}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Wartość (zł)"
          value={wartosc}
          onChangeText={setWartosc}
          placeholder="np. 850000"
          keyboardType="numeric"
          hint="Opcjonalnie — potrzebne, gdy warunek udziału wymaga minimalnej wartości."
        />
        <TextField
          label="Zamawiający"
          value={zamawiajacy}
          onChangeText={setZamawiajacy}
          placeholder="np. Gmina Miejska Kraków"
        />
        <TextField
          label="Data zakończenia (RRRR-MM-DD)"
          value={dataZakonczenia}
          onChangeText={setDataZakonczenia}
          placeholder="2024-06-01"
          autoCapitalize="none"
          hint="Od tej daty liczymy okno 5 lat (roboty) lub 3 lat (dostawy/usługi)."
        />
        <Button title="Dodaj do banku" onPress={dodaj} style={styles.gap} />
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      {/* ── Lista referencji ── */}
      <Text style={styles.sekcjaTytul}>
        Twoje referencje {referencje.length ? `(${referencje.length})` : ''}
      </Text>
      {posortowane.length === 0 ? (
        <Text style={styles.pusto}>
          Brak zapisanych kontraktów. Dodaj pierwszy — zbudujesz bazę, z której jednym rzutem oka
          sprawdzisz, czym spełniasz warunki udziału.
        </Text>
      ) : (
        posortowane.map((r) => {
          const ocena = r._ocena ?? statusReferencji(r);
          const t = tonNaTokeny(ocena.ton, kolory);
          return (
            <View key={r.id} style={styles.ref}>
              <View style={styles.refGlowa}>
                <Text style={styles.refPrzedmiot}>{r.przedmiot}</Text>
                <Text style={[styles.badge, { backgroundColor: t.tlo, color: t.tekst }]}>
                  {etykietaWaznosci(ocena)}
                </Text>
              </View>
              <Text style={styles.refMeta}>
                {RODZAJE[r.rodzaj]?.etykieta ?? r.rodzaj}
                {formatBudget(r.wartosc) ? ` · ${formatBudget(r.wartosc)}` : ''}
                {r.zamawiajacy ? ` · ${r.zamawiajacy}` : ''}
              </Text>
              <Text style={styles.refDaty}>
                Zakończono {formatDate(r.dataZakonczenia)}
                {ocena.dataWaznosci ? ` · liczy się do ${formatDate(new Date(ocena.dataWaznosci).toISOString())}` : ''}
              </Text>
              <Pressable onPress={() => usun(r.id)} hitSlop={8} accessibilityLabel="Usuń referencję">
                <Text style={styles.usun}>Usuń</Text>
              </Pressable>
            </View>
          );
        })
      )}

      <Text style={styles.stopka}>
        Liczymy najkrótsze, bezpieczne okno (5/3 lata). Zamawiający może je wydłużyć — wtedy
        „wygasłe" u nas doświadczenie może wciąż się liczyć w danym przetargu. Dane zostają na
        Twoim telefonie.
      </Text>
    </Screen>
  );
}

const tworzStyleBanku = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.sm },
  polLabel: { fontSize: 13, fontWeight: '700', color: k.text, marginBottom: spacing.xs, marginTop: spacing.sm },

  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },

  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: k.border, backgroundColor: k.bg,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: k.text },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo, borderRadius: radius.md, borderWidth: 1,
    borderColor: k.ostrzezenieTekst, padding: spacing.md, marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  ref: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.sm,
  },
  refGlowa: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  refPrzedmiot: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  refMeta: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  refDaty: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17, fontVariant: ['tabular-nums'] },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger, marginTop: spacing.sm },

  badge: {
    fontSize: 11, fontWeight: '800', paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.sm, overflow: 'hidden',
  },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
