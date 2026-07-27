import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  podsumujHarmonogram,
  podsumujPorownanie,
} from '../lib/zabezpieczenieZwrot';

/**
 * Panel „ODZYSKIWACZ ZABEZPIECZENIA — pilnuj zwrotu swoich pieniędzy po kontrakcie".
 *
 * Po podpisaniu umowy wykonawca zostawia zamawiającemu zabezpieczenie należytego wykonania
 * (zwykle 5% ceny). Pzp każe je zwrócić (art. 453): 70% w 30 dni od uznania zamówienia za
 * należycie wykonane, a zatrzymane ≤30% w 15 dni po upływie rękojmi/gwarancji. HACZYK: za
 * nieterminowy zwrot zamawiającemu NIE grozi żadna sankcja z Pzp, więc bez upominania się
 * pieniądze potrafią leżeć latami. Ten panel:
 *   • liczy harmonogram transz z terminami i ALARMUJE w dniu, w którym można żądać zwrotu,
 *   • przy przeterminowaniu nalicza odsetki i podpowiada ścieżkę z bezpodstawnego wzbogacenia
 *     (art. 405 KC), generując gotowe WEZWANIE DO ZWROTU,
 *   • przed podpisem porównuje realny koszt: zamrozić gotówkę na 5+ lat vs zapłacić prowizję
 *     za gwarancję bankową.
 *
 * Ekran NIC nie liczy z reguł — cały rachunek robi BEZSTANOWY backend
 * (`/api/przetarg/zabezpieczenie/*`, bez DB i bez płatnego AI). Formatowanie kwot/dni i
 * mapowanie statusu na `ton` żyją w testowanym `lib/zabezpieczenieZwrot.js`. Kolory wyłącznie
 * z tokenów motyw.js (kontrast AA) — lib podaje `ton`, token dokłada tu.
 */

