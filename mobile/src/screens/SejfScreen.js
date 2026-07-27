import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { opisStatusu, etykietaLicznika, sortujDokumenty } from '../lib/sejf';

/**
 * Panel „SEJF DOKUMENTÓW FIRMY" — podzadanie 7/7 ulepszenia „Sejf podmiotowych środków
 * dowodowych z licznikiem świeżości".
 *
 * Podręczny sejf firmy: KRK, niezaleganie US/ZUS, polisa OC, wpis do rejestru, wykaz
 * robót, uprawnienia. Przy każdym dokumencie widać licznik dni ważności i status
 * (gotowy do użycia / zamów nowy / przeterminowany) oraz link „gdzie wyrobić online".
 * Można wgrać ORYGINAŁ elektroniczny (XML / podpisany PDF) — backend wykrywa format i
 * podpis, a przy skanie papieru ostrzega (w zamówieniach publicznych to realny błąd).
 *
 * Ekran NIC nie liczy — świeżość, status i licznik przychodzą gotowe z backendu
 * (`/api/przetarg/sejf/*`), a reguły „status/licznik → słowo" i kolejność listy żyją w
 * testowanym `lib/sejf.js`. Kolory wyłącznie z tokenów motyw.js (sukcesAkcent i spółka,
 * kontrast AA); ton badge'a wybiera lib, a token dokłada tu `tokenyTonu`.
 */

/** Semantyczny ton statusu (z lib/sejf) → para tokenów motyw.js (tło + tekst), AA. */
function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

async function otworzLink(url) {
  if (!url) return;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    /* nie udało się otworzyć przeglądarki — nic nie robimy */
  }
}

/**
 * Odczyt wybranego pliku do base64 bez dokładania natywnego expo-file-system:
 * fetch(file://) → Blob → FileReader.readAsDataURL (RN ma oba). Zdejmujemy prefiks
 * „data:...;base64," — backend oczekuje samej treści base64.
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

/** Badge statusu (słowo z lib/sejf + kolor z tokenów). */
function BadgeStatusu({ status, styles, kolory }) {
  const { etykieta, ton } = opisStatusu(status);
  const t = tokenyTonu(ton, kolory);
  return (
    <Text style={[styles.badge, { backgroundColor: t.tlo, color: t.tekst }]}>{etykieta}</Text>
  );
}

