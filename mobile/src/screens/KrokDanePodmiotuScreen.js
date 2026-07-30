import { useMemo, useState } from 'react';
import { View, Text, Share } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  szablonZobowiazania,
  walidujKompletnoscZobowiazania,
  grupujPolaFormularza,
  ustawWartoscPola,
  generujTrescZobowiazania,
} from '../lib/zobowiazaniePodmiotu';

/**
 * KROK 2 kreatora „Pożycz doświadczenie" (art. 118 Pzp) — FORMULARZ danych
 * podmiotu udostępniającego i zakresu udostępnienia. Podzadanie 6/12 ulepszenia
 * „Pożycz doświadczenie: kreator polegania na zasobach podmiotu trzeciego".
 *
 * Ekran jest CIENKI: cała wiedza o polach, ich podziale na sekcje i o tym, co
 * czyni zobowiązanie kompletnym, żyje w `lib/zobowiazaniePodmiotu.js` (testowanym
 * bez renderera). Tu tylko:
 *  • generujemy pola tekstowe z modelu (`grupujPolaFormularza`),
 *  • trzymamy draft zobowiązania w stanie i aktualizujemy go niemutująco
 *    (`ustawWartoscPola`) w `onChangeText`,
 *  • na bieżąco liczymy kompletność WYMAGANYCH pól funkcją walidacji modelu
 *    (`walidujKompletnoscZobowiazania`) — ta sama reguła, którą sprawdza backend.
 *
 * Walidacja pilnuje czterech elementów wymaganych przez art. 118 ust. 4 Pzp
 * (zakres, sposób, okres udostępnienia, zakres podwykonawstwa) oraz identyfikacji
 * podmiotu. Adres i reprezentant są ZALECANE — brak daje miękkie ostrzeżenie, nie
 * blokuje przejścia dalej. Błędy pod polami zapalają się dopiero po próbie „Dalej",
 * żeby świeży formularz nie był od razu czerwony. Samo generowanie treści
 * zobowiązania to KOLEJNY krok kreatora (osobny ekran).
 */
