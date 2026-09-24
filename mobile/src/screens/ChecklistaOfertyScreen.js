import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { KOSZYKI_CHECKLISTY, opisGotowosci, opisDniDoZlozenia } from '../lib/wygrywalnosc';

/*
 * „Co muszę mieć do dnia składania" (etap 6).
 *
 * Łączy trzy rzeczy, które do tej pory żyły osobno: wymagania postępowania
 * (Radar SWZ), stan Sejfu dokumentów i DZIEŃ SKŁADANIA z kalendarza.
 *
 * 🚨 Trzeci składnik jest tu najważniejszy. Zaświadczenie z ZUS ma 3 miesiące,
 * KRK pół roku — przy terminie za siedem tygodni „mam to" potrafi znaczyć
 * „będę musiał wystąpić o to jeszcze raz, a urząd ma na to 7 dni". Ekran, który
 * sprawdza ważność na DZIŚ, mówi firmie, że jest gotowa — i to jest gorsze niż
 * brak ekranu.
 *
 * Degradacja jest świadoma: Radar SWZ i Sejf mieszkają w osobnej usłudze, więc
 * gdy są nieosiągalne, checklista nadal się liczy, a `stanWiedzy` mówi wprost,
 * czego nie wiemy — zamiast pokazać zero braków.
 */

function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

