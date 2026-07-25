import { useState, useEffect } from 'react';
import { View, Text, Alert } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { pozostaly_czas_do } from '../lib/terminKio';
import { wygeneruj_wniosek_o_protokol } from '../lib/wniosekProtokol';
import { wygeneruj_notatki_odwolanie } from '../lib/notatkiOdwolanie';
import { pobierzDokument } from '../services/dokumenty';

/**
 * Ekran WYNIKU KONTROLI oferty zwycięzcy — podzadanie 12/13 ulepszenia
 * „Prześwietlenie oferty zwycięzcy i szansa na odwołanie".
 *
 * WYŁĄCZNIE UI spinające ISTNIEJĄCE dane: bierze poprzetargową kontrolę z gotowym
 * wynikiem analizy (podzadanie 11/13) i wyliczonym terminem KIO (3/13) i pokazuje:
 *  - wyróżnioną decyzję końcową „walcz / odpuść" wraz z oceną szans,
 *  - żywy licznik terminu na odwołanie do KIO (countdown, tyka co minutę),
 *  - listę potencjalnych zarzutów z siłą i opisem,
 *  - przyciski pobrania wniosku o protokół i notatek roboczych pod odwołanie.
 *
 * Sama analiza (parser + silnik reguł + ocena szans) liczona jest wcześniej i
 * zapisywana w rekordzie kontroli — ten ekran jej NIE liczy, tylko wyświetla.
 * Parametry nawigacji: `{ tender, kontrola }` (kontrola jako zwykły obiekt z toJSON).
 */

const ETYKIETA_SZANS = { niska: 'niskie', srednia: 'średnie', wysoka: 'wysokie' };
const ETYKIETA_SILY = { slaba: 'słaba', umiarkowana: 'umiarkowana', mocna: 'mocna' };

