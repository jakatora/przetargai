import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, ScrollView, View, Text, TextInput, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';
import Button from './Button';
import PodpisZrodla from './PodpisZrodla';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import * as storage from '../lib/storage';
import { spacing, radius, typografia, DOTYK } from '../theme';
import Ikona from './Ikona';
import { StanLadowania, StanBledu, StanPusty } from './Stan';
import { WOJEWODZTWA } from '../lib/wojewodztwa';
import { formatDate, formatBudget } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { znacznikKryteriow } from '../lib/kryteriaOceny';
import { znacznikZmian } from '../lib/zmianyDokumentow';
import {
  FILTRY_DOMYSLNE, KLUCZ_FILTROW, SORTOWANIA, STATUSY_TERMINU, ZRODLA,
  normalizujFiltry, parametryZapytania, liczbaAktywnychFiltrow,
  opisPustki, etykietaLicznika,
} from '../lib/katalogPrzetargow';
import { etykietaZrodla } from '../lib/zrodlaDanych';
import { useAuth } from '../context/AuthContext';
import { eksportujNaEmail } from '../services/eksportCsv';
import { utworzKatalogPaginowany } from '../lib/katalogPaginacja';

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
  const kryteria = znacznikKryteriow(tender);
  const zmiany = znacznikZmian(tender);
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

      <View style={styles.kartaPasek}>
        <Text style={styles.kartaTermin}>
          {t('Termin', 'Deadline')}: <Text style={styles.kartaTerminData}>{formatDate(tender.deadline)}</Text>
        </Text>
        <Text style={[styles.kartaChip, termin.pilny && styles.kartaPilny, termin.minal && styles.kartaPoTerminie]}>
          {t(termin.etykieta)}
        </Text>
        {tender.region_nazwa ? <Text style={styles.kartaMeta}>{tender.region_nazwa}</Text> : null}
        {budzet ? <Text style={[styles.kartaMeta, styles.kartaKwota]}>{budzet}</Text> : null}
        {kryteria ? (
          <Text style={[styles.kartaChip, !kryteria.tylkoCena && styles.kartaKryteria]} numberOfLines={1}>
            {t(kryteria.pl, kryteria.en)}
          </Text>
        ) : null}
        {zmiany ? <Text style={[styles.kartaChip, styles.kartaZmiany]} numberOfLines={1}>{t(zmiany.pl, zmiany.en)}</Text> : null}
      </View>

      {/* Źródło pierwotne + czas ostatniej synchronizacji — wymóg P1-3. */}
      <PodpisZrodla zrodlo={tender.zrodlo} kompakt />
    </Pressable>
  );
}

