import { useState, useEffect } from 'react';
import { View, Text, Alert, Pressable, Switch, ActivityIndicator, TextInput, Share } from 'react-native';
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
import { orientacyjnaWartosc, ZRODLO_BENCHMARKU } from '../lib/wartosciBenchmark';
import { nazwaWojewodztwa } from '../lib/wojewodztwa';
import { opisKryterium, opisCzesci } from '../lib/ogloszenieMeta';
import { opisWyniki } from '../lib/wyniki';
import PodpisZrodla, { PrzyciskOryginalu, ZrodlaAlternatywne } from '../components/PodpisZrodla';
import Wyjasnienie from '../components/Wyjasnienie';
import { pelnaNazwaZrodla } from '../lib/zrodlaDanych';
import { useJezyk } from '../context/JezykContext';

/** Etykieta etapu kontroli (STATUSY_KONTROLI); brak kontroli → pierwszy etap „Nowa". */
function etykietaEtapuKontroli(status) {
  const wpis = STATUSY_KONTROLI.find((s) => s.wartosc === status) ?? STATUSY_KONTROLI[0];
  return wpis.etykieta;
}

/**
 * Zwięzła kwota do benchmarku: „203 tys." / „1,47 mln" (bez groszy — to widełki orientacyjne).
 * Po angielsku „203k" / „1.47M" — `t` to tłumacz ekranu z useJezyk().
 */
