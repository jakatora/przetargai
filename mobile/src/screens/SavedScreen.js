import { useState, useCallback, useRef } from 'react';
import {
  FlatList, View, Text, Pressable, ActivityIndicator, Switch, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { opisBrakuPrzypomnienia, opisTerminu } from '../lib/termin';
import { ScoreBadge } from '../components/MatchCard';
import { znacznikKryteriow } from '../lib/kryteriaOceny';
import { znacznikZmian, znacznikOtwarcia } from '../lib/zmianyDokumentow';
import StatusPicker from '../components/StatusPicker';
import { StanLadowania } from '../components/Stan';
import { STATUS_DOMYSLNY, przypomnieniaWstrzymane } from '../lib/statusPrzetargu';
import { uruchomSciezkeOdwolania } from '../lib/orkiestratorOdwolania';
import { zaplanujPowiadomienieOTerminieKio } from '../services/powiadomieniaKio';
import * as storage from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { eksportujNaEmail } from '../services/eksportCsv';
import { kolejnoscZapisanych, podsumowanieZapisanych } from '../lib/kolejnoscZapisanych';
import { utworzLicznikZadan } from '../lib/licznikZadan';

export default function SavedScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleZapisanych);
  // Zakładki to drugi najczęściej otwierany ekran — dwujęzyczny jak feed (P1-5).
  const { t, jezyk } = useJezyk();
  const { toggle } = useSaved();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blad, setBlad] = useState(false);
  const [bladZapisu, setBladZapisu] = useState(false);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [zajete, setZajete] = useState(() => new Set());
  const blokady = useRef(new Set());
  const odczyty = useRef(utworzLicznikZadan());
  function rozpocznij(id) {
    if (blokady.current.has(id)) return false;
    odczyty.current.nowe(); // wcześniejszy GET nie może cofnąć decyzji użytkownika
    blokady.current.add(id); setZajete(new Set(blokady.current));
    setBladZapisu(false);
    return true;
  }
  function zakoncz(id) {
    blokady.current.delete(id); setZajete(new Set(blokady.current));
  }

  const wczytaj = useCallback(async () => {
    // Odczyt w trakcie zapisu mógłby zwrócić poprzedni stan serwera.
    if (blokady.current.size) return;
    const nr = odczyty.current.nowe();
    try {
      const d = await api.getSaved();
      if (!odczyty.current.czyAktualne(nr)) return;
      if (!Array.isArray(d?.saved)) throw new Error('Invalid saved response');
      // Co pilne — na górze (najbliższy termin), historia na dole; przy edycji etapu lista nie skacze.
      setItems(kolejnoscZapisanych(d.saved));
      setBlad(false);
    } catch {
      // Offline/awaria — zostaje ostatnia lista, ale gdy nie mamy CZEGO pokazać,
      // musimy odróżnić „nie masz zapisanych" od „nie udało się wczytać" (inaczej
      // user widzi mylący pusty stan). Wzór jak w feedzie.
      if (odczyty.current.czyAktualne(nr)) setBlad(true);
    } finally {
      if (odczyty.current.czyAktualne(nr)) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void wczytaj();
    // Także po zmianie konta: nawigator jest montowany od nowa dla user.id.
    return () => { odczyty.current.nowe(); };
  }, [wczytaj]));

  async function usun(tenderId) {
    if (!rozpocznij(tenderId)) return;
    try {
      await toggle(tenderId, false);
      setItems((prev) => prev.filter((s) => s.tender.id !== tenderId));
    } catch { setBladZapisu(true); }
    finally { zakoncz(tenderId); }
  }

  async function zmienStatus(item, nowy) {
    if (!rozpocznij(item.tender.id)) return;
    const poprzedni = item.status || STATUS_DOMYSLNY;
    setItems((prev) => prev.map((s) =>
      s.tender.id === item.tender.id ? { ...s, status: nowy } : s));
    try {
      await api.setStatus(item.tender.id, nowy);
      // Przegrana → uruchom ścieżkę odwołania (podzadanie 13/13): kontrola + termin
      // KIO + przypomnienie o zbliżającym się terminie.
      // Best-effort: błąd tej ścieżki nie może cofnąć zmiany statusu.
      if (nowy === 'przegrana') {
        uruchomSciezkeOdwolania(storage, item.tender)
          .then((k) => { if (k) zaplanujPowiadomienieOTerminieKio(k).catch(() => {}); })
          .catch(() => {});
      }
    } catch {
      setItems((prev) => prev.map((s) =>
        s.tender.id === item.tender.id ? { ...s, status: poprzedni } : s));
      setBladZapisu(true);
    } finally { zakoncz(item.tender.id); }
  }

  async function przelaczPrzypomnienie(item, wartosc) {
    if (!rozpocznij(item.tender.id)) return;
    // Optymistycznie; przy błędzie cofamy.
    setItems((prev) => prev.map((s) =>
      s.tender.id === item.tender.id ? { ...s, reminder_enabled: wartosc } : s));
    try {
      const stan = await api.setReminder(item.tender.id, wartosc);
      setItems((prev) => prev.map((s) =>
        s.tender.id === item.tender.id
          ? { ...s, reminder_enabled: stan.reminder_enabled, remind_at: stan.remind_at }
          : s));
    } catch {
      setItems((prev) => prev.map((s) =>
        s.tender.id === item.tender.id ? { ...s, reminder_enabled: item.reminder_enabled } : s));
      setBladZapisu(true);
    } finally { zakoncz(item.tender.id); }
  }

  if (loading) {
    return <View style={styles.list}><StanLadowania karty={3} /></View>;
  }

  function renderItem({ item }) {
    const tender = item.tender;
    const termin = opisTerminu(tender.deadline);
    const maTermin = !!tender.deadline && !termin.minal;
    const brakPrzypomnienia = opisBrakuPrzypomnienia(tender.deadline);
    const kryteria = znacznikKryteriow(tender);
    const zmiany = znacznikZmian(tender);
    const otwarcie = znacznikOtwarcia(tender, t);
    return (
      // Karta to zwykły View: NAWIGUJE tylko górny wiersz. Gdyby cała karta była
      // Pressable, przełącznik przypomnienia (na web) otwierałby szczegóły.
      <View style={styles.card}>
        {zajete.has(tender.id) ? <Text accessibilityLiveRegion="polite" style={styles.przypOpis}>
          {t('Zapisywanie zmiany…', 'Saving change…')}
        </Text> : null}
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('MatchDetail', { match: item })}
          accessibilityRole="button"
          accessibilityLabel={`${tender.title}. ${termin.etykieta}.`}
        >
          <ScoreBadge score={item.confidence_score} />
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={3}>{tender.title}</Text>
            {tender.organization ? <Text style={styles.org} numberOfLines={1}>{tender.organization}</Text> : null}
            <Text style={styles.deadline}>{t('Termin', 'Deadline')}: {formatDate(tender.deadline)}</Text>
            <Text style={[styles.znacznik, termin.minal && styles.miniony, termin.pilny && styles.pilny]}>
              {termin.etykieta}
            </Text>
            {kryteria ? (
              <Text style={[styles.kryteria, !kryteria.tylkoCena && styles.kryteriaPozacenowe]} numberOfLines={1}>
                {t(kryteria.pl, kryteria.en)}
              </Text>
            ) : null}
            {zmiany ? <Text style={[styles.kryteria, styles.zmiany]} numberOfLines={2}>{t(zmiany.pl, zmiany.en)}</Text> : null}
            {otwarcie ? <Text style={[styles.kryteria, styles.kryteriaPozacenowe]} numberOfLines={1}>{otwarcie}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" disabled={zajete.has(tender.id)} onPress={() => usun(tender.id)} hitSlop={12} accessibilityLabel={t('Usuń z zapisanych', 'Remove from saved')} style={styles.gwiazdka}>
            <Text style={[styles.gwiazdkaZnak, { color: kolory.blue }]}>★</Text>
          </Pressable>
        </Pressable>

        <View style={styles.etapBlok}>
          <Text style={styles.etapEtykieta}>{t('Etap', 'Stage')}</Text>
          <StatusPicker disabled={zajete.has(tender.id)} wartosc={item.status || STATUS_DOMYSLNY} onChange={(v) => zmienStatus(item, v)} />
        </View>

        <View style={styles.przypomnienie}>
          <View style={styles.przypInfo}>
            <Text style={styles.przypTytul}>{przypomnieniaWstrzymane(item.status) ? t('Przypomnienia wstrzymane', 'Reminders paused') : t('Przypomnij przed terminem', 'Remind me before the deadline')}</Text>
            <Text style={styles.przypOpis}>
              {przypomnieniaWstrzymane(item.status)
                ? t('Na tym etapie nie wysyłamy przypomnień o składaniu oferty. Przełącznik określa, czy mają działać po powrocie do przygotowania oferty, jeśli termin jeszcze nie minął.',
                  'Bid submission reminders are paused at this stage. The switch sets whether to resume them if you return to preparing the bid before its deadline.')
                : maTermin
                ? (item.reminder_enabled
                  ? t('Powiadomimy Cię na 7, 3 i 1 dzień przed terminem składania ofert.',
                    'We will notify you 7, 3 and 1 day before the bid submission deadline.')
                  : t('Push, żebyś nie przegapił terminu.', 'A push so you do not miss the deadline.'))
                : t(brakPrzypomnienia.pl, brakPrzypomnienia.en)}
            </Text>
          </View>
          <Switch
            accessibilityLabel={przypomnieniaWstrzymane(item.status) ? t('Przypomnienia po powrocie do przygotowania oferty', 'Reminders when returning to bid preparation') : t('Przypomnij przed terminem', 'Remind me before the deadline')}
            value={item.reminder_enabled}
            onValueChange={(v) => przelaczPrzypomnienie(item, v)}
            disabled={!maTermin || zajete.has(tender.id)}
            trackColor={{ true: kolory.blue }}
          />
        </View>
      </View>
    );
  }

  const skrot = podsumowanieZapisanych(items);
  const odswiez = async () => { setOdswiezanie(true); await wczytaj(); setOdswiezanie(false); };

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={items.length ? styles.list : styles.listEmpty}
      refreshControl={<RefreshControl refreshing={odswiezanie} onRefresh={odswiez} tintColor={kolory.blue} />}
      ListHeaderComponent={<View>
        {skrot ? (
          <Text style={[styles.skrot, skrot.pilne && { color: kolory.ostrzezenieTekst }]} accessibilityRole="summary">{t(skrot)}</Text>
        ) : null}
        {blad && items.length ? <View>
          <Text accessibilityRole="alert" style={{ color: kolory.danger }}>
            {t('Nie udało się odświeżyć listy. Pokazujemy ostatnio wczytane dane.',
              'Could not refresh the list. Showing previously loaded data.')}
          </Text>
          <Pressable onPress={wczytaj} accessibilityRole="button" style={styles.ponowBtn}>
            <Text style={styles.ponowBtnTekst}>{t('Spróbuj ponownie', 'Try again')}</Text>
          </Pressable>
        </View> : null}
        {bladZapisu ? <Text accessibilityRole="alert" style={{ color: kolory.danger, marginBottom: spacing.md }}>
          {t('Nie udało się potwierdzić zapisu zmiany. Pokazujemy poprzednie ustawienie. Sprawdź połączenie i spróbuj ponownie.',
            'Could not confirm the change was saved. Showing the previous setting. Check your connection and try again.')}
        </Text> : null}
        {items.length ? (
        <View style={styles.widokiRzad}>
          <Pressable style={styles.widokBtn} onPress={() => navigation.navigate('Pulpit')} accessibilityRole="button">
            <Text style={styles.widokBtnTekst}>📋  {t('Moje oferty', 'My bids')}</Text>
          </Pressable>
          <Pressable style={styles.widokBtn} onPress={() => navigation.navigate('KalendarzTerminow')} accessibilityRole="button">
            <Text style={styles.widokBtnTekst}>📅  {t('Kalendarz', 'Calendar')}</Text>
          </Pressable>
          <Pressable
            style={styles.widokBtn}
            onPress={() => eksportujNaEmail({ rodzaj: 'zapisane', email: user?.email, jezyk })}
            accessibilityRole="button"
          >
            <Text style={styles.widokBtnTekst}>📤  {t('Excel', 'Excel')}</Text>
          </Pressable>
        </View>
      ) : null}</View>}
      renderItem={renderItem}
      ListEmptyComponent={blad ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>{t('Nie udało się wczytać', 'Could not load')}</Text>
          <Text style={styles.emptyText}>
            {t('Sprawdź połączenie z internetem i spróbuj ponownie.', 'Check your internet connection and try again.')}
          </Text>
          <Pressable
            style={styles.ponowBtn}
            onPress={() => { setLoading(true); wczytaj(); }}
            accessibilityRole="button"
          >
            <Text style={styles.ponowBtnTekst}>{t('Spróbuj ponownie', 'Try again')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>☆</Text>
          <Text style={styles.emptyTitle}>{t('Brak zapisanych przetargów', 'No saved tenders')}</Text>
          <Text style={styles.emptyText}>
            {t(
              'Dotknij gwiazdki przy przetargu, aby zapisać go tutaj — ustawisz etap pracy, dopiszesz notatki i włączysz przypomnienie o terminie.',
              'Tap the star on a tender to save it here — you can set your stage, add notes and turn on a deadline reminder.',
            )}
          </Text>
        </View>
      )}
    />
  );
}

