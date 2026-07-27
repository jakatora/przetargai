import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  podsumowanieRekomendacji,
  przygotujWykresSalda,
} from '../lib/symulatorPlynnosci';

/**
 * Panel „SYMULATOR PŁYNNOŚCI — CZY UDŹWIGNIESZ KONTRAKT" — podzadanie 6/6 ulepszenia
 * „Symulator płynności: czy udźwigniesz ten kontrakt".
 *
 * Wchodzi w decyzję „startować czy nie" OBOK szansy na wygraną: zanim wykonawca zdecyduje
 * się startować, pokazuje, ile własnej gotówki musi wyłożyć, zanim zobaczy pierwszą złotówkę
 * od zamawiającego. Na wejściu bierze parametry AUTOMATYCZNIE z treści SWZ / wzoru umowy
 * (harmonogram płatności, termin zapłaty, zabezpieczenie, zaliczka, cena) i pozwala RĘCZNIE
 * skorygować dwie rzeczy, których w dokumentach nie ma: miesięczne koszty (ludzie + materiały)
 * i własną poduszkę gotówki. Zwraca:
 *   • OŚ miesięcznego salda narastającego (dołek = pieniądze wyłożone z kieszeni),
 *   • wyraźny BOX luki finansowania pomostowego („ok. X zł przez Y mies.; twoja poduszka to Z"),
 *   • listę KONKRETNYCH ruchów domknięcia luki (gwarancja zamiast gotówki, zaliczka, pytanie
 *     o płatności częściowe, faktoring) — dobranych z danych kontraktu.
 *
 * Ekran NIC nie liczy z reguł biznesowych — cały model finansowy, symulację przepływów i
 * rekomendacje robi BEZSTANOWY backend (`/api/przetarg/symulator-plynnosci/analiza`, bez DB
 * i bez płatnego AI — parser deterministyczny). Formatowanie kwot/miesięcy, mapowanie statusu
 * na semantyczny `ton` i przygotowanie osi salda żyją w testowanym `lib/symulatorPlynnosci.js`.
 * Kolory wyłącznie z tokenów motyw.js (kontrast AA) — lib podaje `ton`, token dokłada tu.
 */

/** Semantyczny ton (z lib) → para tokenów motyw.js (tło + tekst), AA. Jak w RejestratorOfertyScreen. */
function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

/**
 * Pole liczbowe → liczba albo undefined. Zdejmuje spacje, „zł" i inne znaki, przecinek
 * traktuje jak kropkę dziesiętną. To parsowanie WEJŚCIA (string→number dla API), nie logika
 * biznesowa — cała matematyka symulacji zostaje na backendzie / w lib.
 */
function naLiczbe(txt) {
  if (typeof txt !== 'string') return undefined;
  const oczyszczone = txt.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!oczyszczone) return undefined;
  const n = Number(oczyszczone);
  return Number.isFinite(n) ? n : undefined;
}

/** Badge tonu (słowo z lib + kolor z tokenów). */
function Badge({ etykieta, ton, styles, kolory }) {
  const t = tonNaTokeny(ton, kolory);
  return <Text style={[styles.badge, { backgroundColor: t.tlo, color: t.tekst }]}>{etykieta}</Text>;
}