export default function KatalogWszystkich({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKatalogu);
  const { t, jezyk } = useJezyk();
  const { user } = useAuth();

  const [filtry, setFiltry] = useState(FILTRY_DOMYSLNE);
  const filtryRef = useRef(FILTRY_DOMYSLNE);
  const [panelOtwarty, setPanelOtwarty] = useState(false);
  const [katalog] = useState(() => utworzKatalogPaginowany({ pobierzStrone: (p) => api.getTenders(p) }));
  const [stan, setStan] = useState(katalog.stan);
  const { pozycje, wyczerpano, ladowanie, odswiezanie, dociaganie, blad, przeskanowano } = stan;
  useEffect(() => katalog.subskrybuj(setStan), [katalog]);
  useEffect(() => () => katalog.anuluj(), [katalog]);
  const ustawFiltry = useCallback((nowe) => {
    filtryRef.current = nowe;
    katalog.ustawParametry(parametryZapytania(nowe));
    setFiltry(nowe);
  }, [katalog]);
  // `null` = jeszcze nie wiadomo; bez tego panel filtrów migałby przy starcie.
  const [gotowe, setGotowe] = useState(false);

  // Filtry przeżywają restart aplikacji — wybrany region to nie jest decyzja na raz.
  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_FILTROW)
      .then((zapis) => {
        if (!aktywny) return;
        try {
          ustawFiltry(normalizujFiltry(zapis ? JSON.parse(zapis) : null));
        } catch {
          ustawFiltry(FILTRY_DOMYSLNE);
        }
      })
      .catch(() => { if (aktywny) ustawFiltry(FILTRY_DOMYSLNE); })
      .finally(() => { if (aktywny) setGotowe(true); });
    return () => { aktywny = false; };
  }, [ustawFiltry]);

  const zmienFiltr = useCallback((pole, wartosc) => {
    const nowe = normalizujFiltry({ ...filtryRef.current, [pole]: wartosc });
    ustawFiltry(nowe);
    storage.setItem(KLUCZ_FILTROW, JSON.stringify(nowe)).catch(() => {});
  }, [ustawFiltry]);

  const wyczyscFiltry = useCallback(() => {
    ustawFiltry(FILTRY_DOMYSLNE);
    storage.setItem(KLUCZ_FILTROW, JSON.stringify(FILTRY_DOMYSLNE)).catch(() => {});
  }, [ustawFiltry]);

  const parametry = useMemo(() => parametryZapytania(filtry), [filtry]);
  const aktywnych = useMemo(() => liczbaAktywnychFiltrow(filtry), [filtry]);

  const wczytaj = useCallback((tryb) => katalog.wczytaj(tryb), [katalog]);
  const dociagnij = useCallback(() => katalog.dociagnij(), [katalog]);

  /*
   * Zmiana filtrów przeładowuje pierwszą stronę — ale dopiero po chwili ciszy.
   * Bez tego każde uderzenie w klawiaturę w polu szukania byłoby osobnym
   * żądaniem do backendu, który skanuje setki dokumentów na zapytanie.
   */
  useEffect(() => {
    if (!gotowe) return undefined;
    const id = setTimeout(() => { wczytaj(); }, 350);
    return () => clearTimeout(id);
  }, [gotowe, parametry, wczytaj]);

  const licznik = etykietaLicznika({ ile: pozycje.length, wyczerpano });

  const naglowek = (
    <View>
      <View style={styles.szukajRzad}>
        <Ikona nazwa="szukaj" rozmiar={18} kolor={kolory.textMuted} />
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
          <Pressable accessibilityRole="button" onPress={() => zmienFiltr('q', '')} hitSlop={10} style={styles.szukajX} accessibilityLabel={t('Wyczyść szukanie', 'Clear search')}>
            <Ikona nazwa="zamknij" rozmiar={16} kolor={kolory.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.paskaRzad}>
        <Pressable
          onPress={() => setPanelOtwarty((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: panelOtwarty }}
          accessibilityLabel={aktywnych
            ? t(`Filtry, aktywne: ${aktywnych}`, `Filters, active: ${aktywnych}`)
            : t('Filtry', 'Filters')}
          style={[styles.przyciskFiltrow, (panelOtwarty || aktywnych > 0) && styles.przyciskFiltrowOn]}
        >
          <Ikona nazwa="filtr" rozmiar={18} kolor={panelOtwarty || aktywnych > 0 ? kolory.blue : kolory.text} />
          <Text style={[styles.przyciskFiltrowTekst, (panelOtwarty || aktywnych > 0) && styles.przyciskFiltrowTekstOn]}>
            {t('Filtry', 'Filters')}
          </Text>
          {aktywnych ? <Text style={styles.filtryLicznik}>{aktywnych}</Text> : null}
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

          {/*
            WEJŚCIE DO OBSERWACJI (etap 5). Przycisk stoi TU, a nie na osobnym ekranie,
            bo filtry są tutaj — i tylko tutaj użytkownik wie, co dokładnie zapisuje.
            Druga, równoległa lista filtrów w ekranie obserwacji rozjechałaby się
            z katalogiem przy pierwszej zmianie i alert dotyczyłby innego zbioru
            niż widziana lista.
          */}
          <Button
            title={t('Zapisz to wyszukiwanie', 'Save this search')}
            variant="ghost"
            onPress={() => navigation.navigate('ZapisaneWyszukiwania', { filtry })}
            style={styles.wyczysc}
          />
          <Button
            title={t('Wyślij listę do Excela (e-mail)', 'Send the list to Excel (e-mail)')}
            variant="ghost"
            onPress={() => eksportujNaEmail({ rodzaj: 'katalog', filtry: parametry, email: user?.email, jezyk })}
            style={styles.wyczysc}
          />

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

  const pracuje = ladowanie || odswiezanie || dociaganie;
  const postep = (
    <View style={styles.stopka} accessibilityLiveRegion="polite">
      <ActivityIndicator color={kolory.blue} accessibilityLabel={t('Przeszukujemy rynek', 'Searching the market')} />
      <Text style={styles.pustkaTekst}>
        {t('Przeszukujemy rynek…', 'Searching the market…')}
        {przeskanowano > 0 ? t(` Sprawdzono ${przeskanowano} ogłoszeń.`, ` Checked ${przeskanowano} notices.`) : ''}
      </Text>
    </View>
  );

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
      onEndReached={() => { if (!blad) dociagnij(); }}
      onEndReachedThreshold={0.4}
      ListFooterComponent={pozycje.length > 0 ? (pracuje ? postep : (!wyczerpano && !blad ? (
        <Button title={t('Więcej ogłoszeń', 'More notices')} variant="ghost" onPress={dociagnij} />
      ) : null)) : null}
      ListEmptyComponent={pracuje ? (
        <View>{postep}<StanLadowania karty={3} /></View>
      ) : blad ? (
        <StanBledu tytul={t('Nie udało się wczytać rynku', 'Could not load the market')} opis={blad} onPonow={() => wczytaj()} />
      ) : wyczerpano ? (
        <StanPusty
          tytul={t('Brak wyników', 'No results')}
          opis={t(opisPustki(filtry))}
          akcja={aktywnych > 0 ? { tytul: t('Wyczyść filtry', 'Clear filters'), onPress: wyczyscFiltry, wariant: 'ghost' } : null}
        />
      ) : null}
    />
  );
}

