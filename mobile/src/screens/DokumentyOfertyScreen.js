import { Fragment, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Share, Switch } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import * as storage from '../lib/storage';
import { STAWKI_VAT } from '../lib/kalkulatorCeny';
import {
  POLA_WYKONAWCY,
  WIELKOSCI_FIRMY,
  ID_POL_WYKONAWCY,
  KLUCZ_DANYCH_WYKONAWCY,
  ETYKIETY_KIEDY,
  szablonDanychWykonawcy,
  walidujDaneWykonawcy,
  daneZOgloszenia,
  pakietDokumentow,
  coJeszczeDolaczyc,
  wczytajStanOferty,
  zapiszStanOferty,
} from '../lib/dokumentyOferty';
import { pobierzDanePoNip } from '../lib/danePoNip';
import { generujSciageJedz } from '../lib/sciagaJedz';

/**
 * „DOKUMENTY DO OFERTY W 1 KLIK" — dane firmy wpisujesz RAZ (zostają w aplikacji),
 * resztę bierze z ogłoszenia; dostajesz komplet gotowych tekstów do podpisu:
 * formularz ofertowy, oświadczenie z art. 125 ust. 1, grupa kapitałowa,
 * aktualność informacji. Każdy udostępniasz do e-maila / Worda / platformy.
 *
 * Ekran jest CIENKI: pola, walidacja i treści żyją w `lib/dokumentyOferty.js`
 * (testowane bez renderera). Tu tylko stan formularza, zapis danych firmy
 * w lokalnym magazynie i udostępnianie (`Share`), jak w Kreatorze 118.
 */
