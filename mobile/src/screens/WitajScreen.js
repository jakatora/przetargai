import { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius, typografia } from '../theme';
import { celPoOnboardingu } from '../lib/onboarding';

/**
 * Ekran powitalny (first-run onboarding). Pokazywany, gdy zalogowany użytkownik ma
 * PUSTY profil (brak słów kluczowych i CPV) i nie pominął go wcześniej — decyzję
 * podejmuje `lib/onboarding.czyPokazacOnboarding`, a trasę startową ustawia
 * RootNavigator.
 *
 * Aktywacja B2B stoi na jednym: dopasowania zależą od profilu. Nowy użytkownik na
 * pustym feedzie odchodzi. Dlatego zamiast wrzucać go od razu na listę, TU prowadzimy
 * go za rękę: opisuje firmę jednym zdaniem → AI dobiera słowa kluczowe i CPV → zapis →
 * feed od razu ma sens. „Pomiń" zostaje, ale świadomie wymaga kliknięcia.
 *
 * Ekran jest cienki: całe dobieranie robi backend (`api.suggestProfile`), a decyzję
 * o pokazaniu — czysta `lib/onboarding.js`.
 */
function parseList(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function WitajScreen({ navigation }) {
  const { user, setUser, pominOnboarding } = useAuth();
  const styles = useStyle(tworzStyleWitaj);
  /*
   * Ekran powitalny to PIERWSZE, co widzi nowe konto — także takie z angielskim
   * systemem, bo `JezykProvider` wykrywa locale urządzenia przy pierwszym starcie.
   * Dopóki ten ekran był wyłącznie polski, obietnica dwujęzyczności pękała
   * dokładnie tam, gdzie zaczyna się korzystanie z aplikacji (P1-5).
   */
  const { t } = useJezyk();

  const [opis, setOpis] = useState('');
  const [keywords, setKeywords] = useState((user?.keywords || []).join(', '));
  const [cpv, setCpv] = useState((user?.cpv_codes || []).join(', '));
  const [dobieranie, setDobieranie] = useState(false);
  const [info, setInfo] = useState(null);
  const [zapis, setZapis] = useState(false);

  function idzDoFeeda() {
    navigation.replace('MatchFeed');
  }

  async function dobierz() {
    if (!opis.trim() || dobieranie) return;
    setDobieranie(true);
    setInfo(null);
    try {
      const s = await api.suggestProfile(opis.trim());
      if (!s.keywords) {
        setInfo(s.komunikat || t('Nie udało się teraz dobrać podpowiedzi. Możesz wpisać słowa ręcznie.', 'Could not fetch suggestions right now. You can type the words in yourself.'));
        return;
      }
      // Scalamy z tym, co user już wpisał (bez duplikatów), cap 30 = limit backendu.
      const scal = (biezace, nowe) => {
        const lista = [...parseList(biezace), ...nowe];
        return [...new Set(lista.map((x) => x.trim()).filter(Boolean))].slice(0, 30).join(', ');
      };
      if (s.keywords.length) setKeywords((b) => scal(b, s.keywords));
      if (s.cpv.length) setCpv((b) => scal(b, s.cpv));
      setInfo(t(`Dobrano ${s.keywords.length} słów i ${s.cpv.length} kodów CPV. Sprawdź i zapisz.`,
        `Picked ${s.keywords.length} keywords and ${s.cpv.length} CPV codes. Review and save.`));
    } catch (err) {
      setInfo(err.message);
    } finally {
      setDobieranie(false);
    }
  }

  async function zapiszIStart() {
    const kw = parseList(keywords);
    const cp = parseList(cpv);
    if (kw.length === 0 && cp.length === 0) {
      setInfo(t('Dodaj przynajmniej jedno słowo kluczowe albo kod CPV — na tej podstawie dobieramy przetargi.',
        'Add at least one keyword or CPV code — that is what we match tenders against.'));
      return;
    }
    setZapis(true);
    try {
      const data = await api.updateProfile({ keywords: kw, cpv_codes: cp });
      setUser(data.user); // profil niepusty → onboarding już się nie pokaże
      // Dalej do Karty firmy (NIP, teren, kwoty) — reguła w lib/onboarding.js; „Pomiń" idzie prosto na listę.
      const cel = celPoOnboardingu(false);
      navigation.replace(cel.trasa, cel.params);
    } catch (err) {
      setInfo(err.message);
    } finally {
      setZapis(false);
    }
  }

  function pomin() {
    pominOnboarding();
    idzDoFeeda();
  }

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.tytul} accessibilityRole="header">{t('Witaj w PrzetargAI', 'Welcome to PrzetargAI')}</Text>
        <Text style={styles.wstep}>
          {t(
            'Powiedz, czym się zajmujesz. Resztę robi aplikacja: codziennie przegląda ogłoszenia z rejestrów publicznych i wybiera te, które pasują do Twojej firmy.',
            'Tell us what you do. The app does the rest: it reviews public procurement notices every day and picks the ones that fit your company.',
          )}
        </Text>
      </View>

      <View style={styles.krokRzad}>
        <Text style={styles.krokNumer}>1</Text>
        <Text style={styles.krok}>{t('Opisz firmę jednym zdaniem', 'Describe your company in one sentence')}</Text>
      </View>
      <TextField
        value={opis}
        onChangeText={setOpis}
        placeholder={t('np. Kładę kostkę brukową i buduję ogrodzenia', 'e.g. I lay paving stones and build fences')}
        multiline
      />
      <Button
        title={t('Dobierz słowa kluczowe i CPV', 'Suggest keywords and CPV codes')}
        onPress={dobierz}
        loading={dobieranie}
        variant="ghost"
        style={styles.gap}
      />
      {info ? <Text style={styles.info}>{info}</Text> : null}

      <View style={styles.krokRzad}>
        <Text style={styles.krokNumer}>2</Text>
        <Text style={styles.krok}>{t('Sprawdź i popraw', 'Review and adjust')}</Text>
      </View>
      <TextField
        label={t('Słowa kluczowe', 'Keywords')}
        value={keywords}
        onChangeText={setKeywords}
        placeholder={t('remont, budowa drogi, instalacje', 'renovation, road construction, installations')}
        hint={t('Po przecinku', 'Comma-separated')}
        multiline
      />
      <TextField
        label={t('Kody CPV', 'CPV codes')}
        value={cpv}
        onChangeText={setCpv}
        placeholder="45000000, 45300000"
        hint={t('Po przecinku — jeśli nie znasz, zostaw AI powyżej', 'Comma-separated — if you do not know them, use the suggestion above')}
        style={styles.polCpv}
      />

      <Button title={t('Zapisz i zacznij', 'Save and start')} onPress={zapiszIStart} loading={zapis} style={styles.gap} />
      <Button title={t('Pomiń na razie', 'Skip for now')} onPress={pomin} variant="ghost" style={styles.gapMaly} />
      <Text style={styles.stopka}>
        {t(
          'Bez uzupełnionego profilu feed będzie pusty — możesz wrócić do tego w każdej chwili w „Koncie".',
          'Without a profile your feed stays empty — you can come back to this any time under „Account".',
        )}
      </Text>
    </Screen>
  );
}

const tworzStyleWitaj = tworzStyle((k) => ({
  // Powitanie na „atramencie" — ten sam ciemny blok co raport pracownika na liście przetargów.
  hero: {
    backgroundColor: k.atrament,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  tytul: { ...typografia.ekran, color: k.naAtramencie },
  wstep: { fontSize: 16, color: k.atramentDrugi, marginTop: spacing.sm, lineHeight: 23 },
  krokRzad: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  krokNumer: {
    width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden',
    fontSize: 14, fontWeight: '800', color: k.naAkcencie, backgroundColor: k.blue,
  },
  krok: { ...typografia.sekcja, color: k.text, flex: 1 },
  gap: { marginTop: spacing.md },
  gapMaly: { marginTop: spacing.sm },
  polCpv: { marginBottom: spacing.xs },
  info: { fontSize: 14, color: k.blue, fontWeight: '600', marginTop: spacing.sm, lineHeight: 20 },
  stopka: { fontSize: 13, color: k.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 18 },
}));
