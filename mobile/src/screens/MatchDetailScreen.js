import { useState, useEffect } from 'react';
import { View, Text, Alert, Linking, Pressable, Switch, ActivityIndicator, TextInput, Share } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import StatusPicker from '../components/StatusPicker';
import { ScoreBadge } from '../components/MatchCard';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius } from '../theme';
import { opisOceny, opisTerminu } from '../lib/termin';
import { opisCpv } from '../lib/cpv';
import { formatDate, formatBudget } from '../lib/format';
import { STATUS_DOMYSLNY } from '../lib/statusPrzetargu';
import {
  wczytajKontrole,
  oznaczWniosekWyslany,
  STATUSY_KONTROLI,
} from '../lib/poprzetargowaKontrola';
import { uruchomSciezkeOdwolania } from '../lib/orkiestratorOdwolania';
import { wygeneruj_wniosek_o_protokol } from '../lib/wniosekProtokol';
import { pobierzDokument } from '../services/dokumenty';
import { zaplanujPowiadomienieOTerminieKio } from '../services/powiadomieniaKio';
import * as storage from '../lib/storage';
import { opisWadium } from '../lib/wadium';
import { opisKryterium, opisCzesci } from '../lib/ogloszenieMeta';
import { opisWyniki } from '../lib/wyniki';

/** Etykieta etapu kontroli (STATUSY_KONTROLI); brak kontroli → pierwszy etap „Nowa". */
function etykietaEtapuKontroli(status) {
  const wpis = STATUSY_KONTROLI.find((s) => s.wartosc === status) ?? STATUSY_KONTROLI[0];
  return wpis.etykieta;
}

