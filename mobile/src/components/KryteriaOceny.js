import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { kartaKryteriow, pytaniaOKryteria } from '../lib/kryteriaOceny';
import { czyMoznaPytacPrzetargu } from '../lib/zapytajSwz';

/**
 * „Za co są punkty” (2026-10-31, z analizy konkurencji). Kryteria oceny z wagami prosto
 * z ogłoszenia BZP, przy każdym kryterium wskazówka, co zadeklarować, i ile wart jest punkt
 * w cenie. `onPytania` oddaje ekranowi gotowe pytania do „Zapytaj SWZ” o punktowanie
 * kryteriów pozacenowych. Bez listy (inne rejestry, starsze ogłoszenia) karta się nie pokazuje.
 */
export default function KryteriaOceny({ tender, onPytania = null }) {
  const styles = useStyle(tworzStyleKryteriow);
  const { t } = useJezyk();
  const navigation = useNavigation();
  const [dane, setDane] = useState(null);

  useEffect(() => {
    if (!tender?.id) return undefined;
    let aktywny = true;
    api.kryteriaPrzetargu(tender.id)
      .then((d) => {
        if (!aktywny) return;
        setDane(d);
        onPytania?.(pytaniaOKryteria(d));
      })
      .catch(() => {});
    return () => { aktywny = false; };
  }, [tender?.id]);

  const karta = kartaKryteriow(dane);
  if (!karta) return null;

  return (
    <View style={styles.karta} accessibilityLabel={t('Za co są punkty', 'What scores points')}>
      <Text style={styles.tytul}>{t('Za co są punkty', 'What scores points')}</Text>
      <Text style={styles.podtytul}>
        {karta.tylkoCena
          ? t('Liczy się tylko cena — wygrywa najtańsza ważna oferta.', 'Only price counts — the cheapest valid offer wins.')
          : t('Kryteria i wagi z ogłoszenia. Pod każdym: co zadeklarować w ofercie.', 'Criteria and weights from the notice. Under each: what to declare.')}
      </Text>
      {karta.wiersze.map((w, i) => (
        <View key={`${w.nazwa}-${i}`} style={styles.wiersz}>
          <View style={styles.naglowekWiersza}>
            <Text style={styles.nazwa}>{w.nazwa}</Text>
            {w.udzial ? <Text style={styles.udzial}>{w.udzial}</Text> : null}
          </View>
          {w.rodzaj !== 'inne' && w.etykieta.pl.toLowerCase() !== w.nazwa.toLowerCase()
            ? <Text style={styles.etykieta}>{t(w.etykieta.pl, w.etykieta.en)}</Text>
            : null}
          {!karta.tylkoCena ? <Text style={styles.wskazowka}>{t(w.wskazowka.pl, w.wskazowka.en)}</Text> : null}
          {w.rodzaj === 'doswiadczenie' ? (
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('BankOsob')} hitSlop={8}>
              <Text style={styles.link}>{t('Wykaz osób z Banku osób →', 'Staff list from the staff bank →')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {karta.procentZaPunkt ? (
        <Text style={styles.cenaPunktu}>
          {t(
            `Przy cenie ${String(karta.udzialCeny).replace('.', ',')}% każdy punkt przewagi w pozostałych kryteriach jest wart ok. ${String(karta.procentZaPunkt).replace('.', ',')}% ceny — o tyle możesz być drożej od najtańszej oferty (przy typowym wzorze: najniższa cena / Twoja cena).`,
            `With price at ${karta.udzialCeny}%, each point of advantage in other criteria is worth about ${karta.procentZaPunkt}% of the price — that much more expensive you can be than the cheapest offer (with the usual lowest price / your price formula).`,
          )}
        </Text>
      ) : null}
      {karta.rozneWCzesciach ? (
        <Text style={styles.uwaga}>
          {t('W innych częściach zamówienia kryteria albo wagi są inne — sprawdź w SWZ część, w której startujesz.', 'Other lots have different criteria or weights — check the lot you bid for in the documents.')}
        </Text>
      ) : null}
      {!karta.tylkoCena ? (
        <Text style={styles.zrodlo}>
          {czyMoznaPytacPrzetargu(tender)
            ? t('Maksimum punktów i sposób liczenia są w SWZ. Zapytaj o nie niżej w „Zapytaj SWZ”.', 'The maximum points and scoring method are in the documents. Ask below in "Ask the tender documents".')
            : t('Maksimum punktów i sposób liczenia są w SWZ.', 'The maximum points and scoring method are in the documents.')}
        </Text>
      ) : null}
    </View>
  );
}

const tworzStyleKryteriow = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4 },
  wiersz: { borderTopWidth: 1, borderTopColor: k.border, marginTop: spacing.sm, paddingTop: spacing.sm },
  naglowekWiersza: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  nazwa: { flex: 1, fontSize: 14, fontWeight: '700', color: k.text, lineHeight: 19 },
  udzial: { fontSize: 14, fontWeight: '800', color: k.blue },
  etykieta: { fontSize: 12, color: k.textMuted, marginTop: 2 },
  wskazowka: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: 4 },
  cenaPunktu: { fontSize: 13, color: k.text, lineHeight: 19, marginTop: spacing.md, fontWeight: '600' },
  uwaga: { fontSize: 13, color: k.ostrzezenieTekst, lineHeight: 19, marginTop: spacing.sm },
  zrodlo: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.sm },
  link: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: 4 },
}));
