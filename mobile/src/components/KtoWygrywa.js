import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { kwotaKrotko, czyPokazacKtoWygrywa } from '../lib/ktoWygrywa';
import { czyMoznaOtworzycProfil } from '../lib/profilKonkurenta';

/**
 * „Kto wygrywa u tego zamawiającego” (2026-10-31, z analizy konkurencji: Pressinfo, eGospodarka).
 * Ładuje się sam przy otwarciu przetargu z BZP/TED — wykonawca widzi, z kim realnie startuje
 * (najczęstsi zwycięzcy tego zamawiającego, ile wygrali i za ile) i jak kończyły się ostatnie
 * postępowania, zanim włoży tydzień w ofertę. Dane: ogłoszenia o wyniku w BZP i TED, po NIP-ie
 * zamawiającego. Brak danych albo NIP-u → komponent się nie pokazuje (nie zaśmieca ekranu).
 */
export default function KtoWygrywa({ tender }) {
  const styles = useStyle(tworzStyleKtoWygrywa);
  const { t } = useJezyk();
  const navigation = useNavigation();
  const [dane, setDane] = useState(null);
  const pokaz = czyPokazacKtoWygrywa(tender);

  useEffect(() => {
    if (!pokaz) return undefined;
    let aktywny = true;
    api.ktoWygrywa(tender.id).then((d) => { if (aktywny) setDane(d); }).catch(() => {});
    return () => { aktywny = false; };
  }, [pokaz, tender?.id]);

  if (!pokaz || !dane?.dostepne || !(dane.ostatnie?.length)) return null;

  const { probka, zwyciezcy = [], ostatnie = [], wystarczajaca } = dane;
  return (
    <View style={styles.karta} accessibilityLabel={t('Kto wygrywa u tego zamawiającego', 'Who wins with this buyer')}>
      <Text style={styles.tytul}>{t('Kto wygrywa u tego zamawiającego', 'Who wins with this buyer')}</Text>
      <Text style={styles.podtytul}>
        {t(`Z ${probka.ogloszenia} rozstrzygnięć${probka.od ? ` od ${formatDate(probka.od)}` : ''}`, `From ${probka.ogloszenia} awarded procedures${probka.od ? ` since ${formatDate(probka.od)}` : ''}`)}
      </Text>

      {wystarczajaca ? (
        <View style={styles.lista}>
          {zwyciezcy.slice(0, 3).map((z) => (
            <Pressable
              key={z.nip ?? z.nazwa}
              style={styles.wiersz}
              accessibilityRole="button"
              disabled={!czyMoznaOtworzycProfil(z)}
              onPress={() => navigation.navigate('ProfilKonkurenta', { nip: z.nip ?? null, nazwa: z.nazwa })}
            >
              <Text style={styles.nazwa} numberOfLines={1}>{z.nazwa}</Text>
              <Text style={styles.opis}>
                {t(z.wygrane === 1 ? '1 wygrana' : `${z.wygrane} wygrane`, z.wygrane === 1 ? '1 win' : `${z.wygrane} wins`)}
                {kwotaKrotko(z.wartosc, t) ? ` · ${kwotaKrotko(z.wartosc, t)}` : ''}
                {z.maly === true ? t(' · mała firma', ' · small company') : ''}
              </Text>
              {czyMoznaOtworzycProfil(z) ? <Text style={styles.link}>{t('Co jeszcze wygrywa →', 'What else it wins →')}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.opis}>{t('Za mało rozstrzygnięć, żeby wskazać stałych zwycięzców.', 'Not enough results to name regular winners.')}</Text>
      )}

      <Text style={styles.sekcja}>{t('Ostatnie rozstrzygnięcia', 'Latest results')}</Text>
      {ostatnie.slice(0, 3).map((o, i) => (
        <View key={`${o.tytul}-${i}`} style={styles.wiersz}>
          <Text style={styles.nazwa} numberOfLines={1}>{o.tytul ?? t('Postępowanie', 'Procedure')}</Text>
          <Text style={styles.opis} numberOfLines={2}>
            {o.opublikowano ? `${formatDate(o.opublikowano)} · ` : ''}
            {o.uniewaznione
              ? t('unieważnione', 'cancelled')
              : [o.zwyciezca, kwotaKrotko(o.cena, t), Number.isFinite(o.liczba_ofert) ? t(`${o.liczba_ofert} ofert`, `${o.liczba_ofert} bids`) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ))}
      <Text style={styles.zrodlo}>{t('Dane z ogłoszeń o wyniku w BZP i TED.', 'Data from award notices in BZP and TED.')}</Text>
    </View>
  );
}

const tworzStyleKtoWygrywa = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 12, color: k.textMuted, marginTop: 2 },
  lista: { marginTop: spacing.sm, gap: 8 },
  wiersz: { marginTop: 6 },
  nazwa: { fontSize: 14, fontWeight: '700', color: k.text },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: 2 },
  sekcja: { fontSize: 13, fontWeight: '700', color: k.textMuted, marginTop: spacing.md },
  zrodlo: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm },
  link: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: 2 },
}));
