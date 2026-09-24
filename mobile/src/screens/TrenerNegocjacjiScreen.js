import { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  wykryjTrybNegocjacji,
  wyjasnienieDlaUzytkownika,
  ZELAZNA_ZASADA,
  KRYTERIA_DOMYSLNE,
  porownajOfertaDodatkowa,
  normalizujLiczbe,
  walidujOferty,
} from '../lib/trenerNegocjacji';

/*
 * TRENER NEGOCJACJI I OFERTY DODATKOWEJ (P2-5).
 *
 * Tryb podstawowy w wariancie 2 lub 3 (art. 275 pkt 2-3 Pzp): po otwarciu ofert
 * zamawiający zaprasza do negocjacji, a wykonawca składa ofertę dodatkową. Jedna
 * pułapka kosztuje całe postępowanie: oferta dodatkowa gorsza w JAKIMKOLWIEK
 * kryterium jest odrzucana (art. 296 ust. 3). Ekran:
 *   1. rozpoznaje tryb z wklejonego ogłoszenia/SWZ (albo pozwala go wybrać),
 *   2. tłumaczy, co to znaczy,
 *   3. porównuje ofertę dodatkową z pierwotną pole po polu i BLOKUJE (kolor
 *      danger), gdy cokolwiek jest mniej korzystne.
 *
 * Całość liczy się lokalnie z lib/trenerNegocjacji.js — bez sieci i bez AI.
 * Treść jest polska jak w pozostałych narzędziach Pzp (patrz P1-5).
 */

const WARIANTY = [
  { wartosc: 1, etykieta: 'Wariant 1', opis: 'bez negocjacji' },
  { wartosc: 2, etykieta: 'Wariant 2', opis: 'może negocjować' },
  { wartosc: 3, etykieta: 'Wariant 3', opis: 'negocjuje' },
];

const PUSTA_OFERTA = { cena: '', termin: '', gwarancja: '' };

