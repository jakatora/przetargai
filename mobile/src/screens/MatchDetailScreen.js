import { useState, useEffect } from 'react';
import { useNoteDraft } from '../hooks/useNoteDraft';
import { View, Text, Alert, Pressable, Switch, ActivityIndicator, TextInput, Share } from 'react-native';
import { udostepnijTekst } from '../lib/udostepnianie';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import StatusPicker from '../components/StatusPicker';
import { ScoreBadge } from '../components/MatchCard';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { spacing, radius, typografia } from '../theme';
import Ikona from '../components/Ikona';
import WierszAkcji from '../components/WierszAkcji';
import { opisBrakuPrzypomnienia, opisOceny, opisTerminu } from '../lib/termin';
import { opisCpv } from '../lib/cpv';
import { formatDate, formatBudget } from '../lib/format';
import { STATUS_DOMYSLNY, przypomnieniaWstrzymane } from '../lib/statusPrzetargu';
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
import SzczegolPlatformy from '../components/SzczegolPlatformy';
import KtoWygrywa from '../components/KtoWygrywa';
import PartnerzyPrzetargu from '../components/PartnerzyPrzetargu';
import KryteriaOceny from '../components/KryteriaOceny';
import { ZapytajSwzPrzetargu } from '../components/ZapytajSwz';
import DokumentyEZamowienia from '../components/DokumentyEZamowienia';
import Wyjasnienie from '../components/Wyjasnienie';
import { pelnaNazwaZrodla } from '../lib/zrodlaDanych';
import { parametryNarzedzia } from '../lib/sciezkaDoOferty';
import { useJezyk } from '../context/JezykContext';
import { useAuth } from '../context/AuthContext';
import * as WebBrowser from 'expo-web-browser';
import ArkuszOdrzucenia from '../components/ArkuszOdrzucenia';
import WarunkiUdzialu from '../components/WarunkiUdzialu';
import PlanDzialania from '../components/PlanDzialania';
import { POKAZUJ_ZAKUP } from '../lib/kanal';
import { pasekDecyzji, krokiBiore, grupyNarzedzi, liczbaNarzedzi } from '../lib/szczegolyPrzetargu';

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
  const { isSaved, toggle, refresh: odswiezZapisane } = useSaved();
  const { match } = route?.params ?? {};
  const tender = match?.tender;
  const ocena = opisOceny(match?.scorer);
  const { user } = useAuth();
  // Plan efektywny z API (spec §15); stary zapis użytkownika bez `plan` — z planu rozliczeniowego.
  const plan = user?.plan ?? (user?.premium_tier === 'standard' ? 'standard' : 'free');
  const [arkusz, setArkusz] = useState(false);
  const [pytaniaKryteriow, setPytaniaKryteriow] = useState([]);
  const [odrzucanie, setOdrzucanie] = useState(false);
  // Stan przypomnienia: znany, gdy weszliśmy z ekranu „Zapisane"; inaczej domyślnie off.
  const [przypomnienie, setPrzypomnienie] = useState(match?.reminder_enabled === true);
  // Wyjaśnienie AI (D-052) — leniwe: generujemy dopiero na żądanie (koszt AI).
  const [streszczenie, setStreszczenie] = useState(null);
  const [strLoading, setStrLoading] = useState(false);
  const [strBlad, setStrBlad] = useState(null);
  // Warsztat przetargu (D-054) — etap pracy + prywatna notatka (znane, gdy wszedł z „Zapisane").
  const [status, setStatus] = useState(match?.status || STATUS_DOMYSLNY);
  const notatkaDraft = useNoteDraft(match?.notatka || '', async (text) => {
    if (!zapisany) await toggle(match.id, true);
    return api.setNotatka(match.id, text);
  });
  // Statystyki wyników (R17) — lekki odczyt, pobierany raz na wejściu (bez kosztu AI).
  const [wyniki, setWyniki] = useState(null);
  const [wynikiSurowe, setWynikiSurowe] = useState(null); // do auto-prefillu karty decyzji
  // Poprzetargowa kontrola oferty zwycięzcy (podzadanie 6/13) — tylko dla przegranej.
  const [kontrola, setKontrola] = useState(null);
  const [wniosekBusy, setWniosekBusy] = useState(false);
  // Ekran szczegółów 2026-11-10: narzędzia i szczegóły oceny zwinięte, „Biorę” w pasku na dole.
  const [narzedziaOtwarte, setNarzedziaOtwarte] = useState(false);
  const [ocenaOtwarta, setOcenaOtwarta] = useState(false);
  const [bioreTrwa, setBioreTrwa] = useState(false);
  const [doSzefaTrwa, setDoSzefaTrwa] = useState(false);

  useEffect(() => {
    if (!match?.id) return undefined;
    let aktywny = true;
    api.getWyniki(match.id)
      .then((d) => { if (aktywny && d.wyniki) { setWyniki(opisWyniki(d.wyniki)); setWynikiSurowe(d.wyniki); } })
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
  const deadlineText = formatDate(tender.deadline); // status terminu stoi w chipie pod tytułem
  const maTermin = !!tender.deadline && !termin.minal;
  const brakPrzypomnienia = opisBrakuPrzypomnienia(tender.deadline);
  // Wniosek już poszedł, gdy kontrola przeszła poza etap „nowa".
  const wniosekWyslany = !!kontrola && kontrola.status !== 'nowa';
  // Analiza gotowa → mamy wynik do pokazania na osobnym ekranie (podzadanie 12/13).
  const analizaGotowa = !!kontrola?.analiza;
  // Checklista jest adresowana identyfikatorem przetargu — bez niego wejścia nie pokazujemy.
  const paramsChecklisty = parametryNarzedzia('ChecklistaOferty', match);

  async function przelaczZapis() {
    try {
      const teraz = await toggle(match.id, !zapisany);
      if (!teraz) setPrzypomnienie(false); // usunięto z zakładek → przypomnienie też gaśnie
      else if (maTermin) setPrzypomnienie(true); // serwer włącza przypomnienie przy nowym zapisie (2026-11-10)
    } catch (err) {
      Alert.alert(t('Błąd', 'Error'), err.message);
    }
  }

  async function przelaczPrzypomnienie(wartosc) {
    setPrzypomnienie(wartosc);
    try {
      // Przypomnienie wymaga zapisu — gdy przetarg nie jest jeszcze w zakładkach, dopisz go.
      if (wartosc && !zapisany) await toggle(match.id, true);
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
      if (!zapisany) await toggle(match.id, true); // etap wymaga zapisu — dopisz do zakładek
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
    try { await notatkaDraft.save(); }
    catch (err) { Alert.alert(t('Błąd', 'Error'), err.message); }
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

  async function przejdzNaStandard() {
    try {
      const { url } = await api.createUpgradeLink();
      await WebBrowser.openBrowserAsync(url);
    } catch { /* bez linku — zostajemy na ekranie */ }
  }

  async function odrzuc(przyczyna, komentarz) {
    setOdrzucanie(true);
    try {
      const wynik = await api.pracownikOdrzuc(match.id, przyczyna, komentarz);
      setArkusz(false);
      // Odrzucony schodzi z Zapisanych na serwerze (bez przypomnień i alertów) — odśwież gwiazdki.
      if (wynik?.usuniety_z_zapisanych) odswiezZapisane?.();
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('Błąd', 'Error'), err.message);
    } finally {
      setOdrzucanie(false);
    }
  }

  // „Wyślij szefowi do decyzji” (2026-11-12): serwer daje link do strony z przyciskami Startujemy / Nie startujemy,
  // a wiadomość wysyła sam użytkownik (WhatsApp, SMS, mail). Decyzja wraca alertem i pushem.
  async function wyslijSzefowi() {
    if (doSzefaTrwa) return;
    setDoSzefaTrwa(true);
    try {
      const { wiadomosc, url } = await api.linkDoDecyzji(match.id);
      await udostepnijTekst({ message: wiadomosc, url, title: tender.title }).catch(() => {});
    } catch (err) {
      Alert.alert(t('Nie udało się przygotować linku', 'Could not prepare the link'), err.message);
    } finally {
      setDoSzefaTrwa(false);
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
        '— znalezione w PrzetargAI, monitoring przetargów publicznych: https://przetarg-ai.pl',
        '— found with PrzetargAI, public tender monitoring: https://przetarg-ai.pl',
      ),
    ].filter(Boolean);
    try {
      await udostepnijTekst({ message: linie.join('\n'), url: tender.url || undefined, title: tender.title });
    } catch {
      /* użytkownik anulował udostępnianie — nic nie robimy */
    }
  }

  // „Biorę” (2026-11-10): zapis + przypomnienie 7/3/1 + etap „Przygotowuję ofertę” jednym ruchem
  // (`lib/szczegolyPrzetargu.krokiBiore`). Zapis jest warunkiem reszty; przypomnienie i etap — najlepiej jak się da.
  async function biore() {
    if (bioreTrwa) return;
    setBioreTrwa(true);
    const kroki = krokiBiore({ zapisany, przypomnienie, maTermin, status });
    try {
      if (kroki.includes('zapisz')) await toggle(match.id, true);
    } catch (err) {
      setBioreTrwa(false);
      Alert.alert(t('Nie udało się zapisać przetargu', 'Could not save the tender'), err.message);
      return;
    }
    if (kroki.includes('przypomnienie')) {
      try {
        const stan = await api.setReminder(match.id, true);
        setPrzypomnienie(stan.reminder_enabled);
      } catch { /* przypomnienie włączysz przełącznikiem niżej */ }
    }
    if (kroki.includes('etap')) {
      try {
        await api.setStatus(match.id, 'przygotowuje');
        setStatus('przygotowuje');
      } catch { /* etap zmienisz niżej */ }
    }
    setBioreTrwa(false);
  }

  // Parametry tras narzędzi (lista i kolejność: `lib/szczegolyPrzetargu.grupyNarzedzi`).
  const nazwa = { nazwa: tender.title };
  const parametryNarzedzi = {
    KartaDecyzji: { match, wyniki: wynikiSurowe },
    CzyWarto: { matchId: match.id, tenderId: tender?.id ?? match.tender_id ?? null, tytul: tender?.title },
    SymulatorPlynnosci: nazwa,
    SciezkaDoOferty: { match },
    ChecklistaOferty: paramsChecklisty,
    DokumentyOferty: { match },
    KalkulatorCeny: { ...nazwa, match, rynek: wartoscOrient ?? null, budzet: Number.isFinite(Number(tender.budget)) && Number(tender.budget) > 0 ? Number(tender.budget) : null },
    SprawdzarkaCeny: { ...nazwa, tenderId: tender.id },
    KalkulatorPunktow: nazwa,
    SymulatorPunktacji: nazwa,
    KontrolerGwarancji: { ...nazwa, tenderId: tender.id },
    KontrolaOferty: { match },
    RejestratorOferty: { termin: tender.deadline, postepowanieId: match.id, nazwa: tender.title },
    OdpowiedzNaWezwanie: { match },
    StraznikWezwania: nazwa,
    ObronaCeny: nazwa,
    KaryUmowne: nazwa,
    TerminZwiazania: nazwa,
    WizjaLokalna: nazwa,
    Konsorcjum: nazwa,
    Tajemnica: nazwa,
    Samooczyszczenie: nazwa,
    Kreator118: undefined,
    KalkulatorTerminow: nazwa,
    PoWygranej: { match },
    ZabezpieczenieZwrot: nazwa,
    KalkulatorOdsetek: nazwa,
  };
  const grupy = grupyNarzedzi({ status, maChecklista: !!paramsChecklisty });
  const pasek = pasekDecyzji({ zapisany, przypomnienie, status, terminMinal: termin.minal, maTermin });
  const uzasadnienie = match.uzasadnienie ?? [];

  return (
    <Screen
      scroll
      stopka={pasek.widoczny ? (
        <View>
          {pasek.podpis ? <Text style={styles.pasekPodpis}>{t(pasek.podpis)}</Text> : null}
          <View style={styles.pasekPrzyciski}>
            {pasek.glowna.akcja === 'biore' ? (
              <Button title={t(pasek.glowna.etykieta)} onPress={biore} loading={bioreTrwa} style={styles.pasekGlowny} />
            ) : (
              <View style={[styles.pasekGlowny, styles.pasekStan]}>
                <Ikona nazwa="ok" rozmiar={18} kolor={kolory.sukcesAkcent} />
                <Text style={styles.pasekStanTekst}>{t(pasek.glowna.etykieta)}</Text>
              </View>
            )}
            <Button title={t('Nie dla nas', 'Not for us')} variant="ghost" onPress={() => setArkusz(true)} style={styles.pasekDrugi} />
          </View>
        </View>
      ) : null}
    >
      <View style={styles.headerRow}>
        <ScoreBadge score={match.confidence_score} size="lg" />
        <View style={styles.headerTresc}>
          <Text style={styles.title} accessibilityRole="header">{tender.title}</Text>
          <View style={styles.headerChipy}>
            <Text style={[styles.terminChip, termin.pilny && styles.terminChipPilny, termin.minal && styles.terminChipMiniony]}>
              {t(termin.etykieta)}
            </Text>
            {/* Odpowiedź z linku „do decyzji” od razu pod tytułem (2026-11-12, seria 2 runda 1). */}
            {match.decyzja_szefa?.decyzja ? (
              <Text style={[styles.terminChip, match.decyzja_szefa.decyzja === 'tak' ? styles.terminChipOk : styles.terminChipPilny]}>
                {match.decyzja_szefa.decyzja === 'tak' ? t('Szef: startujemy', 'Boss: we bid') : t('Szef: nie startujemy', 'Boss: we pass')}
              </Text>
            ) : null}
            {wadium ? (
              <Text style={[styles.terminChip, wadium.ostrzezenie ? styles.terminChipPilny : styles.terminChipOk]}>
                {wadium.ostrzezenie ? t('Wymaga wadium', 'Bid security required') : t('Bez wadium', 'No bid security')}
              </Text>
            ) : null}
          </View>
        </View>
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

      {/* DECYZJA (2026-11-10): najpierw to, co rozstrzyga „biorę czy nie” — jedno uzasadnienie zamiast czterech. */}
      <Text style={styles.sectionTitle}>{t('Dlaczego to wybraliśmy', 'Why we picked this')}</Text>
      <View style={styles.card}>
        {uzasadnienie.length ? uzasadnienie.map((p) => (
          <View key={p} style={styles.uzasadnienieRzad}>
            <Ikona nazwa="ok" rozmiar={16} kolor={kolory.sukcesAkcent} />
            <Text style={styles.uzasadnienieTekst}>{p}</Text>
          </View>
        )) : (
          <Text style={styles.reasoning}>{match.reasoning || t('Brak uzasadnienia.', 'No rationale provided.')}</Text>
        )}
        <Pressable
          onPress={() => setOcenaOtwarta((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: ocenaOtwarta }}
          style={styles.rozwinRzad}
        >
          <Text style={styles.rozwinTekst}>
            {ocenaOtwarta ? t('Zwiń szczegóły oceny', 'Hide scoring details') : t('Jak to oceniliśmy', 'How we scored it')}
          </Text>
        </Pressable>
        {ocenaOtwarta ? (
          <View>
            {uzasadnienie.length && match.reasoning ? <Text style={styles.reasoning}>{match.reasoning}</Text> : null}
            {/* Model czy sama heurystyka — użytkownik ma prawo wiedzieć, na czym opiera się liczba (audyt 2026-07-10). */}
            <View style={styles.zrodloOceny}>
              <Text style={styles.zrodloEtykieta}>{t(ocena.etykieta)}</Text>
              <Text style={styles.zrodloOpis}>{t(ocena.opis)}</Text>
            </View>
            <Wyjasnienie wyjasnienie={match.wyjasnienie} />
          </View>
        ) : null}
      </View>

      <WarunkiUdzialu match={match} plan={plan} navigation={navigation} onUpgrade={POKAZUJ_ZAKUP ? przejdzNaStandard : null} />
      <KryteriaOceny tender={tender} onPytania={setPytaniaKryteriow} />

      {/*
        Źródło pierwotne, czas ostatniej synchronizacji i link do ORYGINAŁU (P1-3).
        Ofertę składa się w rejestrze, nie w tej aplikacji — adres oryginału jest
        więc najważniejszym wyjściem z tego ekranu.
      */}
      <View style={styles.zrodloBox}>
        <Text style={styles.zrodloNazwaRejestru}>{t(pelnaNazwaZrodla(tender.zrodlo?.kod ?? tender.source))}</Text>
        <PodpisZrodla zrodlo={tender.zrodlo ?? { kod: tender.source }} />
        <PrzyciskOryginalu tender={tender} />
        <SzczegolPlatformy tender={tender} navigation={navigation} />
        <DokumentyEZamowienia tender={tender} navigation={navigation} />
      </View>
      <ZrodlaAlternatywne zrodla={tender.zrodla_alternatywne} />
      <ZapytajSwzPrzetargu tender={tender} pytaniaDodatkowe={pytaniaKryteriow} />

      <Text style={styles.sectionTitle}>{t('Wyjaśnienie AI', 'AI explanation')}</Text>
      <View style={styles.card}>
        <Text style={styles.strPodtytul}>
          {t(
            'Prosty opis ogłoszenia przygotowany przez AI na podstawie danych przetargu (nie zastępuje pełnej specyfikacji (SWZ)).',
            'A plain-language summary of the notice prepared by AI from the tender data (it does not replace the full tender specification (SWZ)).',
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
                    <View style={styles.strKropka} />
                    <Text style={styles.strPunkt}><Text style={styles.zakreslenie}>{d}</Text></Text>
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

      <PlanDzialania match={match} plan={plan} navigation={navigation} onUpgrade={POKAZUJ_ZAKUP ? przejdzNaStandard : null} />

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

      <KtoWygrywa tender={tender} />
      <PartnerzyPrzetargu tender={tender} />

      <Text style={styles.sectionTitle}>{t('Twoja praca nad przetargiem', 'Your work on this tender')}</Text>
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
            <Text style={styles.przypTytul}>{przypomnieniaWstrzymane(status) ? t('Przypomnienia wstrzymane', 'Reminders paused') : t('Przypomnij przed terminem', 'Remind me before the deadline')}</Text>
            <Text style={styles.przypOpis}>
              {przypomnieniaWstrzymane(status)
                ? t('Na tym etapie nie wysyłamy przypomnień o składaniu oferty. Przełącznik określa, czy mają działać po powrocie do przygotowania oferty, jeśli termin jeszcze nie minął.',
                  'Bid submission reminders are paused at this stage. The switch sets whether to resume them if you return to preparing the bid before its deadline.')
                : maTermin
                ? t('Push na 7, 3 i 1 dzień przed terminem składania ofert.', 'A push 7, 3 and 1 day before the bid deadline.')
                : t(brakPrzypomnienia.pl, brakPrzypomnienia.en)}
            </Text>
          </View>
          <Switch
            accessibilityLabel={przypomnieniaWstrzymane(status) ? t('Przypomnienia po powrocie do przygotowania oferty', 'Reminders when returning to bid preparation') : t('Przypomnij przed terminem', 'Remind me before the deadline')}
            value={przypomnienie}
            onValueChange={przelaczPrzypomnienie}
            disabled={!maTermin}
            trackColor={{ true: kolory.blue }}
          />
        </View>

        <View style={styles.pracaOdstep}>
          <Text style={styles.warsztatEtykieta}>{t('Etap', 'Stage')}</Text>
          <StatusPicker wartosc={status} onChange={zmienStatus} />

          <Text style={[styles.warsztatEtykieta, styles.warsztatOdstep]}>{t('Moja notatka', 'My note')}</Text>
          <TextInput
            style={styles.notatka}
            value={notatkaDraft.text}
            onChangeText={notatkaDraft.change}
            placeholder={t(
              'np. Zebrać: KRS, referencje z 2 podobnych robót. Dopytać o termin realizacji.',
              'e.g. Gather: company register extract, references from 2 similar works. Ask about the completion date.',
            )}
            placeholderTextColor={kolory.textMuted}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.notatkaStopka}>
            <Text accessibilityLiveRegion="polite" style={[styles.notatkaStan, notatkaDraft.status === 'error' && { color: kolory.danger }]}>
              {notatkaDraft.busy
                ? t('Zapisywanie…', 'Saving…')
                : notatkaDraft.status === 'saved' ? t('Zapisano ✓', 'Saved ✓')
                  : notatkaDraft.status === 'dirty' ? t('Masz niezapisane zmiany', 'You have unsaved changes')
                    : notatkaDraft.status === 'error' ? t('Zapis niepotwierdzony — spróbuj ponownie', 'Save not confirmed — try again') : ' '}
            </Text>
            <Button
              title={t('Zapisz notatkę', 'Save note')}
              onPress={zapiszNotatke}
              variant="ghost"
              loading={notatkaDraft.busy}
              style={styles.notatkaBtn}
            />
          </View>
        </View>
      </View>

      {status === 'wygrana' ? (
        <>
          <Text style={styles.sectionTitle}>
            {t('Wygrana! Co teraz', 'You won! What now')}
          </Text>
          <View style={styles.card}>
            <Text style={styles.strPodtytul}>
              {t(
                'Pierwsze dni kontraktu to terminy z umowy: zabezpieczenie, polisa, zgłoszenie podwykonawców. Lista, czego pilnować, i trzy pisma gotowe do podpisu.',
                'The first days of the contract are about contract deadlines: security, insurance, subcontractor notices. A checklist and three letters ready to sign.',
              )}
            </Text>
            <Button
              title={t('Otwórz „Po wygranej"', 'Open "After winning"')}
              onPress={() => navigation.navigate('PoWygranej', { match })}
              style={styles.gap}
            />
          </View>
        </>
      ) : null}

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

            <Button
              title={t('Odzyskaj wadium — wniosek w 1 klik', 'Get your bid bond back — request in one tap')}
              onPress={() => navigation.navigate('ZwrotWadium', { match, podstawa: 'wybor_innej' })}
              variant="ghost"
              style={styles.gap}
            />

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

      {/* NARZĘDZIA (2026-11-10): jedna zwinięta sekcja w grupach zamiast pięciu kart i szesnastu wierszy. */}
      <Pressable
        style={({ pressed }) => [styles.narzedziaNaglowek, pressed && styles.ctaWcisniete]}
        onPress={() => setNarzedziaOtwarte((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: narzedziaOtwarte }}
      >
        <View style={styles.narzedziaTresc}>
          <Text style={styles.narzedziaTytul}>
            {t(`Narzędzia do tej oferty (${liczbaNarzedzi(grupy)})`, `Tools for this bid (${liczbaNarzedzi(grupy)})`)}
          </Text>
          <Text style={styles.narzedziaOpis}>
            {t('Decyzja, cena i punkty, dokumenty, pisma i terminy', 'Decision, price and points, documents, letters and deadlines')}
          </Text>
        </View>
        <Text style={styles.narzedziaStrzalka}>{narzedziaOtwarte ? '▴' : '▾'}</Text>
      </Pressable>
      {narzedziaOtwarte ? grupy.map((g) => (
        <View key={g.klucz} style={[styles.kartaListy, styles.gap]}>
          <Text style={[styles.grupaNarzedzi, styles.kartaListyWstep]}>{t(g.tytul)}</Text>
          {g.pozycje.map((n, i) => (
            <WierszAkcji
              key={n.ekran}
              tytul={t(n.tytul)}
              opis={n.opis ? t(n.opis) : undefined}
              onPress={() => navigation.navigate(n.ekran, parametryNarzedzi[n.ekran])}
              ostatni={i === g.pozycje.length - 1}
            />
          ))}
        </View>
      )) : null}

      <View style={styles.doSzefa}>
        <Text style={styles.doSzefaTytul}>{t('Decyzję podejmuje ktoś inny?', 'Someone else decides?')}</Text>
        <Text style={styles.doSzefaOpis}>
          {match.decyzja_szefa?.decyzja
            ? t(`Odpowiedź z linku: ${match.decyzja_szefa.decyzja === 'tak' ? 'startujemy' : 'nie startujemy'}.`, `Answer from the link: ${match.decyzja_szefa.decyzja === 'tak' ? 'we bid' : 'we pass'}.`)
            : t('Wyślij szefowi link — zobaczy przetarg, termin i powody wyboru, i odpowie jednym kliknięciem, bez instalowania aplikacji. Odpowiedź dostaniesz w powiadomieniu.', 'Send your boss a link — they see the tender, deadline and reasons, and answer in one tap without the app. You get the answer as a notification.')}
        </Text>
        <Button title={t('Wyślij szefowi do decyzji', 'Send to the boss for a decision')} variant="ghost" loading={doSzefaTrwa} onPress={wyslijSzefowi} />
      </View>

      <Button
        title={t('Udostępnij przetarg', 'Share tender')}
        variant="ghost"
        onPress={udostepnij}
        style={styles.gap}
      />
      <ArkuszOdrzucenia widoczny={arkusz} onAnuluj={() => setArkusz(false)} onOdrzuc={odrzuc} zapisywanie={odrzucanie} />
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
    minHeight: 52, paddingVertical: spacing.sm,
  },
  gwiazdka: { fontSize: 24, lineHeight: 28, fontWeight: '700' },
  zapiszTekst: { fontSize: 15, fontWeight: '700', color: k.text },
  przypRzad: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  przypInfo: { flex: 1 },
  przypTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  przypOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  zrodloOceny: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  zrodloEtykieta: { fontSize: 13, fontWeight: '700', color: k.blue },
  zrodloOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginBottom: spacing.md },
  headerTresc: { flex: 1, gap: spacing.sm },
  title: { ...typografia.tytul, color: k.text },
  headerChipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  terminChip: {
    fontSize: 12, fontWeight: '700', color: k.textMuted, backgroundColor: k.neutralneTlo,
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.sm, overflow: 'hidden',
  },
  terminChipPilny: { color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo },
  terminChipMiniony: { color: k.danger, backgroundColor: k.dangerTlo },
  terminChipOk: { color: k.sukcesAkcent, backgroundColor: k.sukcesTlo },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
  },
  kartaListy: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    overflow: 'hidden',
  },
  kartaListyWstep: { padding: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: k.border },
  row: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 13, color: k.textMuted, marginBottom: 2 },
  rowValue: { fontSize: 15, lineHeight: 21, color: k.text, fontWeight: '600' },
  wadiumPodpis: { fontSize: 13, color: k.textMuted, marginTop: 3, lineHeight: 18 },
  wynikWiersz: { fontSize: 15, color: k.text, lineHeight: 22, marginBottom: 6 },
  wynikPodpis: { fontSize: 13, color: k.textMuted, marginTop: 4, lineHeight: 18 },
  sectionTitle: {
    ...typografia.sekcja,
    color: k.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  reasoning: { fontSize: 15, color: k.text, lineHeight: 22 },
  strPodtytul: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  doSzefa: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, gap: spacing.sm },
  doSzefaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  doSzefaOpis: { fontSize: 14, lineHeight: 20, color: k.textMuted },
  warsztatEtykieta: { fontSize: 13, fontWeight: '700', color: k.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },
  warsztatOdstep: { marginTop: spacing.lg },
  notatka: {
    minHeight: 96, borderWidth: 1.5, borderColor: k.obramowaniePola, borderRadius: radius.md,
    padding: spacing.sm + 4, fontSize: 15, lineHeight: 21, color: k.text, backgroundColor: k.surface,
  },
  notatkaStopka: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  notatkaStan: { fontSize: 13, color: k.sukcesAkcent, fontWeight: '700' },
  notatkaBtn: { minWidth: 140 },
  strStart: { marginTop: spacing.md, gap: spacing.sm },
  strBlad: { fontSize: 13, color: k.textMuted, lineHeight: 18 },
  strLadowanie: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strLadowanieTekst: { fontSize: 14, color: k.textMuted },
  strTresc: { marginTop: spacing.md, gap: spacing.md },
  strAkapit: { fontSize: 15, color: k.text, lineHeight: 22 },
  strBlok: { gap: 6 },
  strNaglowek: { fontSize: 14, fontWeight: '800', color: k.text, marginBottom: 2 },
  strPunktRzad: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  strKropka: { width: 6, height: 6, borderRadius: 3, backgroundColor: k.textMuted, marginTop: 9 },
  strPunkt: { flex: 1, fontSize: 15, color: k.text, lineHeight: 24 },
  // Wyróżnik marki: to, co AI wypisało z dokumentów, jest „zakreślone" jak w papierowej SWZ.
  zakreslenie: { backgroundColor: k.zakreslacz },
  uzasadnienieRzad: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 6 },
  uzasadnienieTekst: { flex: 1, fontSize: 15, lineHeight: 21, color: k.text },
  gap: { marginTop: spacing.md },
  // Ekran szczegółów 2026-11-10: pasek decyzji, rozwijane szczegóły oceny, zwinięte narzędzia, karta „Twoja praca”.
  pasekPodpis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginBottom: spacing.xs },
  pasekPrzyciski: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  // 1,3 : 1 — „Nie dla nas” mieści się w jednej linii na telefonie 375 px, a „Bierzesz ten przetarg” też.
  pasekGlowny: { flex: 1.3 },
  pasekDrugi: { flex: 1 },
  pasekStan: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 48, borderRadius: radius.md, backgroundColor: k.sukcesTlo },
  pasekStanTekst: { fontSize: 15, fontWeight: '800', color: k.text },
  rozwinRzad: { marginTop: spacing.md, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  rozwinTekst: { fontSize: 14, fontWeight: '700', color: k.blue },
  pracaOdstep: { paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: k.border },
  narzedziaNaglowek: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl,
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md,
  },
  narzedziaTresc: { flex: 1 },
  narzedziaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  narzedziaOpis: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  narzedziaStrzalka: { fontSize: 18, color: k.textMuted },
  grupaNarzedzi: { fontSize: 13, fontWeight: '800', color: k.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  benchmarkKarta: {
    backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  benchmarkTytul: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  benchmarkKwoty: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 4, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  benchmarkMediana: { color: k.blue, fontWeight: '800' },
  benchmarkOpis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: 6 },
  benchmarkZrodlo: { fontSize: 12, color: k.textMuted, marginTop: 6 },
  decyzjaCta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: k.blue, padding: spacing.md, marginTop: spacing.md },
  decyzjaCtaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  decyzjaCtaOpis: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: 4 },
  decyzjaCtaLink: { fontSize: 14, fontWeight: '800', color: k.blue, marginTop: 10 },
  sciezkaCta: { backgroundColor: k.atrament, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  sciezkaCtaTytul: { fontSize: 16, fontWeight: '800', color: k.naAtramencie },
  sciezkaCtaOpis: { fontSize: 14, color: k.atramentDrugi, lineHeight: 20, marginTop: 4 },
  sciezkaCtaLink: {
    alignSelf: 'flex-start', fontSize: 14, fontWeight: '800', color: k.atrament, backgroundColor: k.naAtramencie,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.sm, overflow: 'hidden', marginTop: 12,
  },
  ctaWcisniete: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  checklistaCta: { marginTop: spacing.sm },
  kontrolaEtapRzad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: k.border,
  },
  kontrolaEtapEtykieta: { fontSize: 13, fontWeight: '700', color: k.textMuted },
  kontrolaEtapWartosc: { fontSize: 15, fontWeight: '700', color: k.text },
  kontrolaInfo: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.sm },
}));
