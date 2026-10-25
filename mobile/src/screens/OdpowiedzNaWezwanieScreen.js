import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Share } from 'react-native';
import { udostepnijTekst } from '../lib/udostepnianie';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import PrzyciskWord from '../components/PrzyciskWord';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import {
  KLUCZ_DANYCH_WYKONAWCY,
  szablonDanychWykonawcy,
  daneZOgloszenia,
  generujOswiadczenieAktualnosci,
  generujOswiadczenieGrupaKapitalowa,
} from '../lib/dokumentyOferty';
import {
  RODZAJE_WEZWANIA,
  TYPOWE_DOKUMENTY,
  rozpoznajWezwanie,
  generujOdpowiedz,
  kontrolaPrzedWyslaniem,
  wczytajStanWezwania,
  zapiszStanWezwania,
} from '../lib/odpowiedzNaWezwanie';
import { useAuth } from '../context/AuthContext';
import { generujWykaz } from '../lib/wykazReferencji';
import { stanZalacznikowZSejfu } from '../lib/stanDokumentowWezwania';
import { api } from '../api/client';

const CHIP_WYKAZU = 'Wykaz robót / usług / dostaw z referencjami';
const CHIP_AKTUALNOSC = 'Oświadczenie o aktualności informacji z art. 125 ust. 1';
const CHIP_GRUPA = 'Oświadczenie o grupie kapitałowej (art. 108 ust. 1 pkt 5)';
const KLUCZ_BANKU = 'przetargai.bankReferencji';

/**
 * „ODPOWIEDŹ NA WEZWANIE W 1 KLIK" — wklejasz treść wezwania zamawiającego, aplikacja
 * rozpoznaje podstawę (art. 128 / 274 / 223 / 224), termin i znak pisma, a potem składa
 * pismo przewodnie z listą załączników gotowe do podpisu elektronicznego.
 *
 * Ekran jest CIENKI: rozpoznawanie, treść pisma i kontrola przed wysłaniem żyją
 * w `lib/odpowiedzNaWezwanie.js` (testowane bez renderera). Dane firmy bierze
 * z tego samego magazynu co „Dokumenty do oferty" — wpisane raz, służą wszędzie.
 */
