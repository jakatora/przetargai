import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import {
  tonCzynnika, opisWerdyktu, metryczkaProbki, uporzadkujCzynniki, policzTony,
} from '../lib/wygrywalnosc';

/*
 * „Czy warto startować?" (etap 6).
 *
 * Ekran istnieje po to, żeby firma ODPUŚCIŁA przetarg, w którym nie ma szans,
 * ZANIM włoży w niego tydzień — i żeby weszła w ten, w którym szanse ma.
 *
 * 🚨 Czego ten ekran nie pokaże, choćby ktoś bardzo chciał: procentu szans
 * wygranej. Backend takiej liczby nie oddaje (rozstrzygnięcia mówią, co działo
 * się na rynku, a nie jak wypadnie TA oferta), a ekran jej sobie nie policzy.
 * Zamiast tego: czynniki z liczbami, jawna wielkość próbki i zastrzeżenie,
 * które zawsze idzie razem z werdyktem.
 */

function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

function Czynnik({ czynnik, styles, kolory, t }) {
  const tokeny = tokenyTonu(tonCzynnika(czynnik.ton), kolory);
  return (
    <View style={[styles.czynnik, { borderLeftColor: tokeny.tekst }]}>
      <Text style={[styles.czynnikNaglowek, { color: tokeny.tekst }]}>{czynnik.naglowek}</Text>
      <Text style={styles.czynnikOpis}>{czynnik.szczegol}</Text>
      {czynnik.probka ? (
        <Text style={styles.czynnikProbka}>
          {t('z', 'from')} {czynnik.probka} {t('rozstrzygnięć', 'settled parts')}
        </Text>
      ) : null}
    </View>
  );
}

