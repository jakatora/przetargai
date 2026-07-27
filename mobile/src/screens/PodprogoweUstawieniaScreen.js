import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { etykietaWartosciNetto } from '../lib/podprogowe';

/**
 * Ustawienia radaru zamówień podprogowych (ulepszenie „Radar zamówień podprogowych",
 * podzadanie 7/7). „Ustaw raz branżę i region" z opisu ulepszenia: użytkownik
 * zapisuje pary branża/region (+ opcjonalny próg netto, domyślnie 170 tys. zł), po
 * których monitor backendu zbiera ogłoszenia. Stąd też ręczne „Odśwież teraz".
 *
 * Ekran tylko woła endpointy `/api/przetarg/podprogowe/*`; walidację i zbieranie
 * robi backend. Próg 170 tys. zł to stan od 1.01.2026 (od kiedy dużo zamówień
 * idealnych dla firmy 1-20 osób zeszło pod próg Pzp).
 */

const PROG_DOMYSLNY = '170000';

export default function PodprogoweUstawieniaScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleUstawien);

  const [prefs, setPrefs] = useState(null);
  const [blad, setBlad] = useState(null);

  const [branza, setBranza] = useState('');
  const [region, setRegion] = useState('');
  const [prog, setProg] = useState(PROG_DOMYSLNY);
  const [zapisuje, setZapisuje] = useState(false);

  const [usuwaneId, setUsuwaneId] = useState(null);
  const [odswiezam, setOdswiezam] = useState(false);
  const [odswiezWynik, setOdswiezWynik] = useState(null);

  const wczytaj = useCallback(async () => {
    setBlad(null);
    try {
      const { preferencje } = await api.podprogowePreferencje();
      setPrefs(Array.isArray(preferencje) ? preferencje : []);
    } catch (err) {
      setBlad(err.message);
      setPrefs([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  async function zapisz() {
    if ((!branza.trim() && !region.trim()) || zapisuje) return;
    setZapisuje(true);
    setBlad(null);
    setOdswiezWynik(null);
    try {
      const payload = {};
      if (branza.trim()) payload.branza = branza.trim();
      if (region.trim()) payload.region = region.trim();
      const p = Number(prog);
      if (prog.trim() && Number.isFinite(p) && p > 0) payload.prog_netto = p;
      await api.podprogoweZapiszPreferencje(payload);
      setBranza('');
      setRegion('');
      setProg(PROG_DOMYSLNY);
      await wczytaj();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setZapisuje(false);
    }
  }

  async function usun(id) {
    if (usuwaneId) return;
    setUsuwaneId(id);
    setBlad(null);
    setOdswiezWynik(null);
    try {
      await api.podprogoweUsunPreferencje(id);
      await wczytaj();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setUsuwaneId(null);
    }
  }

  async function odswiez() {
    if (odswiezam) return;
    setOdswiezam(true);
    setBlad(null);
    setOdswiezWynik(null);
    try {
      const wynik = await api.podprogoweOdswiez();
      setOdswiezWynik(wynik);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setOdswiezam(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Ustaw raz branżę i region, a radar będzie zbierał zakupy poniżej progu Pzp
        (poniżej 170 tys. zł) z platform zakupowych, BIP-ów i Bazy Konkurencyjności —
        i pokaże je obok „dużych" przetargów jako „łatwiejszy start".
      </Text>

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Dodaj obszar do monitorowania</Text>
        <TextField
          label="Branża"
          value={branza}
          onChangeText={setBranza}
          placeholder="np. sprzątanie, roboty budowlane, catering"
          autoCapitalize="none"
        />
        <TextField
          label="Region"
          value={region}
          onChangeText={setRegion}
          placeholder="np. mazowieckie, powiat nowosądecki"
          autoCapitalize="none"
        />
        <TextField
          label="Górny próg wartości netto (zł)"
          value={prog}
          onChangeText={setProg}
          placeholder={PROG_DOMYSLNY}
          keyboardType="numeric"
          hint="Domyślnie 170 000 zł (stan od 1.01.2026). Podaj co najmniej branżę lub region."
        />
        <Button
          title="Zapisz obszar"
          onPress={zapisz}
          loading={zapisuje}
          disabled={!branza.trim() && !region.trim()}
        />
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      <Text style={styles.sekcjaTytul}>Twoje obszary</Text>
      {prefs === null ? (
        <ActivityIndicator color={kolory.blue} style={styles.spinner} />
      ) : prefs.length === 0 ? (
        <Text style={styles.pusto}>Nie masz jeszcze żadnego obszaru pod radarem.</Text>
      ) : (
        prefs.map((p) => (
          <View key={p.id} style={styles.pref}>
            <View style={styles.prefTresc}>
              <Text style={styles.prefTytul}>
                {[p.branza, p.region].filter(Boolean).join(' · ') || 'Wszystkie ogłoszenia'}
              </Text>
              <Text style={styles.prefMeta}>
                Próg: {etykietaWartosciNetto(p.prog_netto) ?? 'domyślny'}
              </Text>
            </View>
            <Pressable
              onPress={() => usun(p.id)}
              disabled={usuwaneId === p.id}
              hitSlop={10}
              accessibilityLabel="Usuń obszar"
            >
              {usuwaneId === p.id ? (
                <ActivityIndicator color={kolory.danger} />
              ) : (
                <Text style={styles.usun}>Usuń</Text>
              )}
            </Pressable>
          </View>
        ))
      )}

      {prefs && prefs.length > 0 ? (
        <>
          <Button
            title="Odśwież teraz"
            variant="ghost"
            onPress={odswiez}
            loading={odswiezam}
            style={styles.gap}
          />
          {odswiezWynik ? (
            <Text style={styles.odswiezInfo}>
              Odświeżono {odswiezWynik.odswiezono} obszar(y): nowych ogłoszeń {odswiezWynik.dodano ?? 0}.
            </Text>
          ) : (
            <Text style={styles.odswiezPodpis}>
              Zwykle radar odświeża się sam. „Odśwież teraz" przepytuje źródła od razu.
            </Text>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const tworzStyleUstawien = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  spinner: { marginTop: spacing.lg },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.md },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.md },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  pref: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  prefTresc: { flex: 1, marginRight: spacing.md },
  prefTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  prefMeta: { fontSize: 12, color: k.textMuted, marginTop: 2 },
  usun: { fontSize: 14, fontWeight: '700', color: k.danger },

  odswiezInfo: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  odswiezPodpis: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm, lineHeight: 17, fontStyle: 'italic' },
}));