export default function SymulatorPlynnosciScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSymulatora);

  const params = route?.params ?? {};
  const nazwa = params.nazwa ?? null;

  // Wejście automatyczne (z dokumentów) — wklejane, bo to jedyne źródło parametrów kontraktu.
  const [swz, setSwz] = useState('');
  const [umowa, setUmowa] = useState('');
  // Ręczna korekta — dane, których w SWZ/umowie nie ma.
  const [koszty, setKoszty] = useState('');
  const [czas, setCzas] = useState('');
  const [poduszka, setPoduszka] = useState('');

  const [wynik, setWynik] = useState(null); // { parametry, symulacja, rekomendacje }
  const [liczy, setLiczy] = useState(false);
  const [blad, setBlad] = useState(null);

  async function policz() {
    if (liczy) return;
    const swzT = swz.trim();
    const umowaT = umowa.trim();
    if (!swzT && !umowaT) {
      setBlad('Wklej treść SWZ lub wzoru umowy — z nich odczytujemy harmonogram płatności, '
        + 'termin zapłaty, zabezpieczenie i cenę kontraktu.');
      return;
    }
    setLiczy(true);
    setBlad(null);
    try {
      const payload = {};
      if (swzT) payload.swz = swzT;
      if (umowaT) payload.umowa = umowaT;
      const k = naLiczbe(koszty);
      if (k != null) payload.kosztyMiesieczne = k;
      const c = naLiczbe(czas);
      if (c != null && c > 0) payload.czasTrwaniaMies = c;
      const p = naLiczbe(poduszka);
      if (p != null) payload.poduszkaGotowki = p;

      const dane = await api.symulatorPlynnosciAnaliza(payload);
      setWynik(dane);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLiczy(false);
    }
  }

  // Wszystko policzone przez backend/lib — ekran tylko renderuje.
  const pods = wynik ? podsumowanieRekomendacji(wynik.rekomendacje) : null;
  const wykres = wynik ? przygotujWykresSalda(wynik.symulacja?.miesiace) : null;
  const tonLuki = pods ? tonNaTokeny(pods.ton, kolory) : null;
  const pierwszaWplata = Number(wynik?.symulacja?.pierwszaWplataMiesiac);
  const maPierwszaWplata = Number.isFinite(pierwszaWplata) && pierwszaWplata > 0;

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zanim wystartujesz, policz płynność. Pokażemy, ile własnej gotówki musisz wyłożyć na
        ludzi i materiały, zanim zobaczysz pierwszą złotówkę od zamawiającego — i czy Twoja
        poduszka to udźwignie. To wsad do decyzji „startować czy nie" obok szansy na wygraną.
      </Text>

      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Wejście: auto z SWZ/umowy + ręczna korekta ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>1. Wklej dokumenty kontraktu</Text>
        <Text style={styles.kartaOpis}>
          Z treści SWZ i wzoru umowy odczytamy automatycznie: harmonogram płatności (jedna
          faktura czy częściowe), termin zapłaty, zabezpieczenie należytego wykonania, zaliczkę
          i cenę. Wystarczy jeden z dokumentów.
        </Text>
        <TextField
          label="Treść SWZ"
          value={swz}
          onChangeText={setSwz}
          placeholder="Wklej tu treść SWZ…"
          multiline
          numberOfLines={5}
          inputStyle={styles.inputWielo}
        />
        <TextField
          label="Wzór umowy"
          value={umowa}
          onChangeText={setUmowa}
          placeholder="Wklej tu wzór umowy…"
          multiline
          numberOfLines={5}
          inputStyle={styles.inputWielo}
        />

        <Text style={[styles.kartaTytul, styles.blokOdstep]}>2. Skoryguj to, czego nie ma w dokumentach</Text>
        <TextField
          label="Miesięczne koszty (ludzie + materiały)"
          value={koszty}
          onChangeText={setKoszty}
          placeholder="np. 60000"
          keyboardType="numeric"
          hint="Ile realnie wydajesz z własnej kieszeni w miesiącu realizacji."
        />
        <TextField
          label="Czas trwania kontraktu (miesiące)"
          value={czas}
          onChangeText={setCzas}
          placeholder="np. 4"
          keyboardType="numeric"
          hint="Opcjonalnie — bez tego liczymy jeden miesiąc realizacji."
        />
        <TextField
          label="Twoja poduszka gotówki"
          value={poduszka}
          onChangeText={setPoduszka}
          placeholder="np. 120000"
          keyboardType="numeric"
          hint="Wolne środki, które możesz zamrozić na pomost. Brak → liczymy pesymistycznie (0 zł)."
        />

        <Button title="Policz płynność" onPress={policz} loading={liczy} style={styles.gap} />
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      {pods ? (
        <>
          {/* ── Wyraźny BOX luki finansowania ── */}
          <View style={[styles.lukaCard, { borderColor: tonLuki.tekst }]}>
            <View style={styles.lukaNaglowek}>
              <Text style={styles.lukaTytul}>Finansowanie pomostowe</Text>
              <Badge etykieta={pods.etykietaStatusu} ton={pods.ton} styles={styles} kolory={kolory} />
            </View>

            {pods.wymagaFinansowania ? (
              <>
                <Text style={[styles.lukaKwota, { color: tonLuki.tekst }]}>{pods.lukaLabel}</Text>
                <Text style={styles.lukaPodpis}>przez {pods.miesiaceLabel}</Text>
                <View style={styles.lukaRzad}>
                  <View style={styles.lukaKom}>
                    <Text style={styles.lukaKomEtykieta}>Twoja poduszka</Text>
                    <Text style={styles.lukaKomWartosc}>{pods.poduszkaLabel}</Text>
                  </View>
                  <View style={styles.lukaKom}>
                    <Text style={styles.lukaKomEtykieta}>Pokrycie luki</Text>
                    <Text style={styles.lukaKomWartosc}>{pods.pokrycieLabel}</Text>
                  </View>
                  <View style={styles.lukaKom}>
                    <Text style={styles.lukaKomEtykieta}>Brakuje</Text>
                    <Text style={styles.lukaKomWartosc}>{pods.brakujeLabel}</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={[styles.lukaKwota, { color: tonLuki.tekst }]}>Bez luki pomostowej</Text>
            )}

            <Text style={styles.lukaKomunikat}>{pods.komunikat || pods.opisStatusu}</Text>
          </View>

          {/* ── Oś miesięcznego salda narastającego ── */}
          <Text style={styles.sekcjaTytul}>Miesięczne saldo narastające</Text>
          <View style={styles.card}>
            <Text style={styles.kartaOpis}>
              Słupki poniżej zera (na czerwono) to pieniądze wyłożone z własnej kieszeni w danym
              miesiącu — najgłębszy dołek to szczyt zapotrzebowania na gotówkę.
            </Text>

            {wykres.pusta ? (
              <Text style={styles.pusto}>Brak danych do wykresu — uzupełnij koszty i policz ponownie.</Text>
            ) : (
              <View style={styles.osWrap}>
                {wykres.punkty.map((p) => (
                  <View key={p.miesiac} style={styles.osWiersz}>
                    <Text style={styles.osMiesiac}>Mies. {p.miesiac}</Text>
                    <View style={styles.osTor}>
                      <View
                        style={[
                          styles.osSlupek,
                          {
                            width: `${Math.max(2, Math.round(p.udzial * 100))}%`,
                            backgroundColor: p.ujemne ? kolory.danger : kolory.green,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.osKwota, { color: p.ujemne ? kolory.danger : kolory.sukcesAkcent }]}>
                      {p.saldoLabel}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {maPierwszaWplata ? (
              <Text style={styles.osStopka}>
                Pierwsza wpłata od zamawiającego: miesiąc {pierwszaWplata}.
              </Text>
            ) : null}
          </View>

          {/* ── Konkretne ruchy domknięcia luki ── */}
          {pods.ruchy.length > 0 ? (
            <>
              <Text style={styles.sekcjaTytul}>Jak domknąć lukę</Text>
              {pods.ruchy.map((r, i) => (
                <View key={`${r.typ ?? 'ruch'}-${i}`} style={styles.ruch}>
                  <View style={styles.ruchNaglowek}>
                    <Text style={styles.ruchTytul}>{r.tytul}</Text>
                    {r.oszczednoscLabel ? (
                      <Text style={styles.ruchKwota}>uwalnia ok. {r.oszczednoscLabel}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.ruchOpis}>{r.opis}</Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <Text style={styles.stopka}>
        Symulacja jest pesymistyczna dla płynności (braki liczymy na Twoją niekorzyść) i ma
        wesprzeć decyzję, a nie zastąpić własną kalkulację. Nie wysyłamy nic do zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleSymulatora = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.sm },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.xs },
  kartaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  blokOdstep: { marginTop: spacing.md },
  inputWielo: { minHeight: 96, textAlignVertical: 'top' },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  badge: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  // Box luki finansowania
  lukaCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  lukaNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lukaTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  lukaKwota: { fontSize: 30, fontWeight: '900', marginTop: spacing.sm, letterSpacing: 0.3 },
  lukaPodpis: { fontSize: 14, color: k.textMuted, marginTop: 2 },
  lukaRzad: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  lukaKom: { flex: 1 },
  lukaKomEtykieta: { fontSize: 11, color: k.textMuted, marginBottom: 2 },
  lukaKomWartosc: { fontSize: 15, fontWeight: '800', color: k.text },
  lukaKomunikat: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: spacing.md },

  // Oś salda narastającego
  osWrap: { gap: spacing.sm },
  osWiersz: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  osMiesiac: { width: 58, fontSize: 12, color: k.textMuted, fontWeight: '700' },
  osTor: {
    flex: 1,
    height: 18,
    backgroundColor: k.bg,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  osSlupek: { height: '100%', borderRadius: radius.sm },
  osKwota: { width: 96, fontSize: 12, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] },
  osStopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, fontStyle: 'italic' },

  // Ruch domknięcia luki
  ruch: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  ruchNaglowek: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  ruchTytul: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  ruchKwota: { fontSize: 12, fontWeight: '800', color: k.sukcesAkcent },
  ruchOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.xs },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