export default function CzyWartoScreen({ route, navigation }) {
  const { tenderId, matchId, tytul } = route.params ?? {};
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const { t, jezyk } = useJezyk();

  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);

  const wczytaj = useCallback(async () => {
    setLadowanie(true);
    try {
      // Feed dopasowań i katalog prowadzą do TEJ SAMEJ karty, tylko innym wejściem:
      // dopasowanie zna swój identyfikator, katalog zna identyfikator przetargu.
      const odpowiedz = matchId
        ? await api.czyWartoDlaDopasowania(matchId)
        : await api.czyWartoStartowac(tenderId);
      setDane(odpowiedz);
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
    }
  }, [matchId, tenderId]);

  useEffect(() => { wczytaj(); }, [wczytaj]);

  if (ladowanie && !dane) {
    return (
      <Screen>
        <View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View>
      </Screen>
    );
  }

  if (blad && !dane) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Nie udało się policzyć', 'Could not compute')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} style={styles.gap} />
      </Screen>
    );
  }

  // Postępowanie już rozstrzygnięte — nie ma czego rozważać, więc pokazujemy WYNIK.
  if (dane?.stan === 'rozstrzygniete') {
    const czesci = dane.rozstrzygniecie?.czesci ?? [];
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('To postępowanie jest już rozstrzygnięte', 'This tender is already settled')}</Text>
        {tytul ? <Text style={styles.podtytul}>{tytul}</Text> : null}
        <Text style={styles.akapit}>
          {t('Oferty nie da się już złożyć. Poniżej to, co wiemy o rozstrzygnięciu.',
            'A bid can no longer be submitted. Below is what we know about the outcome.')}
        </Text>
        {czesci.map((czesc) => (
          <View key={czesc.numer} style={styles.karta}>
            <Text style={styles.czescNaglowek}>
              {t('Część', 'Part')} {czesc.numer}
              {czesc.uniewaznione ? ` — ${t('unieważniona', 'cancelled')}` : ''}
            </Text>
            {czesc.zwyciezca?.nazwa ? (
              <Text style={styles.czynnikOpis}>{t('Wygrał', 'Winner')}: {czesc.zwyciezca.nazwa}</Text>
            ) : null}
            {Number.isFinite(czesc.cenaWybrana) ? (
              <Text style={styles.czynnikOpis}>
                {t('Cena', 'Price')}: {Math.round(czesc.cenaWybrana).toLocaleString('pl-PL')} zł
              </Text>
            ) : null}
            {Number.isFinite(czesc.liczbaOfert) ? (
              <Text style={styles.czynnikProbka}>{t('Ofert', 'Bids')}: {czesc.liczbaOfert}</Text>
            ) : null}
          </View>
        ))}
      </Screen>
    );
  }

  const karta = dane?.karta;
  const werdykt = opisWerdyktu(karta?.werdykt, jezyk);
  const tokeny = tokenyTonu(werdykt.ton, kolory);
  const metryczka = metryczkaProbki(karta, jezyk);
  const tony = policzTony(karta?.czynniki);

  return (
    <Screen scroll>
      {tytul ? <Text style={styles.podtytul}>{tytul}</Text> : null}

      <View style={[styles.werdykt, { backgroundColor: tokeny.tlo }]}>
        <Text style={[styles.werdyktTekst, { color: tokeny.tekst }]}>{werdykt.etykieta}</Text>
        <Text style={[styles.werdyktOpis, { color: tokeny.tekst }]}>{karta?.naglowek}</Text>
      </View>

      {/* Pasek tonów — jedno spojrzenie mówi, ilu rzeczy trzeba się przyjrzeć. */}
      <Text style={styles.pasek}>
        {tony.czerwony} {t('do sprawdzenia', 'to check')} · {tony.zolty} {t('z zastrzeżeniem', 'with caveats')}
        {' · '}{tony.zielony} {t('na plus', 'in your favour')}
        {tony.nieznany ? ` · ${tony.nieznany} ${t('bez danych', 'unknown')}` : ''}
      </Text>

      {metryczka ? (
        <View style={styles.metryczka}>
          <Text style={styles.metryczkaTekst}>{metryczka.tekst}</Text>
          {metryczka.zakres ? (
            <Text style={styles.metryczkaMeta}>{t('Zakres dat', 'Date range')}: {metryczka.zakres}</Text>
          ) : null}
          {metryczka.rejestry ? (
            <Text style={styles.metryczkaMeta}>{t('Rejestry', 'Registers')}: {metryczka.rejestry}</Text>
          ) : null}
        </View>
      ) : null}

      {uporzadkujCzynniki(karta?.czynniki).map((czynnik) => (
        <Czynnik key={czynnik.kod} czynnik={czynnik} styles={styles} kolory={kolory} t={t} />
      ))}

      {/*
        Zastrzeżenie NIE jest drobnym drukiem do pominięcia: bez niego czynniki
        czyta się jak prognozę wyniku TEJ oferty, czym nie są.
      */}
      <View style={styles.zastrzezenie}>
        <Text style={styles.zastrzezenieTekst}>{karta?.zastrzezenie}</Text>
      </View>

      {tenderId ? (
        <Button
          title={t('Co muszę mieć do dnia składania', 'What I need by submission day')}
          onPress={() => navigation.navigate('ChecklistaOferty', { tenderId, tytul })}
          style={styles.gap}
        />
      ) : null}
      <Button title={t('Odśwież', 'Refresh')} variant="ghost" onPress={wczytaj} style={styles.gapMaly} />
    </Screen>
  );
}

const tworzStyleKarty = tworzStyle((k) => ({
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 14, color: k.textMuted, marginBottom: spacing.sm },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  werdykt: { padding: spacing.md, borderRadius: radius.lg, gap: 4 },
  werdyktTekst: { fontSize: 18, fontWeight: '800' },
  werdyktOpis: { fontSize: 14, fontWeight: '600' },
  pasek: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm },
  metryczka: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: k.neutralneTlo,
    gap: 2,
  },
  metryczkaTekst: { fontSize: 13, fontWeight: '700', color: k.text },
  metryczkaMeta: { fontSize: 11, color: k.textMuted },
  czynnik: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    borderLeftWidth: 4,
    backgroundColor: k.surface,
    gap: 4,
  },
  czynnikNaglowek: { fontSize: 15, fontWeight: '800' },
  czynnikOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19 },
  czynnikProbka: { fontSize: 11, color: k.textMuted },
  karta: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    gap: 4,
  },
  czescNaglowek: { fontSize: 15, fontWeight: '800', color: k.text },
  zastrzezenie: {
    marginTop: spacing.lg,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: k.neutralneTlo,
  },
  zastrzezenieTekst: { fontSize: 12, color: k.textMuted, lineHeight: 18 },
  gap: { marginTop: spacing.lg },
  gapMaly: { marginTop: spacing.sm },
}));
