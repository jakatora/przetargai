import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { useAuth } from '../context/AuthContext';
import { spacing, radius, typografia } from '../theme';
import Ikona from '../components/Ikona';
import { WOJEWODZTWA } from '../lib/wojewodztwa';
import { KROKI_KREATORA, kartaDoFormularza, formularzDoKarty, walidujFormularz, parsujListe } from '../lib/kartaFirmy';
import * as storage from '../lib/storage';
import { KLUCZ_DANYCH_WYKONAWCY } from '../lib/dokumentyOferty';
import { pobierzDanePoNip } from '../lib/danePoNip';
import { prefillKartyZDanychFirmy, scalDaneWykonawcy, komunikatPrefillu, tekstDoPodpowiedzi } from '../lib/kartaZNip';

/** Selekcja wyłączona po stronie serwera (`PRACOWNIK_ENABLED=false`) — zostają pola profilu z `PATCH /auth/me`. */
const KROKI_UPROSZCZONE = [1, 3, 4];
const KROKI_PELNE = [1, 2, 3, 4, 5];

/**
 * Kreator „Karta firmy” (spec §3.3): 5 kroków, każdy do pominięcia. Zapis wysyła całą kartę;
 * serwer przelicza otwarte przetargi, gdy zmieniły się reguły.
 */