const tworzStyleZapisanych = tworzStyle((k) => ({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  skrot: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.md },
  widokiRzad: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  widokBtn: {
    flex: 1,
    backgroundColor: k.wyroznienie ?? k.surface,
    borderWidth: 1, borderColor: k.blue, borderRadius: radius.md,
    paddingVertical: spacing.sm + 2, alignItems: 'center',
  },
  widokBtnTekst: { fontSize: 14, fontWeight: '800', color: k.blue },
  list: { padding: spacing.lg },
  listEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: k.text },
  org: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  deadline: { fontSize: 12, color: k.textMuted, marginTop: 6 },
  znacznik: { marginTop: spacing.xs, fontSize: 12, fontWeight: '700', color: k.textMuted },
  pilny: { color: k.ostrzezenieTekst },
  miniony: { color: k.danger },
  kryteria: { marginTop: spacing.xs, fontSize: 12, fontWeight: '700', color: k.textMuted },
  kryteriaPozacenowe: { color: k.blue },
  zmiany: { color: k.ostrzezenieTekst },
  gwiazdka: { padding: 2 },
  gwiazdkaZnak: { fontSize: 22, lineHeight: 24, fontWeight: '700' },
  etapBlok: {
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  etapEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue, marginBottom: spacing.sm },
  przypomnienie: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  przypInfo: { flex: 1 },
  przypTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przypOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  emptyIcon: { fontSize: 48, color: k.textMuted, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  ponowBtn: {
    marginTop: spacing.lg,
    backgroundColor: k.blue,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  ponowBtnTekst: { color: k.naAkcencie, fontSize: 15, fontWeight: '700' },
}));