/** Data ISO → polski zapis DD.MM.RRRR (bez przesuwania dnia przez strefę). */
function formatujDatePL(iso) {
  const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export default function WynikKontroliScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWyniku);
  const { tender, kontrola } = route?.params ?? {};
  const analiza = kontrola?.analiza ?? null;

  // Countdown „z countdown": czas odniesienia tyka, żeby licznik się starzał.
  // Dni/godziny wystarczy odświeżać co minutę — bez zbędnego re-renderu co sekundę.
  const [teraz, setTeraz] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTeraz(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [busyWniosek, setBusyWniosek] = useState(false);
  const [busyNotatki, setBusyNotatki] = useState(false);

  const rekomendacja = analiza?.rekomendacja ?? null;
  const walcz = rekomendacja?.wartosc === 'walcz';
  const etykietaDecyzji = rekomendacja?.etykieta ?? (walcz ? 'jest podstawa, walcz' : 'odpuść');
  const etykietaSzans = ETYKIETA_SZANS[analiza?.ocenaSzans] ?? 'nieokreślone';
  const zarzuty = Array.isArray(analiza?.zarzuty) ? analiza.zarzuty : [];

  // Odliczanie z wyliczonego terminu KIO (czysta funkcja 4/13) — null, gdy termin nieznany.
  const czas = pozostaly_czas_do(kontrola?.terminOdwolaniaKio, teraz);
  const terminPL = formatujDatePL(kontrola?.terminOdwolaniaKio);
  // Kolor pilności: po terminie / ostatni dzień → czerwony; ≤2 dni → bursztyn; dalej → niebieski.
  const pilnyKolor = !czas || czas.poTerminie || czas.dni === 0
    ? kolory.danger
    : czas.dni <= 2
      ? kolory.ostrzezenieTekst
      : kolory.blue;

  async function pobierzWniosek() {
    setBusyWniosek(true);
    try {
      const dok = wygeneruj_wniosek_o_protokol(tender ?? kontrola, {
        dataPisma: new Date().toISOString().slice(0, 10),
      });
      await pobierzDokument(dok);
    } catch (err) {
      Alert.alert('Nie udało się pobrać wniosku', err.message);
    } finally {
      setBusyWniosek(false);
    }
  }

  async function pobierzNotatki() {
    setBusyNotatki(true);
    try {
      const dok = wygeneruj_notatki_odwolanie(kontrola, {
        teraz: Date.now(),
        nazwaPostepowania: tender?.title,
      });
      await pobierzDokument(dok);
    } catch (err) {
      Alert.alert('Nie udało się pobrać notatek', err.message);
    } finally {
      setBusyNotatki(false);
    }
  }

  return (
    <Screen scroll>
      {/* Wyróżniona decyzja końcowa */}
      <View style={[styles.decyzjaCard, walcz ? styles.decyzjaWalcz : styles.decyzjaOdpusc]}>
        <Text style={[styles.decyzjaEtykieta, walcz ? styles.tekstWalcz : styles.tekstOdpusc]}>
          Rekomendacja
        </Text>
        <Text style={[styles.decyzjaWartosc, walcz ? styles.tekstWalcz : styles.tekstOdpusc]}>
          {etykietaDecyzji}
        </Text>
        <Text style={styles.decyzjaSzanse}>Szanse powodzenia w KIO: {etykietaSzans}</Text>
      </View>

      {/* Licznik terminu KIO (countdown) */}
      <Text style={styles.sectionTitle}>Termin na odwołanie do KIO</Text>
      <View style={styles.card}>
        {!kontrola?.terminOdwolaniaKio || !czas ? (
          <Text style={styles.terminNieznany}>
            Termin nie został jeszcze ustalony. Liczy się on od dnia przekazania
            informacji o wyborze najkorzystniejszej oferty.
          </Text>
        ) : czas.poTerminie ? (
          <>
            <Text style={[styles.terminMinal, { color: kolory.danger }]}>Termin upłynął</Text>
            <Text style={styles.terminData}>
              Ostatni dzień na odwołanie: {terminPL}. Wniesienie odwołania po terminie
              skutkuje jego odrzuceniem przez KIO.
            </Text>
          </>
        ) : (
          <>
            <View style={styles.countdownRzad}>
              <View style={styles.countdownBox}>
                <Text style={[styles.countdownLiczba, { color: pilnyKolor }]}>{czas.dni}</Text>
                <Text style={styles.countdownJednostka}>dni</Text>
              </View>
              <View style={styles.countdownBox}>
                <Text style={[styles.countdownLiczba, { color: pilnyKolor }]}>{czas.godziny}</Text>
                <Text style={styles.countdownJednostka}>godz.</Text>
              </View>
            </View>
            <Text style={styles.terminData}>do {terminPL} włącznie (ostatni dzień)</Text>
          </>
        )}
      </View>

      {/* Lista zarzutów z siłą */}
      <Text style={styles.sectionTitle}>Potencjalne zarzuty ({zarzuty.length})</Text>
      {zarzuty.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.pusto}>
            Nie wykryto przesłanek odrzucenia oferty zwycięzcy dających realną podstawę
            do odwołania.
          </Text>
        </View>
      ) : (
        zarzuty.map((z, i) => {
          const etSila = ETYKIETA_SILY[z.sila] ?? z.sila;
          const stylBadge =
            z.sila === 'mocna' ? styles.silaMocna : z.sila === 'umiarkowana' ? styles.silaUmiar : styles.silaSlaba;
          const stylBadgeText =
            z.sila === 'mocna'
              ? styles.silaMocnaText
              : z.sila === 'umiarkowana'
                ? styles.silaUmiarText
                : styles.silaSlabaText;
          return (
            <View key={i} style={[styles.card, styles.zarzutCard]}>
              <View style={styles.zarzutNaglowek}>
                <Text style={styles.zarzutTytul}>{z.tytul || 'Zarzut'}</Text>
                {etSila ? (
                  <View style={[styles.silaBadge, stylBadge]}>
                    <Text style={[styles.silaText, stylBadgeText]}>{etSila}</Text>
                  </View>
                ) : null}
              </View>
              {z.opis_zarzutu ? <Text style={styles.zarzutOpis}>{z.opis_zarzutu}</Text> : null}
            </View>
          );
        })
      )}

      {/* Uzasadnienie oceny */}
      {analiza?.uzasadnienie ? (
        <>
          <Text style={styles.sectionTitle}>Uzasadnienie oceny</Text>
          <View style={styles.card}>
            <Text style={styles.uzasadnienie}>{analiza.uzasadnienie}</Text>
            {analiza.kompletDokumentow === false ? (
              <Text style={styles.wstepna}>
                Analiza wstępna — nie wgrano jeszcze kompletu dokumentów. Ocena może się
                jeszcze zmienić.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Pobranie dokumentów */}
      <Text style={styles.sectionTitle}>Dokumenty do pobrania</Text>
      <Button
        title="Pobierz notatki pod odwołanie"
        onPress={pobierzNotatki}
        loading={busyNotatki}
        variant="primary"
      />
      <Button
        title="Pobierz wniosek o protokół"
        onPress={pobierzWniosek}
        loading={busyWniosek}
        variant="ghost"
        style={styles.gap}
      />
      <Text style={styles.stopka}>
        Notatki to materiał roboczy przygotowany z automatycznej kontroli oferty —
        nie zastępują pisma procesowego ani porady prawnej.
      </Text>
    </Screen>
  );
}

const tworzStyleWyniku = tworzStyle((k) => ({
  decyzjaCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  decyzjaWalcz: { backgroundColor: k.sukcesTlo, borderColor: k.green },
  decyzjaOdpusc: { backgroundColor: k.neutralneTlo, borderColor: k.border },
  decyzjaEtykieta: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  decyzjaWartosc: { fontSize: 24, fontWeight: '800', marginTop: 4, lineHeight: 30 },
  decyzjaSzanse: { fontSize: 14, color: k.text, marginTop: spacing.sm, fontWeight: '600' },
  tekstWalcz: { color: k.green },
  tekstOdpusc: { color: k.textMuted },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  terminNieznany: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  terminMinal: { fontSize: 20, fontWeight: '800' },
  terminData: { fontSize: 13, color: k.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  countdownRzad: { flexDirection: 'row', gap: spacing.md },
  countdownBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.bg,
  },
  countdownLiczba: { fontSize: 34, fontWeight: '800', lineHeight: 38 },
  countdownJednostka: { fontSize: 12, color: k.textMuted, marginTop: 2, fontWeight: '600' },
  zarzutCard: { marginBottom: spacing.sm },
  zarzutNaglowek: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  zarzutTytul: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  silaBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  silaText: { fontSize: 11, fontWeight: '700' },
  silaMocna: { backgroundColor: k.wyroznienie },
  silaMocnaText: { color: k.blue },
  silaUmiar: { backgroundColor: k.ostrzezenieTlo },
  silaUmiarText: { color: k.ostrzezenieTekst },
  silaSlaba: { backgroundColor: k.neutralneTlo },
  silaSlabaText: { color: k.textMuted },
  zarzutOpis: { fontSize: 14, color: k.text, lineHeight: 20, marginTop: spacing.sm },
  uzasadnienie: { fontSize: 14, color: k.text, lineHeight: 21 },
  wstepna: { fontSize: 12, color: k.ostrzezenieTekst, lineHeight: 17, marginTop: spacing.sm, fontStyle: 'italic' },
  gap: { marginTop: spacing.md },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, fontStyle: 'italic' },
}));
