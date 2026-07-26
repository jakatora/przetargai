import { useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import {
  odliczaniePytan,
  statusPytaniaEtykieta,
  parsujDiff,
  etykietaSekcji,
  etykietaPoziomuBramki,
} from '../lib/radarSwz';

/**
 * Panel „RADAR SWZ" — podzadanie 7/7 ulepszenia „Radar pytań i odpowiedzi do SWZ".
 *
 * Spina w jeden ekran trzy rzeczy, które backend już liczy dla obserwowanego
 * postępowania:
 *   1. listę WYGENEROWANYCH PYTAŃ do SWZ z ODLICZANIEM do terminu ich składania
 *      (koniec dnia połowy terminu składania ofert — po nim zamawiający może je
 *      zignorować),
 *   2. TIMELINE opublikowanych zmian SWZ z czytelnym diffem i opisem skutku
 *      („termin 60→45 dni — przelicz harmonogram i cenę") + odznaczaniem „uwzględniono",
 *   3. CHECKLISTĘ przedwysyłkową z werdyktem bramki: blokada przy nieuwzględnionych
 *      zmianach, przejście z ostrzeżeniem na wyraźne wymuszenie.
 *
 * Ekran NIC nie liczy — całość (termin, diff, mapowanie na sekcje oferty, bramka)
 * robi backend; tu tylko renderujemy i wołamy endpointy (`/api/przetarg/swz/*`).
 * Reguły „liczba → słowo" (odliczanie, kolor diffu, etykiety) żyją w testowanym
 * `lib/radarSwz.js`.
 */

/** Akcent banera odliczania wg pilności terminu pytań. */
function akcentOdliczania(stan, k) {
  if (stan === 'minelo' || stan === 'dzis') return k.danger;
  if (stan === 'pilne') return k.ostrzezenieTekst;
  if (stan === 'ok') return k.green;
  return k.textMuted;
}

/** Akcent banera bramki wg jej poziomu (ok / blokada / ostrzeżenie). */
function akcentBramki(poziom, k) {
  if (poziom === 'ok') return k.green;
  if (poziom === 'ostrzezenie') return k.ostrzezenieTekst;
  return k.danger;
}

/** Kolor linii diffu wg typu (dodane/usunięte/kontekst/zwinięte). */
function kolorDiffu(typ, k) {
  if (typ === 'dodane') return k.green;
  if (typ === 'usuniete') return k.danger;
  return k.textMuted;
}

export default function RadarSwzScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleRadaru);

  const [mode, setMode] = useState('lista'); // 'lista' | 'detal'
  const [lista, setLista] = useState(null);
  const [bladListy, setBladListy] = useState(null);

  const [wybraneId, setWybraneId] = useState(null);
  const [detal, setDetal] = useState(null);
  const [ladujeDetal, setLadujeDetal] = useState(false);
  const [bladDetal, setBladDetal] = useState(null);

  // Formularz założenia postępowania (wejście panelu).
  const [nowaNazwa, setNowaNazwa] = useState('');
  const [nowaOgloszenie, setNowaOgloszenie] = useState('');
  const [nowyTermin, setNowyTermin] = useState('');
  const [tworze, setTworze] = useState(false);

  // Akcje w detalu: analiza (generuje pytania), odświeżenie (nowa wersja SWZ).
  const [swzTekst, setSwzTekst] = useState('');
  const [analizuje, setAnalizuje] = useState(false);
  const [nowaWersja, setNowaWersja] = useState('');
  const [odswiezam, setOdswiezam] = useState(false);
  const [zmianaBusyId, setZmianaBusyId] = useState(null);
  const [wysylam, setWysylam] = useState(false);
  const [wyslijWynik, setWyslijWynik] = useState(null);
  const [bladAkcji, setBladAkcji] = useState(null);

  const wczytajListe = useCallback(async () => {
    setBladListy(null);
    try {
      const dane = await api.radarListaPostepowan();
      setLista(Array.isArray(dane?.postepowania) ? dane.postepowania : []);
    } catch (err) {
      setBladListy(err.message);
      setLista([]);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (mode === 'lista') wczytajListe();
  }, [mode, wczytajListe]));

  async function wczytajDetal(id) {
    setLadujeDetal(true);
    setBladDetal(null);
    try {
      setDetal(await api.radarPostepowanie(id));
    } catch (err) {
      setBladDetal(err.message);
      setDetal(null);
    } finally {
      setLadujeDetal(false);
    }
  }

  function otworz(id) {
    setWybraneId(id);
    setMode('detal');
    setWyslijWynik(null);
    setBladAkcji(null);
    setSwzTekst('');
    setNowaWersja('');
    wczytajDetal(id);
  }

  function wroc() {
    setMode('lista');
    setWybraneId(null);
    setDetal(null);
  }

  async function utworz() {
    const nazwa = nowaNazwa.trim();
    if (!nazwa || tworze) return;
    setTworze(true);
    setBladListy(null);
    try {
      const payload = { nazwa };
      if (nowaOgloszenie.trim()) payload.data_ogloszenia = nowaOgloszenie.trim();
      if (nowyTermin.trim()) payload.termin_skladania_ofert = nowyTermin.trim();
      const { postepowanie } = await api.radarUtworzPostepowanie(payload);
      setNowaNazwa('');
      setNowaOgloszenie('');
      setNowyTermin('');
      otworz(postepowanie.id);
    } catch (err) {
      setBladListy(err.message);
    } finally {
      setTworze(false);
    }
  }

  async function analizuj() {
    if (!swzTekst.trim() || analizuje) return;
    setAnalizuje(true);
    setBladAkcji(null);
    try {
      await api.radarAnalizuj(wybraneId, { swz: swzTekst.trim() });
      setSwzTekst('');
      await wczytajDetal(wybraneId);
    } catch (err) {
      setBladAkcji(err.message);
    } finally {
      setAnalizuje(false);
    }
  }

  async function odswiez() {
    if (!nowaWersja.trim() || odswiezam) return;
    setOdswiezam(true);
    setBladAkcji(null);
    try {
      await api.radarOdswiez(wybraneId, { tresc: nowaWersja.trim() });
      setNowaWersja('');
      setWyslijWynik(null);
      await wczytajDetal(wybraneId);
    } catch (err) {
      setBladAkcji(err.message);
    } finally {
      setOdswiezam(false);
    }
  }

  async function przelacz(zmiana) {
    if (zmianaBusyId) return;
    setZmianaBusyId(zmiana.id);
    setBladAkcji(null);
    setWyslijWynik(null);
    try {
      await api.radarUwzglednij(wybraneId, zmiana.id, !zmiana.uwzglednione);
      await wczytajDetal(wybraneId);
    } catch (err) {
      setBladAkcji(err.message);
    } finally {
      setZmianaBusyId(null);
    }
  }

  async function wyslij(wymus) {
    if (wysylam) return;
    setWysylam(true);
    setBladAkcji(null);
    try {
      const wynik = await api.radarWyslij(wybraneId, wymus);
      setWyslijWynik(wynik.bramka);
    } catch (err) {
      // 409 = bramka zablokowała (nieuwzględnione zmiany) — pokaż to wprost.
      if (err.status === 409) {
        setBladAkcji('Nie można wysłać — masz nieuwzględnione zmiany SWZ. Odznacz je albo wyślij z wymuszeniem.');
      } else {
        setBladAkcji(err.message);
      }
    } finally {
      setWysylam(false);
    }
  }

  // ── Widok LISTY / założenia postępowania ───────────────────────────────────
  if (mode === 'lista') {
    return (
      <Screen scroll>
        <Text style={styles.wstep}>
          Radar SWZ pilnuje dwóch rzeczy: terminu na pytania do treści SWZ (koniec dnia,
          w którym mija połowa terminu składania ofert) oraz zmian, które zamawiający
          publikuje aż do składania — i sprawdza, czy uwzględniłeś je przed wysłaniem oferty.
        </Text>

        <View style={styles.card}>
          <Text style={styles.sekcjaTytul}>Weź postępowanie pod radar</Text>
          <TextField
            label="Nazwa postępowania"
            value={nowaNazwa}
            onChangeText={setNowaNazwa}
            placeholder="np. Budowa drogi gminnej"
          />
          <TextField
            label="Data ogłoszenia"
            value={nowaOgloszenie}
            onChangeText={setNowaOgloszenie}
            placeholder="RRRR-MM-DD"
            hint="Opcjonalnie. Razem z terminem składania wyznacza termin pytań."
            autoCapitalize="none"
          />
          <TextField
            label="Termin składania ofert"
            value={nowyTermin}
            onChangeText={setNowyTermin}
            placeholder="RRRR-MM-DD"
            hint="Opcjonalnie. Bez niego nie policzymy terminu pytań."
            autoCapitalize="none"
          />
          <Button title="Dodaj do radaru" onPress={utworz} loading={tworze} disabled={!nowaNazwa.trim()} />
        </View>

        {bladListy ? (
          <View style={styles.bladCard}><Text style={styles.bladText}>{bladListy}</Text></View>
        ) : null}

        {lista === null ? (
          <ActivityIndicator color={kolory.blue} style={styles.spinner} />
        ) : lista.length === 0 ? (
          <Text style={styles.pusto}>Nie masz jeszcze żadnego postępowania pod radarem.</Text>
        ) : (
          lista.map((p) => {
            const o = odliczaniePytan(p.termin_pytania);
            const akcent = akcentOdliczania(o.stan, kolory);
            return (
              <Pressable key={p.id} onPress={() => otworz(p.id)} style={styles.kafelek}>
                <Text style={styles.kafelekNazwa}>{p.nazwa}</Text>
                <View style={[styles.chip, { borderColor: akcent }]}>
                  <Text style={[styles.chipText, { color: akcent }]}>{o.etykieta}</Text>
                </View>
                <Text style={styles.kafelekMeta}>
                  Pytania: {p.liczba_pytan} · Zmiany: {p.liczba_zmian}
                  {p.do_odznaczenia > 0 ? ` · Do uwzględnienia: ${p.do_odznaczenia}` : ''}
                </Text>
              </Pressable>
            );
          })
        )}
      </Screen>
    );
  }

  // ── Widok DETALU (radar postępowania) ──────────────────────────────────────
  if (ladujeDetal && !detal) {
    return (
      <Screen>
        <View style={styles.center}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </Screen>
    );
  }

  if (bladDetal && !detal) {
    return (
      <Screen scroll>
        <Pressable onPress={wroc} hitSlop={8}><Text style={styles.powrot}>← Wszystkie postępowania</Text></Pressable>
        <View style={styles.bladCard}><Text style={styles.bladText}>{bladDetal}</Text></View>
        <Button title="Spróbuj ponownie" variant="ghost" onPress={() => wczytajDetal(wybraneId)} />
      </Screen>
    );
  }

  if (!detal) return null;

  const { postepowanie, termin_pytania: terminPytania, pytania, zmiany, checklista, bramka } = detal;
  const odliczanie = odliczaniePytan(terminPytania);
  const akcentTerminu = akcentOdliczania(odliczanie.stan, kolory);
  const werdykt = wyslijWynik ?? bramka;
  const akcentWerdyktu = akcentBramki(werdykt.poziom, kolory);

  return (
    <Screen scroll>
      <Pressable onPress={wroc} hitSlop={8}><Text style={styles.powrot}>← Wszystkie postępowania</Text></Pressable>
      <Text style={styles.tytul}>{postepowanie.nazwa}</Text>
      <Text style={styles.podtytul}>
        Termin składania ofert: {postepowanie.termin_skladania_ofert ? formatDate(postepowanie.termin_skladania_ofert) : 'nieznany'}
      </Text>

      {bladAkcji ? (
        <View style={styles.bladCard}><Text style={styles.bladText}>{bladAkcji}</Text></View>
      ) : null}

      {/* ── 1. Termin pytań + pytania ── */}
      <View style={[styles.baner, { borderColor: akcentTerminu }]}>
        <Text style={[styles.banerTytul, { color: akcentTerminu }]}>{odliczanie.etykieta}</Text>
        {terminPytania?.terminPytan ? (
          <Text style={styles.banerMeta}>Pytania do SWZ złóż do końca dnia {formatDate(terminPytania.terminPytan)}.</Text>
        ) : (
          <Text style={styles.banerMeta}>Uzupełnij daty postępowania, żeby policzyć termin pytań.</Text>
        )}
      </View>

      <Text style={styles.sekcjaTytul}>Pytania do SWZ ({pytania.length})</Text>
      {pytania.length === 0 ? (
        <Text style={styles.pusto}>Brak pytań. Wygeneruj je z treści SWZ poniżej.</Text>
      ) : (
        pytania.map((p) => (
          <View key={p.id} style={styles.pozycja}>
            <View style={styles.pozycjaNaglowek}>
              <Text style={styles.badgeNeutral}>{statusPytaniaEtykieta(p.status)}</Text>
            </View>
            <Text style={styles.pozycjaTresc}>{p.tresc}</Text>
            {p.fragment_swz ? <Text style={styles.pozycjaFragment}>Dotyczy: {p.fragment_swz}</Text> : null}
          </View>
        ))
      )}

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Wygeneruj pytania z treści SWZ</Text>
        <Text style={styles.kartaOpis}>
          Wklej treść SWZ — wykryjemy niejasności, sprzeczności i braki parametrów i zapiszemy je jako gotowe szkice pytań.
        </Text>
        <TextField
          value={swzTekst}
          onChangeText={setSwzTekst}
          placeholder="Wklej tu treść SWZ…"
          multiline
          numberOfLines={6}
          inputStyle={styles.inputWielo}
        />
        <Button title="Wygeneruj pytania" onPress={analizuj} loading={analizuje} disabled={!swzTekst.trim()} />
      </View>

      {/* ── 2. Timeline zmian ── */}
      <Text style={styles.sekcjaTytul}>Opublikowane zmiany ({zmiany.length})</Text>
      {zmiany.length === 0 ? (
        <Text style={styles.pusto}>Zamawiający nie opublikował jeszcze żadnej zmiany.</Text>
      ) : (
        zmiany.map((z) => {
          const linie = parsujDiff(z.diff);
          const busy = zmianaBusyId === z.id;
          return (
            <View
              key={z.id}
              style={[styles.zmiana, { borderLeftColor: z.uwzglednione ? kolory.green : kolory.danger }]}
            >
              <Text style={styles.zmianaData}>{z.data_publikacji ? formatDate(z.data_publikacji) : 'bez daty'}</Text>
              {z.opis_skutku ? (
                <Text style={styles.zmianaOpis}>{z.opis_skutku}</Text>
              ) : (
                <Text style={styles.zmianaOpisBrak}>Opis skutku niedostępny — zobacz różnicę poniżej.</Text>
              )}

              {linie.length > 0 ? (
                <View style={styles.diff}>
                  {linie.map((l, i) => (
                    <Text key={i} style={[styles.diffLinia, { color: kolorDiffu(l.typ, kolory) }]}>
                      {l.typ === 'dodane' ? '+ ' : l.typ === 'usuniete' ? '− ' : '  '}{l.tekst}
                    </Text>
                  ))}
                </View>
              ) : null}

              {z.elementy_oferty?.length ? (
                <View style={styles.sekcjeRzad}>
                  {z.elementy_oferty.map((s) => (
                    <Text key={s} style={styles.badgeSekcja}>{etykietaSekcji(s)}</Text>
                  ))}
                </View>
              ) : null}

              <Pressable onPress={() => przelacz(z)} disabled={busy} style={styles.przelacznik}>
                {busy ? (
                  <ActivityIndicator color={kolory.blue} />
                ) : (
                  <Text style={[styles.przelacznikText, { color: z.uwzglednione ? kolory.green : kolory.blue }]}>
                    {z.uwzglednione ? '☑ Uwzględniono w ofercie' : '☐ Oznacz jako uwzględnione'}
                  </Text>
                )}
              </Pressable>
            </View>
          );
        })
      )}

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>Sprawdź publikacje zamawiającego</Text>
        <Text style={styles.kartaOpis}>
          Wklej nowo opublikowaną wersję SWZ — porównamy ją z poprzednią i pokażemy różnicę oraz jej skutek.
        </Text>
        <TextField
          value={nowaWersja}
          onChangeText={setNowaWersja}
          placeholder="Wklej treść nowej wersji SWZ…"
          multiline
          numberOfLines={6}
          inputStyle={styles.inputWielo}
        />
        <Button title="Sprawdź zmiany" onPress={odswiez} loading={odswiezam} disabled={!nowaWersja.trim()} />
      </View>

      {/* ── 3. Checklista przedwysyłkowa + bramka ── */}
      <Text style={styles.sekcjaTytul}>Przed wysłaniem oferty</Text>
      <View style={styles.sekcjeRzad}>
        {checklista.sekcje.map((s) => (
          <Text
            key={s.sekcja}
            style={[
              styles.badgeStan,
              s.wymaga_aktualizacji
                ? { backgroundColor: kolory.dangerTlo, color: kolory.danger }
                : { backgroundColor: kolory.sukcesTlo, color: kolory.green },
            ]}
          >
            {etykietaSekcji(s.sekcja)}: {s.wymaga_aktualizacji ? 'wymaga aktualizacji' : 'ok'}
          </Text>
        ))}
      </View>

      <View style={[styles.baner, { borderColor: akcentWerdyktu }]}>
        <Text style={[styles.banerTytul, { color: akcentWerdyktu }]}>{etykietaPoziomuBramki(werdykt.poziom)}</Text>
        <Text style={styles.banerMeta}>{werdykt.komunikat}</Text>
      </View>

      {checklista.gotowa_do_wyslania ? (
        <Button title="Wyślij ofertę" onPress={() => wyslij(false)} loading={wysylam} />
      ) : (
        <Button
          title="Wyślij mimo to (z ostrzeżeniem)"
          variant="danger"
          onPress={() => wyslij(true)}
          loading={wysylam}
        />
      )}

      <Text style={styles.stopka}>
        Radar SWZ jest pomocniczy — nie zastępuje śledzenia oficjalnej platformy zakupowej zamawiającego.
      </Text>
    </Screen>
  );
}

