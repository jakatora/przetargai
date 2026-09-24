import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, ScrollView, View, Text, TextInput, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';
import Button from './Button';
import PodpisZrodla from './PodpisZrodla';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import * as storage from '../lib/storage';
import { spacing, radius } from '../theme';
import { WOJEWODZTWA } from '../lib/wojewodztwa';
import { formatDate, formatBudget } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import {
  FILTRY_DOMYSLNE, KLUCZ_FILTROW, SORTOWANIA, STATUSY_TERMINU, ZRODLA,
  normalizujFiltry, parametryZapytania, liczbaAktywnychFiltrow, scalStrone,
  opisPustki, etykietaLicznika, czyResetowacKursor,
} from '../lib/katalogPrzetargow';
import { etykietaZrodla } from '../lib/zrodlaDanych';

/*
 * Tryb „Wszystkie" na głównej liście (P1-3).
 *
 * To NIE jest drugi feed: ta lista nie przechodzi przez profil, próg dopasowania
 * ani dzienny limit planu. Dzięki temu nowy użytkownik z pustym profilem widzi,
 * że aplikacja ma dane — zamiast wnioskować z pustego ekranu, że ich nie ma.
 *
 * Cała logika stanu (filtry, scalanie stron, teksty pustki) żyje w
 * lib/katalogPrzetargow.js i jest testowana bez Reacta.
 */

const ETYKIETY_SORTOWAN = {
  najnowsze: { pl: 'Najnowsze', en: 'Newest' },
  termin: { pl: 'Termin najbliżej', en: 'Deadline soonest' },
};

const ETYKIETY_TERMINU = {
  aktywne: { pl: 'Aktywne', en: 'Open' },
  poterminie: { pl: 'Po terminie', en: 'Closed' },
  wszystkie: { pl: 'Wszystkie terminy', en: 'Any deadline' },
};

/** Chip wyboru — jeden komponent na wszystkie grupy filtrów (spójny dotyk i stany). */
function Chip({ etykieta, aktywny, onPress, styles }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: aktywny }}
      hitSlop={6}
      style={[styles.chip, aktywny && styles.chipOn]}
    >
      <Text style={[styles.chipTekst, aktywny && styles.chipTekstOn]}>{etykieta}</Text>
    </Pressable>
  );
}

