import { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  KROKI_REJESTRATORA,
  odliczanieBezpieczenstwa,
  TYPY_AWARII,
  opisAwarii,
  opisDowodu,
  formatZnacznik,
} from '../lib/czarnaSkrzynka';

/**
 * Panel „REJESTRATOR OFERTY" — podzadanie 7/7 ulepszenia „Czarna skrzynka składania oferty
 * — dowody na awarię platformy".
 *
 * Prowadzi JEDNĄ próbę złożenia oferty jak rejestrator lotu: przewodnik krok po kroku,
 * odliczanie „czasu bezpieczeństwa" z rekomendacją złożenia 24 h przed terminem, przycisk
 * „Zgłoś awarię → pakiet + pismo" oraz lista utrwalonych dowodów ze znacznikami czasu.
 * Jeśli platforma zawiedzie, jeden krok składa tamper-evident pakiet dowodowy i gotowe
 * pismo o przedłużenie terminu (do wysłania PRZED upływem terminu — po nim czynności nie
 * da się powtórzyć; ciężar udowodnienia awarii spoczywa na wykonawcy — linia KIO).
 *
 * Ekran NIC nie liczy z reguł biznesowych — kolejność kroków, progi czasu bezpieczeństwa
 * i etykiety statusów żyją w testowanym `lib/czarnaSkrzynka.js`, a append-only taśma,
 * suma kontrolna oferty, pakiet i pismo powstają na backendzie (`/api/przetarg/czarna-
 * skrzynka/*`). Kolory wyłącznie z tokenów motyw.js (kontrast AA); lib podaje semantyczny
 * `ton`, a token dokłada tu `tokenyTonu`.
 */

/** Semantyczny ton (z lib) → para tokenów motyw.js (tło + tekst), AA. Jak w SejfScreen. */
function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

/**
 * Odczyt wybranego pliku do base64 bez natywnego expo-file-system:
 * fetch(file://) → Blob → FileReader.readAsDataURL. Zdejmujemy prefiks „data:...;base64,".
 * (Ten sam wzorzec co w SejfScreen.)
 */
async function czytajBase64(uri) {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nie udało się odczytać wybranego pliku.'));
    reader.onload = () => {
      const wynik = String(reader.result || '');
      const przecinek = wynik.indexOf(',');
      resolve(przecinek >= 0 ? wynik.slice(przecinek + 1) : wynik);
    };
    reader.readAsDataURL(blob);
  });
}

/** Badge tonu (słowo z lib + kolor z tokenów). */
function Badge({ etykieta, ton, styles, kolory }) {
  const t = tokenyTonu(ton, kolory);
  return <Text style={[styles.badge, { backgroundColor: t.tlo, color: t.tekst }]}>{etykieta}</Text>;
}