export default function ChecklistaOfertyScreen({ route }) {
  const { tenderId, tytul, postepowanieId } = route.params ?? {};
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleChecklisty);
  const { t, jezyk } = useJezyk();

  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [ostrzezenia, setOstrzezenia] = useState([]);
  const [ladowanie, setLadowanie] = useState(true);

  const wczytaj = useCallback(async () => {
    setLadowanie(true);
    const problemy = [];

    // Sejf i Radar SWZ są w osobnej usłudze — ich awaria NIE może wywrócić
    // checklisty. Zbieramy, co się da, i mówimy, czego zabrakło.
    let dokumenty = [];
    try {
      const odp = await api.sejfDokumenty();
      dokumenty = odp?.dokumenty ?? odp ?? [];
    } catch {
      problemy.push(t('Nie udało się odczytać sejfu dokumentów.', 'Could not read the document safe.'));
    }

    let wymagania = [];
    if (postepowanieId) {
      try {
        const odp = await api.radarPostepowanie(postepowanieId);
        wymagania = odp?.checklista ?? odp?.wymagania ?? [];
      } catch {
        problemy.push(t('Nie udało się odczytać wymagań z Radaru SWZ.', 'Could not read requirements from the tender-document radar.'));
      }
    }

    try {
      setDane(await api.checklistaOferty(tenderId, { wymagania, dokumenty }));
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setOstrzezenia(problemy);
      setLadowanie(false);
    }
  }, [tenderId, postepowanieId, t]);

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
        <Text style={styles.tytul}>{t('Nie udało się zbudować checklisty', 'Could not build the checklist')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} style={styles.gap} />
      </Screen>
    );
  }

  const checklista = dane?.checklista;
  const gotowosc = opisGotowosci(checklista, jezyk);
  const tokenyGotowosci = tokenyTonu(gotowosc?.ton, kolory);
  const licznik = opisDniDoZlozenia(checklista, jezyk);
  const nastepny = checklista?.nastepnyKrok;

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{t('Co musisz mieć do dnia składania', 'What you need by submission day')}</Text>
      {tytul ? <Text style={styles.podtytul}>{tytul}</Text> : null}

      <View style={[styles.gotowosc, { backgroundColor: tokenyGotowosci.tlo }]}>
        <Text style={[styles.gotowoscTekst, { color: tokenyGotowosci.tekst }]}>{gotowosc?.tekst}</Text>
        {licznik ? <Text style={[styles.licznik, { color: tokenyGotowosci.tekst }]}>{licznik}</Text> : null}
      </View>

      {nastepny ? (
        <View style={styles.nastepny}>
          <Text style={styles.nastepnyEtykieta}>
            {nastepny.pilne ? t('Zrób to PILNIE', 'Do this URGENTLY') : t('Następny krok', 'Next step')}
          </Text>
          <Text style={styles.nastepnyTekst}>{nastepny.nazwa}</Text>
        </View>
      ) : null}

      {ostrzezenia.map((tekst) => (
        <Text key={tekst} style={styles.ostrzezenie}>{tekst}</Text>
      ))}

      {KOSZYKI_CHECKLISTY.map((koszyk) => {
        const pozycje = checklista?.koszyki?.[koszyk.kod] ?? [];
        if (!pozycje.length) return null;
        const tokeny = tokenyTonu(koszyk.ton, kolory);
        return (
          <View key={koszyk.kod} style={styles.sekcja}>
            <Text style={[styles.sekcjaTytul, { color: tokeny.tekst }]}>
              {koszyk.etykieta[jezyk] ?? koszyk.etykieta.pl} ({pozycje.length})
            </Text>
            <Text style={styles.sekcjaOpis}>{koszyk.opis[jezyk] ?? koszyk.opis.pl}</Text>
            {pozycje.map((pozycja) => (
              <View key={`${koszyk.kod}-${pozycja.kod ?? pozycja.nazwa}`} style={[styles.pozycja, { borderLeftColor: tokeny.tekst }]}>
                <Text style={styles.pozycjaNazwa}>
                  {pozycja.nazwa}
                  {pozycja.obowiazkowe ? '' : ` — ${t('nieobowiązkowe', 'optional')}`}
                </Text>
                {pozycja.waznyDo ? (
                  <Text style={styles.pozycjaMeta}>
                    {t('Ważne do', 'Valid until')}: {String(pozycja.waznyDo).slice(0, 10)}
                  </Text>
                ) : null}
                {Number.isFinite(pozycja.dniZapasu) && pozycja.dniZapasu < 0 ? (
                  <Text style={[styles.pozycjaMeta, { color: kolory.danger }]}>
                    {t('Zabraknie', 'Short by')} {Math.abs(pozycja.dniZapasu)} {t('dni', 'days')}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}

      {(checklista?.czynnosci ?? []).length ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Czynności, nie dokumenty', 'Actions, not documents')}</Text>
          {checklista.czynnosci.map((czynnosc) => (
            <View key={czynnosc.kod} style={styles.pozycja}>
              <Text style={styles.pozycjaNazwa}>{czynnosc.nazwa}</Text>
              <Text style={styles.pozycjaMeta}>{czynnosc.naKiedy}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Kalendarz trzech terminów: pytania do SWZ mają WCZEŚNIEJSZY termin niż składanie. */}
      {(dane?.kalendarz?.pozycje ?? []).length ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Terminy tego postępowania', 'Deadlines in this tender')}</Text>
          {dane.kalendarz.pozycje.map((pozycja) => (
            <View key={pozycja.kod} style={styles.pozycja}>
              <Text style={styles.pozycjaNazwa}>{t(pozycja.etykieta)}</Text>
              <Text style={styles.pozycjaMeta}>
                {pozycja.znany ? String(pozycja.at).slice(0, 10) : t(pozycja.brak ?? { pl: 'Nieznany', en: 'Unknown' })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Button title={t('Odśwież', 'Refresh')} variant="ghost" onPress={wczytaj} style={styles.gap} />
    </Screen>
  );
}

const tworzStyleChecklisty = tworzStyle((k) => ({
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 14, color: k.textMuted, marginBottom: spacing.sm },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  gotowosc: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, gap: 4 },
  gotowoscTekst: { fontSize: 15, fontWeight: '800' },
  licznik: { fontSize: 13, fontWeight: '600' },
  nastepny: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.ostrzezenieAkcent,
    backgroundColor: k.surface,
    gap: 2,
  },
  nastepnyEtykieta: { fontSize: 11, fontWeight: '800', color: k.ostrzezenieAkcent },
  nastepnyTekst: { fontSize: 15, fontWeight: '700', color: k.text },
  ostrzezenie: { fontSize: 12, color: k.ostrzezenieAkcent, marginTop: spacing.sm },
  sekcja: { marginTop: spacing.lg, gap: 4 },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text },
  sekcjaOpis: { fontSize: 12, color: k.textMuted },
  pozycja: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    borderLeftWidth: 4,
    borderLeftColor: k.border,
    backgroundColor: k.surface,
    gap: 2,
  },
  pozycjaNazwa: { fontSize: 14, fontWeight: '700', color: k.text },
  pozycjaMeta: { fontSize: 12, color: k.textMuted },
  gap: { marginTop: spacing.lg },
}));