const tworzStyleKatalogu = tworzStyle((k) => ({
  lista: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  listaPusta: { padding: spacing.md, flexGrow: 1 },
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: k.bg },

  szukajRzad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: k.surface,
    borderWidth: 1.5,
    borderColor: k.obramowaniePola,
    borderRadius: radius.md,
    paddingLeft: 12,
    minHeight: DOTYK + 4,
    marginBottom: spacing.sm,
  },
  szukajPole: { flex: 1, paddingVertical: 11, fontSize: 15, color: k.text },
  szukajX: { width: DOTYK, height: DOTYK, alignItems: 'center', justifyContent: 'center' },

  paskaRzad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  przyciskFiltrow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, minHeight: 40,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: k.obramowaniePola, backgroundColor: k.surface,
  },
  przyciskFiltrowOn: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  przyciskFiltrowTekst: { fontSize: 14, fontWeight: '700', color: k.text },
  przyciskFiltrowTekstOn: { color: k.blue },
  filtryLicznik: {
    minWidth: 20, textAlign: 'center',
    fontSize: 12, fontWeight: '800', color: k.naAkcencie, backgroundColor: k.blue,
    borderRadius: 10, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 1,
  },
  licznik: { flexShrink: 1, fontSize: 13, color: k.textMuted, fontWeight: '600', textAlign: 'right' },

  panel: {
    backgroundColor: k.surface,
    borderWidth: 1,
    borderColor: k.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.md,
  },
  grupaTytul: { ...typografia.etykieta, color: k.textMuted, marginTop: spacing.md, marginBottom: 6 },
  grupa: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: k.border,
    backgroundColor: k.surface,
    borderRadius: radius.pelny,
    paddingHorizontal: 14,
    marginRight: spacing.xs,
  },
  chipOn: { backgroundColor: k.wyroznienie, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.textMuted, fontWeight: '600' },
  chipTekstOn: { color: k.blue, fontWeight: '800' },
  pole: {
    minHeight: DOTYK,
    borderWidth: 1.5,
    borderColor: k.obramowaniePola,
    backgroundColor: k.surface,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: k.text,
  },
  poleWaskie: { flex: 1, minWidth: 0 },
  widelki: { flexDirection: 'row', gap: spacing.sm },
  uwaga: { fontSize: 12, color: k.textMuted, marginTop: 6, lineHeight: 17 },
  wyczysc: { marginTop: spacing.md },

  pasekBledu: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pasekBleduTekst: { color: k.ostrzezenieTekst, fontSize: 13, fontWeight: '600', lineHeight: 18 },

  karta: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginBottom: 12,
  },
  kartaWcisnieta: { backgroundColor: k.powierzchniaWtorna, borderColor: k.obramowaniePola },
  kartaMiniona: { opacity: 0.6 },
  kartaTytul: { ...typografia.karta, color: k.text },
  kartaOrg: { fontSize: 13, lineHeight: 18, color: k.textMuted, marginTop: 4 },
  kartaRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  kartaPasek: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, paddingTop: spacing.sm + 2, borderTopWidth: 1, borderTopColor: k.border,
  },
  kartaTermin: { fontSize: 13, color: k.textMuted },
  kartaTerminData: { color: k.text, fontWeight: '700' },
  kartaChip: {
    fontSize: 12, fontWeight: '700', color: k.textMuted, backgroundColor: k.neutralneTlo,
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.sm, overflow: 'hidden',
  },
  kartaPilny: { color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo },
  kartaPoTerminie: { color: k.danger, backgroundColor: k.dangerTlo },
  kartaKryteria: { color: k.blue, backgroundColor: k.wyroznienie, flexShrink: 1 },
  kartaZmiany: { color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo, flexShrink: 1 },
  kartaMeta: { fontSize: 13, color: k.textMuted },
  kartaKwota: { color: k.text, fontWeight: '700', fontVariant: ['tabular-nums'] },

  stopka: { paddingVertical: spacing.md, alignItems: 'center' },
  pustkaTytul: { ...typografia.sekcja, color: k.text, textAlign: 'center' },
  pustkaTekst: { fontSize: 14, color: k.textMuted, textAlign: 'center', lineHeight: 20 },
  ponow: { marginTop: spacing.md },
}));