export default function KrokDanePodmiotuScreen() {
  const styles = useStyle(tworzStyleKroku);
  const sekcje = useMemo(() => grupujPolaFormularza(), []);
  const [draft, setDraft] = useState(szablonZobowiazania);
  const [probowanoDalej, setProbowanoDalej] = useState(false);
  const [zatwierdzono, setZatwierdzono] = useState(false);

  const walidacja = walidujKompletnoscZobowiazania(draft);
  const brakiSciezki = new Set(walidacja.braki.map((b) => b.sciezka));
  const liczbaWymaganych = walidacja.wypelnione.length + walidacja.braki.length;

  const wartoscPola = (pole) =>
    pole.sciezka.reduce((o, k) => (o == null ? undefined : o[k]), draft) ?? '';

  const zmienPole = (pole) => (tekst) => {
    setZatwierdzono(false);
    setDraft((d) => ustawWartoscPola(d, pole.sciezka, tekst));
  };

  async function handleDalej() {
    if (!walidacja.kompletne) {
      setProbowanoDalej(true);
      return;
    }
    setZatwierdzono(true);
    const dok = generujTrescZobowiazania(draft);
    try {
      await Share.share({ message: dok.tresc, title: dok.nazwa });
    } catch {
      /* użytkownik anulował udostępnianie — nic nie robimy */
    }
  }

  return (
    <Screen scroll>
      {/* Ramka kroku — spójna z krokiem 1 (ten sam licznik „z 4"). */}
      <View style={styles.hero}>
        <Text style={styles.heroKrok}>Krok 2 z 2 · Pożycz doświadczenie</Text>
        <Text style={styles.heroTytul}>Dane podmiotu i zakres udostępnienia</Text>
        <Text style={styles.heroWstep}>
          Uzupełnij, kto użycza doświadczenia i na jakich zasadach. Cztery elementy
          zakresu wymaga wprost art. 118 ust. 4 Pzp — bez nich zamawiający lub KIO
          mogą uznać udostępnienie za pozorne.
        </Text>
      </View>

      {sekcje.map((sekcja) => (
        <View key={sekcja.id}>
          <Text style={styles.sectionTitle}>{sekcja.tytul}</Text>
          {sekcja.opis ? <Text style={styles.sectionOpis}>{sekcja.opis}</Text> : null}
          {sekcja.pola.map((pole) => {
            const wieloliniowe = pole.sciezka.length === 1;
            const brakuje = brakiSciezki.has(pole.sciezka.join('.'));
            return (
              <TextField
                key={pole.id}
                label={`${pole.etykieta} · ${pole.wymagane ? 'wymagane' : 'opcjonalne'}`}
                value={wartoscPola(pole)}
                onChangeText={zmienPole(pole)}
                hint={pole.opis}
                error={probowanoDalej && brakuje ? 'To pole jest wymagane.' : undefined}
                multiline={wieloliniowe}
                inputStyle={wieloliniowe ? styles.wielolinia : undefined}
                autoCapitalize="sentences"
              />
            );
          })}
        </View>
      ))}

      {/* Podsumowanie kompletności — na żywo, ta sama reguła co po stronie backendu. */}
      {walidacja.kompletne ? (
        <View style={[styles.panel, styles.panelOk]}>
          <Text style={styles.panelOkTytul}>
            Komplet — wszystkie wymagane elementy uzupełnione
          </Text>
          {walidacja.ostrzezenia.length > 0 ? (
            <Text style={styles.panelOkTresc}>
              Warto jeszcze dodać: {walidacja.ostrzezenia.map((o) => o.etykieta).join(', ')}.
              To pola zalecane — nie blokują przejścia dalej.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={[styles.panel, styles.panelBrak]}>
          <Text style={styles.panelBrakTytul}>
            Uzupełnij wymagane pola — brakuje {walidacja.braki.length} z {liczbaWymaganych}
          </Text>
          {walidacja.braki.map((b) => (
            <View key={b.id} style={styles.brakRzad}>
              <Text style={styles.brakKropka}>•</Text>
              <Text style={styles.brakTekst}>{b.etykieta}</Text>
            </View>
          ))}
        </View>
      )}

      <Button title="Wygeneruj zobowiązanie (udostępnij)" onPress={handleDalej} />
      {!walidacja.kompletne ? (
        <Text style={styles.stopkaHint}>
          Uzupełnij wszystkie wymagane pola — zobowiązanie wygenerujesz dopiero, gdy będzie kompletne.
        </Text>
      ) : zatwierdzono ? (
        <Text style={styles.stopkaOk}>
          Gotowe — zobowiązanie złożone do udostępnienia. Musi je PODPISAĆ sam podmiot udostępniający zasoby.
        </Text>
      ) : null}
    </Screen>
  );
}

const tworzStyleKroku = tworzStyle((k) => ({
  hero: {
    backgroundColor: k.wyroznienie,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroKrok: {
    fontSize: 12,
    fontWeight: '700',
    color: k.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  sectionOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  wielolinia: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  panel: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  panelOk: { backgroundColor: k.sukcesTlo, borderColor: k.green },
  panelOkTytul: { fontSize: 14, fontWeight: '700', color: k.green },
  panelOkTresc: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: 6 },
  panelBrak: { backgroundColor: k.dangerTlo, borderColor: k.danger },
  panelBrakTytul: { fontSize: 14, fontWeight: '700', color: k.danger, marginBottom: 6 },
  brakRzad: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  brakKropka: { fontSize: 14, color: k.danger, fontWeight: '800', lineHeight: 20 },
  brakTekst: { flex: 1, fontSize: 13, color: k.text, lineHeight: 20 },
  stopkaHint: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm, lineHeight: 17 },
  stopkaOk: {
    fontSize: 13,
    color: k.green,
    fontWeight: '600',
    marginTop: spacing.sm,
    lineHeight: 18,
  },
}));