/** Karta ogłoszenia z katalogu. Bez wyniku dopasowania — ta lista go nie liczy. */
function KartaPrzetargu({ tender, onPress, styles, t }) {
  const termin = opisTerminu(tender.deadline);
  const budzet = formatBudget(tender.budget, tender.currency);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${tender.title}. ${termin.etykieta}. ${t(etykietaZrodla(tender.zrodlo?.kod))}.`}
      style={({ pressed }) => [styles.karta, pressed && styles.kartaWcisnieta, termin.minal && styles.kartaMiniona]}
    >
      <Text style={styles.kartaTytul} numberOfLines={2}>{tender.title}</Text>
      {tender.organization ? (
        <Text style={styles.kartaOrg} numberOfLines={1}>{tender.organization}</Text>
      ) : null}

      <View style={styles.kartaRzad}>
        <Text style={[styles.kartaTermin, termin.pilny && styles.kartaPilny, termin.minal && styles.kartaPoTerminie]}>
          {t('Termin', 'Deadline')}: {formatDate(tender.deadline)} · {termin.etykieta}
        </Text>
      </View>

      <View style={styles.kartaRzad}>
        {tender.region_nazwa ? <Text style={styles.kartaMeta}>{tender.region_nazwa}</Text> : null}
        {budzet ? <Text style={styles.kartaMeta}>{budzet}</Text> : null}
      </View>

      {/* Źródło pierwotne + czas ostatniej synchronizacji — wymóg P1-3. */}
      <PodpisZrodla zrodlo={tender.zrodlo} kompakt />
    </Pressable>
  );
}

export default function KatalogWszystkich({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKatalogu);
  const { t } = useJezyk();

  const [filtry, setFiltry] = useState(FILTRY_DOMYSLNE);
  const [panelOtwarty, setPanelOtwarty] = useState(false);
  const [pozycje, setPozycje] = useState([]);
  const [kursor, setKursor] = useState(null);
  const [wyczerpano, setWyczerpano] = useState(false);
  const [ladowanie, setLadowanie] = useState(true);
  const [odswiezanie, setOdswiezanie] = useState(false);
  const [dociaganie, setDociaganie] = useState(false);
  const [blad, setBlad] = useState(null);
  // `null` = jeszcze nie wiadomo; bez tego panel filtrów migałby przy starcie.
  const [gotowe, setGotowe] = useState(false);

  // Filtry przeżywają restart aplikacji — wybrany region to nie jest decyzja na raz.
  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_FILTROW)
      .then((zapis) => {
        if (!aktywny) return;
        try {
          setFiltry(normalizujFiltry(zapis ? JSON.parse(zapis) : null));
        } catch {
          setFiltry(FILTRY_DOMYSLNE);
        }
      })
      .catch(() => {})
      .finally(() => { if (aktywny) setGotowe(true); });
    return () => { aktywny = false; };
  }, []);

  const zmienFiltr = useCallback((pole, wartosc) => {
    setFiltry((poprzednie) => {
      const nowe = normalizujFiltry({ ...poprzednie, [pole]: wartosc });
      storage.setItem(KLUCZ_FILTROW, JSON.stringify(nowe)).catch(() => {});
      // Kursor należy do ZESTAWU filtrów — backend odrzuci go po zmianie.
      if (czyResetowacKursor(poprzednie, nowe)) setKursor(null);
      return nowe;
    });
  }, []);

  const wyczyscFiltry = useCallback(() => {
    setFiltry(FILTRY_DOMYSLNE);
    setKursor(null);
    storage.setItem(KLUCZ_FILTROW, JSON.stringify(FILTRY_DOMYSLNE)).catch(() => {});
  }, []);

  const parametry = useMemo(() => parametryZapytania(filtry), [filtry]);
  const aktywnych = useMemo(() => liczbaAktywnychFiltrow(filtry), [filtry]);

  /** Pierwsza strona (albo odświeżenie). Błąd NIE kasuje tego, co już widać. */
  const wczytaj = useCallback(async (tryb) => {
    if (tryb === 'odswiez') setOdswiezanie(true);
    try {
      const dane = await api.getTenders({ ...parametry, limit: 20 });
      setPozycje(dane.tenders ?? []);
      setKursor(dane.next_kursor ?? null);
      setWyczerpano(dane.wyczerpano !== false);
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
      setOdswiezanie(false);
    }
  }, [parametry]);

  /*
   * Zmiana filtrów przeładowuje pierwszą stronę — ale dopiero po chwili ciszy.
   * Bez tego każde uderzenie w klawiaturę w polu szukania byłoby osobnym
   * żądaniem do backendu, który skanuje setki dokumentów na zapytanie.
   */
  useEffect(() => {
    if (!gotowe) return undefined;
    const id = setTimeout(() => { wczytaj(); }, 350);
    return () => clearTimeout(id);
  }, [gotowe, wczytaj]);

  /**
   * Dociąganie. `wyczerpano: false` bez kursora nie zdarza się z backendu, ale
   * gdyby się zdarzyło, pętla i tak się zatrzyma — lista nie ma prawa kręcić się
   * w nieskończoność na błędzie kontraktu.
   */
  const dociagnij = useCallback(async () => {
    if (!kursor || dociaganie || odswiezanie || ladowanie) return;
    setDociaganie(true);
    try {
      const dane = await api.getTenders({ ...parametry, limit: 20, kursor });
      setPozycje((poprzednie) => scalStrone(poprzednie, dane.tenders ?? []));
      setKursor(dane.next_kursor ?? null);
      setWyczerpano(dane.wyczerpano !== false);
      setBlad(null);
    } catch (err) {
      // Błąd dociągania nie może skasować listy — pokazujemy pasek nad stopką.
      setBlad(err.message);
    } finally {
      setDociaganie(false);
    }
  }, [kursor, dociaganie, odswiezanie, ladowanie, parametry]);

  const licznik = etykietaLicznika({ ile: pozycje.length, wyczerpano });

  const naglowek = (
    <View>
      <View style={styles.szukajRzad}>
        <Text style={styles.szukajIkona}>🔍</Text>
        <TextInput
          style={styles.szukajPole}
          value={filtry.q}
          onChangeText={(v) => zmienFiltr('q', v)}
          placeholder={t('Szukaj w całym rynku', 'Search the whole market')}
          placeholderTextColor={kolory.textMuted}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('Szukaj w całym rynku', 'Search the whole market')}
        />
        {filtry.q ? (
          <Pressable onPress={() => zmienFiltr('q', '')} hitSlop={10} accessibilityLabel={t('Wyczyść szukanie', 'Clear search')}>
            <Text style={styles.szukajX}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.paskaRzad}>
        <Pressable
          onPress={() => setPanelOtwarty((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: panelOtwarty }}
          style={styles.przyciskFiltrow}
        >
          <Text style={styles.przyciskFiltrowTekst}>
            {panelOtwarty ? '▾ ' : '▸ '}{t('Filtry', 'Filters')}{aktywnych ? ` (${aktywnych})` : ''}
          </Text>
        </Pressable>
        {licznik ? <Text style={styles.licznik}>{t(licznik)}</Text> : null}
      </View>

      {panelOtwarty ? (
        <View style={styles.panel}>
          <Text style={styles.grupaTytul}>{t('Źródło', 'Source')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grupa}>
            <Chip styles={styles} etykieta={t('Wszystkie', 'All')} aktywny={!filtry.zrodlo} onPress={() => zmienFiltr('zrodlo', null)} />
            {ZRODLA.map((kod) => (
              <Chip
                key={kod}
                styles={styles}
                etykieta={t(etykietaZrodla(kod))}
                aktywny={filtry.zrodlo === kod}
                onPress={() => zmienFiltr('zrodlo', filtry.zrodlo === kod ? null : kod)}
              />
            ))}
          </ScrollView>

          <Text style={styles.grupaTytul}>{t('Województwo', 'Voivodeship')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grupa}>
            <Chip styles={styles} etykieta={t('Wszystkie', 'All')} aktywny={!filtry.region} onPress={() => zmienFiltr('region', null)} />
            {Object.entries(WOJEWODZTWA).map(([kod, nazwa]) => (
              <Chip
                key={kod}
                styles={styles}
                etykieta={nazwa}
                aktywny={filtry.region === kod}
                onPress={() => zmienFiltr('region', filtry.region === kod ? null : kod)}
              />
            ))}
          </ScrollView>

          <Text style={styles.grupaTytul}>{t('Termin składania', 'Submission deadline')}</Text>
          <View style={styles.grupa} accessibilityRole="radiogroup">
            {STATUSY_TERMINU.map((kod) => (
              <Chip
                key={kod}
                styles={styles}
                etykieta={t(ETYKIETY_TERMINU[kod])}
                aktywny={filtry.termin === kod}
                onPress={() => zmienFiltr('termin', kod)}
              />
            ))}
          </View>

          <Text style={styles.grupaTytul}>{t('Kolejność', 'Order')}</Text>
          <View style={styles.grupa} accessibilityRole="radiogroup">
            {SORTOWANIA.map((kod) => (
              <Chip
                key={kod}
                styles={styles}
                etykieta={t(ETYKIETY_SORTOWAN[kod])}
                aktywny={filtry.sort === kod}
                onPress={() => zmienFiltr('sort', kod)}
              />
            ))}
          </View>

          <Text style={styles.grupaTytul}>{t('Kod CPV (prefiks)', 'CPV code (prefix)')}</Text>
          <TextInput
            style={styles.pole}
            value={filtry.cpv}
            onChangeText={(v) => zmienFiltr('cpv', v)}
            placeholder="45233"
            placeholderTextColor={kolory.textMuted}
            keyboardType="number-pad"
            accessibilityLabel={t('Kod CPV', 'CPV code')}
          />

          <Text style={styles.grupaTytul}>{t('Wartość zamówienia (zł)', 'Contract value (PLN)')}</Text>
          <View style={styles.widelki}>
            <TextInput
              style={[styles.pole, styles.poleWaskie]}
              value={filtry.wartosc_min}
              onChangeText={(v) => zmienFiltr('wartosc_min', v)}
              placeholder={t('od', 'from')}
              placeholderTextColor={kolory.textMuted}
              keyboardType="number-pad"
              accessibilityLabel={t('Wartość od', 'Value from')}
            />
            <TextInput
              style={[styles.pole, styles.poleWaskie]}
              value={filtry.wartosc_max}
              onChangeText={(v) => zmienFiltr('wartosc_max', v)}
              placeholder={t('do', 'to')}
              placeholderTextColor={kolory.textMuted}
              keyboardType="number-pad"
              accessibilityLabel={t('Wartość do', 'Value to')}
            />
          </View>
          {/*
            Widełki kwoty odsiewają ogłoszenia BEZ podanej wartości, a rejestry
            podają ją rzadko. Bez tego zdania pusty wynik wygląda jak „nie ma
            takich przetargów", choć znaczy „rejestr tego nie publikuje".
          */}
          <Text style={styles.uwaga}>
            {t(
              'Widełki kwoty pomijają ogłoszenia bez podanej wartości — rejestry podają ją rzadko.',
              'The value range skips notices with no stated value — registers rarely publish it.',
            )}
          </Text>

          {aktywnych > 0 ? (
            <Button title={t('Wyczyść filtry', 'Clear filters')} variant="ghost" onPress={wyczyscFiltry} style={styles.wyczysc} />
          ) : null}
        </View>
      ) : null}

      {blad && pozycje.length > 0 ? (
        <Pressable style={styles.pasekBledu} onPress={() => wczytaj('odswiez')} accessibilityRole="button">
          <Text style={styles.pasekBleduTekst}>
            {t(
              'Nie udało się odświeżyć listy. Pokazujemy ostatnio pobrane. Dotknij, aby spróbować ponownie.',
              'Could not refresh the list. Showing the last fetch. Tap to retry.',
            )}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (ladowanie && !pozycje.length) {
    return (
      <View style={styles.srodek}>
        <ActivityIndicator size="large" color={kolory.blue} />
      </View>
    );
  }

  if (blad && !pozycje.length) {
    return (
      <View style={styles.srodek}>
        <Text style={styles.pustkaTytul}>{t('Nie udało się wczytać rynku', 'Could not load the market')}</Text>
        <Text style={styles.pustkaTekst}>{blad}</Text>
        <Button
          title={t('Spróbuj ponownie', 'Try again')}
          variant="ghost"
          onPress={() => { setLadowanie(true); wczytaj(); }}
          style={styles.ponow}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={pozycje}
      keyExtractor={(item) => item.id}
      contentContainerStyle={pozycje.length ? styles.lista : styles.listaPusta}
      ListHeaderComponent={naglowek}
      renderItem={({ item }) => (
        <KartaPrzetargu
          tender={item}
          styles={styles}
          t={t}
          onPress={() => navigation.navigate('KatalogDetail', { tender: item })}
        />
      )}
      refreshControl={(
        <RefreshControl
          refreshing={odswiezanie}
          onRefresh={() => wczytaj('odswiez')}
          tintColor={kolory.blue}
          colors={[kolory.blue]}
        />
      )}
      onEndReached={dociagnij}
      onEndReachedThreshold={0.4}
      ListFooterComponent={dociaganie ? (
        <View style={styles.stopka}><ActivityIndicator color={kolory.blue} /></View>
      ) : null}
      ListEmptyComponent={(
        <View style={styles.pustka}>
          <Text style={styles.pustkaIkona}>🗂️</Text>
          <Text style={styles.pustkaTytul}>{t('Brak wyników', 'No results')}</Text>
          <Text style={styles.pustkaTekst}>{t(opisPustki(filtry))}</Text>
          {aktywnych > 0 ? (
            <Button title={t('Wyczyść filtry', 'Clear filters')} variant="ghost" onPress={wyczyscFiltry} style={styles.ponow} />
          ) : null}
        </View>
      )}
    />
  );
}

const tworzStyleKatalogu = tworzStyle((k) => ({
  lista: { padding: spacing.md, paddingBottom: spacing.xl },
  listaPusta: { padding: spacing.md, flexGrow: 1 },
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: k.bg },

  szukajRzad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: k.surface,
    borderWidth: 1,
    borderColor: k.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  szukajIkona: { fontSize: 14 },
  szukajPole: { flex: 1, paddingVertical: 10, fontSize: 15, color: k.text },
  szukajX: { fontSize: 16, color: k.textMuted, paddingHorizontal: 4 },

  paskaRzad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  przyciskFiltrow: { paddingVertical: 6, paddingRight: 8 },
  przyciskFiltrowTekst: { fontSize: 14, fontWeight: '800', color: k.blue },
  licznik: { fontSize: 12, color: k.textMuted, fontWeight: '600' },

  panel: {
    backgroundColor: k.surface,
    borderWidth: 1,
    borderColor: k.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  grupaTytul: { fontSize: 12, fontWeight: '800', color: k.textMuted, marginTop: spacing.sm, marginBottom: 6, textTransform: 'uppercase' },
  grupa: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  chip: {
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.bg,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginRight: spacing.xs,
  },
  chipOn: { backgroundColor: k.blue, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.text, fontWeight: '600' },
  chipTekstOn: { color: k.white, fontWeight: '800' },
  pole: {
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.bg,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: k.text,
  },
  poleWaskie: { flex: 1 },
  widelki: { flexDirection: 'row', gap: spacing.sm },
  uwaga: { fontSize: 11, color: k.textMuted, marginTop: 6, lineHeight: 16 },
  wyczysc: { marginTop: spacing.md },

  pasekBledu: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  pasekBleduTekst: { color: k.ostrzezenieTekst, fontSize: 12, fontWeight: '600', lineHeight: 17 },

  karta: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  kartaWcisnieta: { opacity: 0.7 },
  kartaMiniona: { opacity: 0.55 },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  kartaOrg: { fontSize: 13, color: k.textMuted, marginTop: 3 },
  kartaRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  kartaTermin: { fontSize: 12, color: k.textMuted, fontWeight: '600' },
  kartaPilny: { color: k.ostrzezenieAkcent },
  kartaPoTerminie: { color: k.danger },
  kartaMeta: { fontSize: 12, color: k.textMuted },

  stopka: { paddingVertical: spacing.md, alignItems: 'center' },
  pustka: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.sm },
  pustkaIkona: { fontSize: 40 },
  pustkaTytul: { fontSize: 17, fontWeight: '800', color: k.text, textAlign: 'center' },
  pustkaTekst: { fontSize: 14, color: k.textMuted, textAlign: 'center', lineHeight: 20 },
  ponow: { marginTop: spacing.md },
}));
