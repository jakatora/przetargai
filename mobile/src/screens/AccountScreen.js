import { useState } from 'react';
import { View, Text, Alert, Pressable, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import CpvPicker from '../components/CpvPicker';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { PREFERENCJE, ETYKIETY_PREFERENCJI } from '../lib/motyw';
import { spacing, radius } from '../theme';

function parseList(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

// Ten sam adres, co w Polityce prywatności i Regulaminie (docs/*.html) — spójny kanał kontaktu.
const KONTAKT_EMAIL = 'jakatora68@gmail.com';

export default function AccountScreen({ navigation }) {
  const { user, signOut, refreshUser, setUser, zarejestrujPush } = useAuth();
  const { preferencja, ustawPreferencje } = useTheme();
  const styles = useStyle(tworzStyleKonta);
  const [keywords, setKeywords] = useState((user.keywords || []).join(', '));
  const [cpv, setCpv] = useState((user.cpv_codes || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [haslo, setHaslo] = useState('');
  const [usuwanie, setUsuwanie] = useState(false);
  const [sciagaOtwarta, setSciagaOtwarta] = useState(false);
  const [demoInfo, setDemoInfo] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  // Onboarding AI (rundy 9-10): opis firmy → słowa kluczowe + CPV.
  const [opisFirmy, setOpisFirmy] = useState('');
  const [dobieranie, setDobieranie] = useState(false);
  const [dobierInfo, setDobierInfo] = useState(null);

  const isStandard = user.premium_tier === 'standard';
  const wersjaApp = Constants.expoConfig?.version ?? '—';

  /** Otwiera klienta poczty z tematem zawierającym wersję (ułatwia diagnozę zgłoszeń). */
  function otworzKontakt() {
    const temat = encodeURIComponent(`PrzetargAI — pomoc (v${wersjaApp})`);
    Linking.openURL(`mailto:${KONTAKT_EMAIL}?subject=${temat}`).catch(() => {
      Alert.alert('Kontakt', `Napisz do nas na adres:\n${KONTAKT_EMAIL}`);
    });
  }

  async function dobierzProfil() {
    if (!opisFirmy.trim() || dobieranie) return;
    setDobieranie(true);
    setDobierInfo(null);
    try {
      const s = await api.suggestProfile(opisFirmy.trim());
      if (!s.keywords) {
        setDobierInfo(s.komunikat || 'Nie udało się dobrać podpowiedzi.');
        return;
      }
      // Dokładamy do istniejących (nie kasujemy tego, co user już wpisał), bez duplikatów.
      // Cap 30 = limit backendu (profileSchema) — bez tego scalona lista mogłaby go
      // przekroczyć i zapis profilu wróciłby z 400 (audyt R13).
      const scal = (biezace, nowe) => {
        const lista = [...parseList(biezace), ...nowe];
        return [...new Set(lista.map((x) => x.trim()).filter(Boolean))].slice(0, 30).join(', ');
      };
      if (s.keywords.length) setKeywords((b) => scal(b, s.keywords));
      if (s.cpv.length) setCpv((b) => scal(b, s.cpv));
      setDobierInfo(`Dobrano ${s.keywords.length} słów i ${s.cpv.length} kodów CPV. Sprawdź i zapisz profil.`);
    } catch (err) {
      setDobierInfo(err.message);
    } finally {
      setDobieranie(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data = await api.updateProfile({
        keywords: parseList(keywords),
        cpv_codes: parseList(cpv),
      });
      setUser(data.user);
      Alert.alert('Zapisano', 'Profil firmy został zaktualizowany.');
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Czeka, aż webhook Stripe podniesie plan. Płatność potwierdza się po stronie
   * Stripe'a, a nasz backend dowiaduje się o niej osobnym żądaniem — zwykle w kilka
   * sekund, ale nie natychmiast. Jednorazowe sprawdzenie po powrocie z przeglądarki
   * prawie zawsze trafiało w moment PRZED webhookiem i użytkownik, który właśnie
   * zapłacił, widział wciąż plan „Free" (audyt 2026-07-10).
   */
  async function poczekajNaAktywacjePlanu({ prob = 6, odstepMs = 2500 } = {}) {
    for (let i = 0; i < prob; i++) {
      const swiezy = await refreshUser().catch(() => null);
      if (swiezy?.premium_tier === 'standard') {
        // Plan aktywny — dopiero TERAZ prosimy o zgodę na powiadomienia i wysyłamy
        // token. Bez tego użytkownik płaciłby za push, którego nie dostaje, aż do
        // następnego zalogowania (audyt 2026-07-10).
        zarejestrujPush();
        return true;
      }
      if (i < prob - 1) await new Promise((r) => setTimeout(r, odstepMs));
    }
    return false;
  }

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const link = await api.createUpgradeLink();
      await WebBrowser.openBrowserAsync(link.url);

      const aktywny = await poczekajNaAktywacjePlanu();
      if (!aktywny) {
        Alert.alert(
          'Płatność w toku',
          'Jeśli płatność się powiodła, plan aktywuje się w ciągu kilku minut. '
          + 'Odśwież ten ekran lub sprawdź skrzynkę e-mail.',
        );
      }
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setUpgrading(false);
    }
  }

  /**
   * DEMO (tylko buildy deweloperskie): przełącza plan bez Stripe, żeby obejrzeć
   * różnicę pakietów. Backend poza produkcją od razu przelicza dopasowania.
   * Komunikat inline zamiast Alert — Alert.alert nie renderuje się na web.
   */
  async function przelaczDemoPlan(tier) {
    if (demoBusy || user.premium_tier === tier) return;
    setDemoBusy(true);
    setDemoInfo(null);
    try {
      const dane = await api.setDemoTier(tier);
      setUser(dane.user);
      const nazwa = tier === 'standard' ? 'Standard' : 'Free';
      setDemoInfo(
        dane.matchesCreated > 0
          ? `Plan ${nazwa} aktywny — dopasowano ${dane.matchesCreated} nowych przetargów. Wróć do listy, żeby zobaczyć różnicę.`
          : `Plan ${nazwa} aktywny. Nowych dopasowań teraz brak — Free pokazuje max 5 dziennie, Standard bez limitu przy kolejnych ogłoszeniach.`,
      );
    } catch (err) {
      setDemoInfo(`Nie udało się przełączyć: ${err.message}`);
    } finally {
      setDemoBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Wylogowanie', 'Czy na pewno chcesz się wylogować?', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Wyloguj', style: 'destructive', onPress: signOut },
    ]);
  }

  /**
   * Usunięcie konta (RODO art. 17). Google Play wymaga, by dało się to zrobić
   * z poziomu aplikacji, a nie tylko mailem do administratora.
   */
  async function usunKonto() {
    if (!haslo) {
      Alert.alert('Podaj hasło', 'Wpisz hasło, aby potwierdzić usunięcie konta.');
      return;
    }
    setUsuwanie(true);
    try {
      await api.deleteAccount(haslo);
      // Konto już nie istnieje — czyścimy sesję lokalnie i wracamy do logowania.
      await signOut();
    } catch (err) {
      Alert.alert('Nie udało się usunąć konta', err.message);
    } finally {
      setUsuwanie(false);
    }
  }

  function potwierdzUsuniecie() {
    Alert.alert(
      'Usunąć konto na zawsze?',
      'Stracisz wszystkie dopasowane przetargi i ustawienia profilu. Tej operacji nie da się cofnąć.'
      + (isStandard ? '\n\nSubskrypcja Standard zostanie anulowana.' : ''),
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń konto', style: 'destructive', onPress: usunKonto },
      ],
    );
  }

  return (
    <Screen scroll>
      <View style={styles.card}>
        <Text style={styles.company}>{user.company_name || 'Moje konto'}</Text>
        {user.company_nip ? <Text style={styles.muted}>NIP: {user.company_nip}</Text> : null}
        <Text style={styles.muted}>{user.email}</Text>
        <View style={[styles.badge, isStandard ? styles.badgeStandard : styles.badgeFree]}>
          <Text style={styles.badgeText}>Plan {isStandard ? 'Standard' : 'Free'}</Text>
        </View>
      </View>

      {isStandard ? (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>Plan Standard aktywny ✓</Text>
          <Text style={styles.upgradeText}>
            Masz nielimitowane dopasowania przetargów oraz powiadomienia push.
          </Text>
        </View>
      ) : (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>Przejdź na Standard</Text>
          <Text style={styles.upgradeText}>
            Nielimitowane dopasowania i powiadomienia push o nowych przetargach
            — 49 zł / miesiąc.
          </Text>
          <Button
            title="Przejdź na Standard"
            onPress={handleUpgrade}
            loading={upgrading}
            style={styles.gap}
          />
        </View>
      )}

      {__DEV__ ? (
        <View style={styles.demoCard}>
          <Text style={styles.demoTytul}>TRYB DEMO — porównaj pakiety</Text>
          <Text style={styles.demoOpis}>
            Przełącza plan bez płatności i od razu przelicza dopasowania.
            Widoczne tylko w buildzie deweloperskim.
          </Text>
          <View style={styles.demoPrzyciski}>
            {['free', 'standard'].map((tier) => {
              const aktywny = user.premium_tier === tier;
              return (
                <Pressable
                  key={tier}
                  onPress={() => przelaczDemoPlan(tier)}
                  disabled={demoBusy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.demoPrzycisk, aktywny && styles.demoPrzyciskAktywny]}
                >
                  <Text style={[styles.demoPrzyciskTekst, aktywny && styles.demoPrzyciskTekstAktywny]}>
                    {tier === 'standard' ? 'Standard' : 'Free'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {demoBusy ? <Text style={styles.demoInfo}>Przełączam…</Text> : null}
          {demoInfo ? <Text style={styles.demoInfo}>{demoInfo}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Profil firmy</Text>
      <Text style={styles.sectionHint}>
        Na podstawie tych danych AI dopasowuje przetargi do Twojej firmy.
      </Text>

      {/* Onboarding AI (rundy 9-10): nie wiesz jakie słowa/CPV? Opisz firmę. */}
      <View style={styles.dobierzCard}>
        <Text style={styles.dobierzTytul}>Nie wiesz, co wpisać?</Text>
        <Text style={styles.dobierzOpis}>
          Opisz jednym zdaniem, czym się zajmujesz — AI dobierze słowa kluczowe i kody CPV.
        </Text>
        <TextField
          value={opisFirmy}
          onChangeText={setOpisFirmy}
          placeholder="np. Kładę kostkę brukową i buduję ogrodzenia"
          multiline
        />
        <Button
          title="Dobierz słowa i CPV"
          onPress={dobierzProfil}
          loading={dobieranie}
          variant="ghost"
          style={styles.gap}
        />
        {dobierInfo ? <Text style={styles.dobierzInfo}>{dobierInfo}</Text> : null}
      </View>

      <TextField
        label="Słowa kluczowe"
        value={keywords}
        onChangeText={setKeywords}
        placeholder="remont, budowa drogi, instalacje"
        hint="Po przecinku"
        multiline
      />
      <TextField
        label="Kody CPV"
        value={cpv}
        onChangeText={setCpv}
        placeholder="45000000, 45300000"
        hint="Po przecinku"
        style={styles.poleCpv}
      />
      <Pressable onPress={() => setSciagaOtwarta(true)} hitSlop={8} accessibilityRole="button">
        <Text style={styles.linkSciagi}>Nie znasz kodów? Otwórz ściągę CPV →</Text>
      </Pressable>
      <Button title="Zapisz profil" onPress={handleSave} loading={saving} />

      <Text style={styles.sectionTitle}>Narzędzia firmy</Text>
      <Text style={styles.sectionHint}>
        Bank referencji pilnuje „terminu przydatności” Twojego doświadczenia (roboty 5 lat,
        dostawy i usługi 3 lata) — żebyś nie odkrył w dniu składania, że kluczowa robota już
        się nie liczy.
      </Text>
      <Button
        title="Otwórz bank referencji"
        variant="ghost"
        onPress={() => navigation.navigate('BankReferencji')}
      />
      <Button
        title="Certyfikat wykonawcy — czy się opłaca?"
        variant="ghost"
        onPress={() => navigation.navigate('CertyfikatWykonawcy')}
      />
      <Button
        title="Kalkulator terminów Pzp"
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorTerminow')}
        style={styles.gap}
      />
      <Button
        title="Kalkulator ceny ofertowej"
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorCeny')}
        style={styles.gap}
      />
      <Button
        title="Sprawdzarka formularza cenowego"
        variant="ghost"
        onPress={() => navigation.navigate('SprawdzarkaCeny')}
        style={styles.gap}
      />
      <Button
        title="Symulator punktacji oferty"
        variant="ghost"
        onPress={() => navigation.navigate('SymulatorPunktacji')}
        style={styles.gap}
      />
      <Button
        title="Kalkulator kar umownych"
        variant="ghost"
        onPress={() => navigation.navigate('KaryUmowne')}
        style={styles.gap}
      />
      <Button
        title="Odsetki za opóźnienie + rekompensata"
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorOdsetek')}
        style={styles.gap}
      />

      <CpvPicker
        widoczny={sciagaOtwarta}
        onClose={() => setSciagaOtwarta(false)}
        wartosc={cpv}
        onChange={setCpv}
      />

      <Text style={styles.sectionTitle}>Wygląd</Text>
      <Text style={styles.sectionHint}>
        „Systemowy” podąża za ustawieniem telefonu.
      </Text>
      <View style={styles.motywy} accessibilityRole="radiogroup">
        {PREFERENCJE.map((opcja) => {
          const aktywna = preferencja === opcja;
          return (
            <Pressable
              key={opcja}
              onPress={() => ustawPreferencje(opcja)}
              accessibilityRole="radio"
              accessibilityState={{ selected: aktywna }}
              style={[styles.motyw, aktywna && styles.motywAktywny]}
            >
              <Text style={[styles.motywTekst, aktywna && styles.motywTekstAktywny]}>
                {ETYKIETY_PREFERENCJI[opcja]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        ZGODNOŚĆ — Google Play, zasady „twierdzeń wprowadzających w błąd" (2026-07-12).
        Aplikacja podaje informacje urzędowe (ogłoszenia o zamówieniach publicznych),
        więc MUSI: (1) wskazać oficjalne, DZIAŁAJĄCE źródła tych informacji,
        (2) wyraźnie zastrzec, że nie reprezentuje instytucji państwowej.
        Odrzucenie wynikło z braku tego zastrzeżenia i z linku źródłowego, który
        recenzent uznał za niedostępny. NIE USUWAĆ tej sekcji.
      */}
      <Text style={styles.sectionTitle}>Źródła danych i zastrzeżenie</Text>
      <View style={styles.zrodlaCard}>
        <Text style={styles.zastrzezenie}>
          PrzetargAI jest niezależną, prywatną aplikacją. Nie jest powiązana z Urzędem
          Zamówień Publicznych, platformą e-Zamówienia, Unią Europejską ani żadną inną
          instytucją państwową i nie działa w ich imieniu.
        </Text>
        <Text style={styles.zrodlaOpis}>
          Ogłoszenia pochodzą z oficjalnych, publicznych rejestrów. Wiążąca jest
          zawsze treść ogłoszenia u źródła — dopasowania i wyjaśnienia generuje AI
          i mają charakter wyłącznie informacyjny.
        </Text>

        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://ezamowienia.gov.pl')}
          accessibilityRole="link"
          hitSlop={8}
        >
          <Text style={styles.zrodloLink}>
            Biuletyn Zamówień Publicznych (BZP) — ezamowienia.gov.pl →
          </Text>
        </Pressable>
        <Text style={styles.zrodloPodpis}>Prowadzony przez Urząd Zamówień Publicznych.</Text>

        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://ted.europa.eu')}
          accessibilityRole="link"
          hitSlop={8}
          style={styles.gap}
        >
          <Text style={styles.zrodloLink}>
            TED — Tenders Electronic Daily — ted.europa.eu →
          </Text>
        </Pressable>
        <Text style={styles.zrodloPodpis}>Dziennik Urzędowy UE — zamówienia powyżej progów unijnych.</Text>

        {/*
          Google Play wymaga linku do polityki prywatności ZARÓWNO w listingu, JAK I
          w aplikacji (mail o odrzuceniu 2026-07-13). Wcześniej apka nie linkowała jej
          nigdzie — to była druga, niezależna podstawa do odrzucenia. NIE USUWAĆ.
        */}
        <View style={styles.prawneRzad}>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync('https://przetargai.web.app/polityka-prywatnosci')}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={styles.linkPrawny}>Polityka prywatności</Text>
          </Pressable>
          <Text style={styles.zrodloPodpis}>·</Text>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync('https://przetargai.web.app/regulamin')}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={styles.linkPrawny}>Regulamin</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Pomoc i kontakt</Text>
      <View style={styles.zrodlaCard}>
        <Text style={styles.zrodlaOpis}>
          Masz pytanie albo problem z kontem lub płatnością? Napisz do nas — pomożemy.
        </Text>
        <Pressable onPress={otworzKontakt} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.zrodloLink}>Napisz do nas: {KONTAKT_EMAIL} →</Text>
        </Pressable>
        <Text style={styles.wersja}>PrzetargAI · wersja {wersjaApp}</Text>
      </View>

      <View style={styles.signOut}>
        <Button title="Wyloguj się" variant="ghost" onPress={confirmSignOut} />
      </View>

      <View style={styles.strefaNiebezpieczna}>
        <Text style={styles.naglowekNiebezpieczny}>Usunięcie konta</Text>
        <Text style={styles.opisNiebezpieczny}>
          Trwale usuwamy Twoje konto, profil i wszystkie dopasowane przetargi.
          {isStandard
            ? ' Subskrypcję Standard anulujemy automatycznie — karta nie zostanie już obciążona.'
            : ' Tej operacji nie da się cofnąć.'}
        </Text>
        <TextField
          label="Potwierdź hasłem"
          value={haslo}
          onChangeText={setHaslo}
          secureTextEntry
          placeholder="••••••••"
        />
        <Button
          title="Usuń konto na zawsze"
          variant="danger"
          onPress={potwierdzUsuniecie}
          loading={usuwanie}
        />
      </View>
    </Screen>
  );
}

const tworzStyleKonta = tworzStyle((k) => ({
  strefaNiebezpieczna: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  naglowekNiebezpieczny: { fontSize: 16, fontWeight: '700', color: k.danger, marginBottom: spacing.xs },
  opisNiebezpieczny: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  company: { fontSize: 19, fontWeight: '800', color: k.text },
  muted: { fontSize: 14, color: k.textMuted, marginTop: 4 },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeFree: { backgroundColor: k.neutralneTlo },
  badgeStandard: { backgroundColor: k.sukcesTlo },
  badgeText: { fontSize: 13, fontWeight: '700', color: k.text },
  upgradeCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: k.blue,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  upgradeTitle: { fontSize: 16, fontWeight: '800', color: k.text },
  upgradeText: { fontSize: 14, color: k.textMuted, marginTop: 6, lineHeight: 21 },
  gap: { marginTop: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.lg },
  sectionHint: { fontSize: 13, color: k.textMuted, marginTop: 4, marginBottom: spacing.md },
  poleCpv: { marginBottom: spacing.xs },
  dobierzCard: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  dobierzTytul: { fontSize: 15, fontWeight: '800', color: k.text },
  dobierzOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, marginBottom: spacing.sm, lineHeight: 18 },
  dobierzInfo: { fontSize: 13, color: k.blue, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  linkSciagi: { color: k.blue, fontSize: 14, fontWeight: '600', marginBottom: spacing.md },
  demoCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  demoTytul: { fontSize: 13, fontWeight: '800', color: k.ostrzezenieTekst, letterSpacing: 0.5 },
  demoOpis: { fontSize: 12, color: k.ostrzezenieTekst, marginTop: 4, lineHeight: 17, opacity: 0.9 },
  demoPrzyciski: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  demoPrzycisk: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: k.ostrzezenieTekst,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  demoPrzyciskAktywny: { backgroundColor: k.ostrzezenieTekst },
  demoPrzyciskTekst: { fontSize: 14, fontWeight: '700', color: k.ostrzezenieTekst },
  demoPrzyciskTekstAktywny: { color: k.surface },
  demoInfo: { fontSize: 12, color: k.ostrzezenieTekst, marginTop: spacing.sm, lineHeight: 17, fontWeight: '600' },
  motywy: { flexDirection: 'row', gap: spacing.sm },
  motyw: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: k.border,
    backgroundColor: k.surface,
    alignItems: 'center',
  },
  motywAktywny: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  motywTekst: { fontSize: 14, fontWeight: '600', color: k.textMuted },
  motywTekstAktywny: { color: k.blue },
  signOut: { marginTop: spacing.lg, marginBottom: spacing.xl },
  zrodlaCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  zastrzezenie: { fontSize: 13, fontWeight: '700', color: k.text, lineHeight: 19 },
  zrodlaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  zrodloLink: { fontSize: 14, fontWeight: '700', color: k.blue, lineHeight: 20 },
  zrodloPodpis: { fontSize: 12, color: k.textMuted, lineHeight: 17 },
  wersja: { fontSize: 12, color: k.textMuted, marginTop: spacing.xs },
  prawneRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: k.border,
  },
  linkPrawny: { fontSize: 13, fontWeight: '700', color: k.blue },
}));
