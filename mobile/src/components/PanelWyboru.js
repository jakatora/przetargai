import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api/client';
import Button from './Button';
import ArkuszOdrzucenia from './ArkuszOdrzucenia';
import { StanLadowania } from './Stan';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius, typografia } from '../theme';
import Ikona from './Ikona';
import { formatDate } from '../lib/format';
import { getItem, setItem } from '../lib/storage';
import {
  zdanieRaportu, grupujOdrzucone, opisProby, opisNastepnegoPrzebiegu, zdanieOczekujacych,
  opisKoncaProby, KLUCZ_KONCA_PROBY,
} from '../lib/selekcja';
import { OPISY_BRAKOW } from '../lib/kartaFirmy';
import { POKAZUJ_ZAKUP } from '../lib/kanal';
import { krokiBiore } from '../lib/szczegolyPrzetargu';
import { opisTerminu } from '../lib/termin';
import { postepDnia, podpisPostepu, opisGotowego } from '../lib/postepDnia';

/**
 * Górna część ekranu „Twoje przetargi” (spec §10): raport dnia, próba Standard, braki karty,
 * propozycje zmian, dzisiejsze wybrane z uzasadnieniem, odrzucone wg przyczyn. Historia
 * (wcześniejsze dni) zostaje w liście pod spodem — MatchFeedScreen. `onZmiana` — odrzucenie albo
 * przyjęta propozycja zmieniły to, co pokazuje lista pod spodem (rodzic ją przeładowuje).
 */
