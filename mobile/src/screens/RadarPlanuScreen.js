import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Linking, Alert } from 'react-native';
import { api } from '../api/client';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import {
  etykietaTerminu, opisPoziomu, tonPoziomu, opisKamienia, opisOgloszenia, formatujWartoscPlanu,
} from '../lib/radarPlanow';

/*
 * Szczegół pozycji planu (Radar planów, P2-4): co zrobić i KIEDY, żeby w dniu
 * ogłoszenia być gotowym — oraz czy przetarg już się ukazał.
 *
 * Plan przygotowań i dopasowanie ogłoszenia liczy backend (bez AI). Treść
 * kamieni milowych i dokumentów pochodzi z polskiego modułu Pzp — jak narzędzia
 * w hubie, nie tłumaczymy jej, bo dotyczy polskich dokumentów.
 */

function tokenyTonu(ton, k) {
  if (ton === 'danger') return { tlo: k.dangerTlo, tekst: k.danger };
  if (ton === 'ostrzezenie') return { tlo: k.ostrzezenieTlo, tekst: k.ostrzezenieTekst };
  if (ton === 'sukces') return { tlo: k.sukcesTlo, tekst: k.sukcesAkcent };
  return { tlo: k.neutralneTlo, tekst: k.textMuted };
}

async function otworzLink(adres, t) {
  try {
    if (adres && await Linking.canOpenURL(adres)) await Linking.openURL(adres);
    else Alert.alert(t('Nie można otworzyć linku', 'Cannot open link'), adres ?? '');
  } catch {
    Alert.alert(t('Nie można otworzyć linku', 'Cannot open link'), adres ?? '');
  }
}

export default function RadarPlanuScreen({ route, navigation }) {
  const { id, tytul } = route.params ?? {};
  const { kolory } = useTheme();
  const styles = useStyle(tworzStylePlanu);
  const { t, jezyk } = useJezyk();

  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [ladowanie, setLadowanie] = useState(true);

  const wczytaj = useCallback(async () => {
    setLadowanie(true);
    try {
      setDane(await api.radarPlanu(id));
      setBlad(null);
    } catch (err) {
      setBlad(err.message);
    } finally {
      setLadowanie(false);
    }
  }, [id]);

  useEffect(() => { wczytaj(); }, [wczytaj]);

  if (ladowanie && !dane) {
    return <Screen><View style={styles.srodek}><ActivityIndicator size="large" color={kolory.blue} /></View></Screen>;
  }

  if (blad && !dane) {
    return (
      <Screen scroll>
        {tytul ? <Text style={styles.podtytul}>{tytul}</Text> : null}
        <Text style={styles.naglowek}>{t('Nie udało się wczytać planu', 'Could not load the plan')}</Text>
        <Text style={styles.akapit}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={wczytaj} style={styles.gap} />
      </Screen>
    );
  }

  const { pozycja, dopasowanie, przygotowania, ogloszenie, ostrzezenia = [] } = dane ?? {};
  const termin = etykietaTerminu(pozycja, jezyk);
  const tonTerminu = tokenyTonu(termin.ton, kolory);
  const opisOgl = opisOgloszenia(ogloszenie, jezyk);
  const tonOgl = opisOgl ? tokenyTonu(opisOgl.ton, kolory) : null;
  const poziom = opisPoziomu(dopasowanie?.poziom, jezyk);
  const tonDopasowania = tokenyTonu(tonPoziomu(dopasowanie?.poziom), kolory);

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{pozycja?.przedmiot}</Text>
      {pozycja?.zamawiajacy ? (
        <Text style={styles.podtytul}>
          {pozycja.zamawiajacy}{pozycja.region_nazwa ? ` · ${pozycja.region_nazwa}` : ''}
        </Text>
      ) : null}

      {/* Najważniejsze na górze: czy przetarg już jest. */}
      {opisOgl ? (
        <View style={[styles.blok, { backgroundColor: tonOgl.tlo }]}>
          <Text style={[styles.blokNaglowek, { color: tonOgl.tekst }]}>{opisOgl.naglowek}</Text>
          {ogloszenie.tytul ? <Text style={[styles.blokTekst, { color: tonOgl.tekst }]}>{ogloszenie.tytul}</Text> : null}
          <Text style={[styles.blokMeta, { color: tonOgl.tekst }]}>{opisOgl.pewnosc}</Text>
          <Button
            title={t('Otwórz ogłoszenie', 'Open the tender')}
            onPress={() => navigation.navigate('KatalogDetail', { tender: { id: ogloszenie.tender_id, title: ogloszenie.tytul } })}
            style={styles.gapMaly}
          />
        </View>
      ) : null}

      <View style={[styles.blok, { backgroundColor: tonTerminu.tlo }]}>
        <Text style={[styles.blokNaglowek, { color: tonTerminu.tekst }]}>{termin.tekst}</Text>
        <Text style={[styles.blokMeta, { color: tonTerminu.tekst }]}>
          {formatujWartoscPlanu(pozycja?.wartosc, pozycja?.waluta, jezyk)}
        </Text>
      </View>

      {ostrzezenia.map((o) => (
        <View key={o.kod} style={[styles.uwaga, { borderLeftColor: o.kod === 'skrocony_termin' ? kolory.ostrzezenieTekst : kolory.border }]}>
          <Text style={styles.uwagaTekst}>{t(o.pl, o.en)}</Text>
        </View>
      ))}

      {poziom ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Dlaczego pasuje', 'Why it matches')}</Text>
          <View style={[styles.plakietka, { backgroundColor: tonDopasowania.tlo }]}>
            <Text style={[styles.plakietkaTekst, { color: tonDopasowania.tekst }]}>{poziom}</Text>
          </View>
          {(dopasowanie?.powody ?? []).map((p) => <Text key={p} style={styles.punkt}>• {p}</Text>)}
        </View>
      ) : null}

      {przygotowania ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Plan przygotowań', 'Preparation plan')}</Text>
          <Text style={styles.akapit}>{przygotowania.komunikat}</Text>
          {(przygotowania.kamienieMilowe ?? []).map((k) => {
            const opis = opisKamienia(k, jezyk);
            const ton = tokenyTonu(opis.ton, kolory);
            return (
              <View key={k.klucz} style={[styles.kamien, { borderLeftColor: ton.tekst }]}>
                <Text style={styles.kamienTytul}>{opis.tytul}</Text>
                <Text style={[styles.kamienKiedy, { color: ton.tekst }]}>{opis.kiedy}</Text>
              </View>
            );
          })}
          {przygotowania.konsorcjum?.potrzebnyPartner ? (
            <View style={[styles.uwaga, { borderLeftColor: kolory.ostrzezenieTekst }]}>
              {przygotowania.konsorcjum.powody.map((p) => <Text key={p} style={styles.uwagaTekst}>{p}</Text>)}
            </View>
          ) : null}
        </View>
      ) : null}

      {przygotowania?.doKompletowania?.length ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Dokumenty do skompletowania', 'Documents to gather')}</Text>
          {przygotowania.doKompletowania.map((d) => (
            <View key={d.klucz} style={styles.dokument}>
              <Text style={styles.kamienTytul}>{d.nazwa}</Text>
              <Text style={styles.blokMeta}>{d.powod}</Text>
            </View>
          ))}
          <Button
            title={t('Sprawdź w Sejfie dokumentów', 'Check the document safe')}
            variant="ghost"
            onPress={() => navigation.navigate('Sejf')}
            style={styles.gapMaly}
          />
        </View>
      ) : null}

      {pozycja?.opis ? (
        <View style={styles.sekcja}>
          <Text style={styles.sekcjaTytul}>{t('Opis z planu', 'Plan description')}</Text>
          <Text style={styles.akapit}>{pozycja.opis}</Text>
        </View>
      ) : null}

      <Button
        title={t('Otwórz w TED', 'Open in TED')}
        variant="ghost"
        onPress={() => otworzLink(pozycja?.url, t)}
        style={styles.gap}
      />
    </Screen>
  );
}