export default function KartaFirmyScreen({ route, navigation }) {
  const { t, jezyk } = useJezyk();
  const styles = useStyle(tworzStyleKarty);
  const { kolory } = useTheme();
  const { user, setUser } = useAuth();
  const [krok, setKrok] = useState(Math.min(5, Math.max(1, Number(route?.params?.krok) || 1)));
  // Wejście zaraz po ekranie powitalnym (lib/onboarding.js): po zapisie albo pominięciu idziemy na listę, nie „wstecz".
  const poStarcie = Boolean(route?.params?.poStarcie);
  const [form, setForm] = useState(null);
  const [uproszczony, setUproszczony] = useState(false);
  const [blad, setBlad] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [podpowiadanie, setPodpowiadanie] = useState(false);
  // „Wpisz NIP — resztę wstawimy": nazwa i województwo z Białej listy VAT (logika w lib/kartaZNip.js);
  // te same dane firmy lądują w magazynie Dokumentów do oferty, więc NIP wpisuje się RAZ.
  const [nip, setNip] = useState('');
  const [nipStan, setNipStan] = useState({ laduje: false, komunikat: null, ok: false });

  const wczytaj = useCallback(() => {
    setBlad(null);
    api.kartaFirmy().then((d) => {
      setUproszczony(false);
      setForm(kartaDoFormularza(d.karta));
    }).catch((err) => {
      if (err.status !== 503 || !user) { setBlad(err.message); return; }
      setUproszczony(true);
      setForm(kartaDoFormularza(user));
      setKrok((k) => (KROKI_UPROSZCZONE.includes(k) ? k : 1));
    });
  }, [user]);

  useEffect(() => { wczytaj(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_DANYCH_WYKONAWCY)
      .then((s) => { const d = s ? JSON.parse(s) : null; if (aktywny && d?.nip) setNip(String(d.nip)); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  async function wypelnijZNip() {
    setNipStan({ laduje: true, komunikat: null, ok: false });
    const { dane, blad } = await pobierzDanePoNip(nip);
    if (!dane) { setNipStan({ laduje: false, komunikat: blad, ok: false }); return; }
    const wynik = prefillKartyZDanychFirmy(form, dane);
    setForm(wynik.form);
    try {
      const s = await storage.getItem(KLUCZ_DANYCH_WYKONAWCY);
      await storage.setItem(KLUCZ_DANYCH_WYKONAWCY, JSON.stringify(scalDaneWykonawcy(s ? JSON.parse(s) : null, dane)));
    } catch { /* magazyn niedostępny — karta i tak wypełniona */ }
    let komunikat = komunikatPrefillu(wynik, jezyk);
    // Leniwy start: karta bez słów i CPV → dobieramy je od razu z nazwy firmy (albo z opisu), bez klikania.
    const tekst = tekstDoPodpowiedzi({ opis: form.opis, nazwa: dane.nazwa, keywords: form.keywords, cpv_codes: form.cpv_codes });
    if (tekst && (await dobierzZ(tekst))) {
      komunikat += t(' Dobraliśmy też słowa i kody CPV z nazwy firmy — sprawdź je niżej.', ' We also picked keywords and CPV codes from the company name — check them below.');
    }
    setNipStan({ laduje: false, komunikat, ok: true });
  }

  if (!form) {
    return (
      <Screen>
        {blad ? (
          <View>
            <Text style={styles.blad}>{blad}</Text>
            <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} />
          </View>
        ) : <ActivityIndicator />}
      </Screen>
    );
  }

  const kroki = uproszczony ? KROKI_UPROSZCZONE : KROKI_PELNE;
  const pozycja = Math.max(0, kroki.indexOf(krok));
  const ustaw = (pole) => (wartosc) => setForm((f) => ({ ...f, [pole]: wartosc }));
  const opisKroku = KROKI_KREATORA[krok - 1];

  /** Dobiera słowa i CPV z tekstu i dokleja do formularza; zwraca liczbę dodanych słów albo null przy braku podpowiedzi. */
  async function dobierzZ(tekst) {
    setPodpowiadanie(true);
    try {
      const s = await api.suggestProfile(tekst);
      if (s.keywords) {
        setForm((f) => ({
          ...f,
          keywords: parsujListe(`${f.keywords},${s.keywords.join(',')}`).join(', '),
          cpv_codes: parsujListe(`${f.cpv_codes},${(s.cpv ?? []).join(',')}`).join(', '),
        }));
        return s.keywords.length + (s.cpv ?? []).length;
      }
      if (s.komunikat) setBlad(s.komunikat);
      return null;
    } catch (err) {
      setBlad(err.message);
      return null;
    } finally {
      setPodpowiadanie(false);
    }
  }

  async function podpowiedz() {
    if (form.opis.trim().length < 3) return;
    await dobierzZ(form.opis.trim());
  }

  async function zapisz() {
    const problem = walidujFormularz(form);
    if (problem) { setBlad(t(problem)); return; }
    setZapisywanie(true);
    setBlad(null);
    try {
      const karta = formularzDoKarty(form);
      const d = uproszczony
        ? await api.updateProfile({
          keywords: karta.keywords, cpv_codes: karta.cpv_codes, regiony: karta.regiony, wartosc_max: karta.wartosc_max,
        })
        : await api.zapiszKarteFirmy(karta);
      // Odpowiedź niesie świeżego użytkownika — bez drugiego żądania, które mogłoby się nie udać po udanym zapisie.
      if (d?.user) setUser?.(d.user);
      if (poStarcie) navigation.replace('MatchFeed'); else navigation.goBack();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setZapisywanie(false);
    }
  }

  const pole = (wartosc, onChange, etykieta, przyklad, opcje = {}) => (
    <TextField
      label={etykieta}
      value={wartosc}
      onChangeText={onChange}
      placeholder={przyklad}
      inputStyle={opcje.wieloliniowe ? styles.poleWysokie : undefined}
      multiline={Boolean(opcje.wieloliniowe)}
      keyboardType={opcje.liczba ? 'numeric' : 'default'}
      maxLength={opcje.maks}
    />
  );

  return (
    <Screen scroll>
      {uproszczony ? (
        <Text style={styles.uwaga}>
          {t('Część karty jest chwilowo niedostępna. Możesz zmienić zakres, teren i największą kwotę.', 'Part of the card is temporarily unavailable. You can change scope, area and the largest value.')}
        </Text>
      ) : null}
      {poStarcie ? (
        <Text style={styles.uwaga}>
          {t('Jeszcze minuta: NIP, teren i kwoty — selekcja przetargów będzie trafniejsza. Każdy krok możesz pominąć.', 'One more minute: tax ID, area and contract sizes — tender selection gets more accurate. You can skip any step.')}
        </Text>
      ) : null}
      <View style={styles.postep} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: kroki.length, now: pozycja + 1 }}>
        {kroki.map((k, i) => <View key={k} style={[styles.postepOdcinek, i <= pozycja && styles.postepOdcinekGotowy]} />)}
      </View>
      <Text style={styles.licznik}>{t(`Krok ${pozycja + 1} z ${kroki.length}`, `Step ${pozycja + 1} of ${kroki.length}`)}</Text>
      <Text style={styles.tytul}>{t(opisKroku.tytul)}</Text>
      <Text style={styles.opis}>{t(opisKroku.opis)}</Text>

      {krok === 1 ? (
        <View>
          <TextField
            label={t('NIP firmy', 'Company tax ID (NIP)')}
            value={nip}
            onChangeText={setNip}
            placeholder="7941844550"
            keyboardType="numeric"
            maxLength={13}
            hint={t('Wpisz NIP, a nazwę i województwo wstawimy z Białej listy VAT', 'Enter your NIP and we fill in the name and voivodeship from the VAT register')}
          />
          <Button title={t('Wypełnij z Białej listy', 'Fill in from the VAT register')} variant="ghost" loading={nipStan.laduje} onPress={wypelnijZNip} style={styles.pomocniczy} />
          {nipStan.komunikat ? <Text style={nipStan.ok ? styles.ok : styles.blad}>{nipStan.komunikat}</Text> : null}
          {pole(form.opis, ustaw('opis'), t('Czym się zajmujesz', 'What you do'), t('Np. remonty i wymiana pokryć dachowych na Podkarpaciu', 'E.g. roof repairs and replacement in Subcarpathia'), { wieloliniowe: true, maks: 600 })}
          <Button title={t('Podpowiedz słowa i kody CPV', 'Suggest keywords and CPV codes')} variant="ghost" loading={podpowiadanie} onPress={podpowiedz} style={styles.pomocniczy} />
          {pole(form.keywords, ustaw('keywords'), t('Słowa kluczowe, po przecinku', 'Keywords, comma separated'), t('Np. dach, pokrycie dachowe', 'E.g. roof, roofing'))}
          {pole(form.cpv_codes, ustaw('cpv_codes'), t('Kody CPV, po przecinku', 'CPV codes, comma separated'), t('Np. 45261000', 'E.g. 45261000'))}
        </View>
      ) : null}

      {krok === 2 ? pole(form.wykluczenia, ustaw('wykluczenia'), t('Czego nie bierzesz, po przecinku', 'What you do not take on, comma separated'), t('Np. drogi, odśnieżanie', 'E.g. roads, snow removal'), { wieloliniowe: true }) : null}

      {krok === 3 ? (
        <View style={styles.chipy}>
          {Object.entries(WOJEWODZTWA).map(([kod, nazwa]) => {
            const wybrane = form.regiony.includes(kod);
            return (
              <Pressable
                key={kod}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: wybrane }}
                onPress={() => ustaw('regiony')(wybrane ? form.regiony.filter((r) => r !== kod) : [...form.regiony, kod])}
                style={[styles.chip, wybrane && styles.chipWybrany]}
              >
                {wybrane ? <Ikona nazwa="ok" rozmiar={14} kolor={kolory.blue} /> : null}
                <Text style={[styles.chipTekst, wybrane && styles.chipTekstWybrany]}>{nazwa}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {krok === 4 ? (
        <View>
          {uproszczony ? null : pole(form.wartosc_min, ustaw('wartosc_min'), t('Najmniejsza wartość zamówienia (zł)', 'Smallest contract value (PLN)'), t('Np. 50 000', 'E.g. 50,000'), { liczba: true })}
          {pole(form.wartosc_max, ustaw('wartosc_max'), t('Największa wartość zamówienia (zł)', 'Largest contract value (PLN)'), t('Np. 2 000 000', 'E.g. 2,000,000'), { liczba: true })}
          {uproszczony ? null : pole(form.min_dni_oferta, ustaw('min_dni_oferta'), t('Ile dni potrzebujesz na ofertę (1–60)', 'Days you need to bid (1–60)'), '5', { liczba: true })}
        </View>
      ) : null}

      {krok === 5 ? (
        <View>
          {pole(form.obrot_roczny, ustaw('obrot_roczny'), t('Roczny obrót (zł)', 'Annual turnover (PLN)'), t('Np. 1 500 000', 'E.g. 1,500,000'), { liczba: true })}
          {pole(form.referencja_kwota, ustaw('referencja_kwota'), t('Największa zrealizowana robota (zł)', 'Largest completed contract (PLN)'), t('Np. 800 000', 'E.g. 800,000'), { liczba: true })}
          {pole(form.referencja_opis, ustaw('referencja_opis'), t('Czego dotyczyła ta robota', 'What that contract covered'), t('Np. dach szkoły, 1200 m²', 'E.g. school roof, 1,200 m²'), { maks: 200 })}
          {pole(form.uprawnienia, ustaw('uprawnienia'), t('Uprawnienia i certyfikaty, po przecinku', 'Licences and certificates, comma separated'), t('Np. ISO 9001, uprawnienia budowlane', 'E.g. ISO 9001, building licence'), { wieloliniowe: true })}
        </View>
      ) : null}

      {blad ? <Text style={styles.blad}>{blad}</Text> : null}

      <View style={styles.rzad}>
        {pozycja > 0 ? <Button title={t('Wstecz', 'Back')} variant="ghost" onPress={() => setKrok(kroki[pozycja - 1])} style={styles.przycisk} /> : null}
        {pozycja < kroki.length - 1 ? <Button title={t('Dalej', 'Next')} onPress={() => setKrok(kroki[pozycja + 1])} style={styles.przycisk} /> : null}
      </View>
      <Button
        title={t('Zapisz kartę firmy', 'Save company card')}
        variant={pozycja === kroki.length - 1 ? 'primary' : 'ghost'}
        loading={zapisywanie}
        onPress={zapisz}
        style={styles.zapisz}
      />
      {poStarcie ? <Button title={t('Pomiń, pokaż przetargi', 'Skip, show tenders')} variant="ghost" onPress={() => navigation.replace('MatchFeed')} /> : null}
    </Screen>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  uwaga: { fontSize: 14, lineHeight: 20, color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden' },
  postep: { flexDirection: 'row', gap: 6, marginBottom: spacing.sm },
  postepOdcinek: { flex: 1, height: 4, borderRadius: 2, backgroundColor: k.neutralneTlo },
  postepOdcinekGotowy: { backgroundColor: k.blue },
  licznik: { fontSize: 13, fontWeight: '600', color: k.textMuted },
  ok: { fontSize: 14, color: k.sukcesAkcent, fontWeight: '600', marginVertical: spacing.sm, lineHeight: 20 },
  tytul: { ...typografia.tytul, color: k.text, marginTop: spacing.xs },
  opis: { fontSize: 15, color: k.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 22 },
  poleWysokie: { minHeight: 96, textAlignVertical: 'top' },
  pomocniczy: { marginBottom: spacing.lg },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pelny,
    borderWidth: 1.5, borderColor: k.border, backgroundColor: k.surface,
  },
  chipWybrany: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  chipTekst: { fontSize: 14, fontWeight: '600', color: k.text },
  chipTekstWybrany: { color: k.blue, fontWeight: '700' },
  blad: { color: k.danger, marginVertical: spacing.sm, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  rzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  przycisk: { flex: 1 },
  zapisz: { marginTop: spacing.sm },
}));
