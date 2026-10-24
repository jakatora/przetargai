import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { WOJEWODZTWA } from '../lib/wojewodztwa';
import { KROKI_KREATORA, kartaDoFormularza, formularzDoKarty, walidujFormularz, parsujListe } from '../lib/kartaFirmy';

/**
 * Kreator „Karta firmy” (spec §3.3): 5 kroków, każdy do pominięcia. Zapis wysyła całą kartę;
 * serwer przelicza otwarte przetargi, gdy zmieniły się reguły.
 */
export default function KartaFirmyScreen({ route, navigation }) {
  const { t } = useJezyk();
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const { refreshUser } = useAuth();
  const [krok, setKrok] = useState(Math.min(5, Math.max(1, Number(route?.params?.krok) || 1)));
  const [form, setForm] = useState(null);
  const [blad, setBlad] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [podpowiadanie, setPodpowiadanie] = useState(false);

  useEffect(() => {
    api.kartaFirmy().then((d) => setForm(kartaDoFormularza(d.karta))).catch((err) => setBlad(err.message));
  }, []);

  if (!form) {
    return <Screen>{blad ? <Text style={styles.blad}>{blad}</Text> : <ActivityIndicator />}</Screen>;
  }

  const ustaw = (pole) => (wartosc) => setForm((f) => ({ ...f, [pole]: wartosc }));
  const opisKroku = KROKI_KREATORA[krok - 1];

  async function podpowiedz() {
    if (form.opis.trim().length < 3) return;
    setPodpowiadanie(true);
    try {
      const s = await api.suggestProfile(form.opis.trim());
      if (s.keywords) {
        setForm((f) => ({
          ...f,
          keywords: parsujListe(`${f.keywords},${s.keywords.join(',')}`).join(', '),
          cpv_codes: parsujListe(`${f.cpv_codes},${(s.cpv ?? []).join(',')}`).join(', '),
        }));
      } else if (s.komunikat) {
        setBlad(s.komunikat);
      }
    } catch (err) {
      setBlad(err.message);
    } finally {
      setPodpowiadanie(false);
    }
  }

  async function zapisz() {
    const problem = walidujFormularz(form);
    if (problem) { setBlad(t(problem)); return; }
    setZapisywanie(true);
    setBlad(null);
    try {
      await api.zapiszKarteFirmy(formularzDoKarty(form));
      await refreshUser?.();
      navigation.goBack();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setZapisywanie(false);
    }
  }

  const pole = (wartosc, onChange, etykieta, opcje = {}) => (
    <TextInput
      value={wartosc}
      onChangeText={onChange}
      placeholder={etykieta}
      accessibilityLabel={etykieta}
      placeholderTextColor={kolory.textMuted}
      style={[styles.pole, opcje.wieloliniowe && styles.poleWysokie]}
      multiline={Boolean(opcje.wieloliniowe)}
      keyboardType={opcje.liczba ? 'numeric' : 'default'}
      maxLength={opcje.maks}
    />
  );

  return (
    <Screen scroll>
      <Text style={styles.licznik}>{t(`Krok ${krok} z 5`, `Step ${krok} of 5`)}</Text>
      <Text style={styles.tytul}>{t(opisKroku.tytul)}</Text>
      <Text style={styles.opis}>{t(opisKroku.opis)}</Text>

      {krok === 1 ? (
        <View>
          {pole(form.opis, ustaw('opis'), t('Np. remonty i wymiana pokryć dachowych na Podkarpaciu', 'E.g. roof repairs and replacement in Subcarpathia'), { wieloliniowe: true, maks: 600 })}
          <Button title={t('Podpowiedz słowa i kody CPV', 'Suggest keywords and CPV codes')} variant="ghost" loading={podpowiadanie} onPress={podpowiedz} />
          {pole(form.keywords, ustaw('keywords'), t('Słowa kluczowe, po przecinku', 'Keywords, comma separated'))}
          {pole(form.cpv_codes, ustaw('cpv_codes'), t('Kody CPV, po przecinku', 'CPV codes, comma separated'))}
        </View>
      ) : null}

      {krok === 2 ? pole(form.wykluczenia, ustaw('wykluczenia'), t('Np. drogi, odśnieżanie', 'E.g. roads, snow removal'), { wieloliniowe: true }) : null}

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
                <Text style={styles.chipTekst}>{nazwa}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {krok === 4 ? (
        <View>
          {pole(form.wartosc_min, ustaw('wartosc_min'), t('Najmniejsza wartość zamówienia (zł)', 'Smallest contract value (PLN)'), { liczba: true })}
          {pole(form.wartosc_max, ustaw('wartosc_max'), t('Największa wartość zamówienia (zł)', 'Largest contract value (PLN)'), { liczba: true })}
          {pole(form.min_dni_oferta, ustaw('min_dni_oferta'), t('Ile dni potrzebujesz na ofertę (1–60)', 'Days you need to bid (1–60)'), { liczba: true })}
        </View>
      ) : null}

      {krok === 5 ? (
        <View>
          {pole(form.obrot_roczny, ustaw('obrot_roczny'), t('Roczny obrót (zł)', 'Annual turnover (PLN)'), { liczba: true })}
          {pole(form.referencja_kwota, ustaw('referencja_kwota'), t('Największa zrealizowana robota (zł)', 'Largest completed contract (PLN)'), { liczba: true })}
          {pole(form.referencja_opis, ustaw('referencja_opis'), t('Czego dotyczyła (krótko)', 'What it covered (briefly)'), { maks: 200 })}
          {pole(form.uprawnienia, ustaw('uprawnienia'), t('Uprawnienia i certyfikaty, po przecinku', 'Licences and certificates, comma separated'), { wieloliniowe: true })}
        </View>
      ) : null}

      {blad ? <Text style={styles.blad}>{blad}</Text> : null}

      <View style={styles.rzad}>
        {krok > 1 ? <Button title={t('Wstecz', 'Back')} variant="ghost" onPress={() => setKrok(krok - 1)} style={styles.przycisk} /> : null}
        {krok < 5 ? <Button title={t('Dalej', 'Next')} onPress={() => setKrok(krok + 1)} style={styles.przycisk} /> : null}
      </View>
      <Button title={t('Zapisz kartę firmy', 'Save company card')} variant={krok === 5 ? 'primary' : 'ghost'} loading={zapisywanie} onPress={zapisz} style={styles.zapisz} />
    </Screen>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  licznik: { fontSize: 13, color: k.textMuted },
  tytul: { fontSize: 20, fontWeight: '700', color: k.text, marginTop: spacing.xs },
  opis: { fontSize: 14, color: k.textMuted, marginVertical: spacing.sm, lineHeight: 20 },
  pole: { borderWidth: 1, borderColor: k.border, borderRadius: radius.md, padding: spacing.sm, color: k.text, backgroundColor: k.surface, marginBottom: spacing.sm },
  poleWysokie: { minHeight: 96, textAlignVertical: 'top' },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: k.border },
  chipWybrany: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  chipTekst: { fontSize: 14, color: k.text },
  blad: { color: k.danger, marginVertical: spacing.sm },
  rzad: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  przycisk: { flex: 1 },
  zapisz: { marginTop: spacing.sm },
}));