const tworzStylePlanu = tworzStyle((k) => ({
  srodek: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tytul: { fontSize: 20, fontWeight: '800', color: k.text },
  naglowek: { fontSize: 18, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 14, color: k.textMuted, marginTop: 4, marginBottom: spacing.md },
  akapit: { fontSize: 14, color: k.textMuted, lineHeight: 20, marginTop: spacing.xs },
  blok: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.sm, gap: 4 },
  blokNaglowek: { fontSize: 16, fontWeight: '800' },
  blokTekst: { fontSize: 14, fontWeight: '600' },
  blokMeta: { fontSize: 13 },
  uwaga: { borderLeftWidth: 3, paddingLeft: spacing.sm, paddingVertical: 4, marginBottom: spacing.sm },
  uwagaTekst: { fontSize: 13, color: k.text, lineHeight: 19 },
  sekcja: { marginTop: spacing.md },
  sekcjaTytul: { fontSize: 13, fontWeight: '800', color: k.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  plakietka: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, marginBottom: spacing.xs },
  plakietkaTekst: { fontSize: 12, fontWeight: '800' },
  punkt: { fontSize: 14, color: k.text, lineHeight: 20 },
  kamien: {
    borderLeftWidth: 3, paddingLeft: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.sm,
    backgroundColor: k.surface, borderRadius: radius.sm,
  },
  kamienTytul: { fontSize: 14, fontWeight: '700', color: k.text },
  kamienKiedy: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  dokument: {
    backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border,
    padding: spacing.sm, marginBottom: spacing.xs, gap: 2,
  },
  gap: { marginTop: spacing.lg },
  gapMaly: { marginTop: spacing.sm },
}));