export default function PanelWyboru({ navigation, odswiezenie = 0, onWybraneIds, onUpgrade, onZmiana }) {
  const { t } = useJezyk();
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePanelu);
  const { isSaved, toggle, refresh: odswiezZapisane } = useSaved();
  const [dzien, setDzien] = useState(null);
  const [blad, setBlad] = useState(null);
  const [rozwiniete, setRozwiniete] = useState(false);
  const [doOdrzucenia, setDoOdrzucenia] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [propozycjaWToku, setPropozycjaWToku] = useState(null);
  const [koniecProbyPokazany, setKoniecProbyPokazany] = useState(undefined);
  // „Biorę” na karcie (2026-11-10) — jak w szczegółach: zapis + przypomnienie + etap; ids wziętych w tej wizycie.
  const [wziete, setWziete] = useState(() => new Set());
  const [bioreId, setBioreId] = useState(null);
  const dzienRef = useRef(null);

  const wczytaj = useCallback(async () => {
    try {
      const d = await api.pracownikDzien();
      dzienRef.current = d;
      setDzien(d);
      setBlad(null);
      onWybraneIds?.(new Set((d.wybrane ?? []).map((m) => m.id)));
    } catch (err) {
      // 503 „wylaczony” albo brak sieci — lista pod spodem działa dalej. Gdy panel nadal
      // pokazuje wcześniej wczytany wybór, lista nie może go zdublować.
      setBlad(err);
      if (!dzienRef.current) onWybraneIds?.(new Set());
    }
  }, [onWybraneIds]);

  useEffect(() => { wczytaj(); }, [wczytaj, odswiezenie]);

  useEffect(() => {
    getItem(KLUCZ_KONCA_PROBY).then((v) => setKoniecProbyPokazany(v ?? null)).catch(() => setKoniecProbyPokazany(null));
  }, []);

  const koniecProby = koniecProbyPokazany === undefined ? null : opisKoncaProby(dzien?.proba, dzien?.plan, koniecProbyPokazany);
  // Jednorazowo (spec §15): zapamiętane od razu po pokazaniu, widoczne do końca tej wizyty.
  useEffect(() => {
    if (koniecProby && dzien?.proba?.do) setItem(KLUCZ_KONCA_PROBY, dzien.proba.do).catch(() => {});
  }, [koniecProby, dzien?.proba?.do]);

  function zgloszBlad(tytul, err) {
    Alert.alert(tytul, err?.message ?? t('Spróbuj ponownie za chwilę.', 'Please try again shortly.'));
  }

  async function odrzuc(przyczyna, komentarz) {
    if (!doOdrzucenia) return;
    setZapisywanie(true);
    try {
      const wynik = await api.pracownikOdrzuc(doOdrzucenia.id, przyczyna, komentarz);
      setDoOdrzucenia(null);
      // Serwer zdejmuje odrzucony z Zapisanych (bez przypomnień) — gwiazdki w apce muszą to zobaczyć.
      if (wynik?.usuniety_z_zapisanych) odswiezZapisane?.();
      await wczytaj();
      onZmiana?.();
    } catch (err) {
      zgloszBlad(t('Nie udało się odrzucić przetargu', 'Could not reject the tender'), err);
    } finally {
      setZapisywanie(false);
    }
  }

  async function biore(m) {
    if (bioreId) return;
    setBioreId(m.id);
    const termin = opisTerminu(m.tender?.deadline);
    const kroki = krokiBiore({ zapisany: isSaved(m.id), przypomnienie: m.reminder_enabled === true, maTermin: Boolean(m.tender?.deadline) && !termin.minal, status: m.status || undefined });
    try {
      if (kroki.includes('zapisz')) await toggle(m.id, true);
    } catch (err) {
      setBioreId(null);
      zgloszBlad(t('Nie udało się zapisać przetargu', 'Could not save the tender'), err);
      return;
    }
    // Nowy zapis serwer sam łączy z przypomnieniem 7/3/1 (od 2026-11-10) — osobne żądanie tylko dla wcześniej zapisanych.
    if (kroki.includes('przypomnienie') && !kroki.includes('zapisz')) await api.setReminder(m.id, true).catch(() => {});
    if (kroki.includes('etap')) {
      try {
        await api.setStatus(m.id, 'przygotowuje');
      } catch (err) {
        // „✓ Bierzesz” tylko, gdy etap naprawdę się zapisał — inaczej po powrocie znów byłoby „Biorę” (audyt 2026-11-10).
        setBioreId(null);
        zgloszBlad(t('Zapisano przetarg, ale nie ustawiono etapu „Przygotowuję ofertę”', 'Saved, but the “Preparing the bid” stage was not set'), err);
        return;
      }
    }
    setWziete((stare) => new Set([...stare, m.id]));
    setBioreId(null);
  }

  async function propozycja(p, akcja) {
    if (p.akcja === 'otworz_kreator' && akcja === 'przyjmij') {
      navigation.navigate('KartaFirmy', { krok: p.krok });
      return;
    }
    if (propozycjaWToku) return;
    setPropozycjaWToku(p.klucz);
    try {
      await api.propozycjaKarty(p.klucz, akcja);
      await wczytaj();
      if (akcja === 'przyjmij') onZmiana?.();
    } catch (err) {
      zgloszBlad(t('Nie udało się zapisać zmiany', 'Could not save the change'), err);
    } finally {
      setPropozycjaWToku(null);
    }
  }

  if (!dzien && !blad) return <StanLadowania karty={2} />;
  if (!dzien) {
    // 503 „wyłączony” = funkcja świadomie wyłączona — bez komunikatu. Inny błąd (słaba sieć) nie może
    // po cichu schować dziennego wyboru: karta z ponowieniem (audyt 2026-11-10).
    if (blad?.status === 503) return null;
    return (
      <View style={styles.bladKarta}>
        <Text style={styles.bladTekst}>
          {t('Nie udało się wczytać dzisiejszego wyboru. ', 'Could not load today’s picks. ')}
          {blad?.message ?? ''}
        </Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => { setBlad(null); wczytaj(); }} />
      </View>
    );
  }

  const raport = zdanieRaportu(dzien.raport);
  const proba = opisProby(dzien.proba);
  const nastepny = opisNastepnegoPrzebiegu(dzien.raport?.nastepny_przebieg_o);
  const czekaja = zdanieOczekujacych(dzien.raport?.oczekuje, dzien.plan);
  const grupy = grupujOdrzucone(dzien.odrzucone?.wg_przyczyny);
  const brak = (dzien.braki_karty ?? [])[0];
  // Build z Google Play (lib/kanal.js): informacja o próbie i planie zostaje, zakup i cena znikają.
  const zakup = POKAZUJ_ZAKUP && typeof onUpgrade === 'function';
  const razem = dzien.raport?.odrzucone_razem ?? 0;
  // Postęp decyzji dnia (2026-11-12): „Do decyzji: X z N”, czekające na górze, po ostatniej — „Na dziś gotowe”.
  const czyWziety = (m) => wziete.has(m.id) || (isSaved(m.id) && m.status === 'przygotowuje');
  const postep = postepDnia({ wybrane: dzien.wybrane, raportWybrane: dzien.raport?.wybrane, czyWziety });
  const podpis = podpisPostepu(postep);

  return (
    <View style={styles.panel}>
      <View style={styles.raport} accessibilityRole="summary">
        <Text style={styles.raportNaglowek}>{t('Raport z przeglądu ogłoszeń', 'Notice review report')}</Text>
        <Text style={styles.raportTekst}>{t(raport)}</Text>
        {nastepny ? <Text style={styles.raportDrobny}>{t(nastepny)}</Text> : null}
        {czekaja ? <Text style={styles.raportDrobny}>{t(czekaja)}</Text> : null}
      </View>

      {koniecProby ? (zakup ? (
        <Pressable style={styles.brak} onPress={onUpgrade} accessibilityRole="button">
          <Text style={styles.brakTekst}>{t(koniecProby)}</Text>
          <Text style={styles.brakCta}>{t('Przejdź na Standard — 99 zł/mc', 'Upgrade to Standard — PLN 99/mo')}</Text>
        </Pressable>
      ) : (
        <View style={styles.brak}>
          <Text style={styles.brakTekst}>{t(koniecProby)}</Text>
        </View>
      )) : null}

      {proba ? (zakup ? (
        <Pressable style={styles.proba} onPress={onUpgrade} accessibilityRole="button">
          <Text style={styles.probaTekst}>{t(proba)}</Text>
          <Text style={styles.probaCta}>{t('Przejdź na Standard — 99 zł/mc', 'Upgrade to Standard — PLN 99/mo')}</Text>
        </Pressable>
      ) : (
        <View style={styles.proba}>
          <Text style={styles.probaTekst}>{t(proba)}</Text>
        </View>
      )) : null}

      {brak && OPISY_BRAKOW[brak] ? (
        <Pressable style={styles.brak} onPress={() => navigation.navigate('KartaFirmy', { krok: OPISY_BRAKOW[brak].krok })} accessibilityRole="button">
          <Text style={styles.brakTekst}>{t(OPISY_BRAKOW[brak].tytul)}</Text>
          <Text style={styles.brakCta}>{t('Uzupełnij kartę firmy', 'Complete your company card')}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.sekcja}>{t('Dziś wybrane dla Ciebie', 'Picked for you today')}</Text>
      {podpis ? (
        <View style={styles.postep} accessibilityRole="progressbar" accessibilityLabel={t(podpis)}
          accessibilityValue={{ min: 0, max: postep.razem, now: postep.zdecydowane }}>
          <View style={styles.postepRzad}>
            <Text style={styles.postepTekst}>{t(podpis)}</Text>
            <Text style={styles.postepDrobny}>{t(`zdecydowane: ${postep.zdecydowane}`, `decided: ${postep.zdecydowane}`)}</Text>
          </View>
          <View style={styles.postepTor}>
            <View style={[styles.postepWypelnienie, { width: `${Math.round((postep.zdecydowane / postep.razem) * 100)}%` }]} />
          </View>
        </View>
      ) : null}
      {postep.gotowe ? (
        <View style={styles.gotowe} accessibilityRole="summary">
          <View style={styles.gotoweRzad}>
            <View style={styles.gotoweZnak}><Ikona nazwa="ok" rozmiar={18} kolor={kolory.sukcesAkcent} /></View>
            <Text style={styles.gotoweTytul}>{t('Na dziś gotowe', 'All done for today')}</Text>
          </View>
          <Text style={styles.gotoweTekst}>{t(opisGotowego(postep))}</Text>
          {nastepny ? <Text style={styles.gotoweDrobny}>{t(nastepny)}</Text> : null}
          {postep.wziete > 0 ? (
            <Button title={t('Moje oferty', 'My bids')} variant="ghost" onPress={() => navigation.navigate('Pulpit')} />
          ) : (
            // Wszystko odrzucone = wybór był nietrafiony — najkrótsza droga do poprawy to karta firmy (seria 2 runda 6).
            <Button title={t('Popraw kartę firmy', 'Adjust your company card')} variant="ghost" onPress={() => navigation.navigate('KartaFirmy')} />
          )}
        </View>
      ) : null}
      {/* „Nic nie pasuje” tylko, gdy selekcja naprawdę nic dziś nie wybrała — nie po odrzuceniu wszystkiego (wtedy „Na dziś gotowe”). */}
      {(dzien.wybrane ?? []).length === 0 && !postep.gotowe ? (
        <Text style={styles.drobny}>{t('Dziś nic nie pasuje do Twojej firmy. Wcześniejsze wybory są niżej.', 'Nothing fits your company today. Earlier picks are below.')}</Text>
      ) : null}
      {postep.kolejnosc.map((m) => (
        <Pressable key={m.id} style={({ pressed }) => [styles.karta, pressed && styles.kartaWcisnieta]} onPress={() => navigation.navigate('MatchDetail', { match: m })} accessibilityRole="button">
          <Text style={styles.kartaTytul}>{m.tender?.title}</Text>
          {m.tender?.organization ? <Text style={styles.drobny}>{m.tender.organization}</Text> : null}
          {m.tender?.deadline ? (
            <Text style={styles.drobny}>
              {t(`Termin ofert: ${formatDate(m.tender.deadline)}`, `Bid deadline: ${formatDate(m.tender.deadline)}`)}
              {/* Ile dni zostało — bez liczenia w głowie (seria 2 runda 2). */}
              {opisTerminu(m.tender.deadline).stan !== 'brak' ? (
                <Text style={opisTerminu(m.tender.deadline).pilny ? styles.terminPilny : styles.terminDni}>{` · ${t(opisTerminu(m.tender.deadline).etykieta)}`}</Text>
              ) : null}
            </Text>
          ) : null}
          {(m.uzasadnienie ?? []).length ? (
            <View style={styles.uzasadnienie}>
              {m.uzasadnienie.map((p) => (
                <View key={p} style={styles.punktRzad}>
                  <Ikona nazwa="ok" rozmiar={16} kolor={kolory.sukcesAkcent} />
                  <Text style={styles.punkt}>{p}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {m.decyzja_szefa?.decyzja ? (
            <Text style={m.decyzja_szefa.decyzja === 'tak' ? styles.terminDni : styles.terminPilny}>
              {m.decyzja_szefa.decyzja === 'tak' ? t('Szef: startujemy', 'Boss: we bid') : t('Szef: nie startujemy', 'Boss: we pass')}
            </Text>
          ) : null}
          {m.ocena_bez_ai ? (
            <Text style={styles.drobny}>{t('Wybrany wstępnie, bez oceny AI — AI sprawdzi go przy najbliższym przeglądzie.', 'Picked provisionally, without an AI review — AI will check it in the next review.')}</Text>
          ) : null}
          <View style={styles.rzad}>
            {wziete.has(m.id) || (isSaved(m.id) && m.status === 'przygotowuje') ? (
              <View style={[styles.przyciskPol, styles.wzietyStan]}>
                <Ikona nazwa="ok" rozmiar={16} kolor={kolory.sukcesAkcent} />
                <Text style={styles.wzietyTekst}>{t('Bierzesz', 'Bidding')}</Text>
              </View>
            ) : (
              <Button
                title={t('Biorę', 'I will bid')}
                loading={bioreId === m.id}
                onPress={() => biore(m)}
                style={[styles.przyciskPol, styles.przyciskMaly]}
              />
            )}
            <Button title={t('Nie dla nas', 'Not for us')} variant="ghost" onPress={() => setDoOdrzucenia(m)} style={[styles.przyciskPol, styles.przyciskMaly]} />
          </View>
        </Pressable>
      ))}

      {/* Propozycje zmian w karcie POD wyborem dnia (2026-11-10) — najpierw decyzje, potem porządki. */}
      {(dzien.propozycje ?? []).map((p) => (
        <View key={p.klucz} style={styles.propozycja}>
          <Text style={styles.propozycjaTekst}>{t(p.opis)}</Text>
          <View style={styles.rzad}>
            <Button title={t('Przyjmij', 'Accept')} loading={propozycjaWToku === p.klucz} onPress={() => propozycja(p, 'przyjmij')} style={styles.przyciskPol} />
            <Button title={t('Nie teraz', 'Not now')} variant="ghost" disabled={Boolean(propozycjaWToku)} onPress={() => propozycja(p, 'nie_teraz')} style={styles.przyciskPol} />
          </View>
        </View>
      ))}

      {grupy.length ? (
        <View style={styles.odrzucone}>
          <Pressable onPress={() => setRozwiniete((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: rozwiniete }} style={styles.odrzuconeNaglowek}>
            <Text style={styles.odrzuconeTytul}>
              {t(`Odrzucone przez aplikację (${razem})`, `Rejected by the app (${razem})`)}
            </Text>
            <View style={{ transform: [{ rotate: rozwiniete ? '-90deg' : '90deg' }] }}>
              <Ikona nazwa="dalej" rozmiar={16} kolor={kolory.textMuted} />
            </View>
          </Pressable>
          {rozwiniete ? (
            <View>
              {grupy.map((g) => (
                <View key={g.kod} style={styles.grupaRzad}>
                  <Text style={styles.grupaEtykieta}>{t(g.etykieta)}</Text>
                  <Text style={styles.grupaLiczba}>{g.liczba}</Text>
                </View>
              ))}
              {dzien.odrzucone?.lista_dostepna ? (
                <Button title={t('Pokaż listę odrzuconych', 'Show rejected list')} variant="ghost" onPress={() => navigation.navigate('Odrzucone')} />
              ) : zakup ? (
                <Pressable onPress={onUpgrade} accessibilityRole="button">
                  <Text style={styles.brakCta}>{t('Pełna lista odrzuconych z przyczynami jest w planie Standard', 'The full rejected list with reasons is on the Standard plan')}</Text>
                </Pressable>
              ) : (
                <Text style={styles.raportDrobny}>{t('Pełna lista odrzuconych z przyczynami jest w planie Standard', 'The full rejected list with reasons is on the Standard plan')}</Text>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

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
  // Raport dnia: ciemny blok — „tyle zrobiła aplikacja, zanim tu zajrzałeś".
  raport: { padding: spacing.md + 2, borderRadius: radius.lg, backgroundColor: k.atrament, marginBottom: spacing.md, gap: 4 },
  raportNaglowek: { fontSize: 13, fontWeight: '700', color: k.atramentDrugi },
  raportTekst: { fontSize: 17, lineHeight: 23, fontWeight: '800', color: k.naAtramencie, letterSpacing: -0.2 },
  raportDrobny: { fontSize: 13, lineHeight: 18, color: k.atramentDrugi },
  drobny: { fontSize: 13, lineHeight: 18, color: k.textMuted, marginTop: spacing.xs },
  proba: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.sukcesTlo, marginBottom: spacing.sm },
  probaTekst: { fontSize: 15, fontWeight: '700', color: k.sukcesAkcent },
  probaCta: { fontSize: 14, fontWeight: '700', color: k.text, marginTop: spacing.xs },
  brak: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.ostrzezenieTlo, marginBottom: spacing.sm },
  brakTekst: { fontSize: 14, lineHeight: 20, color: k.ostrzezenieTekst },
  brakCta: { fontSize: 14, fontWeight: '700', color: k.blue, marginTop: spacing.xs },
  propozycja: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, borderLeftWidth: 4, borderLeftColor: k.ostrzezenieAkcent, marginBottom: spacing.sm },
  propozycjaTekst: { fontSize: 14, color: k.text, lineHeight: 20 },
  sekcja: { ...typografia.sekcja, color: k.text, marginTop: spacing.md, marginBottom: spacing.sm },
  karta: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, marginBottom: 12 },
  kartaWcisnieta: { backgroundColor: k.powierzchniaWtorna, borderColor: k.obramowaniePola },
  kartaTytul: { ...typografia.karta, color: k.text },
  uzasadnienie: { marginTop: spacing.sm, gap: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: k.border },
  punktRzad: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  punkt: { flex: 1, fontSize: 14, lineHeight: 20, color: k.text },
  rzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  przyciskPol: { flex: 1 },
  przyciskMaly: { minHeight: 42, paddingVertical: 8 },
  wzietyStan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 42, borderRadius: radius.md, backgroundColor: k.sukcesTlo },
  wzietyTekst: { fontSize: 15, fontWeight: '800', color: k.text },
  bladKarta: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, gap: spacing.sm },
  bladTekst: { color: k.textMuted, fontSize: 14, lineHeight: 20 },
  terminDni: { fontWeight: '700', color: k.text },
  terminPilny: { fontWeight: '800', color: k.ostrzezenieTekst },
  postep: { marginBottom: spacing.sm, gap: 6 },
  postepRzad: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  postepTekst: { fontSize: 14, fontWeight: '700', color: k.text },
  postepDrobny: { fontSize: 13, color: k.textMuted },
  postepTor: { height: 6, borderRadius: 3, backgroundColor: k.border, overflow: 'hidden' },
  postepWypelnienie: { height: 6, borderRadius: 3, backgroundColor: k.blue },
  gotowe: {
    marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.lg, gap: spacing.sm,
    backgroundColor: k.sukcesTlo, borderWidth: 1, borderColor: k.border,
  },
  gotoweRzad: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gotoweZnak: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: k.surface },
  gotoweTytul: { fontSize: 17, fontWeight: '800', color: k.text },
  gotoweTekst: { fontSize: 15, lineHeight: 21, color: k.text },
  gotoweDrobny: { fontSize: 13, color: k.textMuted },
  odrzucone: { marginTop: spacing.sm, backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, paddingHorizontal: spacing.md },
  odrzuconeNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  odrzuconeTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  grupaRzad: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: k.border },
  grupaEtykieta: { flex: 1, fontSize: 14, color: k.text },
  grupaLiczba: { fontSize: 14, fontWeight: '800', color: k.text, fontVariant: ['tabular-nums'] },
}));