export default function DokumentyOfertyScreen({ route, navigation }) {
  const styles = useStyle(tworzStyleDokumentow);
  const { user } = useAuth();
  const match = route?.params?.match ?? null;
  const przetarg = useMemo(() => daneZOgloszenia(match?.tender), [match]);

  const [wykonawca, setWykonawca] = useState(() => szablonDanychWykonawcy(user));
  const [wczytano, setWczytano] = useState(false);
  const [zapisano, setZapisano] = useState(false);
  const [probowano, setProbowano] = useState(false);
  const [pokazDane, setPokazDane] = useState(true);
  const [oferta, setOferta] = useState({ cenaNetto: '', vatProc: 23, terminWykonania: '', gwarancjaMies: '', podwykonawcy: '', tajemnica: false });
  const [sytuacja, setSytuacja] = useState({ art109: false, grupaKapitalowa: false, pelnomocnik: false, polegaNaZasobach: false, konsorcjum: false, wadium: false });
  const [pelnomocnik, setPelnomocnik] = useState({ imie: '', stanowisko: '', dokument: '' });
  const [udostepnione, setUdostepnione] = useState(() => new Set());
  const [nipStan, setNipStan] = useState({ laduje: false, komunikat: null, ok: false });
  const tenderId = match?.tender?.id ?? null;
  const [stanOfertyWczytany, setStanOfertyWczytany] = useState(!tenderId);

  // Stan „tej oferty" per przetarg — po powrocie nic nie wpisujesz drugi raz.
  useEffect(() => {
    if (!tenderId) return undefined;
    let aktywny = true;
    wczytajStanOferty(storage, tenderId).then((z) => {
      if (!aktywny) return;
      if (z) {
        if (z.oferta) setOferta((o) => ({ ...o, ...z.oferta }));
        if (z.sytuacja) setSytuacja((s) => ({ ...s, ...z.sytuacja }));
        if (z.pelnomocnik) setPelnomocnik((p) => ({ ...p, ...z.pelnomocnik }));
      }
      setStanOfertyWczytany(true);
    });
    return () => { aktywny = false; };
  }, [tenderId]);

  useEffect(() => {
    if (!tenderId || !stanOfertyWczytany) return;
    zapiszStanOferty(storage, tenderId, { oferta, sytuacja, pelnomocnik }).catch(() => {});
  }, [tenderId, stanOfertyWczytany, oferta, sytuacja, pelnomocnik]);

  // Dane firmy wpisane raz — przy kolejnej ofercie już są.
  useEffect(() => {
    let aktywny = true;
    (async () => {
      try {
        const surowe = await storage.getItem(KLUCZ_DANYCH_WYKONAWCY);
        if (surowe && aktywny) {
          const zapisane = JSON.parse(surowe);
          setWykonawca((w) => ({ ...w, ...zapisane }));
          setPokazDane(!walidujDaneWykonawcy(zapisane).kompletne);
        }
      } catch {
        /* brak albo uszkodzony zapis — zostaje szablon z profilu */
      } finally {
        if (aktywny) setWczytano(true);
      }
    })();
    return () => { aktywny = false; };
  }, []);

  const walidacja = walidujDaneWykonawcy(wykonawca);
  const brakiIds = new Set(walidacja.braki.map((b) => b.id));
  const bledyWg = Object.fromEntries(walidacja.bledy.map((b) => [b.id, b.komunikat]));

  const zmienWykonawce = (id) => (tekst) => {
    setZapisano(false);
    setWykonawca((w) => ({ ...w, [id]: tekst }));
  };

  // „Wpisz NIP — resztę wstawimy": Biała lista VAT MF (publiczne API, bez klucza).
  async function pobierzPoNip() {
    setNipStan({ laduje: true, komunikat: null, ok: false });
    const { dane, blad } = await pobierzDanePoNip(wykonawca.nip);
    if (!dane) {
      setNipStan({ laduje: false, komunikat: blad, ok: false });
      return;
    }
    setZapisano(false);
    setWykonawca((w) => ({
      ...w,
      nazwa: dane.nazwa || w.nazwa,
      adres: dane.adres || w.adres,
      nip: dane.nip || w.nip,
      regon: dane.regon || w.regon,
      rejestr: dane.rejestr || w.rejestr,
      reprezentant: w.reprezentant || dane.reprezentanci[0] || '',
    }));
    const vat = dane.statusVat ? ` Status VAT: ${dane.statusVat}.` : '';
    setNipStan({ laduje: false, komunikat: `Wstawiono dane z Białej listy VAT.${vat} Sprawdź je i uzupełnij osobę podpisującą oraz e-mail.`, ok: true });
  }

  async function zapiszDane() {
    setProbowano(true);
    if (!walidacja.kompletne) return;
    try {
      await storage.setItem(KLUCZ_DANYCH_WYKONAWCY, JSON.stringify(wykonawca));
      setZapisano(true);
      setPokazDane(false);
    } catch {
      /* magazyn niedostępny — dokumenty i tak się generują z bieżącego stanu */
      setZapisano(true);
      setPokazDane(false);
    }
  }

  const pakiet = useMemo(
    () => pakietDokumentow({ wykonawca, przetarg, oferta, opcje: { ...sytuacja, danePelnomocnika: pelnomocnik }, dzisiaj: new Date().toISOString() }),
    [wykonawca, przetarg, oferta, sytuacja, pelnomocnik],
  );
  const dodatkowe = useMemo(() => coJeszczeDolaczyc(sytuacja), [sytuacja]);

  async function udostepnij(dok) {
    try {
      await Share.share({ message: dok.tresc, title: dok.nazwa });
      setUdostepnione((s) => new Set(s).add(dok.id));
    } catch {
      /* użytkownik anulował — nic nie robimy */
    }
  }

  const przelacz = (klucz) => (v) => setSytuacja((s) => ({ ...s, [klucz]: v }));

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.heroEtykieta}>Dokumenty do oferty w 1 klik</Text>
        <Text style={styles.heroTytul}>{przetarg.tytul ?? 'Komplet oświadczeń do każdej oferty'}</Text>
        <Text style={styles.heroWstep}>
          Dane firmy wpisujesz raz. Formularz ofertowy i trzy oświadczenia dostajesz gotowe do podpisu
          elektronicznego — zamiast przepisywać je przy każdym przetargu.
        </Text>
        {przetarg.zamawiajacy ? <Text style={styles.heroMeta}>Zamawiający: {przetarg.zamawiajacy}</Text> : null}
        {!match ? (
          <Text style={styles.heroMeta}>Otwórz z karty przetargu, a nazwę zamawiającego i numer postępowania wstawi za Ciebie.</Text>
        ) : null}
      </View>

      {/* ── 1. Dane firmy (raz) ── */}
      <Pressable onPress={() => setPokazDane((v) => !v)} style={styles.naglowekSekcji} accessibilityRole="button">
        <Text style={styles.sectionTitle}>1. Dane firmy {walidacja.kompletne ? '✓' : ''}</Text>
        <Text style={styles.naglowekAkcja}>{pokazDane ? 'Zwiń' : 'Edytuj'}</Text>
      </Pressable>
      {!pokazDane && walidacja.kompletne ? (
        <Text style={styles.skrotDanych}>
          {wykonawca.nazwa} · NIP {wykonawca.nip} · podpisuje {wykonawca.reprezentant}
        </Text>
      ) : null}
      {pokazDane ? (
        <View>
          {POLA_WYKONAWCY.filter((p) => p.id !== ID_POL_WYKONAWCY.WIELKOSC).map((p) => (
            <Fragment key={p.id}>
            <TextField
              label={`${p.etykieta} · ${p.wymagane ? 'wymagane' : 'opcjonalne'}`}
              value={wykonawca[p.id] ?? ''}
              onChangeText={zmienWykonawce(p.id)}
              hint={p.opis || undefined}
              error={bledyWg[p.id] ?? (probowano && brakiIds.has(p.id) ? 'To pole jest wymagane.' : undefined)}
              autoCapitalize={p.id === ID_POL_WYKONAWCY.EMAIL ? 'none' : 'sentences'}
              keyboardType={p.id === ID_POL_WYKONAWCY.NIP || p.id === ID_POL_WYKONAWCY.REGON || p.id === ID_POL_WYKONAWCY.TELEFON ? 'phone-pad' : p.id === ID_POL_WYKONAWCY.EMAIL ? 'email-address' : 'default'}
              multiline={p.id === ID_POL_WYKONAWCY.ADRES}
            />
            {p.id === ID_POL_WYKONAWCY.NIP ? (
              <View style={styles.nipBlok}>
                <Button title="Pobierz dane firmy po NIP" onPress={pobierzPoNip} variant="ghost" loading={nipStan.laduje} />
                <Text style={nipStan.ok ? styles.nipOk : nipStan.komunikat ? styles.blad : styles.nipHint}>
                  {nipStan.komunikat ?? 'Nazwę, adres, REGON i KRS wstawimy z Białej listy VAT Ministerstwa Finansów.'}
                </Text>
              </View>
            ) : null}
            </Fragment>
          ))}
          <Text style={styles.label}>Wielkość firmy (oświadczenie MŚP)</Text>
          <View style={styles.chipy}>
            {WIELKOSCI_FIRMY.map((wlk) => {
              const aktywna = wykonawca.wielkosc === wlk.id;
              return (
                <Pressable key={wlk.id} onPress={() => zmienWykonawce(ID_POL_WYKONAWCY.WIELKOSC)(wlk.id)} style={[styles.chip, aktywna && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywna }}>
                  <Text style={[styles.chipTekst, aktywna && styles.chipTekstAktywny]}>{wlk.etykieta}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button title={zapisano ? 'Zapisane' : 'Zapisz dane firmy'} onPress={zapiszDane} disabled={!wczytano} />
          {probowano && !walidacja.kompletne ? (
            <Text style={styles.blad}>
              Uzupełnij: {[...walidacja.braki.map((b) => b.etykieta), ...walidacja.bledy.map((b) => b.etykieta)].join(', ')}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── 2. Ta oferta ── */}
      <Text style={styles.sectionTitle}>2. Ta oferta</Text>
      <Text style={styles.sectionOpis}>Uzupełnij to, co zależy od tego przetargu. Co puste — w dokumencie zostanie kropkowane miejsce.</Text>
      <TextField label="Cena netto (zł)" value={oferta.cenaNetto} onChangeText={(v) => setOferta((o) => ({ ...o, cenaNetto: v }))} keyboardType="decimal-pad" hint="VAT i brutto policzą się same" />
      <Text style={styles.label}>Stawka VAT</Text>
      <View style={styles.chipy}>
        {STAWKI_VAT.map((s) => {
          const aktywna = oferta.vatProc === s;
          return (
            <Pressable key={s} onPress={() => setOferta((o) => ({ ...o, vatProc: s }))} style={[styles.chip, aktywna && styles.chipAktywny]} accessibilityRole="button" accessibilityState={{ selected: aktywna }}>
              <Text style={[styles.chipTekst, aktywna && styles.chipTekstAktywny]}>{s} %</Text>
            </Pressable>
          );
        })}
      </View>
      <TextField label="Termin wykonania" value={oferta.terminWykonania} onChangeText={(v) => setOferta((o) => ({ ...o, terminWykonania: v }))} hint="np. 90 dni od podpisania umowy — tak jak wymaga SWZ" />
      <TextField label="Okres gwarancji (miesiące)" value={oferta.gwarancjaMies} onChangeText={(v) => setOferta((o) => ({ ...o, gwarancjaMies: v }))} keyboardType="number-pad" />
      <TextField label="Części dla podwykonawców" value={oferta.podwykonawcy} onChangeText={(v) => setOferta((o) => ({ ...o, podwykonawcy: v }))} hint="Puste = wykonujesz samodzielnie" multiline />

      <View style={styles.przelacznik}>
        <Text style={styles.przelacznikTekst}>Zastrzegam tajemnicę przedsiębiorstwa w części oferty</Text>
        <Switch value={oferta.tajemnica} onValueChange={(v) => setOferta((o) => ({ ...o, tajemnica: v }))} />
      </View>
      {oferta.tajemnica ? (
        <Button title="Jak zastrzec skutecznie (Tarcza tajemnicy)" onPress={() => navigation.navigate('Tajemnica')} variant="ghost" />
      ) : null}

      {/* ── 3. Sytuacja wykonawcy ── */}
      <Text style={styles.sectionTitle}>3. Twoja sytuacja</Text>
      <Text style={styles.sectionOpis}>Od tego zależy treść oświadczeń i lista dodatkowych załączników.</Text>
      {[
        ['art109', 'Zamawiający przewidział w SWZ wykluczenie z art. 109 ust. 1'],
        ['grupaKapitalowa', 'Należę do grupy kapitałowej z innym oferentem'],
        ['pelnomocnik', 'Ofertę podpisze pełnomocnik'],
        ['polegaNaZasobach', 'Polegam na doświadczeniu innej firmy (art. 118)'],
        ['konsorcjum', 'Startuję w konsorcjum'],
        ['wadium', 'Wymagane jest wadium'],
      ].map(([klucz, etykieta]) => (
        <View key={klucz}>
          <View style={styles.przelacznik}>
            <Text style={styles.przelacznikTekst}>{etykieta}</Text>
            <Switch value={sytuacja[klucz]} onValueChange={przelacz(klucz)} />
          </View>
          {klucz === 'pelnomocnik' && sytuacja.pelnomocnik ? (
            <View>
              <TextField label="Pełnomocnik — imię i nazwisko" value={pelnomocnik.imie} onChangeText={(v) => setPelnomocnik((p) => ({ ...p, imie: v }))} hint="Pełnomocnictwo dojdzie do pakietu; podpisuje je mocodawca z rejestru" />
              <TextField label="Stanowisko pełnomocnika (opcjonalnie)" value={pelnomocnik.stanowisko} onChangeText={(v) => setPelnomocnik((p) => ({ ...p, stanowisko: v }))} />
            </View>
          ) : null}
        </View>
      ))}

      {/* ── 4. Pakiet ── */}
      <Text style={styles.sectionTitle}>4. Gotowe dokumenty</Text>
      {!walidacja.kompletne ? (
        <Text style={styles.ostrzezenie}>Dane firmy są niekompletne — dokumenty wygenerują się z kropkami w brakujących miejscach. Uzupełnij i zapisz w punkcie 1.</Text>
      ) : null}
      {pakiet.map((dok) => (
        <View key={dok.id} style={styles.karta}>
          <View style={styles.kartaNaglowek}>
            <Text style={styles.kartaTytul}>{dok.nazwa}</Text>
            {udostepnione.has(dok.id) ? <Text style={styles.kartaOk}>udostępniono</Text> : null}
          </View>
          <Text style={styles.kartaKiedy}>{ETYKIETY_KIEDY[dok.kiedy]}</Text>
          <Text style={styles.kartaPodstawa}>{dok.podstawa}</Text>
          {dok.uwaga ? <Text style={styles.kartaUwaga}>{dok.uwaga}</Text> : null}
          {dok.braki?.length ? <Text style={styles.kartaUwaga}>Brakuje: {dok.braki.join(', ')} — uzupełnij w punkcie 2.</Text> : null}
          <Text style={styles.podglad} numberOfLines={6}>{dok.tresc}</Text>
          <Button title="Udostępnij / skopiuj" onPress={() => udostepnij(dok)} variant="ghost" />
        </View>
      ))}

      {przetarg.zrodlo === 'ted' ? (
        <View style={styles.karta}>
          <Text style={styles.kartaTytul}>Przetarg unijny: zamiast oświadczenia — JEDZ (ESPD)</Text>
          <Text style={styles.kartaOpis}>
            Powyżej progów UE oświadczenie wstępne składasz na formularzu JEDZ. Ściąga mówi sekcja po sekcji,
            co wpisać i co zaznaczyć — z Twoimi danymi już wstawionymi.
          </Text>
          <Button
            title="Ściąga do JEDZ — udostępnij"
            variant="ghost"
            onPress={async () => {
              const s = generujSciageJedz({ wykonawca, przetarg, sytuacja: { polegaNaZasobach: sytuacja.polegaNaZasobach, podwykonawcy: oferta.podwykonawcy, konsorcjum: sytuacja.konsorcjum } });
              try { await Share.share({ message: s.tresc, title: s.nazwa }); } catch { /* anulowane */ }
            }}
          />
        </View>
      ) : null}

      <Button
        title="Udostępnij cały pakiet jednym ruchem"
        onPress={async () => {
          const calosc = pakiet.map((d) => `=== ${d.nazwa} (${ETYKIETY_KIEDY[d.kiedy]}) ===\n\n${d.tresc}`).join('\n\n\n');
          try {
            await Share.share({ message: calosc, title: `Dokumenty do oferty — ${przetarg.tytul ?? 'pakiet'}` });
            setUdostepnione(new Set(pakiet.map((d) => d.id)));
          } catch {
            /* anulowane */
          }
        }}
      />

      {/* ── 5. Co jeszcze ── */}
      <Text style={styles.sectionTitle}>5. Co jeszcze dołączyć</Text>
      {dodatkowe.map((p) => (
        <View key={p.id} style={styles.karta}>
          <Text style={styles.kartaTytul}>{p.tytul}</Text>
          <Text style={styles.kartaOpis}>{p.opis}</Text>
          {p.ekran ? <Button title="Otwórz narzędzie" onPress={() => navigation.navigate(p.ekran, match ? { match } : undefined)} variant="ghost" /> : null}
        </View>
      ))}
      <Text style={styles.stopka}>
        To szkice wg wymogów Pzp. Gdy zamawiający dołączył do SWZ własne wzory, przepisz do nich te treści — podstawa prawna i elementy są te same.
      </Text>
    </Screen>
  );
}

const tworzStyleDokumentow = tworzStyle((k) => ({
  hero: { backgroundColor: k.wyroznienie, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.lg, marginBottom: spacing.md },
  heroEtykieta: { fontSize: 12, fontWeight: '700', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTytul: { fontSize: 22, fontWeight: '800', color: k.text, marginTop: 6, lineHeight: 28 },
  heroWstep: { fontSize: 14, color: k.text, marginTop: spacing.sm, lineHeight: 21 },
  heroMeta: { fontSize: 13, color: k.textMuted, marginTop: spacing.sm, lineHeight: 19 },
  naglowekSekcji: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  naglowekAkcja: { fontSize: 13, fontWeight: '700', color: k.blue },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: k.text, marginTop: spacing.md, marginBottom: 4 },
  sectionOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  skrotDanych: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: '600', color: k.text, marginTop: spacing.sm, marginBottom: 6 },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: { borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.surface, paddingVertical: 8, paddingHorizontal: 12 },
  chipAktywny: { backgroundColor: k.blue, borderColor: k.blue },
  chipTekst: { fontSize: 13, color: k.text, fontWeight: '600' },
  chipTekstAktywny: { color: k.white },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.sm, lineHeight: 18 },
  nipBlok: { marginBottom: spacing.md },
  nipHint: { fontSize: 12, color: k.textMuted, marginTop: 6, lineHeight: 17 },
  nipOk: { fontSize: 13, color: k.green, marginTop: 6, lineHeight: 18, fontWeight: '600' },
  ostrzezenie: { fontSize: 13, color: k.danger, lineHeight: 19, marginBottom: spacing.sm },
  przelacznik: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 8 },
  przelacznikTekst: { flex: 1, fontSize: 14, color: k.text, lineHeight: 20 },
  karta: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.sm },
  kartaNaglowek: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  kartaTytul: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text },
  kartaOk: { fontSize: 12, fontWeight: '700', color: k.green },
  kartaKiedy: { fontSize: 12, fontWeight: '700', color: k.blue, marginTop: 4 },
  kartaPodstawa: { fontSize: 12, color: k.textMuted, marginTop: 2 },
  kartaUwaga: { fontSize: 13, color: k.danger, lineHeight: 18, marginTop: 6 },
  kartaOpis: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: 4, marginBottom: 6 },
  podglad: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm, marginBottom: spacing.sm, fontFamily: undefined },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.md, marginBottom: spacing.lg },
}));
