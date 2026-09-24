import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, Switch } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { tonNaKolor } from '../components/PodpisZrodla';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { ZRODLA } from '../lib/katalogPrzetargow';
import { nazwaWojewodztwa } from '../lib/wojewodztwa';
import {
  CZESTOTLIWOSCI_ZAPASOWE,
  stanFormularza, walidujFormularz, opisObserwacji, opisCzestotliwosci,
  etykietaNastepnego, podsumowanieListy,
} from '../lib/zapisaneWyszukiwania';

/*
 * ZAPISANE WYSZUKIWANIA (etap 5).
 *
 * Katalog „Wszystkie" pokazuje rynek TERAZ. Ten ekran zamienia jedno spojrzenie
 * w stałą obserwację: „powiedz mi, gdy pojawi się coś takiego". Filtry przychodzą
 * z katalogu (przycisk „Zapisz to wyszukiwanie") i NIE są tu edytowane na nowo —
 * druga, równoległa lista filtrów rozjechałaby się z katalogiem przy pierwszej
 * zmianie i użytkownik dostawałby alerty o innym zbiorze niż widzi na liście.
 *
 * Cała logika stanu żyje w lib/zapisaneWyszukiwania.js (czysta, testowana);
 * tutaj jest wyłącznie render, stany ładowania/pustki/błędu i dostępność.
 */

/** Ton semantyczny → token koloru z motywu. Mapowanie w JEDNYM miejscu na ekran. */
function kolorTonu(kolory, ton) {
  if (ton === 'sukces') return kolory.sukcesAkcent;
  if (ton === 'ostrzezenie') return kolory.ostrzezenieAkcent;
  if (ton === 'danger') return kolory.danger;
  return kolory.textMuted;
}

const ETYKIETY_ZRODEL = new Map(ZRODLA.map((kod) => [kod, kod]));

/** Filtry jako czytelne chipy — użytkownik musi wiedzieć, CO obserwuje. */
function ChipyFiltrow({ filtry, styles, t }) {
  const opisy = [];
  if (filtry?.zrodlo) opisy.push(ETYKIETY_ZRODEL.get(filtry.zrodlo) ?? filtry.zrodlo);
  if (filtry?.region) opisy.push(nazwaWojewodztwa(filtry.region) ?? filtry.region);
  if (filtry?.cpv) opisy.push(`CPV ${filtry.cpv}`);
  if (filtry?.q) opisy.push(`„${filtry.q}"`);
  if (filtry?.wartosc_min) opisy.push(`${t('od', 'from')} ${filtry.wartosc_min}`);
  if (filtry?.wartosc_max) opisy.push(`${t('do', 'to')} ${filtry.wartosc_max}`);
  if (filtry?.termin && filtry.termin !== 'aktywne') opisy.push(filtry.termin);

  if (!opisy.length) {
    return <Text style={styles.chipPusty}>{t('Cały rynek — bez zawężeń', 'Whole market — no narrowing')}</Text>;
  }
  return (
    <View style={styles.chipy}>
      {opisy.map((o) => <Text key={o} style={styles.chip}>{o}</Text>)}
    </View>
  );
}

