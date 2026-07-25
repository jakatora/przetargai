import { useState } from 'react';
import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import {
  KOLOR_ZIELONY,
  KOLOR_POMARANCZOWY,
  KOLOR_CZERWONY,
  meta_koloru,
  podsumuj_flagi,
  ryzyko_ogolne,
  porzadkuj_ryzykiem,
} from '../lib/flagiUmowy';

/**
 * Ekran „PRZEŚWIETLENIE UMOWY PRZED PODPISEM" — podzadanie 9/12 ulepszenia
 * „pilnowanie waloryzacji i pułapek w umowie".
 *
 * WYŁĄCZNIE UI: użytkownik wkleja treść projektu umowy (+ opcjonalnie czas jej
 * trwania), ekran woła `/api/przetarg/umowa/analiza` i renderuje zwróconą listę
 * flag `[{ typ, kolor, tytul, opis }]` po ludzku — jako zielone/pomarańczowe/
 * czerwone karty z prostym opisem ryzyka, uporządkowane „najpierw ryzyko".
 *
 * Całą analizę (parser + detektory + scalenie w flagi) robi backend
 * (`zbuduj_flagi_umowy`) — ten ekran jej NIE liczy, tylko pokazuje. Sam kontrakt
 * koloru/ryzyka/kolejności żyje w czystym `lib/flagiUmowy.js` (testowany).
 */

// Ludzka nazwa obszaru umowy z pola `typ` (backend daje po jednej fladze na obszar).
const ETYKIETA_TYPU = {
  waloryzacja: 'Waloryzacja',
  kary: 'Kary umowne',
  odbiory: 'Odbiory',
  podwykonawcy: 'Podwykonawcy',
};

// Nagłówek banera ogólnego ryzyka wg poziomu z `ryzyko_ogolne`.
const ETYKIETA_RYZYKA = {
  wysokie: 'Wysokie ryzyko — są czerwone flagi',
  srednie: 'Do sprawdzenia przed podpisem',
  niskie: 'Wygląda w porządku',
  brak: 'Brak flag do pokazania',
};