function Row({ styles, label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function MatchDetailScreen({ route, navigation }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleSzczegolow);
  const { isSaved, toggle } = useSaved();
  const { match } = route.params;
  const tender = match.tender;
  const ocena = opisOceny(match.scorer);
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);
  // Stan przypomnienia: znany, gdy weszliśmy z ekranu „Zapisane"; inaczej domyślnie off.
  const [przypomnienie, setPrzypomnienie] = useState(match.reminder_enabled === true);
  // Wyjaśnienie AI (D-052) — leniwe: generujemy dopiero na żądanie (koszt AI).
  const [streszczenie, setStreszczenie] = useState(null);
  const [strLoading, setStrLoading] = useState(false);
  const [strBlad, setStrBlad] = useState(null);
  // Warsztat przetargu (D-054) — etap pracy + prywatna notatka (znane, gdy wszedł z „Zapisane").
  const [status, setStatus] = useState(match.status || STATUS_DOMYSLNY);
  const [notatka, setNotatka] = useState(match.notatka || '');
  const [notatkaZapis, setNotatkaZapis] = useState('idle'); // idle | zapisywanie | zapisano
  // Statystyki wyników (R17) — lekki odczyt, pobierany raz na wejściu (bez kosztu AI).
  const [wyniki, setWyniki] = useState(null);
  // Poprzetargowa kontrola oferty zwycięzcy (podzadanie 6/13) — tylko dla przegranej.
  const [kontrola, setKontrola] = useState(null);
  const [wniosekBusy, setWniosekBusy] = useState(false);

  useEffect(() => {
    let aktywny = true;
    api.getWyniki(match.id)
      .then((d) => { if (aktywny && d.wyniki) setWyniki(opisWyniki(d.wyniki)); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, [match.id]);

  // Kontrola jest kluczowana po `tender.id` (patrz utworzKontrolePoPrzegranej).
  // Ładujemy ją dopiero, gdy etap = „przegrana", i odświeżamy przy zmianie etapu.
  useEffect(() => {
    if (status !== 'przegrana') { setKontrola(null); return; }
    let aktywny = true;
    wczytajKontrole(storage, tender.id)
      .then((k) => { if (aktywny) setKontrola(k); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, [tender.id, status]);

  const zapisany = isSaved(match.id);
  const budget = formatBudget(tender.budget, tender.currency);
  const cpv = opisCpv(tender.cpv);
  const wadium = opisWadium(tender);
  const kryterium = opisKryterium(tender);
  const czesci = opisCzesci(tender);
  // Jedno źródło prawdy o terminie — wcześniej `daysUntil` nie odróżniał
  // terminu minionego od nieznanego i po prostu nic nie pokazywał.
  const termin = opisTerminu(tender.deadline);
  const deadlineText = `${formatDate(tender.deadline)}  ·  ${termin.etykieta}`;
  const maTermin = !!tender.deadline && !termin.minal;
  // Wniosek już poszedł, gdy kontrola przeszła poza etap „nowa".
  const wniosekWyslany = !!kontrola && kontrola.status !== 'nowa';
  // Analiza gotowa → mamy wynik do pokazania na osobnym ekranie (podzadanie 12/13).
  const analizaGotowa = !!kontrola?.analiza;

  async function przelaczZapis() {
    try {
      const teraz = await toggle(match.id);
      if (!teraz) setPrzypomnienie(false); // usunięto z zakładek → przypomnienie też gaśnie
    } catch (err) {
      Alert.alert('Błąd', err.message);
    }
  }

  async function przelaczPrzypomnienie(wartosc) {
    setPrzypomnienie(wartosc);
    try {
      // Przypomnienie wymaga zapisu — gdy przetarg nie jest jeszcze w zakładkach, dopisz go.
      if (wartosc && !zapisany) await toggle(match.id);
      const stan = await api.setReminder(match.id, wartosc);
      setPrzypomnienie(stan.reminder_enabled);
    } catch (err) {
      setPrzypomnienie(!wartosc);
      Alert.alert('Błąd', err.message);
    }
  }

  async function zmienStatus(nowy) {
    const poprzedni = status;
    setStatus(nowy); // optymistycznie
    try {
      if (!zapisany) await toggle(match.id); // etap wymaga zapisu — dopisz do zakładek
      await api.setStatus(match.id, nowy);
      // Przegrana → uruchom ścieżkę odwołania (podzadanie 13/13): załóż kontrolę,
      // wylicz termin KIO i zaplanuj przypomnienie o zbliżającym się terminie.
      // Best-effort: błąd tej ścieżki NIE może cofnąć zmiany statusu.
      if (nowy === 'przegrana') {
        uruchomSciezkeOdwolania(storage, tender)
          .then((k) => {
            if (!k) return;
            setKontrola(k); // od razu pokaż wyliczony termin, nie czekając na przeładowanie
            zaplanujPowiadomienieOTerminieKio(k).catch(() => {});
          })
          .catch(() => {});
      }
    } catch (err) {
      setStatus(poprzedni);
      Alert.alert('Błąd', err.message);
    }
  }

  // Przycisk „Wygeneruj wniosek" (podzadanie 6/13): generuje pismo o protokół
  // (czysta funkcja z 5/13), pobiera/udostępnia je i przesuwa etap kontroli na
  // „wniosek_wysłany". Samo generowanie pisma jest lokalne — bez kosztu AI/API.
  async function wygenerujWniosek() {
    setWniosekBusy(true);
    try {
      const dok = wygeneruj_wniosek_o_protokol(tender, {
        dataPisma: new Date().toISOString().slice(0, 10),
      });
      await pobierzDokument(dok);
      const zaktualizowana = await oznaczWniosekWyslany(storage, tender.id);
      if (zaktualizowana) setKontrola(zaktualizowana);
    } catch (err) {
      Alert.alert('Nie udało się wygenerować wniosku', err.message);
    } finally {
      setWniosekBusy(false);
    }
  }

  // Przejście na ekran wyniku kontroli (podzadanie 12/13). Params serializowalne —
  // przekazujemy kontrolę jako zwykły obiekt (toJSON), ekran tylko wyświetla dane.
  function otworzWynikKontroli() {
    if (!kontrola) return;
    navigation.navigate('WynikKontroli', { tender, kontrola: kontrola.toJSON() });
  }

  async function zapiszNotatke() {
    setNotatkaZapis('zapisywanie');
    try {
      if (!zapisany) await toggle(match.id);
      const stan = await api.setNotatka(match.id, notatka);
      setNotatka(stan.notatka);
      setNotatkaZapis('zapisano');
    } catch (err) {
      setNotatkaZapis('idle');
      Alert.alert('Błąd', err.message);
    }
  }

  async function wyjasnij() {
    setStrLoading(true);
    setStrBlad(null);
    try {
      const odp = await api.getStreszczenie(match.id);
      if (odp.streszczenie) setStreszczenie(odp.streszczenie);
      else setStrBlad(odp.komunikat || 'Nie udało się wygenerować wyjaśnienia.');
    } catch (err) {
      setStrBlad(err.message);
    } finally {
      setStrLoading(false);
    }
  }

  async function handleFeedback(helpful) {
    setSending(true);
    try {
      await api.sendFeedback(match.id, helpful);
      setFeedback(helpful ? 'up' : 'down');
    } catch (err) {
      Alert.alert('Błąd', err.message);
    } finally {
      setSending(false);
    }
  }

  async function udostepnij() {
    // Wykonawcy konsultują przetargi z partnerami/podwykonawcami — dajemy im to wprost.
    const linie = [
      tender.title,
      tender.organization ? `Zamawiający: ${tender.organization}` : null,
      `Termin składania ofert: ${formatDate(tender.deadline)}`,
      tender.url || null,
      '— znalezione w PrzetargAI, monitoring przetargów publicznych: https://przetargai.web.app',
    ].filter(Boolean);
    try {
      await Share.share({ message: linie.join('\n'), url: tender.url || undefined, title: tender.title });
    } catch {
      /* użytkownik anulował udostępnianie — nic nie robimy */
    }
  }

  async function openInBzp() {
    if (!tender.url) return;
    try {
      const canOpen = await Linking.canOpenURL(tender.url);
      if (canOpen) await Linking.openURL(tender.url);
      else Alert.alert('Nie można otworzyć linku', tender.url);
    } catch {
      Alert.alert('Nie można otworzyć linku', tender.url);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <ScoreBadge score={match.confidence_score} size="lg" />
        <Text style={styles.title}>{tender.title}</Text>
      </View>

      <View style={styles.card}>
        <Row styles={styles} label="Zamawiający" value={tender.organization || 'brak danych'} />
        <Row styles={styles} label="Termin składania ofert" value={deadlineText} />
        {wadium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Wadium</Text>
            <Text style={[styles.rowValue, wadium.ostrzezenie && { color: kolory.ostrzezenieTekst }]}>
              {wadium.wartosc}
            </Text>
            {wadium.podpis ? <Text style={styles.wadiumPodpis}>{wadium.podpis}</Text> : null}
          </View>
        ) : null}
        {kryterium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Kryterium oceny</Text>
            <Text style={styles.rowValue}>{kryterium.wartosc}</Text>
            <Text style={styles.wadiumPodpis}>{kryterium.podpis}</Text>
          </View>
        ) : null}
        {czesci ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Części</Text>
            <Text style={styles.rowValue}>{czesci.wartosc}</Text>
            <Text style={styles.wadiumPodpis}>{czesci.podpis}</Text>
          </View>
        ) : null}
        {budget ? <Row styles={styles} label="Szacowana wartość" value={budget} /> : null}
        <Row styles={styles} label={cpv.etykieta} value={cpv.wartosc} last />
      </View>

      <Pressable
        style={styles.sciezkaCta}
        onPress={() => navigation.navigate('SciezkaDoOferty', { match })}
        accessibilityRole="button"
      >
        <Text style={styles.sciezkaCtaTytul}>🏆 Krok po kroku do wygranej</Text>
        <Text style={styles.sciezkaCtaOpis}>
          Przewodnik: co zrobić na każdym etapie — od SWZ po złożenie oferty. Odhaczaj postęp.
        </Text>
        <Text style={styles.sciezkaCtaLink}>Otwórz przewodnik →</Text>
      </Pressable>

      {wyniki ? (
        <>
          <Text style={styles.sectionTitle}>Za ile się to robi (Twój region i branża)</Text>
          <View style={styles.card}>
            {wyniki.cena ? <Text style={styles.wynikWiersz}>{wyniki.cena}</Text> : null}
            {wyniki.konkurencja ? <Text style={styles.wynikWiersz}>{wyniki.konkurencja}</Text> : null}
            {wyniki.maly ? <Text style={styles.wynikWiersz}>{wyniki.maly}</Text> : null}
            <Text style={styles.wynikPodpis}>{wyniki.podpis}</Text>
          </View>
        </>
      ) : null}

      <View style={styles.akcjeCard}>
        <Pressable
          onPress={przelaczZapis}
          style={styles.zapiszRzad}
          accessibilityRole="button"
          accessibilityState={{ selected: zapisany }}
        >
          <Text style={[styles.gwiazdka, { color: zapisany ? kolory.blue : kolory.textMuted }]}>
            {zapisany ? '★' : '☆'}
          </Text>
          <Text style={styles.zapiszTekst}>{zapisany ? 'Zapisany w zakładkach' : 'Zapisz przetarg'}</Text>
        </Pressable>

        <View style={styles.przypRzad}>
          <View style={styles.przypInfo}>
            <Text style={styles.przypTytul}>Przypomnij przed terminem</Text>
            <Text style={styles.przypOpis}>
              {maTermin
                ? 'Push na 7, 3 i 1 dzień przed terminem składania ofert.'
                : 'Ten przetarg nie ma terminu do przypomnienia.'}
            </Text>
          </View>
          <Switch
            value={przypomnienie}
            onValueChange={przelaczPrzypomnienie}
            disabled={!maTermin}
            trackColor={{ true: kolory.blue }}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Zanim wystartujesz — policz płynność</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Sprawdź, ile własnej gotówki musisz wyłożyć, zanim zamawiający zapłaci — i czy Twoja
          poduszka to udźwignie. Symulator czyta warunki płatności z SWZ i wzoru umowy, a wynik
          (luka pomostowa i konkretne ruchy) to wsad do decyzji „startować czy nie" obok szansy
          na wygraną.
        </Text>
        <Button
          title="Otwórz symulator płynności"
          onPress={() => navigation.navigate('SymulatorPlynnosci', { nazwa: tender.title })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>Podpisujesz umowę? Odzyskaj zabezpieczenie</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Zabezpieczenie należytego wykonania (zwykle 5% ceny) to Twoje pieniądze zamrożone u
          zamawiającego. Policzymy harmonogram zwrotu (art. 453 Pzp) i zaalarmujemy w dniu, w
          którym możesz żądać pieniędzy — z gotowym wezwaniem. Przed podpisem porównamy koszt:
          zamrozić gotówkę czy zapłacić za gwarancję bankową.
        </Text>
        <Button
          title="Otwórz odzyskiwacz zabezpieczenia"
          onPress={() => navigation.navigate('ZabezpieczenieZwrot', { nazwa: tender.title })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>Narzędzia do tej oferty</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Nie musisz być najtańszy — sprawdź, o ile drożej możesz dać, wygrywając kryteriami.
          Zanim złożysz wadium gwarancją, przekontroluj jej treść. A gdy przyjdzie wezwanie do
          uzupełnienia — odlicz czas i nie odpadnij formalnie.
        </Text>
        <Button
          title="Kalkulator ceny ofertowej"
          onPress={() => navigation.navigate('KalkulatorCeny', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Kalkulator punktów (cena punktu)"
          onPress={() => navigation.navigate('KalkulatorPunktow', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Symulator punktacji oferty"
          onPress={() => navigation.navigate('SymulatorPunktacji', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Kontroler gwarancji wadialnej"
          onPress={() => navigation.navigate('KontrolerGwarancji', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Strażnik wezwania do uzupełnienia"
          onPress={() => navigation.navigate('StraznikWezwania', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Asystent obrony ceny (art. 224)"
          onPress={() => navigation.navigate('ObronaCeny', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Kalkulator kar umownych"
          onPress={() => navigation.navigate('KaryUmowne', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Strażnik terminu związania ofertą"
          onPress={() => navigation.navigate('TerminZwiazania', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Wykrywacz obowiązkowej wizji lokalnej"
          onPress={() => navigation.navigate('WizjaLokalna', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Strażnik oświadczenia konsorcjum (art. 117)"
          onPress={() => navigation.navigate('Konsorcjum', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Tarcza tajemnicy przedsiębiorstwa"
          onPress={() => navigation.navigate('Tajemnica', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Kreator samooczyszczenia (art. 110)"
          onPress={() => navigation.navigate('Samooczyszczenie', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title="Kalkulator terminów (dni robocze, święta)"
          onPress={() => navigation.navigate('KalkulatorTerminow', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>Etap i notatki</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Prowadź ten przetarg: ustaw etap pracy i zapisz własne notatki
          (np. jakie dokumenty zebrać, o co dopytać zamawiającego).
        </Text>

        <Text style={styles.warsztatEtykieta}>Etap</Text>
        <StatusPicker wartosc={status} onChange={zmienStatus} />

        <Text style={[styles.warsztatEtykieta, styles.warsztatOdstep]}>Moja notatka</Text>
        <TextInput
          style={styles.notatka}
          value={notatka}
          onChangeText={(t) => { setNotatka(t); setNotatkaZapis('idle'); }}
          placeholder="np. Zebrać: KRS, referencje z 2 podobnych robót. Dopytać o termin realizacji."
          placeholderTextColor={kolory.textMuted}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.notatkaStopka}>
          <Text style={styles.notatkaStan}>
            {notatkaZapis === 'zapisywanie' ? 'Zapisywanie…' : notatkaZapis === 'zapisano' ? 'Zapisano ✓' : ' '}
          </Text>
          <Button
            title="Zapisz notatkę"
            onPress={zapiszNotatke}
            variant="ghost"
            loading={notatkaZapis === 'zapisywanie'}
            style={styles.notatkaBtn}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Składasz ofertę? Włącz rejestrator</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Rejestrator prowadzi wysyłkę krok po kroku i utrwala dowody (zrzuty, suma
          kontrolna oferty, przebieg sesji). Jeśli platforma zawiedzie, jednym ruchem
          złożysz pakiet dowodowy i pismo o przedłużenie terminu — złóż ofertę z zapasem
          24 h przed terminem.
        </Text>
        <Button
          title="Otwórz rejestrator oferty"
          onPress={() => navigation.navigate('RejestratorOferty', {
            termin: tender.deadline,
            postepowanieId: match.id,
            nazwa: tender.title,
          })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      {status === 'przegrana' ? (
        <>
          <Text style={styles.sectionTitle}>Przegrana? Prześwietl ofertę zwycięzcy</Text>
          <View style={styles.card}>
            <Text style={styles.strPodtytul}>
              Oferty są jawne od otwarcia (załączniki najpóźniej 3 dni po). Złóż wniosek o
              udostępnienie protokołu i ofert konkurencji — potem sprawdzimy ofertę zwycięzcy
              pod kątem podstaw do odwołania do KIO.
            </Text>

            <View style={styles.kontrolaEtapRzad}>
              <Text style={styles.kontrolaEtapEtykieta}>Etap kontroli</Text>
              <Text style={styles.kontrolaEtapWartosc}>{etykietaEtapuKontroli(kontrola?.status)}</Text>
            </View>

            {wniosekWyslany && !analizaGotowa ? (
              <Text style={styles.kontrolaInfo}>
                Wniosek wygenerowany. Wyślij go do zamawiającego i zaznacz otrzymanie
                dokumentów, gdy dotrą — wtedy ruszy analiza oferty zwycięzcy.
              </Text>
            ) : null}

            {analizaGotowa ? (
              <>
                <Text style={styles.kontrolaInfo}>
                  Analiza oferty zwycięzcy gotowa. Zobacz listę zarzutów, ocenę szans i
                  termin na odwołanie do KIO.
                </Text>
                <Button
                  title="Zobacz wynik kontroli"
                  onPress={otworzWynikKontroli}
                  variant="primary"
                  style={styles.gap}
                />
              </>
            ) : null}

            <Button
              title={wniosekWyslany ? 'Wygeneruj wniosek ponownie' : 'Wygeneruj wniosek'}
              onPress={wygenerujWniosek}
              loading={wniosekBusy}
              variant={wniosekWyslany ? 'ghost' : 'primary'}
              style={styles.gap}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Wyjaśnienie AI</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          Prosty opis ogłoszenia przygotowany przez AI na podstawie danych przetargu
          (nie zastępuje pełnej specyfikacji SIWZ).
        </Text>

        {streszczenie ? (
          <View style={styles.strTresc}>
            <Text style={styles.strAkapit}>{streszczenie.czego_dotyczy}</Text>

            {streszczenie.dokumenty?.length ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Co zwykle trzeba przygotować</Text>
                {streszczenie.dokumenty.map((d, i) => (
                  <View key={i} style={styles.strPunktRzad}>
                    <Text style={styles.strKropka}>•</Text>
                    <Text style={styles.strPunkt}>{d}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {streszczenie.na_co_uwaga ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Na co zwrócić uwagę</Text>
                <Text style={styles.strAkapit}>{streszczenie.na_co_uwaga}</Text>
              </View>
            ) : null}

            {streszczenie.ocena ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>Ocena dla małej firmy</Text>
                <Text style={styles.strAkapit}>{streszczenie.ocena}</Text>
              </View>
            ) : null}
          </View>
        ) : strLoading ? (
          <View style={styles.strLadowanie}>
            <ActivityIndicator color={kolory.blue} />
            <Text style={styles.strLadowanieTekst}>AI analizuje ogłoszenie…</Text>
          </View>
        ) : (
          <View style={styles.strStart}>
            {strBlad ? <Text style={styles.strBlad}>{strBlad}</Text> : null}
            <Button
              title={strBlad ? 'Spróbuj ponownie' : 'Wyjaśnij ten przetarg'}
              onPress={wyjasnij}
              variant="ghost"
            />
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Dlaczego to dopasowanie?</Text>
      <View style={styles.card}>
        <Text style={styles.reasoning}>{match.reasoning || 'Brak uzasadnienia.'}</Text>
        {/*
          Backend zapisuje, czy ocenił model, czy sama heurystyka — ale aplikacja
          tego nie pokazywała. Mechaniczne trafienie w słowo kluczowe wyglądało
          identycznie jak ocena AI (audyt 2026-07-10). To kwestia zaufania:
          użytkownik ma prawo wiedzieć, na czym opiera się liczba na karcie.
        */}
        <View style={styles.zrodloOceny}>
          <Text style={styles.zrodloEtykieta}>{ocena.etykieta}</Text>
          <Text style={styles.zrodloOpis}>{ocena.opis}</Text>
        </View>
      </View>

      {tender.url ? (
        <Button
          // Od D-039 ogłoszenia płyną z wielu źródeł — etykieta mówi, DOKĄD prowadzi link.
          title={`Otwórz ogłoszenie w ${tender.source === 'ted' ? 'TED (UE)' : 'BZP'}`}
          onPress={openInBzp}
          style={styles.gap}
        />
      ) : null}

      <Button
        title="Udostępnij przetarg"
        variant="ghost"
        onPress={udostepnij}
        style={styles.gap}
      />

      <Text style={styles.sectionTitle}>Czy to dopasowanie było trafne?</Text>
      {feedback ? (
        <Text style={styles.feedbackDone}>
          {feedback === 'up'
            ? 'Dziękujemy! Cieszymy się, że trafione.'
            : 'Dziękujemy za informację — wykorzystamy ją do poprawy dopasowań.'}
        </Text>
      ) : (
        <View style={styles.feedbackRow}>
          <Button
            title="👍 Trafne"
            variant="ghost"
            onPress={() => handleFeedback(true)}
            loading={sending}
            style={styles.feedbackBtn}
          />
          <Button
            title="👎 Nietrafne"
            variant="ghost"
            onPress={() => handleFeedback(false)}
            loading={sending}
            style={styles.feedbackBtn}
          />
        </View>
      )}
    </Screen>
  );
}

const tworzStyleSzczegolow = tworzStyle((k) => ({
  akcjeCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  zapiszRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  gwiazdka: { fontSize: 24, lineHeight: 26, fontWeight: '700' },
  zapiszTekst: { fontSize: 15, fontWeight: '700', color: k.text },
  przypRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  przypInfo: { flex: 1 },
  przypTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  przypOpis: { fontSize: 12, color: k.textMuted, marginTop: 2, lineHeight: 17 },
  zrodloOceny: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  zrodloEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue },
  zrodloOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: k.text, lineHeight: 24 },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: k.textMuted, marginBottom: 2 },
  rowValue: { fontSize: 15, color: k.text, fontWeight: '600' },
  wadiumPodpis: { fontSize: 12, color: k.textMuted, marginTop: 3, lineHeight: 16 },
  wynikWiersz: { fontSize: 15, color: k.text, lineHeight: 22, marginBottom: 6 },
  wynikPodpis: { fontSize: 12, color: k.textMuted, marginTop: 4, lineHeight: 16, fontStyle: 'italic' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: k.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reasoning: { fontSize: 15, color: k.text, lineHeight: 22 },
  strPodtytul: { fontSize: 12, color: k.textMuted, lineHeight: 17, fontStyle: 'italic' },
  warsztatEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: spacing.md, marginBottom: spacing.sm },
  warsztatOdstep: { marginTop: spacing.lg },
  notatka: {
    minHeight: 88, borderWidth: 1, borderColor: k.border, borderRadius: radius.md ?? 10,
    padding: spacing.sm, fontSize: 15, color: k.text, backgroundColor: k.bg ?? k.surface,
  },
  notatkaStopka: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  notatkaStan: { fontSize: 12, color: k.textMuted, fontWeight: '600' },
  notatkaBtn: { minWidth: 140 },
  strStart: { marginTop: spacing.md, gap: spacing.sm },
  strBlad: { fontSize: 13, color: k.textMuted, lineHeight: 18 },
  strLadowanie: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strLadowanieTekst: { fontSize: 14, color: k.textMuted },
  strTresc: { marginTop: spacing.md, gap: spacing.md },
  strAkapit: { fontSize: 15, color: k.text, lineHeight: 22 },
  strBlok: { gap: spacing.xs ?? 4 },
  strNaglowek: { fontSize: 13, fontWeight: '700', color: k.blue, marginBottom: 2 },
  strPunktRzad: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  strKropka: { fontSize: 15, color: k.blue, lineHeight: 22 },
  strPunkt: { flex: 1, fontSize: 15, color: k.text, lineHeight: 22 },
  gap: { marginTop: spacing.lg },
  sciezkaCta: { backgroundColor: k.blue, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  sciezkaCtaTytul: { fontSize: 16, fontWeight: '800', color: k.white },
  sciezkaCtaOpis: { fontSize: 13, color: k.white, opacity: 0.92, lineHeight: 18, marginTop: 4 },
  sciezkaCtaLink: { fontSize: 14, fontWeight: '800', color: k.white, marginTop: 8 },
  kontrolaEtapRzad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  kontrolaEtapEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue },
  kontrolaEtapWartosc: { fontSize: 15, fontWeight: '700', color: k.text },
  kontrolaInfo: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: spacing.sm },
  feedbackRow: { flexDirection: 'row', gap: spacing.md },
  feedbackBtn: { flex: 1 },
  feedbackDone: { fontSize: 14, color: k.green, fontWeight: '600' },
}));