/** Semantyczny ton (z lib) → para tokenów motyw.js (tło + tekst), AA. Jak w SymulatorPlynnosciScreen. */
function tonNaTokeny(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

/**
 * Pole liczbowe → liczba albo undefined. Zdejmuje spacje, „zł" i inne znaki, przecinek
 * traktuje jak kropkę. To parsowanie WEJŚCIA (string→number dla API), nie logika biznesowa.
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

export default function ZabezpieczenieZwrotScreen({ route }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleZabezpieczenia);

  const params = route?.params ?? {};
  const nazwa = params.nazwa ?? null;

  // ── Zabezpieczenie z umowy ──
  const [forma, setForma] = useState('gotowka');
  const [kwota, setKwota] = useState('');
  const [procentZatrzymany, setProcentZatrzymany] = useState('30');
  const [dataWykonania, setDataWykonania] = useState('');
  const [dataRekojmi, setDataRekojmi] = useState('');
  const [stopa, setStopa] = useState('');

  const [wynik, setWynik] = useState(null); // { harmonogram, alarm }
  const [liczy, setLiczy] = useState(false);
  const [blad, setBlad] = useState(null);

  // Wezwania generowane per transza (indeks → treść) + wskaźnik ładowania.
  const [wezwania, setWezwania] = useState({});
  const [wezwanieLiczy, setWezwanieLiczy] = useState(null);

  // ── Porównanie kosztu (przed podpisem) ──
  const [porKwota, setPorKwota] = useState('');
  const [porLata, setPorLata] = useState('5');
  const [porProwizja, setPorProwizja] = useState('');
  const [porKapital, setPorKapital] = useState('');
  const [porownanie, setPorownanie] = useState(null);
  const [porLiczy, setPorLiczy] = useState(false);
  const [porBlad, setPorBlad] = useState(null);

  /** „Dzisiaj" z zegara urządzenia (UI, nie logika) — wstrzykiwane do bezstanowego backendu. */
  function dzisiajISO() {
    return new Date().toISOString().slice(0, 10);
  }

  async function policz() {
    if (liczy) return;
    const k = naLiczbe(kwota);
    if (k == null || k <= 0) {
      setBlad('Podaj kwotę zabezpieczenia (np. 5% ceny kontraktu).');
      return;
    }
    if (!dataWykonania.trim() || !dataRekojmi.trim()) {
      setBlad('Podaj obie daty: uznania zamówienia za należycie wykonane oraz upływu rękojmi/gwarancji (RRRR-MM-DD).');
      return;
    }
    setLiczy(true);
    setBlad(null);
    setWezwania({});
    try {
      const payload = {
        kwota: k,
        dataNalezytegoWykonania: dataWykonania.trim(),
        dataUplywuRekojmi: dataRekojmi.trim(),
        dzisiaj: dzisiajISO(),
      };
      const p = naLiczbe(procentZatrzymany);
      if (p != null) payload.procentZatrzymany = p;
      const s = naLiczbe(stopa);
      if (s != null) payload.stopaRoczna = s;

      const dane = await api.zabezpieczenieHarmonogram(payload);
      setWynik(dane);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLiczy(false);
    }
  }

  async function generujWezwanie(i) {
    if (wezwanieLiczy != null) return;
    const transza = wynik?.harmonogram?.transze?.[i];
    if (!transza) return;
    setWezwanieLiczy(i);
    try {
      const payload = {
        kwota: transza.kwota,
        termin: transza.termin,
        dzisiaj: dzisiajISO(),
        tytulTranszy: transza.tytul,
        przedmiot: nazwa || undefined,
      };
      const s = naLiczbe(stopa);
      if (s != null) payload.stopaRoczna = s;
      const { wezwanie } = await api.zabezpieczenieWezwanie(payload);
      setWezwania((prev) => ({ ...prev, [i]: wezwanie.tresc }));
    } catch (err) {
      setWezwania((prev) => ({ ...prev, [i]: `Nie udało się wygenerować wezwania: ${err.message}` }));
    } finally {
      setWezwanieLiczy(null);
    }
  }

  async function policzPorownanie() {
    if (porLiczy) return;
    const k = naLiczbe(porKwota);
    const lata = naLiczbe(porLata);
    if (k == null || k <= 0) { setPorBlad('Podaj kwotę zabezpieczenia do porównania.'); return; }
    if (lata == null || lata <= 0) { setPorBlad('Podaj liczbę lat zamrożenia (np. okres rękojmi + realizacja).'); return; }
    setPorLiczy(true);
    setPorBlad(null);
    try {
      const payload = { kwota: k, lata };
      const prow = naLiczbe(porProwizja);
      if (prow != null) payload.prowizjaGwarancjiRocznaProc = prow;
      const kap = naLiczbe(porKapital);
      if (kap != null) payload.kosztKapitaluRocznyProc = kap;
      const { porownanie: p } = await api.zabezpieczeniePorownaj(payload);
      setPorownanie(p);
    } catch (err) {
      setPorBlad(err.message);
    } finally {
      setPorLiczy(false);
    }
  }

  // Wszystko policzone przez backend/lib — ekran tylko renderuje.
  const pods = wynik ? podsumujHarmonogram(wynik) : null;
  const podsPor = porownanie ? podsumujPorownanie(porownanie) : null;
  const tonAlarm = pods ? tonNaTokeny(pods.alarm ? 'ostrzezenie' : 'neutral', kolory) : null;

  const FORMY = [
    { klucz: 'gotowka', etykieta: 'Gotówka' },
    { klucz: 'gwarancja_bankowa', etykieta: 'Gwarancja bankowa' },
    { klucz: 'gwarancja_ubezpieczeniowa', etykieta: 'Gwar. ubezpieczeniowa' },
  ];

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Zabezpieczenie należytego wykonania (zwykle 5% ceny) to Twoje pieniądze zamrożone u
        zamawiającego. Za nieterminowy zwrot Pzp nie przewiduje dla niego żadnej sankcji, więc
        bez upominania się potrafią leżeć latami. Policz harmonogram zwrotu, a my zaalarmujemy
        w dniu, w którym możesz żądać pieniędzy — i przygotujemy gotowe wezwanie.
      </Text>

      {nazwa ? <Text style={styles.postepowanie}>{nazwa}</Text> : null}

      {/* ── Zabezpieczenie z umowy ── */}
      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Zabezpieczenie z Twojej umowy</Text>

        <Text style={styles.polLabel}>Forma zabezpieczenia</Text>
        <View style={styles.formaRzad}>
          {FORMY.map((f) => (
            <Button
              key={f.klucz}
              title={f.etykieta}
              variant={forma === f.klucz ? 'primary' : 'ghost'}
              onPress={() => setForma(f.klucz)}
              style={styles.formaChip}
            />
          ))}
        </View>

        <TextField
          label="Kwota zabezpieczenia (zł)"
          value={kwota}
          onChangeText={setKwota}
          placeholder="np. 50000"
          keyboardType="numeric"
          hint="Zwykle 5% ceny kontraktu (brutto)."
        />
        <TextField
          label="Zatrzymane na rękojmię (%)"
          value={procentZatrzymany}
          onChangeText={setProcentZatrzymany}
          placeholder="np. 30"
          keyboardType="numeric"
          hint="Ile zamawiający zatrzymuje do końca rękojmi/gwarancji (max 30%, art. 453 ust. 2 Pzp)."
        />
        <TextField
          label="Uznanie za należycie wykonane (data)"
          value={dataWykonania}
          onChangeText={setDataWykonania}
          placeholder="RRRR-MM-DD"
          autoCapitalize="none"
          hint="Od tego dnia biegnie 30 dni na zwrot 70% (art. 453 ust. 1 Pzp)."
        />
        <TextField
          label="Upływ rękojmi / gwarancji (data)"
          value={dataRekojmi}
          onChangeText={setDataRekojmi}
          placeholder="RRRR-MM-DD"
          autoCapitalize="none"
          hint="Zatrzymane ≤30% wraca w 15 dni po tym dniu (art. 453 ust. 3 Pzp)."
        />
        <TextField
          label="Stopa odsetek za opóźnienie (%/rok)"
          value={stopa}
          onChangeText={setStopa}
          placeholder="opcjonalnie, np. 11,25"
          keyboardType="numeric"
          hint="Do naliczenia odsetek przy przeterminowaniu. Brak → stawka domyślna."
        />

        <Button title="Policz harmonogram zwrotu" onPress={policz} loading={liczy} style={styles.gap} />
      </View>

      {blad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{blad}</Text></View>
      ) : null}

      {pods ? (
        <>
          {/* ── Alarm wymagalności ── */}
          <View style={[styles.alarmCard, { borderColor: tonAlarm.tekst }]}>
            <View style={styles.alarmNaglowek}>
              <Text style={styles.alarmTytul}>Zabezpieczenie: {pods.kwotaLabel}</Text>
              <Badge etykieta={pods.alarm ? 'Możesz żądać' : 'W toku'} ton={pods.alarm ? 'ostrzezenie' : 'neutral'} styles={styles} kolory={kolory} />
            </View>
            <Text style={styles.alarmPodpis}>{pods.zatrzymanieLabel}</Text>
            {pods.alarmTekst ? <Text style={[styles.alarmKomunikat, { color: tonAlarm.tekst }]}>{pods.alarmTekst}</Text> : null}
          </View>

          {/* ── Transze zwrotu ── */}
          <Text style={styles.sekcjaTytul}>Harmonogram zwrotu</Text>
          {pods.transze.map((t, i) => {
            const ton = tonNaTokeny(t.ton, kolory);
            const mozeZadac = t.status === 'wymagalne' || t.status === 'przeterminowane';
            return (
              <View key={t.etap ?? i} style={[styles.transza, { borderLeftColor: ton.tekst }]}>
                <View style={styles.transzaNaglowek}>
                  <Text style={styles.transzaTytul}>{t.tytul}</Text>
                  <Badge etykieta={t.etykietaStatusu} ton={t.ton} styles={styles} kolory={kolory} />
                </View>
                <View style={styles.transzaRzad}>
                  <Text style={styles.transzaKwota}>{t.kwotaLabel}</Text>
                  <Text style={styles.transzaProcent}>{t.procentLabel}</Text>
                </View>
                <Text style={styles.transzaMeta}>Termin zwrotu: {t.termin || '—'} · {t.wymagalnoscTekst}</Text>
                {t.odsetkiLabel ? (
                  <Text style={[styles.transzaOdsetki, { color: kolory.danger }]}>
                    Odsetki za opóźnienie: {t.odsetkiLabel}
                  </Text>
                ) : null}

                {mozeZadac ? (
                  <Button
                    title="Generuj wezwanie do zwrotu"
                    variant="primary"
                    onPress={() => generujWezwanie(i)}
                    loading={wezwanieLiczy === i}
                    style={styles.gap}
                  />
                ) : null}

                {wezwania[i] ? (
                  <View style={styles.pismoCard}>
                    <Text style={styles.pismoNota}>Gotowe pismo — przytrzymaj, aby zaznaczyć i skopiować:</Text>
                    <Text style={styles.pismoTresc} selectable>{wezwania[i]}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}

      {/* ── Przed podpisem: gotówka czy gwarancja? ── */}
      <Text style={styles.sekcjaTytul}>Przed podpisem: gotówka czy gwarancja?</Text>
      <View style={styles.card}>
        <Text style={styles.kartaOpis}>
          Zanim wybierzesz formę zabezpieczenia, porównaj realny koszt: zamrożenie własnej
          gotówki na kilka lat (utracony zwrot / koszt kapitału) kontra prowizja banku za
          gwarancję. Pokażemy, która opcja wychodzi taniej.
        </Text>
        <TextField
          label="Kwota zabezpieczenia (zł)"
          value={porKwota}
          onChangeText={setPorKwota}
          placeholder="np. 100000"
          keyboardType="numeric"
        />
        <TextField
          label="Na ile lat zamrożone"
          value={porLata}
          onChangeText={setPorLata}
          placeholder="np. 5"
          keyboardType="numeric"
          hint="Zwykle realizacja + okres rękojmi/gwarancji."
        />
        <TextField
          label="Prowizja gwarancji (%/rok)"
          value={porProwizja}
          onChangeText={setPorProwizja}
          placeholder="opcjonalnie, np. 1,5"
          keyboardType="numeric"
        />
        <TextField
          label="Koszt kapitału (%/rok)"
          value={porKapital}
          onChangeText={setPorKapital}
          placeholder="opcjonalnie, np. 8"
          keyboardType="numeric"
          hint="Ile realnie kosztuje Cię zamrożona gotówka (kredyt obrotowy / utracony zwrot)."
        />
        <Button title="Porównaj koszt" onPress={policzPorownanie} loading={porLiczy} style={styles.gap} />
      </View>

      {porBlad ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{porBlad}</Text></View>
      ) : null}

      {podsPor ? (
        <View style={styles.card}>
          <View style={styles.porRzad}>
            <View style={styles.porKom}>
              <Text style={styles.porEtykieta}>Zamrożona gotówka</Text>
              <Text style={styles.porWartosc}>{podsPor.gotowkaLabel}</Text>
            </View>
            <View style={styles.porKom}>
              <Text style={styles.porEtykieta}>Prowizja za gwarancję</Text>
              <Text style={styles.porWartosc}>{podsPor.gwarancjaLabel}</Text>
            </View>
          </View>
          <Text style={[styles.porRekomendacja, { color: kolory.sukcesAkcent }]}>{podsPor.rekomendacja}</Text>
          <Text style={styles.porZalozenia}>{podsPor.zalozeniaTekst}</Text>
        </View>
      ) : null}

      <Text style={styles.stopka}>
        To narzędzie pomocnicze — daty i kwoty zweryfikuj z umową, a aktualną stawkę odsetek
        ustawowych za opóźnienie sprawdź na dzień wezwania. Nie wysyłamy nic do zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleZabezpieczenia = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  postepowanie: { fontSize: 15, fontWeight: '800', color: k.text, marginBottom: spacing.sm, lineHeight: 20 },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  gap: { marginTop: spacing.sm },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  kartaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  polLabel: { fontSize: 14, fontWeight: '600', color: k.text, marginBottom: 6 },
  formaRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  formaChip: { height: 40, flexGrow: 1, paddingHorizontal: spacing.sm },

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

  // Alarm wymagalności
  alarmCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  alarmNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  alarmTytul: { flex: 1, fontSize: 17, fontWeight: '900', color: k.text },
  alarmPodpis: { fontSize: 13, color: k.textMuted, marginTop: 4 },
  alarmKomunikat: { fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: spacing.sm },

  // Transza zwrotu
  transza: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  transzaNaglowek: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  transzaTytul: { flex: 1, fontSize: 14, fontWeight: '700', color: k.text, lineHeight: 19 },
  transzaRzad: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.sm },
  transzaKwota: { fontSize: 22, fontWeight: '900', color: k.text, letterSpacing: 0.2 },
  transzaProcent: { fontSize: 14, fontWeight: '800', color: k.textMuted },
  transzaMeta: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.xs },
  transzaOdsetki: { fontSize: 13, fontWeight: '800', marginTop: spacing.xs },

  // Wygenerowane pismo
  pismoCard: {
    backgroundColor: k.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  pismoNota: { fontSize: 12, color: k.textMuted, marginBottom: spacing.xs },
  pismoTresc: { fontSize: 12, color: k.text, lineHeight: 18, fontVariant: ['tabular-nums'] },

  // Porównanie kosztu
  porRzad: { flexDirection: 'row', gap: spacing.md },
  porKom: { flex: 1 },
  porEtykieta: { fontSize: 12, color: k.textMuted, marginBottom: 2 },
  porWartosc: { fontSize: 18, fontWeight: '900', color: k.text },
  porRekomendacja: { fontSize: 14, fontWeight: '800', lineHeight: 20, marginTop: spacing.md },
  porZalozenia: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.xs, fontStyle: 'italic' },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