function kwotaZwiezle(n, t) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) {
    const mln = (n / 1e6).toFixed(2);
    return t(`${mln.replace('.', ',')} mln`, `${mln}M`);
  }
  if (n >= 1e3) return t(`${Math.round(n / 1e3)} tys.`, `${Math.round(n / 1e3)}k`);
  return String(Math.round(n));
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
  const { t } = useJezyk();
  const { isSaved, toggle } = useSaved();
  const { match } = route?.params ?? {};
  const tender = match?.tender;
  const ocena = opisOceny(match?.scorer);
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);
  // Stan przypomnienia: znany, gdy weszliśmy z ekranu „Zapisane"; inaczej domyślnie off.
  const [przypomnienie, setPrzypomnienie] = useState(match?.reminder_enabled === true);
  // Wyjaśnienie AI (D-052) — leniwe: generujemy dopiero na żądanie (koszt AI).
  const [streszczenie, setStreszczenie] = useState(null);
  const [strLoading, setStrLoading] = useState(false);
  const [strBlad, setStrBlad] = useState(null);
  // Warsztat przetargu (D-054) — etap pracy + prywatna notatka (znane, gdy wszedł z „Zapisane").
  const [status, setStatus] = useState(match?.status || STATUS_DOMYSLNY);
  const [notatka, setNotatka] = useState(match?.notatka || '');
  const [notatkaZapis, setNotatkaZapis] = useState('idle'); // idle | zapisywanie | zapisano
  // Statystyki wyników (R17) — lekki odczyt, pobierany raz na wejściu (bez kosztu AI).
  const [wyniki, setWyniki] = useState(null);
  // Poprzetargowa kontrola oferty zwycięzcy (podzadanie 6/13) — tylko dla przegranej.
  const [kontrola, setKontrola] = useState(null);
  const [wniosekBusy, setWniosekBusy] = useState(false);

  useEffect(() => {
    if (!match?.id) return undefined;
    let aktywny = true;
    api.getWyniki(match.id)
      .then((d) => { if (aktywny && d.wyniki) setWyniki(opisWyniki(d.wyniki)); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, [match?.id]);

  // Kontrola jest kluczowana po `tender.id` (patrz utworzKontrolePoPrzegranej).
  // Ładujemy ją dopiero, gdy etap = „przegrana", i odświeżamy przy zmianie etapu.
  useEffect(() => {
    if (status !== 'przegrana' || !tender) { setKontrola(null); return undefined; }
    let aktywny = true;
    wczytajKontrole(storage, tender.id)
      .then((k) => { if (aktywny) setKontrola(k); })
      .catch(() => {});
    return () => { aktywny = false; };
  }, [tender?.id, status]);

  // Osłona: ekran wymaga przekazanego dopasowania. Bez params (np. deep-link) — komunikat, nie crash.
  if (!tender) {
    return (
      <Screen scroll>
        <Text style={{ fontSize: 16, fontWeight: '700', color: kolory.text, textAlign: 'center', marginTop: 40 }}>
          {t('Ten przetarg trzeba otworzyć z listy.', 'Open this tender from the list.')}
        </Text>
        <Text style={{ fontSize: 14, color: kolory.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          {t('Wróć do feedu albo „Zapisanych" i wybierz przetarg.', 'Go back to the feed or "Saved" and pick a tender.')}
        </Text>
      </Screen>
    );
  }

  const zapisany = isSaved(match.id);
  const budget = formatBudget(tender.budget, tender.currency);
  const cpv = opisCpv(tender.cpv);
  const wadium = opisWadium(tender);
  // Orientacyjna wartość z historycznych kwot kontraktów (BZP nie podaje wartości przy ogłoszeniu).
  const wartoscOrient = orientacyjnaWartosc(tender.cpv, tender.wojewodztwo);
  const kryterium = opisKryterium(tender);
  const czesci = opisCzesci(tender);
  // Jedno źródło prawdy o terminie — wcześniej `daysUntil` nie odróżniał
  // terminu minionego od nieznanego i po prostu nic nie pokazywał.
  const termin = opisTerminu(tender.deadline);
  const deadlineText = `${formatDate(tender.deadline)}  ·  ${t(termin.etykieta)}`;
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
      Alert.alert(t('Błąd', 'Error'), err.message);
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
      Alert.alert(t('Błąd', 'Error'), err.message);
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
      Alert.alert(t('Błąd', 'Error'), err.message);
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
      Alert.alert(t('Nie udało się wygenerować wniosku', 'Could not generate the request'), err.message);
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
      Alert.alert(t('Błąd', 'Error'), err.message);
    }
  }

  async function wyjasnij() {
    setStrLoading(true);
    setStrBlad(null);
    try {
      const odp = await api.getStreszczenie(match.id);
      if (odp.streszczenie) setStreszczenie(odp.streszczenie);
      else setStrBlad(odp.komunikat || t('Nie udało się wygenerować wyjaśnienia.', 'Could not generate the explanation.'));
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
      Alert.alert(t('Błąd', 'Error'), err.message);
    } finally {
      setSending(false);
    }
  }

  async function udostepnij() {
    // Wykonawcy konsultują przetargi z partnerami/podwykonawcami — dajemy im to wprost.
    const linie = [
      tender.title,
      tender.organization
        ? t(`Zamawiający: ${tender.organization}`, `Contracting authority: ${tender.organization}`)
        : null,
      t(`Termin składania ofert: ${formatDate(tender.deadline)}`, `Bid deadline: ${formatDate(tender.deadline)}`),
      tender.url || null,
      t(
        '— znalezione w PrzetargAI, monitoring przetargów publicznych: https://przetargai.web.app',
        '— found with PrzetargAI, public tender monitoring: https://przetargai.web.app',
      ),
    ].filter(Boolean);
    try {
      await Share.share({ message: linie.join('\n'), url: tender.url || undefined, title: tender.title });
    } catch {
      /* użytkownik anulował udostępnianie — nic nie robimy */
    }
  }

  return (
    <Screen scroll>
      <View style={styles.headerRow}>
        <ScoreBadge score={match.confidence_score} size="lg" />
        <Text style={styles.title}>{tender.title}</Text>
      </View>

      <View style={styles.card}>
        <Row
          styles={styles}
          label={t('Zamawiający', 'Contracting authority')}
          value={tender.organization || t('brak danych', 'no data')}
        />
        <Row styles={styles} label={t('Termin składania ofert', 'Bid deadline')} value={deadlineText} />
        {wadium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('Wadium', 'Bid security')}</Text>
            <Text style={[styles.rowValue, wadium.ostrzezenie && { color: kolory.ostrzezenieTekst }]}>
              {t(wadium.wartosc)}
            </Text>
            {wadium.podpis ? <Text style={styles.wadiumPodpis}>{t(wadium.podpis)}</Text> : null}
          </View>
        ) : null}
        {kryterium ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('Kryterium oceny', 'Award criteria')}</Text>
            <Text style={styles.rowValue}>{t(kryterium.wartosc)}</Text>
            <Text style={styles.wadiumPodpis}>{t(kryterium.podpis)}</Text>
          </View>
        ) : null}
        {czesci ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('Części', 'Lots')}</Text>
            <Text style={styles.rowValue}>{t(czesci.wartosc)}</Text>
            <Text style={styles.wadiumPodpis}>{t(czesci.podpis)}</Text>
          </View>
        ) : null}
        {budget ? <Row styles={styles} label={t('Szacowana wartość', 'Estimated value')} value={budget} /> : null}
        <Row styles={styles} label={t(cpv.etykieta)} value={t(cpv.wartosc)} last />
      </View>

      {/* Orientacyjna wartość — statystyczny benchmark z historycznych kwot kontraktów.
          Pokazujemy, gdy przetarg NIE ma twardej wartości (typowe dla BZP). Świadomie widełki
          + etykieta „orientacyjnie", nie „wartość tego przetargu" (reguła: nie zaniżaj). */}
      {!budget && wartoscOrient ? (
        <View style={styles.benchmarkKarta}>
          <Text style={styles.benchmarkTytul}>{t('Orientacyjna wartość', 'Indicative value')}</Text>
          <Text style={styles.benchmarkKwoty}>
            {kwotaZwiezle(wartoscOrient.p25, t)} –{' '}
            <Text style={styles.benchmarkMediana}>{kwotaZwiezle(wartoscOrient.mediana, t)}</Text> –{' '}
            {kwotaZwiezle(wartoscOrient.p75, t)} {t('zł', 'PLN')}
          </Text>
          <Text style={styles.benchmarkOpis}>
            {wartoscOrient.poziom === 'wojewodztwo' && nazwaWojewodztwa(tender.wojewodztwo)
              ? t(
                `Tak zwykle kształtowały się kwoty podobnych zamówień w woj. ${nazwaWojewodztwa(tender.wojewodztwo).toLowerCase()} (dział CPV, dane 2024–25). Orientacyjnie — to NIE jest wartość tego przetargu.`,
                `Typical contract values for similar contracts in the ${nazwaWojewodztwa(tender.wojewodztwo)} voivodeship (CPV division, 2024–25 data). Indicative only — this is NOT the value of this tender.`,
              )
              : t(
                'Tak zwykle kształtowały się kwoty podobnych zamówień w kraju (dział CPV, dane 2024–25). Orientacyjnie — to NIE jest wartość tego przetargu.',
                'Typical contract values for similar contracts nationwide (CPV division, 2024–25 data). Indicative only — this is NOT the value of this tender.',
              )}
          </Text>
          <Text style={styles.benchmarkZrodlo}>{t('Źródło', 'Source')}: {t(ZRODLO_BENCHMARKU)}</Text>
        </View>
      ) : null}

      <Pressable
        style={styles.decyzjaCta}
        onPress={() => navigation.navigate('KartaDecyzji', { match })}
        accessibilityRole="button"
      >
        <Text style={styles.decyzjaCtaTytul}>{t('⚖️ Startować czy odpuścić?', '⚖️ Bid or pass?')}</Text>
        <Text style={styles.decyzjaCtaOpis}>
          {t(
            'Szybki werdykt GO / ROZWAŻ / ODPUŚĆ z czerwonymi flagami — zanim włożysz pracę w ofertę.',
            'A quick GO / CONSIDER / PASS verdict with red flags — before you put work into a bid.',
          )}
        </Text>
        <Text style={styles.decyzjaCtaLink}>{t('Oceń ten przetarg →', 'Assess this tender →')}</Text>
      </Pressable>

      <Pressable
        style={styles.sciezkaCta}
        onPress={() => navigation.navigate('SciezkaDoOferty', { match })}
        accessibilityRole="button"
      >
        <Text style={styles.sciezkaCtaTytul}>{t('🏆 Krok po kroku do wygranej', '🏆 Step by step to a win')}</Text>
        <Text style={styles.sciezkaCtaOpis}>
          {t(
            'Przewodnik: co zrobić na każdym etapie — od SWZ po złożenie oferty. Odhaczaj postęp.',
            'A guide to every stage — from the tender documents (SWZ) to submitting your bid. Tick off your progress.',
          )}
        </Text>
        <Text style={styles.sciezkaCtaLink}>{t('Otwórz przewodnik →', 'Open the guide →')}</Text>
      </Pressable>

      {wyniki ? (
        <>
          <Text style={styles.sectionTitle}>
            {t('Za ile się to robi (Twój region i branża)', 'What it usually goes for (your region and industry)')}
          </Text>
          <View style={styles.card}>
            {wyniki.cena ? <Text style={styles.wynikWiersz}>{t(wyniki.cena)}</Text> : null}
            {wyniki.konkurencja ? <Text style={styles.wynikWiersz}>{t(wyniki.konkurencja)}</Text> : null}
            {wyniki.maly ? <Text style={styles.wynikWiersz}>{t(wyniki.maly)}</Text> : null}
            <Text style={styles.wynikPodpis}>{t(wyniki.podpis)}</Text>
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
          <Text style={styles.zapiszTekst}>
            {zapisany ? t('Zapisany w zakładkach', 'Saved to bookmarks') : t('Zapisz przetarg', 'Save tender')}
          </Text>
        </Pressable>

        <View style={styles.przypRzad}>
          <View style={styles.przypInfo}>
            <Text style={styles.przypTytul}>{t('Przypomnij przed terminem', 'Remind me before the deadline')}</Text>
            <Text style={styles.przypOpis}>
              {maTermin
                ? t('Push na 7, 3 i 1 dzień przed terminem składania ofert.', 'A push 7, 3 and 1 day before the bid deadline.')
                : t('Ten przetarg nie ma terminu do przypomnienia.', 'This tender has no deadline to remind you about.')}
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

      {/*
        Karta decyzji stoi PRZED symulatorem płynności świadomie: najpierw pytanie
        „czy w tym w ogóle wygrasz", potem „czy udźwigniesz kontrakt". Odwrotna
        kolejność każe liczyć finansowanie przetargu, który trzeba odpuścić.
      */}
      <Text style={styles.sectionTitle}>{t('Czy warto tu startować', 'Is it worth bidding here')}</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Ile firm zwykle startuje u tego zamawiającego, jaka cena tam wygrywa i jak często postępowania kończą się unieważnieniem. Liczby z rozstrzygnięć BZP i TED — bez obietnicy „procentu szans", bo o wyniku decyduje treść Twojej oferty.',
            'How many firms usually bid with this contracting authority, what price wins there and how often procedures end up cancelled. Figures from BZP and TED award notices — with no promised "win percentage", because the content of your bid decides the outcome.',
          )}
        </Text>
        <Button
          title={t('Sprawdź, czy warto startować', 'Check if it is worth bidding')}
          onPress={() => navigation.navigate('CzyWarto', {
            matchId: match.id,
            tenderId: tender?.id ?? match.tender_id ?? null,
            tytul: tender?.title,
          })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>
        {t('Zanim wystartujesz — policz płynność', 'Before you bid — check your cash flow')}
      </Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Sprawdź, ile własnej gotówki musisz wyłożyć, zanim zamawiający zapłaci — i czy Twoja poduszka to udźwignie. Symulator czyta warunki płatności z SWZ i wzoru umowy, a wynik (luka pomostowa i konkretne ruchy) to wsad do decyzji „startować czy nie" obok szansy na wygraną.',
            'See how much of your own cash you must put up before the contracting authority pays — and whether your cushion can take it. The simulator reads the payment terms from the SWZ and the draft contract, and the result (the bridging gap and concrete moves) feeds the "bid or not" decision alongside your chance of winning.',
          )}
        </Text>
        <Button
          title={t('Otwórz symulator płynności', 'Open the cash-flow simulator')}
          onPress={() => navigation.navigate('SymulatorPlynnosci', { nazwa: tender.title })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>
        {t('Podpisujesz umowę? Odzyskaj zabezpieczenie', 'Signing the contract? Get your performance security back')}
      </Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Zabezpieczenie należytego wykonania (zwykle 5% ceny) to Twoje pieniądze zamrożone u zamawiającego. Policzymy harmonogram zwrotu (art. 453 Pzp) i zaalarmujemy w dniu, w którym możesz żądać pieniędzy — z gotowym wezwaniem. Przed podpisem porównamy koszt: zamrozić gotówkę czy zapłacić za gwarancję bankową.',
            'Performance security (usually 5% of the price) is your money frozen with the contracting authority. We will work out the refund schedule (Art. 453 Pzp) and alert you on the day you can claim the money — with a ready-made demand letter. Before you sign, we will compare the cost: freezing cash or paying for a bank guarantee.',
          )}
        </Text>
        <Button
          title={t('Otwórz odzyskiwacz zabezpieczenia', 'Open the performance security recovery tool')}
          onPress={() => navigation.navigate('ZabezpieczenieZwrot', { nazwa: tender.title })}
          variant="primary"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>{t('Narzędzia do tej oferty', 'Tools for this bid')}</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Nie musisz być najtańszy — sprawdź, o ile drożej możesz dać, wygrywając kryteriami. Zanim złożysz wadium gwarancją, przekontroluj jej treść. A gdy przyjdzie wezwanie do uzupełnienia — odlicz czas i nie odpadnij formalnie.',
            'You do not have to be the cheapest — see how much higher you can price and still win on the criteria. Before you lodge bid security as a guarantee, check its wording. And when a request to supplement documents arrives — count down the time and avoid a formal rejection.',
          )}
        </Text>
        <Button
          title={t('Kalkulator ceny ofertowej', 'Bid price calculator')}
          onPress={() => navigation.navigate('KalkulatorCeny', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Sprawdzarka formularza cenowego', 'Price form checker')}
          onPress={() => navigation.navigate('SprawdzarkaCeny', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Kalkulator punktów (cena punktu)', 'Points calculator (price per point)')}
          onPress={() => navigation.navigate('KalkulatorPunktow', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Symulator punktacji oferty', 'Bid scoring simulator')}
          onPress={() => navigation.navigate('SymulatorPunktacji', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Kontroler gwarancji wadialnej', 'Bid security guarantee checker')}
          onPress={() => navigation.navigate('KontrolerGwarancji', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Strażnik wezwania do uzupełnienia', 'Supplement request guard')}
          onPress={() => navigation.navigate('StraznikWezwania', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Asystent obrony ceny (art. 224)', 'Low-price defence assistant (Art. 224)')}
          onPress={() => navigation.navigate('ObronaCeny', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Kalkulator kar umownych', 'Contractual penalties calculator')}
          onPress={() => navigation.navigate('KaryUmowne', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Odsetki za opóźnienie + rekompensata', 'Late payment interest + compensation')}
          onPress={() => navigation.navigate('KalkulatorOdsetek', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Strażnik terminu związania ofertą', 'Bid validity period guard')}
          onPress={() => navigation.navigate('TerminZwiazania', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Wykrywacz obowiązkowej wizji lokalnej', 'Mandatory site visit detector')}
          onPress={() => navigation.navigate('WizjaLokalna', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Strażnik oświadczenia konsorcjum (art. 117)', 'Consortium statement guard (Art. 117)')}
          onPress={() => navigation.navigate('Konsorcjum', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Tarcza tajemnicy przedsiębiorstwa', 'Trade secret shield')}
          onPress={() => navigation.navigate('Tajemnica', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Kreator samooczyszczenia (art. 110)', 'Self-cleaning wizard (Art. 110)')}
          onPress={() => navigation.navigate('Samooczyszczenie', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Pożycz doświadczenie (art. 118)', 'Borrow experience (Art. 118)')}
          onPress={() => navigation.navigate('Kreator118')}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Kalkulator terminów (dni robocze, święta)', 'Deadline calculator (working days, holidays)')}
          onPress={() => navigation.navigate('KalkulatorTerminow', { nazwa: tender.title })}
          variant="ghost"
          style={styles.gap}
        />
      </View>

      <Text style={styles.sectionTitle}>{t('Etap i notatki', 'Stage and notes')}</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Prowadź ten przetarg: ustaw etap pracy i zapisz własne notatki (np. jakie dokumenty zebrać, o co dopytać zamawiającego).',
            'Track this tender: set the work stage and keep your own notes (e.g. which documents to gather, what to ask the contracting authority).',
          )}
        </Text>

        <Text style={styles.warsztatEtykieta}>{t('Etap', 'Stage')}</Text>
        <StatusPicker wartosc={status} onChange={zmienStatus} />

        <Text style={[styles.warsztatEtykieta, styles.warsztatOdstep]}>{t('Moja notatka', 'My note')}</Text>
        <TextInput
          style={styles.notatka}
          value={notatka}
          onChangeText={(tekst) => { setNotatka(tekst); setNotatkaZapis('idle'); }}
          placeholder={t(
            'np. Zebrać: KRS, referencje z 2 podobnych robót. Dopytać o termin realizacji.',
            'e.g. Gather: company register extract, references from 2 similar works. Ask about the completion date.',
          )}
          placeholderTextColor={kolory.textMuted}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.notatkaStopka}>
          <Text style={styles.notatkaStan}>
            {notatkaZapis === 'zapisywanie'
              ? t('Zapisywanie…', 'Saving…')
              : notatkaZapis === 'zapisano' ? t('Zapisano ✓', 'Saved ✓') : ' '}
          </Text>
          <Button
            title={t('Zapisz notatkę', 'Save note')}
            onPress={zapiszNotatke}
            variant="ghost"
            loading={notatkaZapis === 'zapisywanie'}
            style={styles.notatkaBtn}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        {t('Składasz ofertę? Włącz rejestrator', 'Submitting a bid? Turn on the recorder')}
      </Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Rejestrator prowadzi wysyłkę krok po kroku i utrwala dowody (zrzuty, suma kontrolna oferty, przebieg sesji). Jeśli platforma zawiedzie, jednym ruchem złożysz pakiet dowodowy i pismo o przedłużenie terminu — złóż ofertę z zapasem 24 h przed terminem.',
            'The recorder walks you through submission step by step and preserves evidence (screenshots, the bid checksum, the session log). If the platform fails, you can put together the evidence pack and a deadline extension request in one move — submit your bid with a 24 h margin before the deadline.',
          )}
        </Text>
        <Button
          title={t('Lista kontrolna przed wysłaniem', 'Pre-submission checklist')}
          onPress={() => navigation.navigate('KontrolaOferty', { match })}
          variant="ghost"
          style={styles.gap}
        />
        <Button
          title={t('Otwórz rejestrator oferty', 'Open the bid recorder')}
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
          <Text style={styles.sectionTitle}>
            {t('Przegrana? Prześwietl ofertę zwycięzcy', 'Lost? Scrutinise the winning bid')}
          </Text>
          <View style={styles.card}>
            <Text style={styles.strPodtytul}>
              {t(
                'Oferty są jawne od otwarcia (załączniki najpóźniej 3 dni po). Złóż wniosek o udostępnienie protokołu i ofert konkurencji — potem sprawdzimy ofertę zwycięzcy pod kątem podstaw do odwołania do KIO.',
                'Bids are public from the opening (attachments no later than 3 days after). Request access to the procurement record and the competing bids — then we will check the winning bid for grounds to appeal to the KIO.',
              )}
            </Text>

            <View style={styles.kontrolaEtapRzad}>
              <Text style={styles.kontrolaEtapEtykieta}>{t('Etap kontroli', 'Review stage')}</Text>
              <Text style={styles.kontrolaEtapWartosc}>{t(etykietaEtapuKontroli(kontrola?.status))}</Text>
            </View>

            {wniosekWyslany && !analizaGotowa ? (
              <Text style={styles.kontrolaInfo}>
                {t(
                  'Wniosek wygenerowany. Wyślij go do zamawiającego i zaznacz otrzymanie dokumentów, gdy dotrą — wtedy ruszy analiza oferty zwycięzcy.',
                  'Request generated. Send it to the contracting authority and mark the documents as received when they arrive — that starts the analysis of the winning bid.',
                )}
              </Text>
            ) : null}

            {analizaGotowa ? (
              <>
                <Text style={styles.kontrolaInfo}>
                  {t(
                    'Analiza oferty zwycięzcy gotowa. Zobacz listę zarzutów, ocenę szans i termin na odwołanie do KIO.',
                    'The analysis of the winning bid is ready. See the list of objections, the assessment of your chances and the deadline for an appeal to the KIO.',
                  )}
                </Text>
                <Button
                  title={t('Zobacz wynik kontroli', 'See the review result')}
                  onPress={otworzWynikKontroli}
                  variant="primary"
                  style={styles.gap}
                />
              </>
            ) : null}

            <Button
              title={wniosekWyslany
                ? t('Wygeneruj wniosek ponownie', 'Generate the request again')
                : t('Wygeneruj wniosek', 'Generate the request')}
              onPress={wygenerujWniosek}
              loading={wniosekBusy}
              variant={wniosekWyslany ? 'ghost' : 'primary'}
              style={styles.gap}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>{t('Wyjaśnienie AI', 'AI explanation')}</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Prosty opis ogłoszenia przygotowany przez AI na podstawie danych przetargu (nie zastępuje pełnej specyfikacji SIWZ).',
            'A plain-language summary of the notice prepared by AI from the tender data (it does not replace the full tender specification, SIWZ).',
          )}
        </Text>

        {streszczenie ? (
          <View style={styles.strTresc}>
            <Text style={styles.strAkapit}>{streszczenie.czego_dotyczy}</Text>

            {streszczenie.dokumenty?.length ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>{t('Co zwykle trzeba przygotować', 'What you usually need to prepare')}</Text>
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
                <Text style={styles.strNaglowek}>{t('Na co zwrócić uwagę', 'What to watch out for')}</Text>
                <Text style={styles.strAkapit}>{streszczenie.na_co_uwaga}</Text>
              </View>
            ) : null}

            {streszczenie.ocena ? (
              <View style={styles.strBlok}>
                <Text style={styles.strNaglowek}>{t('Ocena dla małej firmy', 'Assessment for a small firm')}</Text>
                <Text style={styles.strAkapit}>{streszczenie.ocena}</Text>
              </View>
            ) : null}
          </View>
        ) : strLoading ? (
          <View style={styles.strLadowanie}>
            <ActivityIndicator color={kolory.blue} />
            <Text style={styles.strLadowanieTekst}>{t('AI analizuje ogłoszenie…', 'AI is analysing the notice…')}</Text>
          </View>
        ) : (
          <View style={styles.strStart}>
            {strBlad ? <Text style={styles.strBlad}>{strBlad}</Text> : null}
            <Button
              title={strBlad ? t('Spróbuj ponownie', 'Try again') : t('Wyjaśnij ten przetarg', 'Explain this tender')}
              onPress={wyjasnij}
              variant="ghost"
            />
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('Dlaczego to dopasowanie?', 'Why this match?')}</Text>
      <View style={styles.card}>
        <Text style={styles.reasoning}>{match.reasoning || t('Brak uzasadnienia.', 'No rationale provided.')}</Text>
        {/*
          Backend zapisuje, czy ocenił model, czy sama heurystyka — ale aplikacja
          tego nie pokazywała. Mechaniczne trafienie w słowo kluczowe wyglądało
          identycznie jak ocena AI (audyt 2026-07-10). To kwestia zaufania:
          użytkownik ma prawo wiedzieć, na czym opiera się liczba na karcie.
        */}
        <View style={styles.zrodloOceny}>
          <Text style={styles.zrodloEtykieta}>{t(ocena.etykieta)}</Text>
          <Text style={styles.zrodloOpis}>{t(ocena.opis)}</Text>
        </View>
      </View>

      {/*
        Wyjaśnienie dopasowania (P1-4): cztery sygnały z konkretami zamiast jednego
        zdania. Liczone z profilu i ogłoszenia — bez wywołania AI.
      */}
      <Wyjasnienie wyjasnienie={match.wyjasnienie} />

      {/*
        Źródło pierwotne, czas ostatniej synchronizacji i link do ORYGINAŁU (P1-3).
        Ofertę składa się w rejestrze, nie w tej aplikacji — adres oryginału jest
        więc najważniejszym wyjściem z tego ekranu.
      */}
      <View style={styles.zrodloBox}>
        <Text style={styles.zrodloNazwaRejestru}>{t(pelnaNazwaZrodla(tender.zrodlo?.kod ?? tender.source))}</Text>
        <PodpisZrodla zrodlo={tender.zrodlo ?? { kod: tender.source }} />
        <PrzyciskOryginalu tender={tender} />
      </View>
      <ZrodlaAlternatywne zrodla={tender.zrodla_alternatywne} />

      <Button
        title={t('Udostępnij przetarg', 'Share tender')}
        variant="ghost"
        onPress={udostepnij}
        style={styles.gap}
      />

      <Text style={styles.sectionTitle}>{t('Czy to dopasowanie było trafne?', 'Was this match accurate?')}</Text>
      {feedback ? (
        <Text style={styles.feedbackDone}>
          {feedback === 'up'
            ? t('Dziękujemy! Cieszymy się, że trafione.', 'Thank you! Glad it was a good match.')
            : t(
              'Dziękujemy za informację — wykorzystamy ją do poprawy dopasowań.',
              'Thanks for letting us know — we will use it to improve matches.',
            )}
        </Text>
      ) : (
        <View style={styles.feedbackRow}>
          <Button
            title={t('👍 Trafne', '👍 Accurate')}
            variant="ghost"
            onPress={() => handleFeedback(true)}
            loading={sending}
            style={styles.feedbackBtn}
          />
          <Button
            title={t('👎 Nietrafne', '👎 Not accurate')}
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
  zrodloBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
  },
  zrodloNazwaRejestru: { fontSize: 14, fontWeight: '800', color: k.text },
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
  benchmarkKarta: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  benchmarkTytul: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  benchmarkKwoty: { fontSize: 20, fontWeight: '700', color: k.text, marginTop: 6, fontVariant: ['tabular-nums'] },
  benchmarkMediana: { color: k.blue, fontWeight: '800' },
  benchmarkOpis: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: 6 },
  benchmarkZrodlo: { fontSize: 11, color: k.textMuted, marginTop: 6, fontStyle: 'italic' },
  decyzjaCta: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.md, marginTop: spacing.md },
  decyzjaCtaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  decyzjaCtaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: 4 },
  decyzjaCtaLink: { fontSize: 14, fontWeight: '800', color: k.blue, marginTop: 8 },
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
