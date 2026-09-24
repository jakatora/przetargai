import { useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';

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
      idzDoFeeda();
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
        <Text style={styles.emoji}>🎯</Text>
        <Text style={styles.tytul}>{t('Witaj w PrzetargAI', 'Welcome to PrzetargAI')}</Text>
        <Text style={styles.wstep}>
          {t(
            'Dopasujemy przetargi publiczne do Twojej firmy. Powiedz nam, czym się zajmujesz — na tej podstawie codziennie znajdziemy pasujące ogłoszenia.',
            'We match public tenders to your company. Tell us what you do and we will find fitting notices for you every day.',
          )}
        </Text>
      </View>

      <Text style={styles.krok}>{t('Krok 1 — opisz firmę jednym zdaniem', 'Step 1 — describe your company in one sentence')}</Text>
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

      <Text style={styles.krok}>{t('Krok 2 — sprawdź i popraw', 'Step 2 — review and adjust')}</Text>
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
  hero: {
    backgroundColor: k.wyroznienie,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  emoji: { fontSize: 40, marginBottom: spacing.sm },
  tytul: { fontSize: 24, fontWeight: '800', color: k.text, textAlign: 'center' },
  wstep: { fontSize: 14, color: k.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  krok: { fontSize: 15, fontWeight: '800', color: k.blue, marginTop: spacing.md, marginBottom: spacing.sm },
  gap: { marginTop: spacing.md },
  gapMaly: { marginTop: spacing.sm },
  polCpv: { marginBottom: spacing.xs },
  info: { fontSize: 13, color: k.blue, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  stopka: { fontSize: 12, color: k.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 17 },
}));
