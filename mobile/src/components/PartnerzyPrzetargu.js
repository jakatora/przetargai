import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate } from '../lib/format';
import { kwotaKrotko } from '../lib/ktoWygrywa';
import { czyMoznaOtworzycProfil } from '../lib/profilKonkurenta';
import { czyPokazacPartnerow, opisZakresu } from '../lib/partnerzy';

/**
 * „Kto może użyczyć doświadczenia” (2026-10-31, z analizy konkurencji: Tender Vision, przetargi.info).
 * Gdy brakuje Ci referencji, możesz polegać na doświadczeniu innej firmy (art. 118 Pzp) albo startować
 * w konsorcjum. Karta pokazuje firmy, które w ostatnim roku wygrywały zamówienia tej samej klasy CPV
 * (najpierw w województwie przetargu). Bez danych — karta się nie pokazuje.
 */
export default function PartnerzyPrzetargu({ tender }) {
  const styles = useStyle(tworzStylePartnerow);
  const { t } = useJezyk();
  const navigation = useNavigation();
  const [dane, setDane] = useState(null);
  const pokaz = czyPokazacPartnerow(tender);

  useEffect(() => {
    if (!pokaz) return undefined;
    let aktywny = true;
    api.partnerzyPrzetargu(tender.id).then((d) => { if (aktywny) setDane(d); }).catch(() => {});
    return () => { aktywny = false; };
  }, [pokaz, tender?.id]);

  if (!pokaz || !dane?.dostepne || !(dane.partnerzy?.length)) return null;

  return (
    <View style={styles.karta} accessibilityLabel={t('Kto może użyczyć doświadczenia', 'Who can lend experience')}>
      <Text style={styles.tytul}>{t('Kto może użyczyć doświadczenia', 'Who can lend experience')}</Text>
      <Text style={styles.podtytul}>{opisZakresu(dane.zakres, t)}</Text>
      <Text style={styles.opis}>
        {t(
          'Brakuje Ci referencji? Te firmy w ostatnim roku wygrywały podobne zamówienia. Możesz zaprosić je do konsorcjum, zlecić podwykonawstwo albo oprzeć się na ich doświadczeniu (art. 118 Pzp).',
          'Missing references? These companies won similar contracts in the last year. Invite them to a consortium, subcontract, or rely on their experience (Art. 118 of the Public Procurement Law).',
        )}
      </Text>
      <View style={styles.lista}>
        {dane.partnerzy.slice(0, 5).map((p) => (
          <Pressable
            key={p.nip ?? p.nazwa}
            style={styles.wiersz}
            accessibilityRole="button"
            disabled={!czyMoznaOtworzycProfil(p)}
            onPress={() => navigation.navigate('ProfilKonkurenta', { nip: p.nip ?? null, nazwa: p.nazwa })}
          >
            <Text style={styles.nazwa} numberOfLines={1}>{p.nazwa}</Text>
            <Text style={styles.opis}>
              {t(p.wygrane === 1 ? '1 wygrana' : `${p.wygrane} wygrane`, p.wygrane === 1 ? '1 win' : `${p.wygrane} wins`)}
              {kwotaKrotko(p.wartosc, t) ? ` · ${kwotaKrotko(p.wartosc, t)}` : ''}
              {p.ostatnio ? t(` · ostatnio ${formatDate(p.ostatnio)}`, ` · last ${formatDate(p.ostatnio)}`) : ''}
              {p.nip ? ` · NIP ${p.nip}` : ''}
            </Text>
            {czyMoznaOtworzycProfil(p) ? <Text style={styles.link}>{t('Co wygrywa →', 'What it wins →')}</Text> : null}
          </Pressable>
        ))}
      </View>
      <Text style={styles.zrodlo}>
        {t('Dane z ogłoszeń o wyniku w BZP i TED. Kontakt znajdziesz po NIP-ie w KRS lub CEIDG.', 'Data from award notices in BZP and TED. Find contact details by tax ID in KRS or CEIDG.')}
      </Text>
    </View>
  );
}

const tworzStylePartnerow = tworzStyle((k) => ({
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  tytul: { fontSize: 15, fontWeight: '800', color: k.text },
  podtytul: { fontSize: 12, color: k.textMuted, marginTop: 2 },
  lista: { marginTop: spacing.sm, gap: 8 },
  wiersz: { marginTop: 6 },
  nazwa: { fontSize: 14, fontWeight: '700', color: k.text },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 18, marginTop: 2 },
  zrodlo: { fontSize: 12, color: k.textMuted, marginTop: spacing.sm },
  link: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: 2 },
}));
