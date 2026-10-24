import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import Button from './Button';
import ArkuszOdrzucenia from './ArkuszOdrzucenia';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import {
  zdanieRaportu, grupujOdrzucone, opisProby, opisNastepnegoPrzebiegu, zdanieOczekujacych,
} from '../lib/selekcja';
import { OPISY_BRAKOW } from '../lib/kartaFirmy';

/**
 * Górna część ekranu „Twoje przetargi” (spec §10): raport dnia, próba Standard, braki karty,
 * propozycje zmian, dzisiejsze wybrane z uzasadnieniem, odrzucone wg przyczyn. Historia
 * (wcześniejsze dni) zostaje w liście pod spodem — MatchFeedScreen.
 */
export default function PanelWyboru({ navigation, odswiezenie = 0, onWybraneIds, onUpgrade }) {
  const { t } = useJezyk();
  const styles = useStyle(tworzStylePanelu);
  const { isSaved, toggle } = useSaved();
  const [dzien, setDzien] = useState(null);
  const [blad, setBlad] = useState(null);
  const [rozwiniete, setRozwiniete] = useState(false);
  const [doOdrzucenia, setDoOdrzucenia] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);

  const wczytaj = useCallback(async () => {
    try {
      const d = await api.pracownikDzien();
      setDzien(d);
      setBlad(null);
      onWybraneIds?.(new Set((d.wybrane ?? []).map((m) => m.id)));
    } catch (err) {
      // 503 „wylaczony” albo brak sieci — lista pod spodem działa dalej.
      setBlad(err.message);
      onWybraneIds?.(new Set());
    }
  }, [onWybraneIds]);

  useEffect(() => { wczytaj(); }, [wczytaj, odswiezenie]);

  async function odrzuc(przyczyna, komentarz) {
    if (!doOdrzucenia) return;
    setZapisywanie(true);
    try {
      await api.pracownikOdrzuc(doOdrzucenia.id, przyczyna, komentarz);
      setDoOdrzucenia(null);
      await wczytaj();
    } finally {
      setZapisywanie(false);
    }
  }

  async function propozycja(p, akcja) {
    if (p.akcja === 'otworz_kreator' && akcja === 'przyjmij') {
      navigation.navigate('KartaFirmy', { krok: p.krok });
      return;
    }
    await api.propozycjaKarty(p.klucz, akcja).catch(() => {});
    await wczytaj();
  }

  if (!dzien && !blad) return <ActivityIndicator style={styles.ladowanie} />;
  if (!dzien) return null;

  const raport = zdanieRaportu(dzien.raport);
  const proba = opisProby(dzien.proba);
  const nastepny = opisNastepnegoPrzebiegu(dzien.raport?.nastepny_przebieg_o);
  const czekaja = zdanieOczekujacych(dzien.raport?.oczekuje, dzien.plan);
  const grupy = grupujOdrzucone(dzien.odrzucone?.wg_przyczyny);
  const brak = (dzien.braki_karty ?? [])[0];
  const razem = dzien.raport?.odrzucone_razem ?? 0;

  return (
    <View style={styles.panel}>
      <View style={styles.raport}>
        <Text style={styles.raportTekst}>{t(raport)}</Text>
        {nastepny ? <Text style={styles.drobny}>{t(nastepny)}</Text> : null}
        {czekaja ? <Text style={styles.drobny}>{t(czekaja)}</Text> : null}
      </View>

      {proba ? (
        <Pressable style={styles.proba} onPress={onUpgrade} accessibilityRole="button">
          <Text style={styles.probaTekst}>{t(proba)}</Text>
          <Text style={styles.probaCta}>{t('Przejdź na Standard — 99 zł/mc →', 'Upgrade to Standard — PLN 99/mo →')}</Text>
        </Pressable>
      ) : null}

      {brak && OPISY_BRAKOW[brak] ? (
        <Pressable style={styles.brak} onPress={() => navigation.navigate('KartaFirmy', { krok: OPISY_BRAKOW[brak].krok })} accessibilityRole="button">
          <Text style={styles.brakTekst}>{t(OPISY_BRAKOW[brak].tytul)}</Text>
          <Text style={styles.brakCta}>{t('Uzupełnij kartę firmy →', 'Complete your company card →')}</Text>
        </Pressable>
      ) : null}

      {(dzien.propozycje ?? []).map((p) => (
        <View key={p.klucz} style={styles.propozycja}>
          <Text style={styles.propozycjaTekst}>{t(p.opis)}</Text>
          <View style={styles.rzad}>
            <Button title={t('Przyjmij', 'Accept')} onPress={() => propozycja(p, 'przyjmij')} style={styles.przyciskPol} />
            <Button title={t('Nie teraz', 'Not now')} variant="ghost" onPress={() => propozycja(p, 'nie_teraz')} style={styles.przyciskPol} />
          </View>
        </View>
      ))}

      <Text style={styles.sekcja}>{t('Dziś wybrane dla Ciebie', 'Picked for you today')}</Text>
      {(dzien.wybrane ?? []).length === 0 ? (
        <Text style={styles.drobny}>{t('Dziś nic nie pasuje do Twojej firmy. Wcześniejsze wybory są niżej.', 'Nothing fits your company today. Earlier picks are below.')}</Text>
      ) : null}
      {(dzien.wybrane ?? []).map((m) => (
        <Pressable key={m.id} style={styles.karta} onPress={() => navigation.navigate('MatchDetail', { match: m })} accessibilityRole="button">
          <Text style={styles.kartaTytul}>{m.tender?.title}</Text>
          {m.tender?.organization ? <Text style={styles.drobny}>{m.tender.organization}</Text> : null}
          {m.tender?.deadline ? (
            <Text style={styles.drobny}>{t(`Termin ofert: ${formatDate(m.tender.deadline)}`, `Bid deadline: ${formatDate(m.tender.deadline)}`)}</Text>
          ) : null}
          {(m.uzasadnienie ?? []).map((p) => <Text key={p} style={styles.punkt}>{`✓ ${p}`}</Text>)}
          {m.ocena_bez_ai ? (
            <Text style={styles.drobny}>{t('Ocena wstępna — sprawdzimy ją jeszcze raz.', 'Preliminary assessment — we will re-check it.')}</Text>
          ) : null}
          <View style={styles.rzad}>
            <Button
              title={isSaved(m.id) ? t('Zapisany', 'Saved') : t('Zapisz', 'Save')}
              variant="ghost"
              onPress={() => toggle(m.id)}
              style={styles.przyciskPol}
            />
            <Button title={t('Odrzuć', 'Reject')} variant="ghost" onPress={() => setDoOdrzucenia(m)} style={styles.przyciskPol} />
          </View>
        </Pressable>
      ))}

      {grupy.length ? (
        <View style={styles.odrzucone}>
          <Pressable onPress={() => setRozwiniete((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: rozwiniete }}>
            <Text style={styles.sekcja}>
              {t(`Odrzucone (${razem}) ${rozwiniete ? '▲' : '▼'}`, `Rejected (${razem}) ${rozwiniete ? '▲' : '▼'}`)}
            </Text>
          </Pressable>
          {rozwiniete ? (
            <View>
              {grupy.map((g) => <Text key={g.kod} style={styles.punkt}>{`${t(g.etykieta)}: ${g.liczba}`}</Text>)}
              {dzien.odrzucone?.lista_dostepna ? (
                <Button title={t('Pokaż listę odrzuconych', 'Show rejected list')} variant="ghost" onPress={() => navigation.navigate('Odrzucone')} />
              ) : (
                <Pressable onPress={onUpgrade} accessibilityRole="button">
                  <Text style={styles.brakCta}>{t('Pełna lista odrzuconych z przyczynami jest w planie Standard →', 'The full rejected list with reasons is on the Standard plan →')}</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.sekcja}>{t('Wcześniej', 'Earlier')}</Text>

      <ArkuszOdrzucenia
        widoczny={Boolean(doOdrzucenia)}
        onAnuluj={() => setDoOdrzucenia(null)}
        onOdrzuc={odrzuc}
        zapisywanie={zapisywanie}
      />
    </View>
  );
}

const tworzStylePanelu = tworzStyle((k) => ({
  panel: { paddingBottom: spacing.sm },
  ladowanie: { marginVertical: spacing.md },
  raport: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, marginBottom: spacing.sm },
  raportTekst: { fontSize: 15, fontWeight: '700', color: k.text },
  drobny: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs },
  proba: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.sukcesTlo, marginBottom: spacing.sm },
  probaTekst: { fontSize: 15, fontWeight: '700', color: k.sukcesAkcent },
  probaCta: { fontSize: 13, color: k.text, marginTop: spacing.xs },
  brak: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.ostrzezenieTlo, marginBottom: spacing.sm },
  brakTekst: { fontSize: 14, color: k.ostrzezenieTekst },
  brakCta: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: spacing.xs },
  propozycja: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: k.ostrzezenieAkcent, marginBottom: spacing.sm },
  propozycjaTekst: { fontSize: 14, color: k.text, lineHeight: 20 },
  sekcja: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.md, marginBottom: spacing.xs },
  karta: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, marginBottom: spacing.sm },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  punkt: { fontSize: 14, color: k.text, marginTop: spacing.xs },
  rzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  przyciskPol: { flex: 1 },
  odrzucone: { marginTop: spacing.xs },
}));