/** Paleta karty/plakietki dla koloru flagi (tło, akcent ramki, kolor tekstu). */
function paletaFlagi(kolor, k) {
  switch (kolor) {
    case KOLOR_ZIELONY:
      return { akcent: k.green, tlo: k.sukcesTlo, tekst: k.green };
    case KOLOR_POMARANCZOWY:
      return { akcent: k.ostrzezenieTekst, tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
    case KOLOR_CZERWONY:
      return { akcent: k.danger, tlo: k.dangerTlo, tekst: k.danger };
    default:
      // Nieznany kolor: neutralnie, ale wyraźnie „do sprawdzenia" (nie zieleń).
      return { akcent: k.border, tlo: k.neutralneTlo, tekst: k.textMuted };
  }
}

/** Akcent banera ogólnego ryzyka. */
function akcentRyzyka(poziom, k) {
  if (poziom === 'wysokie') return k.danger;
  if (poziom === 'srednie') return k.ostrzezenieTekst;
  if (poziom === 'niskie') return k.green;
  return k.textMuted;
}

export default function PrzeswietlenieUmowyScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleUmowy);

  const [tekst, setTekst] = useState('');
  const [miesiaceTekst, setMiesiaceTekst] = useState('');
  const [busy, setBusy] = useState(false);
  const [blad, setBlad] = useState(null);
  const [flagi, setFlagi] = useState(null); // null = jeszcze nie prześwietlono

  const trescPusta = !tekst.trim();

  async function przeswietl() {
    if (trescPusta || busy) return;
    setBusy(true);
    setBlad(null);
    try {
      // `miesiace` wysyłamy tylko gdy podano poprawną dodatnią liczbę — inaczej
      // pomijamy pole (backend potraktuje brak klauzuli jako „uwagę", nie „naruszenie").
      const miesiace = Number.parseInt(miesiaceTekst, 10);
      const payload = { tekst: tekst.trim() };
      if (Number.isFinite(miesiace) && miesiace > 0) payload.miesiace = miesiace;

      const dane = await api.analizujUmowe(payload);
      setFlagi(Array.isArray(dane?.flagi) ? dane.flagi : []);
    } catch (err) {
      setBlad(err.message);
      setFlagi(null);
    } finally {
      setBusy(false);
    }
  }

  const podsumowanie = flagi ? podsumuj_flagi(flagi) : null;
  const poziomRyzyka = flagi ? ryzyko_ogolne(flagi) : null;
  const uporzadkowane = flagi ? porzadkuj_ryzykiem(flagi) : [];

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        Wklej treść projektu umowy, a prześwietlę ją pod kątem pułapek: klauzula
        waloryzacyjna, kary umowne i ich limit, zapisy o odbiorach i podwykonawcach.
      </Text>

      <TextField
        label="Treść projektu umowy"
        value={tekst}
        onChangeText={setTekst}
        placeholder="Wklej tu tekst umowy…"
        hint="Skopiuj treść umowy ze SWZ lub dokumentu."
        multiline
        numberOfLines={8}
        style={styles.poleTekst}
        inputStyle={styles.inputTekst}
      />

      <TextField
        label="Czas trwania umowy (miesiące)"
        value={miesiaceTekst}
        onChangeText={(v) => setMiesiaceTekst(v.replace(/[^0-9]/g, ''))}
        placeholder="np. 18"
        hint="Opcjonalnie. Powyżej 6 miesięcy klauzula waloryzacyjna jest obowiązkowa (art. 439 Pzp)."
        keyboardType="number-pad"
      />

      <Button
        title="Prześwietl umowę"
        onPress={przeswietl}
        loading={busy}
        disabled={trescPusta}
      />

      {blad ? (
        <View style={styles.bladCard}>
          <Text style={styles.bladText}>{blad}</Text>
        </View>
      ) : null}

      {/* Wynik prześwietlenia: baner ryzyka + karty flag „najpierw ryzyko". */}
      {flagi ? (
        flagi.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.pusto}>
              Nie udało się wyodrębnić treści umowy. Sprawdź, czy wklejony tekst
              zawiera zapisy umowy, i spróbuj ponownie.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.banerRyzyka, { borderColor: akcentRyzyka(poziomRyzyka, kolory) }]}>
              <Text style={[styles.banerTytul, { color: akcentRyzyka(poziomRyzyka, kolory) }]}>
                {ETYKIETA_RYZYKA[poziomRyzyka] ?? ETYKIETA_RYZYKA.brak}
              </Text>
              <Text style={styles.banerPodsumowanie}>
                {podsumowanie.zielone} w porządku · {podsumowanie.ostrzezenia} do uwagi
                {podsumowanie.czerwone > 0 ? ` (w tym ${podsumowanie.czerwone} czerwone)` : ''}
              </Text>
            </View>

            {uporzadkowane.map((flaga, i) => {
              const p = paletaFlagi(flaga.kolor, kolory);
              const meta = meta_koloru(flaga.kolor);
              const obszar = ETYKIETA_TYPU[flaga.typ] ?? flaga.typ;
              return (
                <View key={`${flaga.typ}-${i}`} style={[styles.flagaCard, { borderLeftColor: p.akcent }]}>
                  <View style={styles.flagaNaglowek}>
                    {obszar ? <Text style={styles.flagaObszar}>{String(obszar).toUpperCase()}</Text> : null}
                    <View style={[styles.badge, { backgroundColor: p.tlo }]}>
                      <Text style={[styles.badgeText, { color: p.tekst }]}>{meta.etykieta}</Text>
                    </View>
                  </View>
                  {flaga.tytul ? <Text style={styles.flagaTytul}>{flaga.tytul}</Text> : null}
                  {flaga.opis ? <Text style={styles.flagaOpis}>{flaga.opis}</Text> : null}
                </View>
              );
            })}

            <Text style={styles.stopka}>
              Prześwietlenie jest automatyczne i ma charakter informacyjny — nie
              zastępuje analizy prawnej ani porady radcy.
            </Text>
          </>
        )
      ) : null}
    </Screen>
  );
}

const tworzStyleUmowy = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  poleTekst: { marginBottom: spacing.md },
  inputTekst: { minHeight: 140, textAlignVertical: 'top' },
  bladCard: {
    backgroundColor: k.ostrzezenieTlo,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: k.ostrzezenieTekst,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  bladText: { fontSize: 14, color: k.ostrzezenieTekst, lineHeight: 20 },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  banerRyzyka: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: k.surface,
    padding: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  banerTytul: { fontSize: 18, fontWeight: '800', lineHeight: 24 },
  banerPodsumowanie: { fontSize: 13, color: k.textMuted, marginTop: 6, fontWeight: '600' },
  flagaCard: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  flagaNaglowek: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  flagaObszar: { fontSize: 11, fontWeight: '800', color: k.textMuted, letterSpacing: 0.5, flexShrink: 1 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { fontSize: 11, fontWeight: '800' },
  flagaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginTop: spacing.sm, lineHeight: 20 },
  flagaOpis: { fontSize: 14, color: k.text, lineHeight: 20, marginTop: 4 },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
