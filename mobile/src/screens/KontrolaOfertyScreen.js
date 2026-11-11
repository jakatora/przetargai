import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { podsumujKontrole, wczytajKontroleOferty, zapiszKontroleOferty } from '../lib/kontrolaOferty';
import KontrolaPlikowOferty from '../components/KontrolaPlikowOferty';
import { useJezyk } from '../context/JezykContext';

/**
 * „KONTROLA OFERTY PRZED WYSŁANIEM" — lista kontrolna wyłapująca powtarzalne błędy formalne,
 * przez które oferty odpadają najczęściej (podpis, wadium, załączniki, spójność, platforma…).
 * Odhaczaj przed wysyłką; komplet = „gotowe do wysłania". Logika w lib/kontrolaOferty.js.
 */
export default function KontrolaOfertyScreen({ route }) {
  const tenderId = route?.params?.match?.tender?.id ?? 'generic';
  return <KontrolaOfertyContent key={tenderId} route={route} />;
}

export function KontrolaOfertyContent({ route }) {
  const { t } = useJezyk();
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKontroli);
  const match = route?.params?.match ?? null;
  const nazwa = match?.tender?.title ?? route?.params?.nazwa ?? null;
  const tenderId = match?.tender?.id ?? 'generic';

  const [wykonane, setWykonane] = useState(() => new Set());
  const [gotowe, setGotowe] = useState(false);
  const [blad, setBlad] = useState(null);
  const [zapisuje, setZapisuje] = useState(false);
  const [proba, setProba] = useState(0);
  const zajety = useRef(false);
  const aktywnyWidok = useRef(false);

  useEffect(() => {
    aktywnyWidok.current = true;
    return () => { aktywnyWidok.current = false; };
  }, []);

  useEffect(() => {
    let aktywny = true;
    setBlad(null);
    wczytajKontroleOferty(storage, tenderId, { strict: true })
      .then((z) => { if (aktywny) { setWykonane(z); setGotowe(true); } })
      .catch(() => { if (aktywny) setBlad(t('Nie udało się odczytać listy. Spróbuj ponownie.', 'Could not load the checklist. Please retry.')); });
    return () => { aktywny = false; };
  }, [tenderId, proba]);

  async function przelacz(klucz) {
    if (zajety.current || !gotowe || !aktywnyWidok.current) return;
    zajety.current = true;
    setZapisuje(true);
    setBlad(null);
    const next = new Set(wykonane);
    if (next.has(klucz)) next.delete(klucz); else next.add(klucz);
    try {
      await zapiszKontroleOferty(storage, tenderId, next);
      if (aktywnyWidok.current) setWykonane(next);
    } catch {
      if (aktywnyWidok.current) setBlad(t('Nie zapisano zmiany. Zaznacz punkt ponownie, aby spróbować jeszcze raz.', 'Change was not saved. Select the item again to retry.'));
    } finally {
      zajety.current = false;
      if (aktywnyWidok.current) setZapisuje(false);
    }
  }

  if (!gotowe) {
    return <View style={styles.center}>{blad ? <>
      <Text accessibilityRole="alert">{blad}</Text>
      <Pressable accessibilityRole="button" onPress={() => setProba(v => v + 1)}><Text>{t('Spróbuj ponownie', 'Retry')}</Text></Pressable>
    </> : <ActivityIndicator size="large" color={kolory.blue} />}</View>;
  }

  const w = podsumujKontrole(wykonane);

  return (
    <Screen scroll>
      {nazwa ? <Text style={styles.postepowanie} numberOfLines={2}>{nazwa}</Text> : null}
      <Text style={styles.wstep}>
        Większość ofert odpada nie przez cenę, tylko przez POWTARZALNE błędy formalne. Przejdź tę
        listę przed wysyłką — najlepiej „świeżym okiem" osoby, która nie tworzyła oferty.
      </Text>

      <KontrolaPlikowOferty tenderId={match?.tender?.id ?? null} />
      {blad ? <Text accessibilityRole="alert">{blad}</Text> : null}
      {zapisuje ? <Text accessibilityLiveRegion="polite">{t('Zapisywanie…', 'Saving…')}</Text> : null}

      <View style={[styles.hero, w.gotowe && { backgroundColor: kolory.sukcesTlo, borderColor: kolory.sukcesAkcent }]}>
        <View style={styles.heroGora}>
          <Text style={[styles.heroTekst, w.gotowe && { color: kolory.sukcesAkcent }]}>
            {w.gotowe ? 'Gotowe do wysłania ✓' : `Sprawdzono ${w.zrobione}/${w.wszystkich}`}
          </Text>
          <Text style={[styles.heroProcent, w.gotowe && { color: kolory.sukcesAkcent }]}>{w.procent}%</Text>
        </View>
        <View style={styles.pasekTlo}>
          <View style={[styles.pasek, { width: `${w.procent}%` }, w.gotowe && { backgroundColor: kolory.sukcesAkcent }]} />
        </View>
        {!w.gotowe ? (
          <Text style={styles.heroPod}>Nie wysyłaj, dopóki każdy punkt nie jest odhaczony — jeden brak potrafi Cię wykluczyć.</Text>
        ) : null}
      </View>

      {w.pozycje.map((p) => (
        <Pressable
          key={p.klucz}
          onPress={() => przelacz(p.klucz)}
          disabled={zapisuje}
          style={styles.pozycja}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: p.wykonany, disabled: zapisuje }}
          accessibilityLabel={p.tytul}
        >
          <View style={[styles.check, p.wykonany && styles.checkOn]}>
            {p.wykonany ? <Text style={styles.checkZnak}>✓</Text> : null}
          </View>
          <View style={styles.tresc}>
            <Text style={[styles.tytul, p.wykonany && styles.tytulZrobiony]}>{p.tytul}</Text>
            <Text style={styles.opis}>{p.opis}</Text>
          </View>
        </Pressable>
      ))}

      <Text style={styles.stopka}>
        Lista ogólna — zawsze sprawdź konkretne wymagania w SWZ tego postępowania. To pomocnik, nie
        porada prawna. Postęp zapisuje się dla tego przetargu.
      </Text>
    </Screen>
  );
}

const tworzStyleKontroli = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, lineHeight: 20 },
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginTop: spacing.sm, marginBottom: spacing.md },

  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.md, marginBottom: spacing.lg },
  heroGora: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  heroTekst: { fontSize: 15, fontWeight: '800', color: k.blue },
  heroProcent: { fontSize: 18, fontWeight: '900', color: k.blue, fontVariant: ['tabular-nums'] },
  pasekTlo: { height: 10, borderRadius: 999, backgroundColor: k.neutralneTlo, overflow: 'hidden' },
  pasek: { height: 10, borderRadius: 999, backgroundColor: k.blue },
  heroPod: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm },

  pozycja: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: k.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: k.blue, borderColor: k.blue },
  checkZnak: { color: k.naAkcencie, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  tresc: { flex: 1 },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text, lineHeight: 20 },
  tytulZrobiony: { color: k.textMuted },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 3 },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic', marginBottom: spacing.lg },
}));