function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function TrenerNegocjacjiScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleTrenera);

  const [tekst, setTekst] = useState(route?.params?.tekst ?? '');
  const [wykrycie, setWykrycie] = useState(null);
  const [wariantRecznie, setWariantRecznie] = useState(null);
  const [pierwotna, setPierwotna] = useState(PUSTA_OFERTA);
  const [dodatkowa, setDodatkowa] = useState(PUSTA_OFERTA);

  const wariant = wariantRecznie ?? wykrycie?.wariant ?? null;
  const wyjasnienie = wykrycie || wariantRecznie
    ? wyjasnienieDlaUzytkownika({ wariant })
    : null;

  const porownanie = useMemo(() => {
    const liczby = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalizujLiczbe(v)]));
    return porownajOfertaDodatkowa({ pierwotna: liczby(pierwotna), dodatkowa: liczby(dodatkowa) });
  }, [pierwotna, dodatkowa]);
  const tonWyniku = tokenyTonu(porownanie.pozycje.length ? porownanie.ton : 'neutral', kolory);
  // Walidacja pól liczbowych — logika i komunikaty PL wyłącznie z lib (bez duplikacji w ekranie).
  // Przy błędzie NIE pokazujemy werdyktu: „1.200,50" czytane jako 1,2 mogłoby przepuścić gorszą ofertę.
  const { bledy, maBledy } = walidujOferty({ pierwotna, dodatkowa });

  const sprawdz = () => {
    setWariantRecznie(null);
    setWykrycie(wykryjTrybNegocjacji(tekst));
  };

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        W trybie podstawowym z negocjacjami możesz po otwarciu ofert złożyć ofertę dodatkową
        i przebić konkurencję. Sprawdź tryb, a przed wysyłką porównaj obie oferty pole po polu.
      </Text>

      {/* Żelazna zasada — zawsze widoczna, w kolorze danger: to ona odrzuca oferty. */}
      <View style={[styles.zasada, { backgroundColor: kolory.dangerTlo, borderColor: kolory.danger }]}>
        <Text style={[styles.zasadaTytul, { color: kolory.danger }]}>{ZELAZNA_ZASADA.tytul}</Text>
        <Text style={[styles.zasadaTekst, { color: kolory.danger }]}>{ZELAZNA_ZASADA.tresc}</Text>
      </View>

      <Text style={styles.sekcja}>1. Jaki to tryb?</Text>
      <TextField
        label="Fragment ogłoszenia albo SWZ"
        hint="Wklej zdanie o trybie, np. „tryb podstawowy, o którym mowa w art. 275 pkt 2 Pzp”."
        value={tekst}
        onChangeText={setTekst}
        multiline
        inputStyle={styles.poleWielolinijne}
      />
      <Button title="Rozpoznaj tryb" onPress={sprawdz} disabled={!tekst.trim()} />

      {wykrycie && wykrycie.trybPodstawowy && wykrycie.wariant === null ? (
        <Text style={styles.uwaga}>Rozpoznano tryb podstawowy, ale nie wariant — wybierz go poniżej.</Text>
      ) : null}

      <View style={styles.warianty} accessibilityRole="radiogroup">
        {WARIANTY.map((w) => {
          const aktywny = wariant === w.wartosc;
          return (
            <Pressable
              key={w.wartosc}
              style={[styles.wariant, aktywny && { backgroundColor: kolory.blue, borderColor: kolory.blue }]}
              onPress={() => setWariantRecznie(w.wartosc)}
              accessibilityRole="radio"
              accessibilityState={{ checked: aktywny }}
            >
              <Text style={[styles.wariantTytul, aktywny && { color: kolory.white }]}>{w.etykieta}</Text>
              <Text style={[styles.wariantOpis, aktywny && { color: kolory.white }]}>{w.opis}</Text>
            </Pressable>
          );
        })}
      </View>

      {wyjasnienie ? (
        <View style={[styles.karta, { borderLeftColor: wyjasnienie.dotyczy ? kolory.blue : kolory.border }]}>
          <Text style={styles.kartaTytul}>{wyjasnienie.tytul}</Text>
          {wyjasnienie.akapity.map((a) => <Text key={a} style={styles.akapit}>{a}</Text>)}
        </View>
      ) : null}

      <Text style={styles.sekcja}>2. Porównaj ofertę dodatkową z pierwotną</Text>
      <Text style={styles.akapit}>
        Wpisz wartości z oferty pierwotnej i planowanej dodatkowej. Puste pole nie jest porównywane.
      </Text>

      {KRYTERIA_DOMYSLNE.map((k) => (
        <View key={k.klucz} style={styles.wiersz}>
          <TextField
            style={styles.kolumna}
            label={`${k.etykieta} — pierwotna`}
            value={pierwotna[k.klucz]}
            onChangeText={(v) => setPierwotna((o) => ({ ...o, [k.klucz]: v }))}
            keyboardType="decimal-pad"
            placeholder={k.jednostka}
            error={bledy[`pierwotna_${k.klucz}`]}
          />
          <TextField
            style={styles.kolumna}
            label={`${k.etykieta} — dodatkowa`}
            value={dodatkowa[k.klucz]}
            onChangeText={(v) => setDodatkowa((o) => ({ ...o, [k.klucz]: v }))}
            keyboardType="decimal-pad"
            placeholder={k.jednostka}
            error={bledy[`dodatkowa_${k.klucz}`]}
          />
        </View>
      ))}

      {maBledy ? (
        <Text style={[styles.uwaga, { color: kolory.danger }]}>
          Popraw pola oznaczone na czerwono — dopiero wtedy porównamy oferty.
        </Text>
      ) : porownanie.pozycje.length ? (
        <View
          style={[styles.wynik, { backgroundColor: tonWyniku.tlo, borderColor: tonWyniku.tekst }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.wynikTytul, { color: tonWyniku.tekst }]}>
            {porownanie.blokujWyslanie ? 'NIE WYSYŁAJ — oferta zostanie odrzucona' : 'Można wysłać'}
          </Text>
          <Text style={[styles.wynikTekst, { color: tonWyniku.tekst }]}>{porownanie.komunikat}</Text>
          {porownanie.mniejKorzystne.map((p) => (
            <Text key={p.klucz} style={[styles.wynikPunkt, { color: kolory.danger }]}>• {p.powod}</Text>
          ))}
          {porownanie.blokujWyslanie ? (
            <Text style={[styles.wynikTekst, { color: tonWyniku.tekst }]}>{ZELAZNA_ZASADA.konsekwencja}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.uwaga}>Uzupełnij co najmniej jedno kryterium w obu kolumnach.</Text>
      )}
    </Screen>
  );
}

const tworzStyleTrenera = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginBottom: spacing.md },
  zasada: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 4, marginBottom: spacing.lg },
  zasadaTytul: { fontSize: 15, fontWeight: '800' },
  zasadaTekst: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sekcja: { fontSize: 13, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  poleWielolinijne: { minHeight: 96, textAlignVertical: 'top' },
  uwaga: { fontSize: 13, color: k.textMuted, marginTop: spacing.sm },
  warianty: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  wariant: {
    flex: 1, borderWidth: 1.5, borderColor: k.border, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: k.surface,
  },
  wariantTytul: { fontSize: 14, fontWeight: '800', color: k.text },
  wariantOpis: { fontSize: 12, color: k.textMuted, textAlign: 'center' },
  karta: {
    marginTop: spacing.md, backgroundColor: k.surface, borderRadius: radius.md,
    borderLeftWidth: 4, padding: spacing.md, gap: spacing.xs,
  },
  kartaTytul: { fontSize: 15, fontWeight: '800', color: k.text },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  wiersz: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  kolumna: { flex: 1 },
  wynik: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 4, marginTop: spacing.sm },
  wynikTytul: { fontSize: 16, fontWeight: '800' },
  wynikTekst: { fontSize: 14, lineHeight: 20 },
  wynikPunkt: { fontSize: 14, fontWeight: '700' },
}));
