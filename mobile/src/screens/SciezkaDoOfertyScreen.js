import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { zbudujSciezke, wczytajSciezke, zapiszSciezke } from '../lib/sciezkaDoOferty';

/**
 * „KROK PO KROKU DO WYGRANEJ" — przewodnik przygotowania oferty. Prowadzi wykonawcę
 * przez fazy (rozeznanie → decyzja → dokumenty → oferta → złożenie → po złożeniu →
 * rozstrzygnięcie), na każdym kroku mówi CO zrobić i daje skrót do właściwego narzędzia.
 * Postęp (odhaczone kroki) zapisujemy per przetarg. Cała logika w lib/sciezkaDoOferty.js.
 */
export default function SciezkaDoOfertyScreen({ route, navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSciezki);
  const match = route?.params?.match ?? null;
  const tender = match?.tender ?? null;
  const tenderId = tender?.id ?? null;

  const [wykonane, setWykonane] = useState(() => new Set());
  const [gotowe, setGotowe] = useState(false);

  useEffect(() => {
    let aktywny = true;
    if (!tenderId) { setGotowe(true); return undefined; }
    wczytajSciezke(storage, tenderId)
      .then((z) => { if (aktywny) { setWykonane(z); setGotowe(true); } })
      .catch(() => { if (aktywny) setGotowe(true); });
    return () => { aktywny = false; };
  }, [tenderId]);

  function przelacz(klucz) {
    setWykonane((prev) => {
      const next = new Set(prev);
      if (next.has(klucz)) next.delete(klucz); else next.add(klucz);
      if (tenderId) zapiszSciezke(storage, tenderId, next).catch(() => {});
      return next;
    });
  }

  function otworz(krok) {
    if (!krok.ekran) return;
    if (krok.ekran === 'RejestratorOferty') {
      navigation.navigate('RejestratorOferty', {
        termin: tender?.deadline, postepowanieId: match?.id, nazwa: tender?.title,
      });
    } else {
      navigation.navigate(krok.ekran, { nazwa: tender?.title });
    }
  }

  if (!tender) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Otwórz ścieżkę z przetargu</Text>
        <Text style={styles.emptyText}>
          Wejdź w szczegóły konkretnego przetargu i wybierz „Krok po kroku do wygranej".
        </Text>
      </View>
    );
  }

  if (!gotowe) {
    return <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>;
  }

  const { fazy, postep } = zbudujSciezke(wykonane);

  return (
    <Screen scroll>
      <Text style={styles.tytulPrzetargu} numberOfLines={2}>{tender.title}</Text>
      <Text style={styles.wstep}>
        Przejdź po kolei — każdy krok mówi, co zrobić, i prowadzi do narzędzia. Odhaczaj,
        co masz z głowy. Postęp zapisuje się dla tego przetargu.
      </Text>

      <View style={styles.postepCard}>
        <View style={styles.postepGora}>
          <Text style={styles.postepTekst}>Postęp: {postep.zrobione}/{postep.wymagane} kroków</Text>
          <Text style={styles.postepProcent}>{postep.procent}%</Text>
        </View>
        <View style={styles.pasekTlo}>
          <View style={[styles.pasekWypelnienie, { width: `${postep.procent}%` }]} />
        </View>
        {postep.wszystkieWymaganeGotowe ? (
          <Text style={styles.gotowe}>Komplet kroków odhaczony — powodzenia na otwarciu! 🍀</Text>
        ) : null}
      </View>

      {fazy.map((f, i) => (
        <View key={f.nazwa} style={styles.faza}>
          <Text style={styles.fazaTytul}>{i + 1}. {f.nazwa}</Text>
          {f.kroki.map((k) => (
            <View key={k.klucz} style={styles.krok}>
              <Pressable
                onPress={() => przelacz(k.klucz)}
                style={styles.krokGora}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: k.wykonany }}
                accessibilityLabel={k.tytul}
              >
                <View style={[styles.check, k.wykonany && styles.checkOn]}>
                  {k.wykonany ? <Text style={styles.checkZnak}>✓</Text> : null}
                </View>
                <View style={styles.krokTresc}>
                  <Text style={[styles.krokTytul, k.wykonany && styles.krokTytulZrobiony]}>
                    {k.tytul}{k.opcjonalny ? '  ·  opcjonalne' : ''}
                  </Text>
                  <Text style={styles.krokOpis}>{k.opis}</Text>
                </View>
              </Pressable>
              {k.ekran ? (
                <Pressable onPress={() => otworz(k)} hitSlop={6} accessibilityRole="button" style={styles.narzedzieRzad}>
                  <Text style={styles.narzedzieLink}>Otwórz narzędzie →</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ))}

      <Text style={styles.stopka}>
        To przewodnik, nie porada prawna. Wiążąca jest treść SWZ i ustawy Pzp — narzędzia
        liczą i przypominają, ale decyzje podejmujesz Ty.
      </Text>
    </Screen>
  );
}

const tworzStyleSciezki = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  tytulPrzetargu: { fontSize: 17, fontWeight: '800', color: k.text, lineHeight: 23 },
  wstep: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.sm, marginBottom: spacing.md },

  postepCard: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  postepGora: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  postepTekst: { fontSize: 14, fontWeight: '700', color: k.text },
  postepProcent: { fontSize: 18, fontWeight: '900', color: k.blue },
  pasekTlo: { height: 10, borderRadius: 999, backgroundColor: k.neutralneTlo, overflow: 'hidden' },
  pasekWypelnienie: { height: 10, borderRadius: 999, backgroundColor: k.blue },
  gotowe: { fontSize: 13, fontWeight: '700', color: k.sukcesAkcent, marginTop: spacing.sm },

  faza: { marginBottom: spacing.lg },
  fazaTytul: { fontSize: 15, fontWeight: '800', color: k.blue, marginBottom: spacing.sm },
  krok: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  krokGora: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  check: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: k.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkOn: { backgroundColor: k.blue, borderColor: k.blue },
  checkZnak: { color: k.white, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  krokTresc: { flex: 1 },
  krokTytul: { fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  krokTytulZrobiony: { textDecorationLine: 'line-through', color: k.textMuted },
  krokOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 3 },
  narzedzieRzad: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: k.border, alignItems: 'flex-start' },
  narzedzieLink: { fontSize: 14, fontWeight: '800', color: k.blue },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