const tworzStyleRadaru = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { marginTop: spacing.lg },
  powrot: { fontSize: 14, fontWeight: '700', color: k.blue, marginBottom: spacing.md },
  tytul: { fontSize: 22, fontWeight: '800', color: k.text, lineHeight: 28 },
  podtytul: { fontSize: 13, color: k.textMuted, marginTop: 4, marginBottom: spacing.lg },

  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginBottom: spacing.sm },

  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: 4 },
  kartaOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginBottom: spacing.md },
  inputWielo: { minHeight: 110, textAlignVertical: 'top' },

  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },

  // Kafelek postępowania na liście.
  kafelek: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  kafelekNazwa: { fontSize: 16, fontWeight: '700', color: k.text, lineHeight: 21 },
  kafelekMeta: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.sm,
  },
  chipText: { fontSize: 12, fontWeight: '800' },

  // Baner (odliczanie / werdykt bramki).
  baner: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: k.surface,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  banerTytul: { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  banerMeta: { fontSize: 13, color: k.textMuted, marginTop: 4, lineHeight: 19 },

  // Pozycja pytania.
  pozycja: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  pozycjaNaglowek: { flexDirection: 'row', marginBottom: 6 },
  pozycjaTresc: { fontSize: 14, color: k.text, lineHeight: 20 },
  pozycjaFragment: { fontSize: 12, color: k.textMuted, marginTop: 6, fontStyle: 'italic' },
  badgeNeutral: {
    fontSize: 11,
    fontWeight: '800',
    color: k.textMuted,
    backgroundColor: k.neutralneTlo,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  // Wpis timeline zmiany.
  zmiana: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  zmianaData: { fontSize: 12, fontWeight: '700', color: k.textMuted },
  zmianaOpis: { fontSize: 14, fontWeight: '600', color: k.text, marginTop: 4, lineHeight: 20 },
  zmianaOpisBrak: { fontSize: 13, color: k.textMuted, marginTop: 4, fontStyle: 'italic' },
  diff: {
    backgroundColor: k.bg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  diffLinia: { fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
  sekcjeRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  badgeSekcja: {
    fontSize: 11,
    fontWeight: '700',
    color: k.blue,
    backgroundColor: k.wyroznienie,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  badgeStan: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  przelacznik: { marginTop: spacing.md, paddingVertical: spacing.xs },
  przelacznikText: { fontSize: 14, fontWeight: '700' },

  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