export default function ZapisaneWyszukiwaniaScreen({ navigation, route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWyszukiwan);
  const { t, jezyk } = useJezyk();

  // Filtry przekazane z katalogu — jedyne wejście dla NOWEJ obserwacji.
  const filtryZKatalogu = route?.params?.filtry ?? null;
  const propozycja = route?.params?.propozycja ?? null;

  const [dane, setDane] = useState(null);
  const [slownik, setSlownik] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);
  const [blad, setBlad] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);

  const [formularz, setFormularz] = useState(() => stanFormularza({ filtry: filtryZKatalogu, propozycja, jezyk }));
  const [formularzOtwarty, setFormularzOtwarty] = useState(Boolean(filtryZKatalogu));
  const [edytowany, setEdytowany] = useState(null);
  const [bladFormularza, setBladFormularza] = useState(null);

  const wczytaj = useCallback(async () => {
    setLadowanie(true);
    try {
      const [lista, slowniki] = await Promise.all([
        api.getWyszukiwania(),
        api.getCzestotliwosci().catch(() => null), // słownik jest miły, ale nie krytyczny
      ]);
      setDane(lista);
      if (slowniki) setSlownik(slowniki.czestotliwosci);
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
    }
  }, []);

  useEffect(() => { wczytaj(); }, [wczytaj]);

  const czestotliwosci = useMemo(() => slownik ?? CZESTOTLIWOSCI_ZAPASOWE, [slownik]);

  const zamknijFormularz = useCallback(() => {
    setFormularzOtwarty(false);
    setEdytowany(null);
    setBladFormularza(null);
  }, []);

  const zapisz = useCallback(async () => {
    const walidacja = walidujFormularz(formularz);
    if (!walidacja.ok) {
      setBladFormularza(t(walidacja.blad));
      return;
    }

    setZapisywanie(true);
    try {
      if (edytowany) {
        await api.edytujWyszukiwanie(edytowany, {
          nazwa: walidacja.nazwa,
          alert_wlaczony: formularz.alert_wlaczony,
          czestotliwosc: formularz.czestotliwosc,
        });
      } else {
        await api.zapiszWyszukiwanie({
          nazwa: walidacja.nazwa,
          filtry: formularz.filtry,
          alert_wlaczony: formularz.alert_wlaczony,
          czestotliwosc: formularz.czestotliwosc,
        });
      }
      zamknijFormularz();
      await wczytaj();
    } catch (err) {
      /*
       * Backend odrzuca duplikat i przekroczony limit kodem 409 z gotowym
       * komunikatem PL/EN. Pokazujemy JEGO tekst, a nie własny: to on wie,
       * który limit padł i co z tym zrobić.
       */
      setBladFormularza(err.details?.komunikat ? t(err.details.komunikat) : err.message);
    } finally {
      setZapisywanie(false);
    }
  }, [formularz, edytowany, t, wczytaj, zamknijFormularz]);

  const przelaczAlert = useCallback(async (wpis) => {
    try {
      await api.edytujWyszukiwanie(wpis.id, { alert_wlaczony: !wpis.alert_wlaczony });
      await wczytaj();
    } catch (err) {
      Alert.alert(t('Nie udało się zmienić alertu', 'Could not change the alert'), err.message);
    }
  }, [t, wczytaj]);

  const usun = useCallback((wpis) => {
    Alert.alert(
      t('Usunąć obserwację?', 'Delete this search?'),
      t(
        `„${wpis.nazwa}" przestanie być sprawdzane i nie dostaniesz już z niego powiadomień.`,
        `“${wpis.nazwa}” will no longer be checked and will stop sending notifications.`,
      ),
      [
        { text: t('Anuluj', 'Cancel'), style: 'cancel' },
        {
          text: t('Usuń', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.usunWyszukiwanie(wpis.id);
              await wczytaj();
            } catch (err) {
              Alert.alert(t('Nie udało się usunąć', 'Could not delete'), err.message);
            }
          },
        },
      ],
    );
  }, [t, wczytaj]);

  const edytuj = useCallback((wpis) => {
    setFormularz(stanFormularza({ wpis, jezyk }));
    setEdytowany(wpis.id);
    setFormularzOtwarty(true);
    setBladFormularza(null);
  }, [jezyk]);

  if (ladowanie && !dane) {
    return (
      <Screen>
        <View style={styles.srodek}>
          <ActivityIndicator size="large" color={kolory.blue} />
        </View>
      </Screen>
    );
  }

  if (blad && !dane) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Nie udało się wczytać obserwacji', 'Could not load your searches')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} style={styles.gap} />
      </Screen>
    );
  }

  const lista = dane?.wyszukiwania ?? [];

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{t('Zapisane wyszukiwania', 'Saved searches')}</Text>
      <Text style={styles.akapit}>
        {t(
          'Zapisane wyszukiwanie pilnuje rynku za Ciebie: gdy pojawi się nowy przetarg albo zmieni się termin, wartość czy status obserwowanego ogłoszenia — dostaniesz powiadomienie.',
          'A saved search watches the market for you: when a new tender appears, or a watched notice changes its deadline, value or status, you get a notification.',
        )}
      </Text>
      <Text style={styles.podsumowanie}>{podsumowanieListy(dane, jezyk)}</Text>

      {formularzOtwarty ? (
        <View style={styles.formularz}>
          <Text style={styles.formularzTytul}>
            {edytowany ? t('Edytuj obserwację', 'Edit search') : t('Nowa obserwacja', 'New search')}
          </Text>

          <TextField
            label={t('Nazwa', 'Name')}
            value={formularz.nazwa}
            onChangeText={(v) => setFormularz((s) => ({ ...s, nazwa: v }))}
            placeholder={t('np. Drogi w Małopolsce', 'e.g. Roads in Lesser Poland')}
            error={bladFormularza}
            maxLength={60}
          />

          {!edytowany ? (
            <>
              <Text style={styles.etykietaSekcji}>{t('Obserwowane filtry', 'Watched filters')}</Text>
              <ChipyFiltrow filtry={formularz.filtry} styles={styles} t={t} />
              <Text style={styles.podpowiedz}>
                {t(
                  'Filtry pochodzą z listy „Wszystkie". Aby je zmienić, wróć na listę, ustaw filtry i zapisz wyszukiwanie ponownie.',
                  'Filters come from the “All” list. To change them, go back, adjust the filters and save the search again.',
                )}
              </Text>
            </>
          ) : null}

          <Text style={styles.etykietaSekcji}>{t('Jak często sprawdzać', 'How often to check')}</Text>
          <View style={styles.chipy}>
            {czestotliwosci.map((c) => (
              <Pressable
                key={c.kod}
                onPress={() => setFormularz((s) => ({ ...s, czestotliwosc: c.kod }))}
                accessibilityRole="radio"
                accessibilityState={{ selected: formularz.czestotliwosc === c.kod }}
                accessibilityLabel={t(c.etykieta)}
              >
                <Text style={[styles.chipWybor, formularz.czestotliwosc === c.kod && styles.chipWyborAktywny]}>
                  {t(c.etykieta)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.wiersz}>
            <Text style={styles.przelacznikEtykieta}>{t('Powiadamiaj mnie', 'Notify me')}</Text>
            <Switch
              value={formularz.alert_wlaczony}
              onValueChange={(v) => setFormularz((s) => ({ ...s, alert_wlaczony: v }))}
              accessibilityLabel={t('Powiadomienia dla tej obserwacji', 'Notifications for this search')}
            />
          </View>

          <View style={styles.przyciski}>
            <Button
              title={edytowany ? t('Zapisz zmiany', 'Save changes') : t('Zapisz obserwację', 'Save search')}
              onPress={zapisz}
              loading={zapisywanie}
              style={styles.przycisk}
            />
            <Button title={t('Anuluj', 'Cancel')} variant="ghost" onPress={zamknijFormularz} style={styles.przycisk} />
          </View>
        </View>
      ) : null}

      {!lista.length && !formularzOtwarty ? (
        <View style={styles.pustka}>
          <Text style={styles.pustkaIkona}>🔔</Text>
          <Text style={styles.pustkaTytul}>{t('Nie obserwujesz jeszcze niczego', 'You are not watching anything yet')}</Text>
          <Text style={styles.pustkaTekst}>
            {t(
              'Otwórz listę „Wszystkie", ustaw filtry, których szukasz, i dotknij „Zapisz to wyszukiwanie". Od tej chwili będziemy pilnować rynku za Ciebie.',
              'Open the “All” list, set the filters you need and tap “Save this search”. From then on we will watch the market for you.',
            )}
          </Text>
        </View>
      ) : null}

      {lista.map((w) => {
        const opis = opisObserwacji(w, jezyk, Date.now(), czestotliwosci);
        const nastepne = etykietaNastepnego(w.nastepne_sprawdzenie, jezyk, Date.now());
        return (
          <View key={w.id} style={styles.karta}>
            <View style={styles.naglowekKarty}>
              <Text style={styles.nazwa} numberOfLines={2}>{w.nazwa}</Text>
              <Switch
                value={w.alert_wlaczony}
                onValueChange={() => przelaczAlert(w)}
                accessibilityLabel={t(`Alert dla ${w.nazwa}`, `Alert for ${w.nazwa}`)}
              />
            </View>

            <ChipyFiltrow filtry={w.filtry} styles={styles} t={t} />

            <Text style={[styles.stan, { color: kolorTonu(kolory, opis.ton) }]}>{opis.stan}</Text>
            <Text style={styles.meta}>{opis.ostatnio}</Text>
            {nastepne ? (
              <Text style={styles.meta}>{t('Następne sprawdzenie', 'Next check')}: {nastepne}</Text>
            ) : null}

            <View style={styles.akcje}>
              <Pressable onPress={() => edytuj(w)} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.akcja}>{t('Edytuj', 'Edit')}</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('CentrumAlertow')}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.akcja}>{t('Alerty', 'Alerts')}</Text>
              </Pressable>
              <Pressable onPress={() => usun(w)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.akcja, { color: kolory.danger }]}>{t('Usuń', 'Delete')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {blad ? (
        <Pressable style={styles.pasekBledu} onPress={wczytaj} accessibilityRole="button">
          <Text style={styles.pasekBleduTekst}>{blad} · {t('dotknij, aby ponowić', 'tap to retry')}</Text>
        </Pressable>
      ) : null}

      <Button title={t('Odśwież', 'Refresh')} variant="ghost" onPress={wczytaj} style={styles.gap} />
    </Screen>
  );
}

const tworzStyleWyszukiwan = tworzStyle((k) => ({
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  podsumowanie: { fontSize: 12, color: k.textMuted, fontWeight: '700', marginTop: spacing.sm },

  formularz: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.blue,
    backgroundColor: k.surface,
    gap: spacing.sm,
  },
  formularzTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  etykietaSekcji: { fontSize: 13, fontWeight: '800', color: k.text, marginTop: spacing.xs },
  podpowiedz: { fontSize: 12, color: k.textMuted, lineHeight: 18 },
  wiersz: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  przelacznikEtykieta: { fontSize: 14, fontWeight: '700', color: k.text },
  przyciski: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  przycisk: { flex: 1 },

  karta: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    gap: 4,
  },
  naglowekKarty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  nazwa: { flex: 1, fontSize: 15, fontWeight: '800', color: k.text },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    fontSize: 11,
    fontWeight: '700',
    color: k.textMuted,
    backgroundColor: k.neutralneTlo,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  chipPusty: { fontSize: 11, color: k.textMuted, fontStyle: 'italic', marginTop: 2 },
  chipWybor: {
    fontSize: 12,
    fontWeight: '700',
    color: k.textMuted,
    borderWidth: 1,
    borderColor: k.border,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  chipWyborAktywny: { color: k.white, backgroundColor: k.blue, borderColor: k.blue },
  stan: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  meta: { fontSize: 12, color: k.textMuted },
  akcje: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  akcja: { fontSize: 13, fontWeight: '800', color: k.blue },

  pustka: { marginTop: spacing.xl, alignItems: 'center', gap: 6 },
  pustkaIkona: { fontSize: 36 },
  pustkaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  pustkaTekst: { fontSize: 13, color: k.textMuted, lineHeight: 19, textAlign: 'center' },

  pasekBledu: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: k.ostrzezenieTlo,
  },
  pasekBleduTekst: { fontSize: 12, color: k.ostrzezenieTekst, fontWeight: '700' },
  gap: { marginTop: spacing.lg },
}));
