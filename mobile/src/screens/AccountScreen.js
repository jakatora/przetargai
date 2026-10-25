import { useState } from 'react';
import { View, Text, Pressable, Linking, Switch } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { PREFERENCJE, ETYKIETY_PREFERENCJI } from '../lib/motyw';
import { spacing, radius } from '../theme';
import { potwierdzAkcje } from '../lib/potwierdzenie';
import { srodowiskoPotwierdzen, komunikat } from '../services/srodowiskoPotwierdzen';

// Ten sam adres, co w Polityce prywatności i Regulaminie (docs/*.html) — spójny kanał kontaktu.
import { useJezyk } from '../context/JezykContext';
import { opisProby } from '../lib/selekcja';

const KONTAKT_EMAIL = 'jakatora68@gmail.com';

export default function AccountScreen({ navigation }) {
  const { user, signOut, refreshUser, setUser, zarejestrujPush } = useAuth();
  const { preferencja, ustawPreferencje } = useTheme();
  const { t, jezyk, jezyki, etykiety: etykietyJezykow, ustawJezyk } = useJezyk();
  const styles = useStyle(tworzStyleKonta);
  const [upgrading, setUpgrading] = useState(false);
  const [rezygnacja, setRezygnacja] = useState(false);
  const [haslo, setHaslo] = useState('');
  const [usuwanie, setUsuwanie] = useState(false);
  const [demoInfo, setDemoInfo] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const isStandard = user.premium_tier === 'standard';
  // Próba Standard (spec §15) — z API; stary zapis użytkownika bez pola `proba` = brak paska.
  const proba = opisProby(user.proba);
  const wersjaApp = Constants.expoConfig?.version ?? '—';

  /** Otwiera klienta poczty z tematem zawierającym wersję (ułatwia diagnozę zgłoszeń). */
  function otworzKontakt() {
    const temat = encodeURIComponent(`PrzetargAI — pomoc (v${wersjaApp})`);
    Linking.openURL(`mailto:${KONTAKT_EMAIL}?subject=${temat}`).catch(() => {
      komunikat('Kontakt', `Napisz do nas na adres:\n${KONTAKT_EMAIL}`);
    });
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
        komunikat(
          t('Płatność w toku', 'Payment in progress'),
          t('Jeśli płatność się powiodła, plan aktywuje się w ciągu kilku minut. Odśwież ten ekran lub sprawdź skrzynkę e-mail.',
            'If the payment went through, the plan activates within a few minutes. Refresh this screen or check your e-mail.'),
        );
      }
    } catch (err) {
      komunikat(t('Błąd', 'Error'), err.message);
    } finally {
      setUpgrading(false);
    }
  }

  /**
   * Rezygnacja z subskrypcji: planuje anulowanie na koniec opłaconego okresu.
   * Standard działa do końca miesiąca, potem konto wraca na Free (webhook Stripe).
   * Nie pobieramy żadnej opłaty i nie zwracamy pieniędzy — sama zmiana harmonogramu.
   */
  async function potwierdzRezygnacje() {
    // Na webie Alert.alert jest pusty — potwierdzAkcje pyta przez window.confirm.
    potwierdzAkcje({
      tytul: t('Zrezygnować z subskrypcji?', 'Cancel the subscription?'),
      tresc: t('Standard będzie działać do końca opłaconego okresu, a potem konto wróci na plan Free. Nie pobierzemy kolejnej opłaty. W każdej chwili możesz wznowić subskrypcję.',
        'Standard keeps working until the end of the paid period, then the account returns to Free. We will not charge again. You can resume any time.'),
      etykietaTak: t('Rezygnuję', 'Cancel it'),
      etykietaNie: t('Zostaję', 'Keep it'),
      onTak: () => anulujSubskrypcje(),
    }, srodowiskoPotwierdzen());
  }

  async function anulujSubskrypcje() {
    setRezygnacja(true);
    try {
      const wynik = await api.anulujSubskrypcje();
      // Odświeżamy usera — plan nie zmienia się od razu (Standard do końca okresu),
      // ale gdyby backend zaktualizował cokolwiek, chcemy to zobaczyć.
      await refreshUser().catch(() => {});
      komunikat(t('Rezygnacja przyjęta', 'Cancellation accepted'), wynik.komunikat || t('Subskrypcja nie odnowi się.', 'The subscription will not renew.'));
    } catch (err) {
      komunikat(t('Nie udało się zrezygnować', 'Could not cancel'), err.message);
    } finally {
      setRezygnacja(false);
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
    // Na webie Alert.alert jest pusty — potwierdzAkcje pyta tam przez window.confirm.
    potwierdzAkcje({
      tytul: t('Wylogowanie', 'Sign out'),
      tresc: t('Czy na pewno chcesz się wylogować?', 'Are you sure you want to sign out?'),
      etykietaTak: t('Wyloguj', 'Sign out'),
      // Bez przekazywania argumentów — signOut przyjmuje opcje (2026-09-25).
      onTak: () => signOut(),
    }, srodowiskoPotwierdzen());
  }

  /**
   * Usunięcie konta (RODO art. 17). Google Play wymaga, by dało się to zrobić
   * z poziomu aplikacji, a nie tylko mailem do administratora.
   */
  async function usunKonto() {
    if (!haslo) {
      komunikat(t('Podaj hasło', 'Enter your password'), t('Wpisz hasło, aby potwierdzić usunięcie konta.', 'Enter your password to confirm account deletion.'));
      return;
    }
    setUsuwanie(true);
    try {
      await api.deleteAccount(haslo);
      // Konto już nie istnieje — czyścimy sesję ORAZ wszystkie dane konta z telefonu
      // (bank referencji, checklisty…) i wracamy do logowania. Tokenu push nie
      // wyrejestrowujemy: backend skasował go razem z kontem, a żądanie ze
      // skasowanym kontem i tak dostałoby 401 (2026-09-25).
      await signOut({ wyrejestrujPush: false });
    } catch (err) {
      komunikat(t('Nie udało się usunąć konta', 'Could not delete the account'), err.message);
    } finally {
      setUsuwanie(false);
    }
  }

  function potwierdzUsuniecie() {
    potwierdzAkcje({
      tytul: t('Usunąć konto na zawsze?', 'Delete the account forever?'),
      tresc: t('Stracisz wszystkie dopasowane przetargi i ustawienia profilu. Tej operacji nie da się cofnąć.', 'You will lose all matched tenders and profile settings. This cannot be undone.')
        + (isStandard ? t('\n\nSubskrypcja Standard zostanie anulowana.', '\n\nThe Standard subscription will be cancelled.') : ''),
      etykietaTak: t('Usuń konto', 'Delete account'),
      onTak: () => usunKonto(),
    }, srodowiskoPotwierdzen());
  }

  return (
    <Screen scroll>
      <View style={styles.card}>
        <Text style={styles.company}>{user.company_name || t('Moje konto', 'My account')}</Text>
        {user.company_nip ? <Text style={styles.muted}>NIP: {user.company_nip}</Text> : null}
        <Text style={styles.muted}>{user.email}</Text>
        <View style={[styles.badge, isStandard ? styles.badgeStandard : styles.badgeFree]}>
          <Text style={styles.badgeText}>{t('Plan', 'Plan')} {isStandard ? 'Standard' : 'Free'}</Text>
        </View>
      </View>

      <Button
        title={t('🧰  Wszystkie narzędzia', '🧰  All tools')}
        onPress={() => navigation.navigate('Narzedzia')}
        style={styles.gap}
      />
      <Button
        title={t('🚀  Przewodnik startu — czy jesteś gotowy?', '🚀  Getting-started guide — are you ready?')}
        variant="ghost"
        onPress={() => navigation.navigate('PrzewodnikStartu')}
        style={styles.gap}
      />

      {proba ? (
        <View style={styles.proba}>
          <Text style={styles.probaTekst}>{t(proba)}</Text>
          <Text style={styles.sectionHint}>{t('Po próbie konto wróci do planu Free: 5 przetargów dziennie, jeden mail dziennie.', 'After the trial your account returns to Free: 5 tenders a day, one email a day.')}</Text>
        </View>
      ) : null}

      {isStandard ? (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>{t('Plan Standard aktywny ✓', 'Standard plan active ✓')}</Text>
          <Text style={styles.upgradeText}>
            {t('Bez dziennego limitu, przegląd co 3 godziny i powiadomienia od razu, sprawdzanie warunków udziału, plan działania do oferty.', 'No daily limit, reviews every 3 hours with instant alerts, participation condition checks, an action plan to your bid.')}
          </Text>
          <Button
            title={t('Zrezygnuj z subskrypcji', 'Cancel subscription')}
            variant="ghost"
            onPress={potwierdzRezygnacje}
            loading={rezygnacja}
            style={styles.gap}
          />
        </View>
      ) : (
        <View style={styles.upgradeCard}>
          <Text style={styles.upgradeTitle}>{t('Przejdź na Standard', 'Upgrade to Standard')}</Text>
          <Text style={styles.upgradeText}>
            {t('Bez dziennego limitu, przegląd co 3 godziny i powiadomienia od razu, sprawdzanie warunków udziału, plan działania do oferty — 99 zł / miesiąc.', 'No daily limit, reviews every 3 hours with instant alerts, participation condition checks, an action plan to your bid — PLN 99 / month.')}
          </Text>
          <Button
            title={t('Przejdź na Standard', 'Upgrade to Standard')}
            onPress={handleUpgrade}
            loading={upgrading}
            style={styles.gap}
          />
        </View>
      )}

      {__DEV__ ? (
        <View style={styles.demoCard}>
          <Text style={styles.demoTytul}>{t('TRYB DEMO — porównaj pakiety', 'DEMO MODE — compare plans')}</Text>
          <Text style={styles.demoOpis}>
            {t('Przełącza plan bez płatności i od razu przelicza dopasowania. Widoczne tylko w buildzie deweloperskim.',
              'Switches the plan without payment and recalculates matches right away. Visible only in development builds.')}
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
          {demoBusy ? <Text style={styles.demoInfo}>{t('Przełączam…', 'Switching…')}</Text> : null}
          {demoInfo ? <Text style={styles.demoInfo}>{demoInfo}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t('Karta firmy', 'Company card')}</Text>
      <Text style={styles.sectionHint}>
        {t('Czym się zajmujesz, czego nie bierzesz, gdzie pracujesz, jakie kwoty — na tej podstawie wybieramy przetargi dla Ciebie.',
          'What you do, what you do not take on, where you work and what contract sizes — we pick tenders for you based on this.')}
      </Text>
      <Button title={t('Otwórz kartę firmy', 'Open company card')} variant="ghost" onPress={() => navigation.navigate('KartaFirmy')} style={styles.gap} />

      <View style={styles.przelacznik}>
        <Text style={styles.przelacznikTekst}>{t('Maile o nowych przetargach', 'Emails about new tenders')}</Text>
        <Switch
          value={user.powiadomienia_pracownik_email !== false}
          onValueChange={async (wl) => { await api.ustawMaileSelekcji(wl).catch(() => {}); await refreshUser?.().catch(() => {}); }}
          accessibilityLabel={t('Maile o nowych przetargach', 'Emails about new tenders')}
        />
      </View>

      <Text style={styles.sectionTitle}>{t('Narzędzia firmy', 'Company tools')}</Text>
      <Text style={styles.sectionHint}>
        {t('Bank referencji pilnuje „terminu przydatności” Twojego doświadczenia (roboty 5 lat, dostawy i usługi 3 lata) — żebyś nie odkrył w dniu składania, że kluczowa robota już się nie liczy.',
          'The reference bank tracks the “shelf life” of your experience (works 5 years, supplies and services 3 years) — so you do not find out on submission day that a key project no longer counts.')}
      </Text>
      <Button
        title={t('Otwórz bank referencji', 'Open reference bank')}
        variant="ghost"
        onPress={() => navigation.navigate('BankReferencji')}
      />
      <Button
        title={t('Certyfikat wykonawcy — czy się opłaca?', 'Contractor certificate — is it worth it?')}
        variant="ghost"
        onPress={() => navigation.navigate('CertyfikatWykonawcy')}
      />
      <Button
        title={t('Kalkulator terminów Pzp', 'Procurement deadline calculator')}
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorTerminow')}
        style={styles.gap}
      />
      <Button
        title={t('Kalkulator ceny ofertowej', 'Bid price calculator')}
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorCeny')}
        style={styles.gap}
      />
      <Button
        title={t('Sprawdzarka formularza cenowego', 'Price form checker')}
        variant="ghost"
        onPress={() => navigation.navigate('SprawdzarkaCeny')}
        style={styles.gap}
      />
      <Button
        title={t('Symulator punktacji oferty', 'Bid scoring simulator')}
        variant="ghost"
        onPress={() => navigation.navigate('SymulatorPunktacji')}
        style={styles.gap}
      />
      <Button
        title={t('Kalkulator kar umownych', 'Contractual penalty calculator')}
        variant="ghost"
        onPress={() => navigation.navigate('KaryUmowne')}
        style={styles.gap}
      />
      <Button
        title={t('Odsetki za opóźnienie + rekompensata', 'Late-payment interest + compensation')}
        variant="ghost"
        onPress={() => navigation.navigate('KalkulatorOdsetek')}
        style={styles.gap}
      />

      <Text style={styles.sectionTitle}>{t('Zakres danych', 'Data coverage')}</Text>
      <Text style={styles.sectionHint}>
        {t(
          'Które rejestry monitorujemy, kiedy każdy z nich ostatnio odpowiedział i czego aplikacja NIE obejmuje automatycznie.',
          'Which registers we monitor, when each last responded, and what the app does NOT cover automatically.',
        )}
      </Text>
      <Button
        title={t('Zobacz zakres danych', 'View data coverage')}
        variant="ghost"
        onPress={() => navigation.navigate('ZakresDanych')}
        style={styles.gap}
      />

      <Text style={styles.sectionTitle}>{t('Język', 'Language')}</Text>
      <View style={styles.motywy} accessibilityRole="radiogroup">
        {jezyki.map((kod) => {
          const aktywny = jezyk === kod;
          return (
            <Pressable
              key={kod}
              onPress={() => ustawJezyk(kod)}
              accessibilityRole="radio"
              accessibilityState={{ selected: aktywny }}
              style={[styles.motyw, aktywny && styles.motywAktywny]}
            >
              <Text style={[styles.motywTekst, aktywny && styles.motywTekstAktywny]}>{etykietyJezykow[kod]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>{t('Wygląd', 'Appearance')}</Text>
      <Text style={styles.sectionHint}>
        {t('„Systemowy” podąża za ustawieniem telefonu.', '“System” follows your phone setting.')}
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

      <Text style={styles.sectionTitle}>{t('Pomoc i kontakt', 'Help and contact')}</Text>
      <View style={styles.zrodlaCard}>
        <Text style={styles.zrodlaOpis}>
          {t('Masz pytanie albo problem z kontem lub płatnością? Napisz do nas — pomożemy.', 'Have a question or a problem with your account or payment? Write to us — we will help.')}
        </Text>
        <Pressable onPress={otworzKontakt} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.zrodloLink}>{t('Napisz do nas', 'Write to us')}: {KONTAKT_EMAIL} →</Text>
        </Pressable>

        {/*
          Google Play wymaga linku do polityki prywatności W APLIKACJI (mail o odrzuceniu
          2026-07-13) — dlatego, mimo usunięcia sekcji „Źródła danych i zastrzeżenie",
          te linki ZOSTAJĄ tutaj. Pełne zastrzeżenie (niezależność, źródła danych) żyje
          w treści Regulaminu i Polityki prywatności pod tymi linkami. NIE USUWAĆ linków.
        */}
        <View style={styles.prawneRzad}>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync('https://przetargai.web.app/polityka-prywatnosci')}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={styles.linkPrawny}>{t('Polityka prywatności', 'Privacy policy')}</Text>
          </Pressable>
          <Text style={styles.zrodloPodpis}>·</Text>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync('https://przetargai.web.app/regulamin')}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={styles.linkPrawny}>{t('Regulamin', 'Terms of service')}</Text>
          </Pressable>
        </View>

        <Text style={styles.wersja}>PrzetargAI · {t('wersja', 'version')} {wersjaApp}</Text>
      </View>

      <Text style={styles.sectionTitle}>{t('Bezpieczeństwo konta', 'Account security')}</Text>
      <Text style={styles.sectionHint}>
        {t('Zmień hasło albo adres e-mail, na który się logujesz.', 'Change the password or the e-mail address you sign in with.')}
      </Text>
      <Button
        title={t('Zmień hasło lub e-mail', 'Change password or e-mail')}
        variant="ghost"
        onPress={() => navigation.navigate('BezpieczenstwoKonta')}
      />

      <View style={styles.signOut}>
        <Button title={t('Wyloguj się', 'Sign out')} variant="ghost" onPress={confirmSignOut} />
      </View>

      <View style={styles.strefaNiebezpieczna}>
        <Text style={styles.naglowekNiebezpieczny}>{t('Usunięcie konta', 'Delete account')}</Text>
        <Text style={styles.opisNiebezpieczny}>
          {t('Trwale usuwamy Twoje konto, profil i wszystkie dopasowane przetargi.', 'We permanently delete your account, profile and all matched tenders.')}
          {isStandard
            ? t(' Subskrypcję Standard anulujemy automatycznie — karta nie zostanie już obciążona.', ' The Standard subscription is cancelled automatically — your card will not be charged again.')
            : t(' Tej operacji nie da się cofnąć.', ' This cannot be undone.')}
        </Text>
        <TextField
          label={t('Potwierdź hasłem', 'Confirm with your password')}
          value={haslo}
          onChangeText={setHaslo}
          secureTextEntry
          placeholder="••••••••"
        />
        <Button
          title={t('Usuń konto na zawsze', 'Delete account forever')}
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
  przelacznik: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  przelacznikTekst: { fontSize: 15, color: k.text, flex: 1, marginRight: spacing.sm },
  proba: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: k.sukcesTlo, marginBottom: spacing.md },
  probaTekst: { fontSize: 15, fontWeight: '700', color: k.sukcesAkcent },
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
