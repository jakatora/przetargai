import { useState } from 'react';
import { View, Text, Alert, Linking, Pressable, Switch, ActivityIndicator, TextInput } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import StatusPicker from '../components/StatusPicker';
import { ScoreBadge } from '../components/MatchCard';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius } from '../theme';
import { opisOceny, opisTerminu } from '../lib/termin';
import { opisCpv } from '../lib/cpv';
import { formatDate, formatBudget } from '../lib/format';
import { STATUS_DOMYSLNY } from '../lib/statusPrzetargu';
import { opisWadium } from '../lib/wadium';
import { opisKryterium, opisCzesci } from '../lib/ogloszenieMeta';

function Row({ styles, label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function MatchDetailScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSzczegolow);
  const { isSaved, toggle } = useSaved();
  const { match } = route.params;
  const tender = match.tender;
  const ocena = opisOceny(match.scorer);
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);
  // Stan przypomnienia: znany, gdy weszliśmy z ekranu „Zapisane"; inaczej domyślnie off.
  const [przypomnienie, setPrzypomnienie] = useState(match.reminder_enabled === true);
  // Wyjaśnienie AI (D-052) — leniwe: generujemy dopiero na żądanie (koszt AI).
  const [streszczenie, setStreszczenie] = useState(null);
  const [strLoading, setStrLoading] = useState(false);
  const [strBlad, setStrBlad] = useState(null);
  // Warsztat przetargu (D-054) — etap pracy + prywatna notatka (znane, gdy wszedł z „Zapisane").
  const [status, setStatus] = useState(match.status || STATUS_DOMYSLNY);
  const [notatka, setNotatka] = useState(match.notatka || '');
  const [notatkaZapis, setNotatkaZapis] = useState('idle'); // idle | zapisywanie | zapisano

  const zapisany = isSaved(match.id);
  const budget = formatBudget(tender.budget, tender.currency);
  const cpv = opisCpv(tender.cpv);
  const wadium = opisWadium(tender);
  const kryterium = opisKryterium(tender);
  const czesci = opisCzesci(tender);
  // Jedno źródło prawdy o terminie — wcześniej `daysUntil` nie odróżniał
  // terminu minionego od nieznanego i po prostu nic nie pokazywał.
  const termin = opisTerminu(tender.deadline);
  const deadlineText = `${formatDate(tender.deadline)}  ·  ${termin.etykieta}`;
  const maTermin = !!tender.deadline && !termin.minal;

  async function przelaczZapis() {
    try {
      const teraz = await toggle(match.id);
      if (!teraz) setPrzypomnienie(false); // usunięto z zakładek → przypomnienie też gaśnie
    } catch (err) {
      Alert.alert('Błąd', err.message);
    }
  }

  async function przelaczPrzypomnienie(wartosc) {
    setPrzypomnienie(wartosc);
    try {
      // Przypomnienie wymaga zapisu — gdy przetarg nie jest jeszcze w zakładkach, dopisz go.
      if (wartosc && !zapisany) await toggle(match.id);
      const stan = await api.setReminder(match.id, wartosc);
      setPrzypomnienie(stan.reminder_enabled);
    } catch (err) {
      setPrzypomnienie(!wartosc);
      Alert.alert('Błąd', err.message);
    }
  }

  async function zmienStatus(nowy) {
    const poprzedni = status;
    setStatus(nowy); // optymistycznie
    try {
      if (!zapisany) await toggle(match.id); // etap wymaga zapisu — dopisz do zakładek
      await api.setStatus(match.id, nowy);
    } catch (err) {
      setStatus(poprzedni);
      Alert.alert('Błąd', err.message);
    }
  }

  async function zapiszNotatke() {
    setNotatkaZapis('zapisywanie');
    try {
      if (!zapisany) await toggle(match.id);
      const stan = await api.setNotatka(match.id, notatka);
      setNotatka(stan.notatka);
      setNotatkaZapis('zapisano');
    } catch (err) {
      setNotatkaZapis('idle');
      Alert.alert('Błąd', err.message);
    }
  }

  async function wyjasnij() {
    setStrLoading(true);
    setStrBlad(null);
    try {
      const odp = await api.getStreszczenie(match.id);
      if (odp.streszczenie) setStreszczenie(odp.streszczenie);
      else setStrBlad(odp.komunikat || 'Nie udało się wygenerować wyjaśnienia.');
    } catch (err) {
      setStrBlad(err.message);
    } finally {
      setStrLoading(false);
    }
  }

  async function handleFeedback(helpful) {
    setSending(true);
    try {
      await api.sendFeedback(match.id, helpful);
      setFeedback(helpful ? 'up' : 'down');
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setSending(false);
    }
  }

  async function openInBzp() {
    if (!tender.url) return;
    try {
      const canOpen = await Linking.canOpenURL(tender.url);
      if (canOpen) await Linking.openURL(tender.url);
      else Alert.alert('Nie można otworzyć linku', tender.url);
    } catch {
      Alert.alert('Nie można otworzyć linku', tender.url);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <ScoreBadge score={match.confidence_score} size="lg" />
        <Text style={styles.title}>{tender.title}</Text>
      </View>

      <View style={styles.card}>
        <Row styles={styles} label="Zamawiający" value={tender.organization || 'brak danych'} />
        <Row styles={styles} label="Termin składania ofert" value={deadlineText} />
        {wadium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Wadium</Text>
            <Text style={[styles.rowValue, wadium.ostrzezenie && { color: kolory.ostrzezenieTekst }]}>
              {wadium.wartosc}
            </Text>
            {wadium.podpis ? <Text style={styles.wadiumPodpis}>{wadium.podpis}</Text> : null}
          </View>
        ) : null}
        {kryterium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Kryterium oceny</Text>
            <Text style={styles.rowValue}>{kryterium.wartosc}</Text>
            <Text style={styles.wadiumPodpis}>{kryterium.podpis}</Text>
          </View>
        ) : null}
        {czesci ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Części</Text>
            <Text style={styles.rowValue}>{czesci.wartosc}</Text>
            <Text style={styles.wadiumPodpis}>{czesci.podpis}</Text>
          </View>
        ) : null}
        {budget ? <Row styles={styles} label="Szacowana wartość" value={budget} /> : null}
        <Row styles={styles} label={cpv.etykieta} value={cpv.wartosc} last />
      </View>

      <View style={styles.akcjeCard}>
        <Pressable
          onPress={przelaczZapis}
          style={styles.zapiszRzad}
          accessibilityRole="button"
          accessibilityState={{ selected: zapisany }}
        >
          <Text style={[styles.gwiazdka, { color: zapisany ? kolory.blue : kolory.textMuted }]}>
            {zapisany ? '★' : '☆'}
          </Text>
          <Text style={styles.zapiszTekst}>{zapisany ? 'Zapisany w zakładkach' : 'Zapisz przetarg'}</Text>
        </Pressable>

        <View style={styles.przypRzad}>
          <View style={styles.przypInfo}>
            <Text style={styles.przypTytul}>Przypomnij przed terminem</Text>
            <Text style={styles.przypOpis}>
              {maTermin
                ? 'Push ok. 2 dni przed terminem składania ofert.'
                : 'Ten przetarg nie ma terminu do przypomnienia.'}
            </Text>
          </View>
          <Switch
            value={przypomnienie}
            onValueChange={przelaczPrzypomnienie}
            disabled={!maTermin}
            trackColor={{ true: kolory.blue }}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Etap i notatki</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Prowadź ten przetarg: ustaw etap pracy i zapisz własne notatki
          (np. jakie dokumenty zebrać, o co dopytać zamawiającego).
        </Text>

        <Text style={styles.warsztatEtykieta}>Etap</Text>
        <StatusPicker wartosc={status} onChange={zmienStatus} />

        <Text style={[styles.warsztatEtykieta, styles.warsztatOdstep]}>Moja notatka</Text>
        <TextInput
          style={styles.notatka}
          value={notatka}
          onChangeText={(t) => { setNotatka(t); setNotatkaZapis('idle'); }}
          placeholder="np. Zebrać: KRS, referencje z 2 podobnych robót. Dopytać o termin realizacji."
          placeholderTextColor={kolory.textMuted}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.notatkaStopka}>
          <Text style={styles.notatkaStan}>
            {notatkaZapis === 'zapisywanie' ? 'Zapisywanie…' : notatkaZapis === 'zapisano' ? 'Zapisano ✓' : ' '}
          </Text>
          <Button
            title="Zapisz notatkę"
            onPress={zapiszNotatke}
            variant="ghost"
            loading={notatkaZapis === 'zapisywanie'}
            style={styles.notatkaBtn}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Wyjaśnienie AI</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Prosty opis ogłoszenia przygotowany przez AI na podstawie danych przetargu
          (nie zastępuje pełnej specyfikacji SIWZ).
        </Text>

        {streszczenie ? (
          <View style={styles.strTresc}>
            <Text style={styles.strAkapit}>{streszczenie.czego_dotyczy}</Text>

            {streszczenie.dokumenty?.length ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Co zwykle trzeba przygotować</Text>
                {streszczenie.dokumenty.map((d, i) => (
                  <View key={i} style={styles.strPunktRzad}>
                    <Text style={styles.strKropka}>•</Text>
                    <Text style={styles.strPunkt}>{d}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {streszczenie.na_co_uwaga ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Na co zwrócić uwagę</Text>
                <Text style={styles.strAkapit}>{streszczenie.na_co_uwaga}</Text>
              </View>
            ) : null}

            {streszczenie.ocena ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Ocena dla małej firmy</Text>
                <Text style={styles.strAkapit}>{streszczenie.ocena}</Text>
              </View>
            ) : null}
          </View>
        ) : strLoading ? (
          <View style={styles.strLadowanie}>
            <ActivityIndicator color={kolory.blue} />
            <Text style={styles.strLadowanieTekst}>AI analizuje ogłoszenie…</Text>
          </View>
        ) : (
          <View style={styles.strStart}>
            {strBlad ? <Text style={styles.strBlad}>{strBlad}</Text> : null}
            <Button
              title={strBlad ? 'Spróbuj ponownie' : 'Wyjaśnij ten przetarg'}
              onPress={wyjasnij}
              variant="ghost"
            />
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Dlaczego to dopasowanie?</Text>
      <View style={styles.card}>
        <Text style={styles.reasoning}>{match.reasoning || 'Brak uzasadnienia.'}</Text>
        {/*
          Backend zapisuje, czy ocenił model, czy sama heurystyka — ale aplikacja
          tego nie pokazywała. Mechaniczne trafienie w słowo kluczowe wyglądało
          identycznie jak ocena AI (audyt 2026-07-10). To kwestia zaufania:
          użytkownik ma prawo wiedzieć, na czym opiera się liczba na karcie.
        */}
        <View style={styles.zrodloOceny}>
          <Text style={styles.zrodloEtykieta}>{ocena.etykieta}</Text>
          <Text style={styles.zrodloOpis}>{ocena.opis}</Text>
        </View>
      </View>

      {tender.url ? (
        <Button
          // Od D-039 ogłoszenia płyną z wielu źródeł — etykieta mówi, DOKĄD prowadzi link.
          title={`Otwórz ogłoszenie w ${tender.source === 'ted' ? 'TED (UE)' : 'BZP'}`}
          onPress={openInBzp}
          style={styles.gap}
        />
      ) : null}

      <Text style={styles.sectionTitle}>Czy to dopasowanie było trafne?</Text>
      {feedback ? (
        <Text style={styles.feedbackDone}>
          {feedback === 'up'
            ? 'Dziękujemy! Cieszymy się, że trafione.'
            : 'Dziękujemy za informację — wykorzystamy ją do poprawy dopasowań.'}
        </Text>
      ) : (
        <View style={styles.feedbackRow}>
          <Button
            title="👍 Trafne"
            variant="ghost"
            onPress={() => handleFeedback(true)}
            loading={sending}
            style={styles.feedbackBtn}
          />
          <Button
            title="👎 Nietrafne"
            variant="ghost"
            onPress={() => handleFeedback(false)}
            loading={sending}
            style={styles.feedbackBtn}
          />
        </View>
      )}
    </Screen>
  );
}

const tworzStyleSzczegolow = tworzStyle((k) => ({
  akcjeCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  zapiszRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  gwiazdka: { fontSize: 24, lineHeight: 26, fontWeight: '700' },
  zapiszTekst: { fontSize: 15, fontWeight: '700', color: k.text },
  przypRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  przypInfo: { flex: 1 },
  przypTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przypOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  zrodloOceny: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  zrodloEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue },
  zrodloOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: k.text, lineHeight: 24 },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: k.textMuted, marginBottom: 2 },
  rowValue: { fontSize: 15, color: k.text, fontWeight: '600' },
  wadiumPodpis: { fontSize: 12, color: k.textMuted, marginTop: 3, lineHeight: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reasoning: { fontSize: 15, color: k.text, lineHeight: 22 },
  strPodtytul: { fontSize: 12, color: k.textMuted, lineHeight: 17, fontStyle: 'italic' },
  warsztatEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: spacing.md, marginBottom: spacing.sm },
  warsztatOdstep: { marginTop: spacing.lg },
  notatka: {
    minHeight: 88, borderWidth: 1, borderColor: k.border, borderRadius: radius.md ?? 10,
    padding: spacing.sm, fontSize: 15, color: k.text, backgroundColor: k.bg ?? k.surface,
  },
  notatkaStopka: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  notatkaStan: { fontSize: 12, color: k.textMuted, fontWeight: '600' },
  notatkaBtn: { minWidth: 140 },
  strStart: { marginTop: spacing.md, gap: spacing.sm },
  strBlad: { fontSize: 13, color: k.textMuted, lineHeight: 18 },
  strLadowanie: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strLadowanieTekst: { fontSize: 14, color: k.textMuted },
  strTresc: { marginTop: spacing.md, gap: spacing.md },
  strAkapit: { fontSize: 15, color: k.text, lineHeight: 22 },
  strBlok: { gap: spacing.xs ?? 4 },
  strNaglowek: { fontSize: 13, fontWeight: '700', color: k.blue, marginBottom: 2 },
  strPunktRzad: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  strKropka: { fontSize: 15, color: k.blue, lineHeight: 22 },
  strPunkt: { flex: 1, fontSize: 15, color: k.text, lineHeight: 22 },
  gap: { marginTop: spacing.lg },
  feedbackRow: { flexDirection: 'row', gap: spacing.md },
  feedbackBtn: { flex: 1 },
  feedbackDone: { fontSize: 14, color: k.green, fontWeight: '600' },
}));
