import { useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  SectionList,
  ScrollView,
  View,
  Text,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { api } from '../api/client';
import MatchCard from '../components/MatchCard';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { PROGI, KLUCZ_PROGU, filtrujPoProgu, normalizujProg } from '../lib/filtrOcen';
import { SORTOWANIA, KLUCZ_SORT, sortujDopasowania, filtrujTekst, normalizujSort, filtrujMalaFirma } from '../lib/feedSort';
import { sortujPodprogowe, etykietaZrodla, flagiPodprogowe, etykietaWartosciNetto } from '../lib/podprogowe';
import { filtrujWojewodztwo, wojewodztwaObecne, WOJEWODZTWA } from '../lib/wojewodztwa';
import { grupujPoDniach, policzNowe, czyNowe } from '../lib/grupowanieDni';
import {
  STATUSY_TERMINU, STATUS_TERMINU_DOMYSLNY, KLUCZ_STATUS_TERMINU,
  normalizujStatusTerminu, filtrujStatusTerminu, policzPoTerminie,
} from '../lib/filtrTerminu';
import * as storage from '../lib/storage';
import { spacing, radius } from '../theme';

// Znacznik ostatniej wizyty na feedzie — do wykrywania „nowych" przetargów.
const KLUCZ_OSTATNIA_WIZYTA = 'przetargai.feed_ostatnia_wizyta';

/**
 * Kafelek scalonego strumienia podprogowego w bandzie „łatwiejszy start"
 * (podzadanie 7/7). Kompaktowy, poziomy — stoi „obok" dużych przetargów, nie
 * zamiast nich. Reguły „kod/liczba → słowo" i sortowanie żyją w lib/podprogowe.js.
 */
function KartaPodprogowa({ ogloszenie, onPress, styles }) {
  const wartosc = etykietaWartosciNetto(ogloszenie.wartosc_netto, ogloszenie.waluta);
  const flagi = flagiPodprogowe(ogloszenie.flagi);
  return (
    <Pressable onPress={onPress} style={styles.ppKarta} accessibilityRole="button">
      {ogloszenie.latwiejszy_start ? (
        <Text style={styles.ppBadge}>Łatwiejszy start</Text>
      ) : null}
      <Text style={styles.ppTytul} numberOfLines={2}>{ogloszenie.tytul}</Text>
      {ogloszenie.zamawiajacy ? (
        <Text style={styles.ppZamawiajacy} numberOfLines={1}>{ogloszenie.zamawiajacy}</Text>
      ) : null}
      {wartosc ? <Text style={styles.ppWartosc}>{wartosc}</Text> : null}
      {flagi.length ? (
        <View style={styles.ppFlagiRzad}>
          {flagi.map((f) => (
            <Text key={f.klucz} style={styles.ppFlaga}>{f.etykieta}</Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.ppZrodlo}>{etykietaZrodla(ogloszenie.zrodlo)}</Text>
    </Pressable>
  );
}

export default function MatchFeedScreen({ navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleFeedu);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dociaganie, setDociaganie] = useState(false);
  const [kursor, setKursor] = useState(null); // `next_before` z ostatniej strony
  const [error, setError] = useState(null);
  const [prog, setProg] = useState(0);
  const [sort, setSort] = useState('trafnosc');
  const [szukaj, setSzukaj] = useState('');
  const [malaFirma, setMalaFirma] = useState(false); // filtr „dla małej firmy" (R19)
  const [woj, setWoj] = useState(''); // filtr województwa (kod TERYT; '' = wszystkie)
  const [statusTerminu, setStatusTerminu] = useState(STATUS_TERMINU_DOMYSLNY); // Aktywne / Po terminie
  // Zachęta do Standard oparta na realnych liczbach (D-055 — FOMO na Free).
  const [zacheta, setZacheta] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  // Radar zamówień podprogowych (panel 7/7): scalony strumień „obok" dużych przetargów.
  // `null` = jeszcze nie wiadomo, czy user ma ustawiony radar (band się nie miga).
  const [podprogowe, setPodprogowe] = useState([]);
  const [podprogowePrefs, setPodprogowePrefs] = useState(null);

  // Próg filtra i sortowanie przeżywają restart aplikacji.
  useEffect(() => {
    let aktywny = true;
    Promise.all([storage.getItem(KLUCZ_PROGU), storage.getItem(KLUCZ_SORT), storage.getItem(KLUCZ_STATUS_TERMINU)])
      .then(([p, s, st]) => {
        if (!aktywny) return;
        setProg(normalizujProg(p));
        setSort(normalizujSort(s));
        setStatusTerminu(normalizujStatusTerminu(st));
      })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  const zmienProg = useCallback((nowy) => {
    setProg(nowy);
    storage.setItem(KLUCZ_PROGU, String(nowy)).catch(() => {});
  }, []);

  const zmienSort = useCallback((nowy) => {
    setSort(nowy);
    storage.setItem(KLUCZ_SORT, nowy).catch(() => {});
  }, []);

  const zmienStatusTerminu = useCallback((nowy) => {
    setStatusTerminu(nowy);
    storage.setItem(KLUCZ_STATUS_TERMINU, nowy).catch(() => {});
  }, []);

  // Pipeline: próg → tekst → sortowanie. Wszystko po stronie aplikacji na
  // wczytanych dopasowaniach (feed jednego użytkownika jest mały).
  // Województwa OBECNE w feedzie — filtr pokazujemy tylko, gdy jest z czego wybierać.
  const regiony = useMemo(() => wojewodztwaObecne(matches), [matches]);

  const widoczne = useMemo(() => {
    // Najpierw status terminu (Aktywne domyślnie chowa przeterminowane) — reszta filtrów
    // i grupowanie działają już na wybranej „zakładce".
    const poStatusie = filtrujStatusTerminu(matches, statusTerminu);
    const poProgu = filtrujPoProgu(poStatusie, prog);
    const poMalej = filtrujMalaFirma(poProgu, malaFirma);
    const poTekscie = filtrujTekst(poMalej, szukaj);
    const poWoj = filtrujWojewodztwo(poTekscie, woj);
    return sortujDopasowania(poWoj, sort);
  }, [matches, prog, szukaj, sort, malaFirma, woj, statusTerminu]);

  // Licznik przeterminowanych (z pełnej listy) — pokazujemy na zakładce „Po terminie".
  const liczbaPoTerminie = useMemo(() => policzPoTerminie(matches), [matches]);

  // „Nowe od ostatniej wizyty" — bazę (poprzednią wizytę) łapiemy RAZ na wejście do
  // apki i od razu zapisujemy nowy znacznik, żeby kolejne otwarcie wyzerowało badge.
  const [wizytaBazowa, setWizytaBazowa] = useState(0);
  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_OSTATNIA_WIZYTA)
      .then((v) => {
        const ms = Number(v);
        if (aktywny) setWizytaBazowa(Number.isFinite(ms) ? ms : 0);
        storage.setItem(KLUCZ_OSTATNIA_WIZYTA, String(Date.now())).catch(() => {});
      })
      .catch(() => {});
    return () => { aktywny = false; };
  }, []);

  // Grupowanie po dniu DODANIA do aplikacji (created_at) — sekcje od najnowszego dnia.
  const sekcje = useMemo(
    () => grupujPoDniach(widoczne, Date.now(), wizytaBazowa),
    [widoczne, wizytaBazowa],
  );
  const noweLacznie = useMemo(() => policzNowe(widoczne, wizytaBazowa), [widoczne, wizytaBazowa]);

  // Scalony strumień podprogowy — „łatwiejszy start" na górze (reguła w lib/podprogowe.js).
  const podprogoweWidoczne = useMemo(() => sortujPodprogowe(podprogowe), [podprogowe]);

  /**
   * Wczytuje pierwszą stronę.
   *
   * Błąd sieci NIE kasuje tego, co użytkownik już widzi (audyt 2026-07-10):
   * dawniej powrót na ekran w metrze albo nieudane pociągnięcie w dół wymazywało
   * całą listę i pokazywało pełnoekranowy błąd. Pełnoekranowy komunikat jest
   * uzasadniony tylko wtedy, gdy nie mamy CZEGO pokazać.
   */
  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try {
      // Większa pierwsza strona (50 = maks backendu), żeby sortowanie i szukanie
      // objęły cały feed użytkownika bez „dociągnij" — jest go zwykle < 50.
      const data = await api.getMatches({ limit: 50 });
      setMatches(data.matches || []);
      setKursor(data.next_before ?? null);
      setError(null);
      // Statystyki poboczne — nie mogą wywalić feedu, gdy padną.
      api.getStatystyki().then((s) => setZacheta(s.zacheta)).catch(() => {});
      // Radar podprogowy — poboczny strumień; błąd NIE może wywalić głównego feedu.
      // Zbieramy ogłoszenia dla PIERWSZEJ (nadrzędnej) preferencji użytkownika; resztą
      // obszarów zarządza ekran ustawień. Bez preferencji band pokazuje zaproszenie.
      api.podprogowePreferencje()
        .then(async ({ preferencje }) => {
          const lista = Array.isArray(preferencje) ? preferencje : [];
          setPodprogowePrefs(lista);
          const primary = lista[0];
          if (!primary) { setPodprogowe([]); return; }
          const { ogloszenia } = await api.podprogoweOgloszenia({
            branza: primary.branza,
            region: primary.region,
            prog: primary.prog_netto,
            limit: 20,
          });
          setPodprogowe(Array.isArray(ogloszenia) ? ogloszenia : []);
        })
        .catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  async function przejdzNaStandard() {
    setUpgrading(true);
    try {
      const { url } = await api.createUpgradeLink();
      await WebBrowser.openBrowserAsync(url);
    } catch {
      /* brak linku — cicho, baner zostaje */
    } finally {
      setUpgrading(false);
    }
  }

  /**
   * Dociąga kolejną stronę. Bez tego feed kończył się na pierwszej porcji, a starsze
   * dopasowania były nieosiągalne — po miesiącu korzystania znikała większość historii.
   */
  const dociagnijWiecej = useCallback(async () => {
    if (!kursor || dociaganie || refreshing) return;
    setDociaganie(true);
    try {
      const data = await api.getMatches({ before: kursor });
      setMatches((poprzednie) => [...poprzednie, ...(data.matches || [])]);
      setKursor(data.next_before ?? null);
    } catch {
      // Błąd dociągania nie może wywalić już wyświetlonej listy — próba przy kolejnym przewinięciu.
    } finally {
      setDociaganie(false);
    }
  }, [kursor, dociaganie, refreshing]);

  // Odświeżenie listy przy każdym wejściu na ekran.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerAkcje}>
          <Pressable
            onPress={() => navigation.navigate('Narzedzia')}
            hitSlop={12}
            accessibilityLabel="Wszystkie narzędzia"
          >
            <Text style={styles.headerBtn}>Narzędzia</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Saved')} hitSlop={12} accessibilityLabel="Zapisane przetargi">
            <Text style={styles.headerGwiazdka}>★</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Account')} hitSlop={12}>
            <Text style={styles.headerBtn}>Konto</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, styles]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={kolory.blue} />
      </View>
    );
  }

  // Pełnoekranowy błąd TYLKO wtedy, gdy nie mamy nic do pokazania.
  if (error && !matches.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Nie udało się wczytać przetargów</Text>
        <Text style={styles.text}>{error}</Text>
        <Button
          title="Spróbuj ponownie"
          variant="ghost"
          onPress={() => { setLoading(true); load(); }}
          style={styles.retry}
        />
      </View>
    );
  }

  return (
    <SectionList
      sections={sekcje}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={widoczne.length ? styles.list : styles.listEmpty}
      renderSectionHeader={({ section }) => (
        <View style={styles.sekcjaNaglowek}>
          <Text style={styles.sekcjaTytul}>{section.tytul}</Text>
          {section.nowe > 0 ? (
            <Text style={styles.sekcjaNowe}>{section.nowe} nowe</Text>
          ) : null}
        </View>
      )}
      ListHeaderComponent={
        <View>
          {/* Baner „nowe od ostatniej wizyty" — to jest „powiadomienie" wewnątrz apki. */}
          {noweLacznie > 0 ? (
            <View style={styles.noweBaner}>
              <Text style={styles.noweBanerKropka}>●</Text>
              <Text style={styles.noweBanerTekst}>
                {noweLacznie === 1
                  ? '1 nowy przetarg od ostatniej wizyty'
                  : `${noweLacznie} nowych przetargów od ostatniej wizyty`}
              </Text>
            </View>
          ) : null}

          {/* Zachęta do Standard oparta na realnych liczbach (D-055 — FOMO na Free). */}
          {zacheta?.pokaz ? (
            <Pressable style={styles.fomo} onPress={przejdzNaStandard} disabled={upgrading} accessibilityRole="button">
              <Text style={styles.fomoTytul}>{zacheta.tytul}</Text>
              <Text style={styles.fomoOpis}>{zacheta.opis}</Text>
              <Text style={styles.fomoCta}>{upgrading ? 'Otwieram…' : 'Przejdź na Standard — 49 zł/mc →'}</Text>
            </Pressable>
          ) : null}

          {/* ── Radar zamówień podprogowych (panel 7/7): „łatwiejszy start" OBOK dużych
              przetargów — zakupy poniżej progu Pzp z platform/BIP-ów/Bazy Konkurencyjności. ── */}
          {podprogowePrefs !== null ? (
            <View style={styles.ppBand}>
              <View style={styles.ppNaglowek}>
                <Text style={styles.ppTytulSekcji}>Łatwiejszy start</Text>
                <Pressable
                  onPress={() => navigation.navigate('PodprogoweUstawienia')}
                  hitSlop={10}
                  accessibilityLabel="Ustawienia radaru podprogowego"
                >
                  <Text style={styles.ppUstaw}>{podprogowePrefs.length ? 'Ustawienia' : 'Ustaw'}</Text>
                </Pressable>
              </View>

              {podprogowePrefs.length === 0 ? (
                <Pressable
                  style={styles.ppZaproszenie}
                  onPress={() => navigation.navigate('PodprogoweUstawienia')}
                  accessibilityRole="button"
                >
                  <Text style={styles.ppZaproszenieTytul}>Włącz radar zamówień podprogowych</Text>
                  <Text style={styles.ppZaproszenieOpis}>
                    Ustaw branżę i region, a pokażemy tu zakupy poniżej progu Pzp — zwykle bez
                    wadium i bez KIO, z prostszą procedurą. Idealne na łatwiejszy start.
                  </Text>
                </Pressable>
              ) : podprogoweWidoczne.length === 0 ? (
                <Text style={styles.ppPusto}>
                  Brak nowych zamówień podprogowych dla Twojego obszaru. Zajrzyj później albo
                  odśwież w ustawieniach.
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.ppLista}
                >
                  {podprogoweWidoczne.map((o) => (
                    <KartaPodprogowa
                      key={o.id}
                      ogloszenie={o}
                      styles={styles}
                      onPress={() => navigation.navigate('PodprogoweDetail', { ogloszenie: o })}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          ) : null}

          {/* Wyszukiwarka — po tytule i zamawiającym, z tolerancją odmian (D-051). */}
          <View style={styles.szukajRzad}>
            <Text style={styles.szukajIkona}>🔍</Text>
            <TextInput
              style={styles.szukajPole}
              value={szukaj}
              onChangeText={setSzukaj}
              placeholder="Szukaj po nazwie lub zamawiającym"
              placeholderTextColor={kolory.textMuted}
              autoCorrect={false}
              accessibilityLabel="Szukaj w przetargach"
            />
            {szukaj ? (
              <Pressable onPress={() => setSzukaj('')} hitSlop={10} accessibilityLabel="Wyczyść szukanie">
                <Text style={styles.szukajX}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Zakładka statusu terminu: Aktywne (domyślnie) / Po terminie. Odchudza feed z przeterminowanych. */}
          <View style={styles.progi} accessibilityRole="radiogroup">
            {STATUSY_TERMINU.map((opcja) => {
              const aktywny = statusTerminu === opcja.wartosc;
              const licznik = opcja.wartosc === 'poterminie' && liczbaPoTerminie > 0 ? ` (${liczbaPoTerminie})` : '';
              return (
                <Pressable
                  key={opcja.wartosc}
                  onPress={() => zmienStatusTerminu(opcja.wartosc)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.progChip, aktywny && styles.progChipAktywny]}
                >
                  <Text style={[styles.progTekst, aktywny && styles.progTekstAktywny]}>
                    {opcja.etykieta}{licznik}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Sortowanie — trwały wybór (D-051). */}
          <View style={styles.progi} accessibilityRole="radiogroup">
            {SORTOWANIA.map((opcja) => {
              const aktywny = sort === opcja.wartosc;
              return (
                <Pressable
                  key={opcja.wartosc}
                  onPress={() => zmienSort(opcja.wartosc)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.progChip, aktywny && styles.progChipAktywny]}
                >
                  <Text style={[styles.progTekst, aktywny && styles.progTekstAktywny]}>{opcja.etykieta}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Filtr minimalnego dopasowania — trwały wybór usera (D-047). */}
          <View style={styles.progi} accessibilityRole="radiogroup">
            {PROGI.map((opcja) => {
              const aktywny = prog === opcja.wartosc;
              return (
                <Pressable
                  key={opcja.wartosc}
                  onPress={() => zmienProg(opcja.wartosc)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: aktywny }}
                  style={[styles.progChip, aktywny && styles.progChipAktywny]}
                >
                  <Text style={[styles.progTekst, aktywny && styles.progTekstAktywny]}>
                    {opcja.etykieta}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Filtr „dla małej firmy" (R19) — chowa przetargi z dużym wadium. */}
          <Pressable
            onPress={() => setMalaFirma((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: malaFirma }}
            style={[styles.malaChip, malaFirma && styles.malaChipAktywny]}
          >
            <Text style={[styles.malaTekst, malaFirma && styles.malaTekstAktywny]}>
              {malaFirma ? '✓ ' : ''}Dla małej firmy (bez dużego wadium)
            </Text>
          </Pressable>
          {/* Filtr województwa — tylko gdy w feedzie SĄ dane regionu (co najmniej 2). */}
          {regiony.length >= 2 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wojRzad}>
              <Pressable
                onPress={() => setWoj('')}
                accessibilityRole="radio"
                accessibilityState={{ selected: !woj }}
                style={[styles.wojChip, !woj && styles.wojChipOn]}
              >
                <Text style={[styles.wojTekst, !woj && styles.wojTekstOn]}>Wszystkie województwa</Text>
              </Pressable>
              {regiony.map((kod) => {
                const on = woj === kod;
                return (
                  <Pressable
                    key={kod}
                    onPress={() => setWoj(kod)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.wojChip, on && styles.wojChipOn]}
                  >
                    <Text style={[styles.wojTekst, on && styles.wojTekstOn]}>{WOJEWODZTWA[kod]}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {/* Licznik wyników (R14) — ile widać po filtrach; z podpowiedzią, gdy filtr zawęża. */}
          {widoczne.length > 0 ? (
            <Text style={styles.licznik}>
              {widoczne.length === matches.length
                ? `${widoczne.length} ${widoczne.length === 1 ? 'przetarg' : 'przetargów'}`
                : `${widoczne.length} z ${matches.length} przetargów`}
            </Text>
          ) : null}
          {/*
            Mamy starsze dane, ale odświeżenie się nie powiodło — mówimy o tym
            wprost, zamiast udawać, że lista jest aktualna.
          */}
          {error ? (
            <Pressable style={styles.pasekBledu} onPress={() => load('refresh')}>
              <Text style={styles.pasekBleduTekst}>
                Nie udało się odświeżyć. Pokazujemy ostatnio pobrane przetargi. Dotknij, aby spróbować ponownie.
              </Text>
            </Pressable>
          ) : null}
          {matches.length > 0 && widoczne.length === 0 ? (
            <Text style={styles.pustyFiltr}>
              {statusTerminu === 'poterminie' && liczbaPoTerminie === 0
                ? 'Brak przetargów po terminie. Wróć do „Aktywne".'
                : szukaj
                  ? `Brak wyników dla „${szukaj}". Wyczyść szukanie lub zmień frazę.`
                  : woj
                    ? `Brak przetargów z województwa „${WOJEWODZTWA[woj]}" w bieżącym feedzie. Wybierz „Wszystkie województwa".`
                    : statusTerminu === 'aktywne'
                      ? `Wszystkie ${matches.length} dopasowań ma już po terminie — zajrzyj do zakładki „Po terminie".`
                      : `Żadne z ${matches.length} dopasowań nie ma ${prog}%+ — obniż próg, aby je zobaczyć.`}
            </Text>
          ) : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={kolory.blue}
          colors={[kolory.blue]}
        />
      }
      renderItem={({ item }) => (
        <MatchCard
          match={item}
          nowe={czyNowe(item, wizytaBazowa)}
          onPress={() => navigation.navigate('MatchDetail', { match: item })}
        />
      )}
      onEndReached={dociagnijWiecej}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        dociaganie ? (
          <View style={styles.stopka}>
            <ActivityIndicator color={kolory.blue} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        // Pustka od FILTRA ma własny komunikat w nagłówku — ten ekran jest
        // wyłącznie dla faktycznie pustego konta.
        matches.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.title}>Brak dopasowanych przetargów</Text>
            <Text style={styles.text}>
              Gdy pojawią się nowe przetargi pasujące do profilu Twojej firmy,
              zobaczysz je tutaj. Sprawdź w zakładce „Konto”, czy profil ma
              ustawione słowa kluczowe.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

const tworzStyleFeedu = tworzStyle((k) => ({
  noweBaner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: k.wyroznienie,
    borderWidth: 1,
    borderColor: k.blue,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  noweBanerKropka: { color: k.blue, fontSize: 12 },
  noweBanerTekst: { flex: 1, color: k.blue, fontSize: 14, fontWeight: '800' },
  sekcjaNaglowek: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: k.bg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  sekcjaTytul: { fontSize: 15, fontWeight: '800', color: k.text },
  sekcjaNowe: {
    fontSize: 11,
    fontWeight: '800',
    color: k.white,
    backgroundColor: k.blue,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fomo: {
    backgroundColor: k.blue,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  fomoTytul: { fontSize: 16, fontWeight: '800', color: k.surface },
  fomoOpis: { fontSize: 13, color: k.surface, opacity: 0.92, lineHeight: 18 },
  fomoCta: { fontSize: 14, fontWeight: '800', color: k.surface, marginTop: 6 },

  // ── Band radaru podprogowego („łatwiejszy start") ──
  ppBand: { marginBottom: spacing.md },
  ppNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  ppTytulSekcji: { fontSize: 15, fontWeight: '800', color: k.text },
  ppUstaw: { fontSize: 13, fontWeight: '700', color: k.blue },
  ppZaproszenie: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    gap: 4,
  },
  ppZaproszenieTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  ppZaproszenieOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  ppPusto: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  ppLista: { gap: spacing.sm, paddingRight: spacing.xs },
  ppKarta: {
    width: 250,
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    gap: 4,
  },
  ppBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '800',
    color: k.sukcesAkcent,
    backgroundColor: k.sukcesTlo,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: 2,
  },
  ppTytul: { fontSize: 14, fontWeight: '700', color: k.text, lineHeight: 19 },
  ppZamawiajacy: { fontSize: 12, color: k.textMuted },
  ppWartosc: { fontSize: 13, fontWeight: '700', color: k.text, marginTop: 2 },
  ppFlagiRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  ppFlaga: {
    fontSize: 10,
    fontWeight: '700',
    color: k.blue,
    backgroundColor: k.wyroznienie,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  ppZrodlo: { fontSize: 11, color: k.textMuted, marginTop: 4 },
  szukajRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: k.surface, borderWidth: 1.5, borderColor: k.border,
    borderRadius: radius.md, paddingHorizontal: 12, marginBottom: spacing.sm,
  },
  szukajIkona: { fontSize: 15 },
  szukajPole: { flex: 1, paddingVertical: 11, fontSize: 15, color: k.text },
  szukajX: { color: k.textMuted, fontSize: 16, fontWeight: '700', paddingHorizontal: 2 },
  malaChip: {
    alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, marginBottom: spacing.sm,
  },
  malaChipAktywny: { backgroundColor: k.blue, borderColor: k.blue },
  malaTekst: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  malaTekstAktywny: { color: k.surface },
  wojRzad: { gap: spacing.sm, paddingRight: spacing.xs, marginBottom: spacing.sm },
  wojChip: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1.5, borderColor: k.border, backgroundColor: k.surface,
  },
  wojChipOn: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  wojTekst: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  wojTekstOn: { color: k.blue },
  licznik: { fontSize: 13, color: k.textMuted, fontWeight: '700', marginBottom: spacing.sm },
  progi: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  progChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: k.border,
    backgroundColor: k.surface,
    alignItems: 'center',
  },
  progChipAktywny: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  progTekst: { fontSize: 13, fontWeight: '600', color: k.textMuted },
  progTekstAktywny: { color: k.blue },
  pustyFiltr: {
    color: k.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  pasekBledu: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pasekBleduTekst: { color: k.ostrzezenieTekst, fontSize: 13, lineHeight: 18 },
  stopka: { paddingVertical: spacing.lg },
  headerAkcje: { flexDirection: 'row', alignItems: 'center', gap: 18, marginRight: 16 },
  headerGwiazdka: { color: k.white, fontSize: 22, lineHeight: 24, fontWeight: '700' },
  headerBtn: { color: k.white, fontWeight: '700', fontSize: 15 },
  list: { padding: spacing.lg },
  listEmpty: { flexGrow: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: { fontSize: 44, marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: k.text, textAlign: 'center' },
  text: {
    fontSize: 14,
    color: k.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  retry: { marginTop: spacing.lg, alignSelf: 'stretch' },
}));