export default function SejfScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSejfu);

  const [katalog, setKatalog] = useState(null);
  const [dokumenty, setDokumenty] = useState(null);
  const [blad, setBlad] = useState(null);

  // Formularz dodawania.
  const [typ, setTyp] = useState('');
  const [dataWyst, setDataWyst] = useState('');
  const [notatka, setNotatka] = useState('');
  const [dodaje, setDodaje] = useState(false);

  const [uploadId, setUploadId] = useState(null); // dokument aktualnie wgrywany
  const [usuwaneId, setUsuwaneId] = useState(null);

  const wczytaj = useCallback(async () => {
    setBlad(null);
    try {
      const [k, d] = await Promise.all([api.sejfKatalog(), api.sejfDokumenty()]);
      setKatalog(Array.isArray(k?.typy) ? k.typy : []);
      setDokumenty(Array.isArray(d?.dokumenty) ? d.dokumenty : []);
    } catch (err) {
      setBlad(err.message);
      setKatalog((prev) => prev ?? []);
      setDokumenty((prev) => prev ?? []);
    }
  }, []);

  useFocusEffect(useCallback(() => { wczytaj(); }, [wczytaj]));

  const typWybrany = katalog?.find((t) => t.id === typ) ?? null;

  async function dodaj() {
    if (!typ || dodaje) return;
    setDodaje(true);
    setBlad(null);
    try {
      const payload = { typ };
      if (dataWyst.trim()) payload.data_wystawienia = dataWyst.trim();
      if (notatka.trim()) payload.notatka = notatka.trim();
      await api.sejfDodaj(payload);
      setTyp('');
      setDataWyst('');
      setNotatka('');
      await wczytaj();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setDodaje(false);
    }
  }

  async function wgrajPlik(dok) {
    if (uploadId) return;
    let wybor;
    try {
      wybor = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    } catch {
      Alert.alert('Nie udało się otworzyć wyboru pliku', 'Spróbuj ponownie.');
      return;
    }
    if (wybor.canceled || !wybor.assets?.length) return;
    const plik = wybor.assets[0];

    setUploadId(dok.id);
    setBlad(null);
    try {
      const plik_base64 = await czytajBase64(plik.uri);
      const wynik = await api.sejfWgrajPlik(dok.id, { plik_base64, nazwa_pliku: plik.name });
      await wczytaj();
      if (wynik.ostrzezenie) {
        // Skan papieru zamiast oryginału elektronicznego — pokaż to WPROST (backend
        // przyjął plik, ale flaga podpisu = false; w zamówieniach publicznych to błąd).
        Alert.alert('Wgrano — ale sprawdź', wynik.ostrzezenie);
      }
    } catch (err) {
      Alert.alert('Nie udało się wgrać pliku', err.message);
    } finally {
      setUploadId(null);
    }
  }

  function potwierdzUsuniecie(dok) {
    Alert.alert(
      'Usunąć dokument?',
      `${dok.nazwaTypu} zniknie z sejfu. Tej operacji nie da się cofnąć.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => usun(dok) },
      ],
    );
  }

  async function usun(dok) {
    if (usuwaneId) return;
    setUsuwaneId(dok.id);
    setBlad(null);
    try {
      await api.sejfUsun(dok.id);
      await wczytaj();
    } catch (err) {
      setBlad(err.message);
    } finally {
      setUsuwaneId(null);
    }
  }

  const uporzadkowane = sortujDokumenty(dokumenty ?? []);

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Trzymaj tu podmiotowe środki dowodowe firmy z licznikiem świeżości. Alert
        przychodzi z wyprzedzeniem uwzględniającym realny czas urzędu — KRK pocztą
        potrafi iść tygodniami, więc przypominamy odpowiednio wcześniej. Elektroniczne
        zaświadczenia trzymaj w oryginale (XML / podpisany PDF), nie jako skan papieru.
      </Text>

      {/* ── Dodawanie dokumentu ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Dodaj dokument</Text>
        {katalog === null ? (
          <ActivityIndicator color={kolory.blue} style={styles.spinner} />
        ) : (
          <>
            <View style={styles.typyRzad}>
              {katalog.map((t) => {
                const aktywny = t.id === typ;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setTyp(aktywny ? '' : t.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: aktywny }}
                    style={[styles.typChip, aktywny && styles.typChipAktywny]}
                  >
                    <Text style={[styles.typChipTekst, aktywny && styles.typChipTekstAktywny]}>
                      {t.nazwa}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {typWybrany ? (
              <>
                <Text style={styles.typOpis}>{typWybrany.opis}</Text>
                <TextField
                  label="Data wystawienia"
                  value={dataWyst}
                  onChangeText={setDataWyst}
                  placeholder="RRRR-MM-DD"
                  hint={
                    typWybrany.okresWaznosciDniDomyslny
                      ? `Ważność liczymy od tej daty (domyślnie ${typWybrany.okresWaznosciDniDomyslny} dni). Zostaw puste, jeśli jeszcze nie masz.`
                      : 'Ten dokument jest bezterminowy — datę możesz zostawić pustą.'
                  }
                  autoCapitalize="none"
                />
                <TextField
                  label="Notatka (opcjonalnie)"
                  value={notatka}
                  onChangeText={setNotatka}
                  placeholder="np. wersja elektroniczna z e-KRK z 2026 r."
                />
                {typWybrany.online ? (
                  <Pressable onPress={() => otworzLink(typWybrany.online.url)} hitSlop={8} accessibilityRole="link">
                    <Text style={styles.online}>Gdzie wyrobić online: {typWybrany.online.nazwa} →</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Text style={styles.typPodpowiedz}>Wybierz typ dokumentu, żeby go dodać.</Text>
            )}

            <Button
              title="Dodaj do sejfu"
              onPress={dodaj}
              loading={dodaje}
              disabled={!typ}
              style={styles.gap}
            />
          </>
        )}
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      {/* ── Lista dokumentów ── */}
      <Text style={styles.sekcjaTytul}>Twoje dokumenty</Text>
      {dokumenty === null ? (
        <ActivityIndicator color={kolory.blue} style={styles.spinner} />
      ) : uporzadkowane.length === 0 ? (
        <Text style={styles.pusto}>Sejf jest pusty. Dodaj pierwszy dokument powyżej.</Text>
      ) : (
        uporzadkowane.map((dok) => {
          const maPlik = !!dok.plik_url;
          const wgrywam = uploadId === dok.id;
          return (
            <View key={dok.id} style={styles.dok}>
              <View style={styles.dokNaglowek}>
                <Text style={styles.dokNazwa}>{dok.nazwaTypu}</Text>
                <BadgeStatusu status={dok.status} styles={styles} kolory={kolory} />
              </View>

              <Text style={styles.dokLicznik}>{etykietaLicznika(dok)}</Text>
              <Text style={styles.dokMeta}>
                {dok.data_wystawienia
                  ? `Wystawiono: ${formatDate(dok.data_wystawienia)}`
                  : 'Brak daty wystawienia'}
                {dok.dataWaznosci ? `  ·  ważny do ${formatDate(dok.dataWaznosci)}` : ''}
              </Text>
              {dok.notatka ? <Text style={styles.dokNotatka}>{dok.notatka}</Text> : null}

              {/* Oryginał elektroniczny: format + podpis / ostrzeżenie o skanie. */}
              <View style={styles.plikRzad}>
                {maPlik ? (
                  <Text
                    style={[
                      styles.plikStan,
                      dok.flaga_podpis_elektroniczny ? styles.plikOk : styles.plikOstrzezenie,
                    ]}
                  >
                    {dok.plik_format ? `${dok.plik_format.toUpperCase()} · ` : ''}
                    {dok.flaga_podpis_elektroniczny
                      ? 'oryginał z podpisem ✓'
                      : 'bez wykrytego podpisu — sprawdź, czy to nie skan'}
                  </Text>
                ) : (
                  <Text style={styles.plikBrak}>
                    Brak oryginału{dok.wymagaDokumentuElektronicznego ? ' — wymagany elektroniczny (XML/PDF)' : ''}
                  </Text>
                )}
              </View>

              <View style={styles.dokAkcje}>
                <Button
                  title={maPlik ? 'Podmień oryginał' : 'Wgraj oryginał (XML/PDF)'}
                  variant="ghost"
                  onPress={() => wgrajPlik(dok)}
                  loading={wgrywam}
                  style={styles.dokBtn}
                />
                {dok.online ? (
                  <Pressable onPress={() => otworzLink(dok.online.url)} hitSlop={8} accessibilityRole="link">
                    <Text style={styles.dokLink}>{dok.online.nazwa} →</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => potwierdzUsuniecie(dok)}
                  disabled={usuwaneId === dok.id}
                  hitSlop={10}
                  accessibilityLabel="Usuń dokument"
                >
                  {usuwaneId === dok.id ? (
                    <ActivityIndicator color={kolory.danger} />
                  ) : (
                    <Text style={styles.dokUsun}>Usuń</Text>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      <Text style={styles.stopka}>
        Licznik świeżości jest pomocniczy — wiążące są zawsze wymagania konkretnego SWZ i
        data ważności na samym dokumencie. Sejf nie wysyła dokumentów do zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleSejfu = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  spinner: { marginVertical: spacing.md },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.md },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.md },
  typyRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  typChip: {
    borderWidth: 1.5,
    borderColor: k.border,
    backgroundColor: k.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  typChipAktywny: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  typChipTekst: { fontSize: 12, fontWeight: '600', color: k.textMuted },
  typChipTekstAktywny: { color: k.blue },
  typOpis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginBottom: spacing.md },
  typPodpowiedz: { fontSize: 13, color: k.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },
  online: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: 2 },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  dok: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  dokNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  dokNazwa: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  badge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  dokLicznik: { fontSize: 14, fontWeight: '700', color: k.text, marginTop: spacing.sm },
  dokMeta: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  dokNotatka: { fontSize: 13, color: k.textMuted, marginTop: spacing.xs, fontStyle: 'italic', lineHeight: 18 },

  plikRzad: { marginTop: spacing.sm },
  plikStan: { fontSize: 12, fontWeight: '700' },
  plikOk: { color: k.sukcesAkcent },
  plikOstrzezenie: { color: k.ostrzezenieAkcent },
  plikBrak: { fontSize: 12, color: k.textMuted, fontStyle: 'italic' },

  dokAkcje: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  dokBtn: { flex: 1 },
  dokLink: { fontSize: 13, fontWeight: '700', color: k.blue },
  dokUsun: { fontSize: 14, fontWeight: '700', color: k.danger },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