export default function RejestratorOfertyScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleRejestratora);

  const params = route?.params ?? {};
  const termin = params.termin ?? null;
  const nazwa = params.nazwa ?? null;
  const postepowanieId = params.postepowanieId ?? null;

  const [sesja, setSesja] = useState(null); // { id, ... }
  const [zdarzenia, setZdarzenia] = useState([]);
  const [blad, setBlad] = useState(null);
  const [startuje, setStartuje] = useState(false);
  const [zajete, setZajete] = useState(null); // id kroku aktualnie wykonywanego
  const [awaria, setAwaria] = useState(null); // { awaria, pakiet, pismo }
  const [awariaBusy, setAwariaBusy] = useState(false);

  // Tykający zegar — odliczanie odświeża się bez akcji użytkownika (co 30 s wystarczy).
  const [teraz, setTeraz] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTeraz(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const odczyt = odliczanieBezpieczenstwa(termin, teraz);
  const tonCzasu = tokenyTonu(odczyt.ton, kolory);

  const odswiezSesje = useCallback(async (id) => {
    try {
      const data = await api.czarnaSkrzynkaSesja(id);
      setSesja(data.sesja ?? null);
      setZdarzenia(Array.isArray(data.zdarzenia) ? data.zdarzenia : []);
    } catch (err) {
      setBlad(err.message);
    }
  }, []);

  // Po powrocie na ekran odśwież taśmę aktywnej sesji (bez auto-startu nowej).
  useFocusEffect(useCallback(() => {
    if (sesja?.id) odswiezSesje(sesja.id);
  }, [sesja?.id, odswiezSesje]));

  async function rozpocznij() {
    if (startuje) return;
    setStartuje(true);
    setBlad(null);
    try {
      const data = await api.czarnaSkrzynkaRozpocznij(
        postepowanieId ? { postepowanie_id: String(postepowanieId) } : {},
      );
      setSesja(data.sesja ?? null);
      setZdarzenia([]);
      setAwaria(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setStartuje(false);
    }
  }

  /** Dopisuje zwykłe zdarzenie kroku (wysyłka/EPO) do append-only taśmy. */
  async function zapiszKrok(krok) {
    if (!sesja?.id || zajete) return;
    setZajete(krok.id);
    setBlad(null);
    try {
      await api.czarnaSkrzynkaZdarzenie(sesja.id, { typ: krok.typZdarzenie, opis: krok.tytul });
      await odswiezSesje(sesja.id);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setZajete(null);
    }
  }

  /** Krok z plikiem: oferta (suma kontrolna) albo zrzut ekranu. */
  async function wgrajKrok(krok) {
    if (!sesja?.id || zajete) return;
    let wybor;
    try {
      wybor = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: krok.id === 'zrzut' ? 'image/*' : '*/*',
      });
    } catch {
      Alert.alert('Nie udało się otworzyć wyboru pliku', 'Spróbuj ponownie.');
      return;
    }
    if (wybor.canceled || !wybor.assets?.length) return;
    const plik = wybor.assets[0];

    setZajete(krok.id);
    setBlad(null);
    try {
      const plik_base64 = await czytajBase64(plik.uri);
      if (krok.id === 'zrzut') {
        await api.czarnaSkrzynkaZrzut(sesja.id, { plik_base64, opis: 'Zrzut ekranu z widocznym zegarem' });
      } else {
        await api.czarnaSkrzynkaOferta(sesja.id, { plik_base64, nazwa_pliku: plik.name });
      }
      await odswiezSesje(sesja.id);
    } catch (err) {
      Alert.alert('Nie udało się utrwalić dowodu', err.message);
    } finally {
      setZajete(null);
    }
  }

  /** Panic button: loguje typ awarii, po czym backend składa pakiet + pismo w jednym kroku. */
  async function zglosAwarie(typ) {
    if (!sesja?.id || awariaBusy) return;
    setAwariaBusy(true);
    setBlad(null);
    try {
      // Najpierw utrwalamy fakt awarii na taśmie (to on jest wykrywany), potem pakiet+pismo.
      await api.czarnaSkrzynkaZdarzenie(sesja.id, { typ, opis: opisAwarii(typ).etykieta });
      const meta = {};
      if (nazwa) meta.przedmiot_zamowienia = String(nazwa);
      if (termin) meta.termin_skladania = String(termin);
      const wynik = await api.czarnaSkrzynkaAwaria(sesja.id, meta);
      setAwaria(wynik);
      await odswiezSesje(sesja.id);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setAwariaBusy(false);
    }
  }

  function potwierdzAwarie() {
    Alert.alert(
      'Zgłoś awarię platformy',
      'Wybierz, co zawiodło. Utrwalimy to na taśmie i od razu złożymy pakiet dowodowy oraz '
        + 'gotowe pismo o przedłużenie terminu.',
      [
        { text: 'Anuluj', style: 'cancel' },
        ...Object.keys(TYPY_AWARII).map((typ) => ({
          text: opisAwarii(typ).etykieta,
          onPress: () => zglosAwarie(typ),
        })),
      ],
    );
  }

  // Krok uznajemy za wykonany, gdy na taśmie jest wpis jego typu (oferta ↔ hash_oferty).
  const typyNaTasmie = new Set(zdarzenia.map((z) => z.typ));
  function krokWykonany(krok) {
    if (krok.id === 'oferta') return typyNaTasmie.has('hash_oferty') || typyNaTasmie.has('oferta');
    return typyNaTasmie.has(krok.typZdarzenie);
  }

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Rejestrator prowadzi jedną próbę złożenia oferty i utrwala dowody, które muszą
        obronić się przed KIO. Składaj ofertę z zapasem — standardowo rekomendujemy 24 h
        przed terminem, bo platforma potrafi zawieść w ostatniej godzinie, a po terminie
        czynności nie da się powtórzyć.
      </Text>

      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Odliczanie czasu bezpieczeństwa ── */}
      <View style={[styles.card, styles.czasCard, { borderColor: tonCzasu.tekst }]}>
        <View style={styles.czasNaglowek}>
          <Text style={styles.czasTytul}>Czas bezpieczeństwa</Text>
          <Badge etykieta={odczyt.etykietaStatusu} ton={odczyt.ton} styles={styles} kolory={kolory} />
        </View>
        {odczyt.odliczanie ? (
          <Text style={[styles.czasDuzy, { color: tonCzasu.tekst }]}>{odczyt.odliczanie}</Text>
        ) : null}
        <Text style={styles.czasKomunikat}>{odczyt.komunikat}</Text>
        <Text style={styles.czasRekomendacja}>{odczyt.rekomendacja}</Text>
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      {/* ── Start / przewodnik ── */}
      {!sesja ? (
        <View style={styles.card}>
          <Text style={styles.kartaTytul}>Rozpocznij rejestrator</Text>
          <Text style={styles.kartaOpis}>
            Od uruchomienia każdy krok zapisujemy na niezmiennej taśmie ze znacznikiem czasu
            z serwera. Włącz rejestrator, zanim zaczniesz wysyłać ofertę.
          </Text>
          <Button
            title="Rozpocznij rejestrator oferty"
            onPress={rozpocznij}
            loading={startuje}
            style={styles.gap}
          />
        </View>
      ) : (
        <>
          <Text style={styles.sekcjaTytul}>Przewodnik krok po kroku</Text>
          {KROKI_REJESTRATORA.map((krok, i) => {
            const zrobiony = krokWykonany(krok);
            const busy = zajete === krok.id;
            const zPlikiem = krok.id === 'oferta' || krok.id === 'zrzut';
            return (
              <View key={krok.id} style={styles.krok}>
                <View style={styles.krokNaglowek}>
                  <View style={[styles.krokNr, zrobiony && styles.krokNrOk]}>
                    <Text style={[styles.krokNrTekst, zrobiony && styles.krokNrTekstOk]}>
                      {zrobiony ? '✓' : String(i + 1)}
                    </Text>
                  </View>
                  <Text style={styles.krokTytul}>{krok.tytul}</Text>
                </View>
                <Text style={styles.krokOpis}>{krok.opis}</Text>
                <Button
                  title={
                    zPlikiem
                      ? (zrobiony ? 'Utrwal ponownie' : (krok.id === 'zrzut' ? 'Dodaj zrzut ekranu' : 'Wgraj plik oferty'))
                      : (zrobiony ? 'Zapisz ponownie' : 'Oznacz jako wykonane')
                  }
                  variant="ghost"
                  onPress={() => (zPlikiem ? wgrajKrok(krok) : zapiszKrok(krok))}
                  loading={busy}
                  style={styles.gap}
                />
              </View>
            );
          })}

          {/* ── Panic button ── */}
          <View style={[styles.card, styles.awariaCard]}>
            <Text style={styles.awariaTytul}>Platforma zawiodła?</Text>
            <Text style={styles.kartaOpis}>
              Zgłoś awarię jeszcze PRZED upływem terminu. Złożymy tamper-evident pakiet
              dowodowy i gotowe pismo o przedłużenie terminu do zamawiającego.
            </Text>
            <Button
              title="Zgłoś awarię → pakiet + pismo"
              variant="danger"
              onPress={potwierdzAwarie}
              loading={awariaBusy}
              style={styles.gap}
            />
          </View>

          {/* ── Wynik zgłoszenia awarii: pakiet + pismo ── */}
          {awaria ? (
            <View style={[styles.card, styles.wynikCard]}>
              <Text style={styles.kartaTytul}>Pakiet dowodowy i pismo</Text>
              {awaria.awaria?.typy?.length ? (
                <View style={styles.typyRzad}>
                  {awaria.awaria.typy.map((typ) => (
                    <Badge key={typ} etykieta={opisAwarii(typ).etykieta} ton="danger" styles={styles} kolory={kolory} />
                  ))}
                </View>
              ) : (
                <Text style={styles.kartaOpis}>
                  Nie wykryto jeszcze wpisu awarii na taśmie — pakiet zawiera dotychczasowe dowody.
                </Text>
              )}
              {awaria.pakiet?.sumaKontrolna ? (
                <Text style={styles.suma}>Suma kontrolna pakietu: {awaria.pakiet.sumaKontrolna.slice(0, 16)}…</Text>
              ) : null}
              {awaria.pismo?.kompletne === false && awaria.pismo?.braki?.length ? (
                <Text style={styles.braki}>
                  Uzupełnij w piśmie: {awaria.pismo.braki.join(', ')}
                </Text>
              ) : null}
              {awaria.pismo?.tresc ? (
                <View style={styles.pismoBox}>
                  <Text style={styles.pismoTekst} selectable>{awaria.pismo.tresc}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── Utrwalone dowody (taśma) ── */}
          <Text style={styles.sekcjaTytul}>Utrwalone dowody</Text>
          {zdarzenia.length === 0 ? (
            <Text style={styles.pusto}>
              Taśma jest pusta. Wykonaj kroki powyżej — każdy zapisze dowód ze znacznikiem czasu.
            </Text>
          ) : (
            zdarzenia.map((z) => {
              const opis = opisDowodu(z.typ);
              return (
                <View key={z.id} style={styles.dowod}>
                  <View style={styles.dowodNaglowek}>
                    <Badge etykieta={opis.etykieta} ton={opis.ton} styles={styles} kolory={kolory} />
                    <Text style={styles.dowodCzas}>{formatZnacznik(z.czas_serwera)}</Text>
                  </View>
                  {z.opis ? <Text style={styles.dowodOpis}>{z.opis}</Text> : null}
                </View>
              );
            })
          )}
        </>
      )}

      <Text style={styles.stopka}>
        Znaczniki czasu pochodzą z zegara serwera (taśma jest niezmienna). Rejestrator nie
        wysyła oferty ani pisma do zamawiającego — przygotowuje dowody i gotowe pismo, które
        wysyłasz samodzielnie przed upływem terminu.
      </Text>
    </Screen>
  );
}

const tworzStyleRejestratora = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.md },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.xs },
  kartaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },

  // Odliczanie
  czasCard: { borderWidth: 2 },
  czasNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  czasTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  czasDuzy: { fontSize: 26, fontWeight: '900', marginTop: spacing.sm, letterSpacing: 0.3 },
  czasKomunikat: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: spacing.sm },
  czasRekomendacja: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.xs, fontStyle: 'italic' },

  badge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  // Krok przewodnika
  krok: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  krokNaglowek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  krokNr: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: k.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  krokNrOk: { backgroundColor: k.sukcesTlo, borderColor: k.sukcesAkcent },
  krokNrTekst: { fontSize: 13, fontWeight: '800', color: k.textMuted },
  krokNrTekstOk: { color: k.sukcesAkcent },
  krokTytul: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  krokOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.sm },

  // Panic button
  awariaCard: { borderColor: k.danger },
  awariaTytul: { fontSize: 15, fontWeight: '800', color: k.danger, marginBottom: spacing.xs },

  // Wynik awarii
  wynikCard: { borderColor: k.border },
  typyRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.sm },
  suma: { fontSize: 12, color: k.textMuted, marginTop: spacing.xs },
  braki: { fontSize: 13, color: k.ostrzezenieAkcent, fontWeight: '700', marginTop: spacing.sm, lineHeight: 18 },
  pismoBox: {
    backgroundColor: k.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  pismoTekst: { fontSize: 12, color: k.text, lineHeight: 18 },

  // Dowód na taśmie
  dowod: {
    backgroundColor: k.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  dowodNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  dowodCzas: { fontSize: 12, color: k.textMuted, fontVariant: ['tabular-nums'] },
  dowodOpis: { fontSize: 13, color: k.text, lineHeight: 18, marginTop: spacing.xs },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