function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function OdpowiedzNaWezwanieScreen({ route, navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleOdpowiedzi);
  const { user } = useAuth();
  const match = route?.params?.match ?? null;
  const przetarg = useMemo(() => {
    const z = daneZOgloszenia(match?.tender);
    return z.tytul ? z : { ...z, tytul: route?.params?.nazwa ?? null };
  }, [match, route]);

  const [wykonawca, setWykonawca] = useState(() => szablonDanychWykonawcy(user));
  const [tekstWezwania, setTekstWezwania] = useState('');
  const [rodzaj, setRodzaj] = useState('inne');
  const [znak, setZnak] = useState('');
  const [dataWezwania, setDataWezwania] = useState('');
  const [termin, setTermin] = useState(route?.params?.termin ?? '');
  const [godzina, setGodzina] = useState('');
  const [rozpoznano, setRozpoznano] = useState(false);
  const [dokumenty, setDokumenty] = useState(() => (route?.params?.dokumenty ?? []).map((d) => (typeof d === 'string' ? d : d?.nazwa)).filter(Boolean));
  const [nowyDokument, setNowyDokument] = useState('');
  const [wyjasnienie, setWyjasnienie] = useState('');
  const [udostepniono, setUdostepniono] = useState(false);
  // Dokumenty z Sejfu — przy zaznaczonym załączniku od razu widać, czy go masz i czy jest ważny.
  const [sejf, setSejf] = useState([]);
  // Stan pisma per przetarg — po powrocie nic nie wpisujesz drugi raz.
  const tenderId = match?.tender?.id ?? null;
  const [stanWczytany, setStanWczytany] = useState(!tenderId);
  useEffect(() => {
    if (!tenderId) return undefined;
    let aktywny = true;
    wczytajStanWezwania(storage, tenderId).then((z) => {
      if (!aktywny) return;
      if (z) {
        if (typeof z.tekst === 'string') setTekstWezwania(z.tekst);
        if (typeof z.rodzaj === 'string') setRodzaj(z.rodzaj);
        if (typeof z.znak === 'string') setZnak(z.znak);
        if (typeof z.dataWezwania === 'string') setDataWezwania(z.dataWezwania);
        if (typeof z.termin === 'string') setTermin(z.termin);
        if (typeof z.godzina === 'string') setGodzina(z.godzina);
        if (Array.isArray(z.dokumenty)) setDokumenty(z.dokumenty);
        if (typeof z.wyjasnienie === 'string') setWyjasnienie(z.wyjasnienie);
      }
      setStanWczytany(true);
    });
    return () => { aktywny = false; };
  }, [tenderId]);
  useEffect(() => {
    if (!tenderId || !stanWczytany) return;
    zapiszStanWezwania(storage, tenderId, { tekst: tekstWezwania, rodzaj, znak, dataWezwania, termin, godzina, dokumenty, wyjasnienie }).catch(() => {});
  }, [tenderId, stanWczytany, tekstWezwania, rodzaj, znak, dataWezwania, termin, godzina, dokumenty, wyjasnienie]);

  useEffect(() => {
    let aktywny = true;
    storage.getItem(KLUCZ_DANYCH_WYKONAWCY)
      .then((s) => { if (s && aktywny) setWykonawca((w) => ({ ...w, ...JSON.parse(s) })); })
      .catch(() => {});
    api.sejfDokumenty()
      .then((d) => { if (aktywny && Array.isArray(d?.dokumenty)) setSejf(d.dokumenty); })
      .catch(() => { /* Sejf niedostępny — chipy bez podpowiedzi */ });
    return () => { aktywny = false; };
  }, []);

  const stanSejfu = useMemo(() => stanZalacznikowZSejfu(sejf, dokumenty), [sejf, dokumenty]);

  function rozpoznaj() {
    const r = rozpoznajWezwanie(tekstWezwania);
    setRodzaj(r.rodzaj);
    if (r.termin) setTermin(r.termin);
    if (r.godzina) setGodzina(r.godzina);
    if (r.znak) setZnak(r.znak);
    setRozpoznano(true);
  }

  const rodzajInfo = RODZAJE_WEZWANIA.find((r) => r.id === rodzaj) ?? RODZAJE_WEZWANIA.at(-1);
  const potrzebujeWyjasnien = rodzaj === 'wyjasnienia_tresci' || rodzaj === 'razaco_niska' || rodzaj === 'inne';

  const przelaczDokument = (nazwa) => setDokumenty((d) => (d.includes(nazwa) ? d.filter((x) => x !== nazwa) : [...d, nazwa]));
  function dodajDokument() {
    const n = nowyDokument.trim();
    if (!n) return;
    if (!dokumenty.includes(n)) setDokumenty((d) => [...d, n]);
    setNowyDokument('');
  }

  const pismo = useMemo(
    () => generujOdpowiedz({
      wykonawca, przetarg, wyjasnienie, dzisiaj: new Date().toISOString(),
      wezwanie: { rodzaj, znak, dataWezwania, termin, godzina },
      dokumenty: dokumenty.map((nazwa) => ({ nazwa })),
    }),
    [wykonawca, przetarg, wyjasnienie, rodzaj, znak, dataWezwania, termin, godzina, dokumenty],
  );
  const kontrola = useMemo(
    () => kontrolaPrzedWyslaniem({ rodzaj, termin, godzina, dokumenty: dokumenty.map((nazwa) => ({ nazwa })) }),
    [rodzaj, termin, godzina, dokumenty],
  );

  async function udostepnij() {
    try {
      await udostepnijTekst({ message: pismo.tresc, title: pismo.nazwa });
      setUdostepniono(true);
    } catch {
      /* anulowane */
    }
  }

  // Jedno wklejenie wezwania ustawia też odliczanie i checklistę w Strażniku (klucz jak w StraznikWezwaniaScreen).
  async function ustawStraznika() {
    let stare = { termin: '', dokumenty: [] };
    try {
      const s = await storage.getItem('przetargai.wezwanie');
      if (s) { const d = JSON.parse(s); if (d && typeof d === 'object') stare = { termin: d.termin ?? '', dokumenty: Array.isArray(d.dokumenty) ? d.dokumenty : [] }; }
    } catch { /* uszkodzony zapis — nadpiszemy */ }
    const znane = new Set(stare.dokumenty.map((d) => d.nazwa));
    const nowe = dokumenty.filter((n) => !znane.has(n)).map((n, i) => ({ id: `d${Date.now()}${i}`, nazwa: n, gotowy: false }));
    const zapis = {
      termin: termin ? (godzina ? `${termin}T${godzina}` : termin) : stare.termin,
      dokumenty: [...stare.dokumenty, ...nowe],
    };
    try { await storage.setItem('przetargai.wezwanie', JSON.stringify(zapis)); } catch { /* magazyn niedostępny */ }
    navigation.navigate('StraznikWezwania', { nazwa: przetarg.tytul ?? undefined });
  }

  // Oświadczenia z wezwania składają się same z danych firmy — te same generatory co w pakiecie dokumentów.
  async function udostepnijOswiadczenie(ktore) {
    const wspolne = { wykonawca, przetarg, dzisiaj: new Date().toISOString() };
    const dok = ktore === 'grupa'
      ? generujOswiadczenieGrupaKapitalowa({ ...wspolne, nalezy: false })
      : generujOswiadczenieAktualnosci(wspolne);
    try {
      await udostepnijTekst({ message: dok.tresc, title: dok.nazwa });
    } catch {
      /* anulowane */
    }
  }

  // Załącznik „wykaz" składa się sam z Banku referencji (dane już w aplikacji).
  async function udostepnijWykaz(rodzajWykazu) {
    let referencje = [];
    try {
      const s = await storage.getItem(KLUCZ_BANKU);
      if (s) referencje = JSON.parse(s);
    } catch {
      /* pusty bank — wykaz powie „brak pozycji" */
    }
    const dok = generujWykaz({ wykonawca, przetarg, referencje, rodzaj: rodzajWykazu, dzisiaj: new Date().toISOString() });
    try {
      await udostepnijTekst({ message: dok.tresc, title: dok.nazwa });
    } catch {
      /* anulowane */
    }
  }

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.heroEtykieta}>Odpowiedź na wezwanie w 1 klik</Text>
        <Text style={styles.heroTytul}>{przetarg.tytul ?? 'Pismo do zamawiającego z listą załączników'}</Text>
        <Text style={styles.heroWstep}>
          Wklej treść wezwania — rozpoznamy podstawę prawną, termin i znak pisma, a Ty dostaniesz gotową
          odpowiedź. Wezwanie jest jednokrotne: drugiej szansy nie będzie.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>1. Treść wezwania</Text>
      <TextField
        label="Wklej treść wezwania (e-mail lub pismo z platformy)"
        value={tekstWezwania}
        onChangeText={(v) => { setTekstWezwania(v); setRozpoznano(false); }}
        multiline
        inputStyle={styles.wielolinia}
        autoCapitalize="none"
      />
      <Button title="Rozpoznaj wezwanie" onPress={rozpoznaj} disabled={!tekstWezwania.trim()} />
      {rozpoznano ? (
        <Text style={styles.rozpoznano}>
          Rozpoznano: {rodzajInfo.tytul}{termin ? ` · termin ${termin}${godzina ? ` ${godzina}` : ''}` : ' · terminu nie znaleziono — wpisz ręcznie'}
        </Text>
      ) : null}

      <Text style={styles.sectionTitle}>2. Rodzaj wezwania</Text>
      <View style={styles.chipy}>
        {RODZAJE_WEZWANIA.map((r) => {
          const aktywny = r.id === rodzaj;
          return (
            <Pressable key={r.id} onPress={() => setRodzaj(r.id)} style={[styles.chip, aktywny && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywny }}>
              <Text style={[styles.chipTekst, aktywny && styles.chipTekstAktywny]}>{r.podstawa ?? 'Inne'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.rodzajOpis}>{rodzajInfo.tytul}. {rodzajInfo.opis}</Text>
      {rodzajInfo.ekranPomocy ? (
        <Button
          title={rodzaj === 'razaco_niska' ? 'Przygotuj merytorykę w Obronie ceny' : rodzaj === 'srodki_dowodowe' ? 'Sprawdź ważność zaświadczeń w Sejfie' : 'Otwórz strażnika wezwania (odliczanie)'}
          onPress={() => navigation.navigate(rodzajInfo.ekranPomocy, match ? { match } : undefined)}
          variant="ghost"
        />
      ) : null}

      <Text style={styles.sectionTitle}>3. Dane z wezwania</Text>
      <TextField label="Znak / numer pisma zamawiającego" value={znak} onChangeText={setZnak} autoCapitalize="characters" />
      <TextField label="Data wezwania" value={dataWezwania} onChangeText={setDataWezwania} hint="np. 2026-10-22 albo 22.10.2026" />
      <TextField label="Termin odpowiedzi" value={termin} onChangeText={setTermin} hint="RRRR-MM-DD — z wezwania" />
      <TextField label="Godzina (jeśli podana)" value={godzina} onChangeText={setGodzina} hint="np. 10:00" keyboardType="numbers-and-punctuation" />

      {rodzajInfo.zalacznikiWymagane || dokumenty.length ? (
        <View>
          <Text style={styles.sectionTitle}>4. Załączniki</Text>
          <Text style={styles.sectionOpis}>Zaznacz, co dołączasz — trafią do numerowanej listy w piśmie.</Text>
          <View style={styles.chipy}>
            {TYPOWE_DOKUMENTY.map((nazwa) => {
              const aktywny = dokumenty.includes(nazwa);
              return (
                <Pressable key={nazwa} onPress={() => przelaczDokument(nazwa)} style={[styles.chip, aktywny && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywny }}>
                  <Text style={[styles.chipTekst, aktywny && styles.chipTekstAktywny]}>{nazwa}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.rzadDodaj}>
            <TextField label="Inny dokument" value={nowyDokument} onChangeText={setNowyDokument} style={styles.poleDodaj} onSubmitEditing={dodajDokument} />
            <Button title="Dodaj" variant="ghost" onPress={dodajDokument} style={styles.dodajBtn} />
          </View>
          {Object.keys(stanSejfu).length ? (
            <View style={styles.wykazBlok}>
              {dokumenty.filter((n) => stanSejfu[n]).map((n) => {
                const st = stanSejfu[n];
                const tt = tonNaTokeny(st.ton, kolory);
                return (
                  <Text key={n} style={{ fontSize: 13, color: tt.tekst, lineHeight: 18 }}>
                    {n}: <Text style={{ fontWeight: '700' }}>{st.etykieta}</Text>
                  </Text>
                );
              })}
              <Button title="Otwórz Sejf dokumentów" variant="ghost" onPress={() => navigation.navigate('Sejf')} />
            </View>
          ) : null}
          {dokumenty.includes(CHIP_AKTUALNOSC) || dokumenty.includes(CHIP_GRUPA) ? (
            <View style={styles.wykazBlok}>
              <Text style={styles.wykazOpis}>Te oświadczenia napiszemy za Ciebie z danych firmy — podpisz i dołącz:</Text>
              {dokumenty.includes(CHIP_AKTUALNOSC) ? <Button title="Oświadczenie o aktualności informacji" variant="ghost" onPress={() => udostepnijOswiadczenie('aktualnosc')} /> : null}
              {dokumenty.includes(CHIP_GRUPA) ? <Button title="Oświadczenie o grupie kapitałowej (nie należę)" variant="ghost" onPress={() => udostepnijOswiadczenie('grupa')} /> : null}
              {dokumenty.includes(CHIP_GRUPA) ? <Text style={styles.wykazOpis}>Należysz do grupy z innym oferentem? Wariant z listą wygenerujesz w „Dokumentach do oferty".</Text> : null}
            </View>
          ) : null}
          {dokumenty.includes(CHIP_WYKAZU) ? (
            <View style={styles.wykazBlok}>
              <Text style={styles.wykazOpis}>Wykaz złożymy z Twojego Banku referencji (tylko doświadczenie aktualne na dziś):</Text>
              <Button title="Wykaz robót budowlanych" variant="ghost" onPress={() => udostepnijWykaz('roboty')} />
              <Button title="Wykaz usług" variant="ghost" onPress={() => udostepnijWykaz('uslugi')} />
              <Button title="Wykaz dostaw" variant="ghost" onPress={() => udostepnijWykaz('dostawy')} />
            </View>
          ) : null}
          {dokumenty.filter((d) => !TYPOWE_DOKUMENTY.includes(d)).map((d) => (
            <Pressable key={d} onPress={() => przelaczDokument(d)} style={styles.wlasny} accessibilityRole="button" accessibilityLabel={`Usuń ${d}`}>
              <Text style={styles.wlasnyTekst}>• {d}</Text>
              <Text style={styles.wlasnyUsun}>usuń</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {potrzebujeWyjasnien ? (
        <View>
          <Text style={styles.sectionTitle}>{rodzajInfo.zalacznikiWymagane ? '5' : '4'}. Twoje wyjaśnienia</Text>
          <TextField
            label={rodzaj === 'razaco_niska' ? 'Skąd taka cena — konkrety i dowody' : 'Treść wyjaśnień'}
            value={wyjasnienie}
            onChangeText={setWyjasnienie}
            multiline
            inputStyle={styles.wielolinia}
            hint={rodzaj === 'wyjasnienia_tresci' ? 'Wyjaśniasz, nie zmieniasz oferty — pismo samo doda to zastrzeżenie.' : undefined}
          />
        </View>
      ) : null}

      <Button
        title="Ustaw odliczanie i checklistę w Strażniku wezwania"
        variant="ghost"
        onPress={ustawStraznika}
        disabled={!termin && !dokumenty.length}
      />

      <Text style={styles.sectionTitle}>Kontrola przed wysłaniem</Text>
      {kontrola.map((p) => {
        const t = tonNaTokeny(p.ton, kolory);
        return (
          <View key={p.id} style={[styles.punkt, { backgroundColor: t.tlo, borderColor: t.tekst }]}>
            <Text style={[styles.punktTekst, { color: t.tekst }]}>{p.tekst}</Text>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Gotowe pismo</Text>
      <View style={styles.karta}>
        <Text style={styles.kartaTytul}>{pismo.nazwa}</Text>
        <Text style={styles.podglad}>{pismo.tresc}</Text>
      </View>
      <Button title="Udostępnij / skopiuj pismo" onPress={udostepnij} />
      <PrzyciskWord nazwa={pismo.nazwa} tresc={pismo.tresc} />
      {udostepniono ? <Text style={styles.ok}>Udostępniono. Podpisz elektronicznie pismo i każdy załącznik, potem wyślij tam, gdzie wskazuje wezwanie.</Text> : null}
      <Text style={styles.stopka}>To pismo przewodnie wg Pzp — treść merytoryczną wyjaśnień i same dokumenty dostarczasz Ty. Niczego nie wysyłamy do zamawiającego.</Text>
    </Screen>
  );
}

const tworzStyleOdpowiedzi = tworzStyle((k) => ({
  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.lg, marginBottom: spacing.md },
  heroEtykieta: { fontSize: 12, fontWeight: '700', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.md, marginBottom: 4 },
  sectionOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  wielolinia: { minHeight: 120, paddingTop: 12, textAlignVertical: 'top' },
  rozpoznano: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  rodzajOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, paddingVertical: 8, paddingHorizontal: 12 },
  chipAktywny: { backgroundColor: k.blue, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.text, fontWeight: '600' },
  chipTekstAktywny: { color: k.white },
  rzadDodaj: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  poleDodaj: { flex: 1 },
  dodajBtn: { marginBottom: spacing.md },
  wlasny: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  wlasnyTekst: { flex: 1, fontSize: 14, color: k.text },
  wlasnyUsun: { fontSize: 13, color: k.danger, fontWeight: '600' },
  wykazBlok: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm, gap: spacing.sm },
  wykazOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  punkt: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, marginBottom: spacing.sm },
  punktTekst: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  karta: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  podglad: { fontSize: 12, color: k.textMuted, lineHeight: 17 },
  ok: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.sm, lineHeight: 18 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, marginBottom: spacing.lg, fontStyle: 'italic' },
}));
