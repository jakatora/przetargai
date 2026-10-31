import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { czytajPlikBase64 } from '../lib/plikBase64';
import { sprawdzWyborPlikow, podsumowanieKontroli, opisPodpisu } from '../lib/kontrolaPlikow';

/**
 * Automatyczna kontrola plików oferty (2026-10-31, z analizy konkurencji: SEZAM). Wykonawca wybiera
 * gotowe pliki (PDF, Word, .xades), backend sprawdza bez AI: podpisy, niewypełnione miejsca, NIP-y
 * i kwoty brutto — i mówi wprost, czego NIE sprawdził. Pliki nie są nigdzie zapisywane.
 */
export default function KontrolaPlikowOferty({ tenderId = null }) {
  const styles = useStyle(tworzStyleKontroliPlikow);
  const { t } = useJezyk();
  const [stan, setStan] = useState('start'); // start | trwa | gotowe
  const [raport, setRaport] = useState(null);
  const [blad, setBlad] = useState(null);
  const [odrzucone, setOdrzucone] = useState([]);

  async function sprawdz() {
    setBlad(null);
    try {
      const wybor = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true, type: '*/*' });
      if (wybor.canceled || !wybor.assets?.length) return;
      const { pliki, odrzucone: odrz } = sprawdzWyborPlikow(wybor.assets);
      setOdrzucone(odrz);
      if (!pliki.length) { setBlad(t('Żaden z wybranych plików nie mieści się w limitach.', 'None of the selected files fits the limits.')); return; }
      setStan('trwa');
      const zakodowane = [];
      for (const p of pliki) zakodowane.push({ nazwa: p.name, base64: await czytajPlikBase64(p.uri) });
      const r = await api.kontrolaPlikowOferty({ tender_id: tenderId, pliki: zakodowane });
      setRaport(r);
      setStan('gotowe');
    } catch (err) {
      setBlad(err.message);
      setStan(raport ? 'gotowe' : 'start');
    }
  }

  const naglowek = raport ? podsumowanieKontroli(raport) : null;
  return (
    <View style={styles.karta}>
      <Text style={styles.tytul}>{t('Sprawdź pliki oferty automatycznie', 'Check your offer files automatically')}</Text>
      <Text style={styles.opis}>
        {t(
          'Wybierz gotowe pliki (PDF, Word, .xades). Sprawdzimy podpisy, niewypełnione miejsca, NIP-y i kwoty brutto, a potem powiemy, czego nie sprawdziliśmy. Plików nie zapisujemy.',
          'Pick the finished files (PDF, Word, .xades). We check signatures, empty fields, tax IDs and gross amounts, and tell you what we did not check. Files are not stored.',
        )}
      </Text>
      <Pressable style={styles.przycisk} onPress={sprawdz} disabled={stan === 'trwa'} accessibilityRole="button">
        {stan === 'trwa'
          ? <ActivityIndicator color={styles.przyciskTekst.color} />
          : <Text style={styles.przyciskTekst}>{raport ? t('Sprawdź inne pliki', 'Check other files') : t('Wybierz pliki oferty', 'Choose offer files')}</Text>}
      </Pressable>
      {blad ? <Text style={styles.blad}>{blad}</Text> : null}
      {odrzucone.map((o) => <Text key={o.nazwa} style={styles.drobne}>{t(`Pominięto ${o.nazwa}: ${o.powod}`, `Skipped ${o.nazwa}: ${o.powod}`)}</Text>)}

      {raport ? (
        <View style={styles.raport}>
          <Text style={[styles.naglowek, styles[`ton_${naglowek.ton}`]]}>{t(naglowek.pl, naglowek.en)}</Text>
          {raport.wyniki.map((w, i) => (
            <View key={`${w.kod}-${i}`} style={[styles.wynik, styles[`ramka_${w.poziom}`]]}>
              <Text style={[styles.wynikTytul, styles[`ton_${w.poziom}`]]}>{w.poziom === 'blad' ? '✗ ' : w.poziom === 'uwaga' ? '! ' : '✓ '}{w.tytul}</Text>
              <Text style={styles.drobne}>{w.szczegol}</Text>
              {w.pliki?.length ? <Text style={styles.pliki}>{w.pliki.join(' · ')}</Text> : null}
            </View>
          ))}
          <Text style={styles.sekcja}>{t('Pliki', 'Files')}</Text>
          {raport.pliki.map((p) => (
            <Text key={p.nazwa} style={styles.drobne}>{p.nazwa}{opisPodpisu(p.podpis, t) ? ` — ${opisPodpisu(p.podpis, t)}` : ''}</Text>
          ))}
          <Text style={styles.sekcja}>{t('Czego nie sprawdziliśmy', 'What we did not check')}</Text>
          {raport.nie_sprawdzone.map((n) => (
            <Text key={n.tytul} style={styles.drobne}><Text style={styles.pogrubione}>{n.tytul}: </Text>{n.powod}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const tworzStyleKontroliPlikow = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginBottom: spacing.lg },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4 },
  przycisk: { backgroundColor: k.blue, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.md },
  przyciskTekst: { color: k.naAkcencie, fontWeight: '800', fontSize: 14 },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.sm },
  raport: { marginTop: spacing.md },
  naglowek: { fontSize: 15, fontWeight: '800', marginBottom: spacing.sm },
  wynik: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginTop: spacing.sm },
  wynikTytul: { fontSize: 14, fontWeight: '700' },
  ramka_blad: { borderLeftColor: k.danger },
  ramka_uwaga: { borderLeftColor: k.ostrzezenieAkcent },
  ramka_ok: { borderLeftColor: k.sukcesAkcent },
  ton_blad: { color: k.danger },
  ton_uwaga: { color: k.ostrzezenieTekst },
  ton_ok: { color: k.sukcesAkcent },
  drobne: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: 2 },
  pliki: { fontSize: 12, color: k.textMuted, marginTop: 2, fontStyle: 'italic' },
  sekcja: { fontSize: 13, fontWeight: '700', color: k.text, marginTop: spacing.md },
  pogrubione: { fontWeight: '700', color: k.text },
}));
