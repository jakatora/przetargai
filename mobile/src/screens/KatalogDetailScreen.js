import { View, Text } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import PodpisZrodla, { PrzyciskOryginalu, ZrodlaAlternatywne } from '../components/PodpisZrodla';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { formatDate, formatBudget } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { opisCpv } from '../lib/cpv';
import { opisWadium } from '../lib/wadium';
import { opisKryterium, opisCzesci } from '../lib/ogloszenieMeta';
import { pelnaNazwaZrodla } from '../lib/zrodlaDanych';

/*
 * Szczegóły ogłoszenia z trybu „Wszystkie" (P1-3).
 *
 * Osobny ekran od „Szczegółów przetargu", i to jest celowe: tamten operuje na
 * DOPASOWANIU użytkownika (zapisz, przypomnienie, wyjaśnienie AI, statystyki
 * wyników — wszystko zaadresowane identyfikatorem dopasowania). Ogłoszenie
 * z katalogu żadnego dopasowania nie ma, więc tamte akcje kończyłyby się błędem
 * 404 na ekranie, który wygląda na sprawny. Lepszy uczciwy, węższy ekran.
 */

function Wiersz({ etykieta, wartosc, styles, ostatni }) {
  if (!wartosc) return null;
  return (
    <View style={[styles.wiersz, ostatni && styles.wierszOstatni]}>
      <Text style={styles.wierszEtykieta}>{etykieta}</Text>
      <Text style={styles.wierszWartosc}>{wartosc}</Text>
    </View>
  );
}

export default function KatalogDetailScreen({ route, navigation }) {
  const styles = useStyle(tworzStyleSzczegolow);
  const { t } = useJezyk();
  const tender = route?.params?.tender;

  if (!tender) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Otwórz ten przetarg z listy', 'Open this tender from the list')}</Text>
      </Screen>
    );
  }

  const termin = opisTerminu(tender.deadline);
  const wadium = opisWadium(tender);
  const kryterium = opisKryterium(tender);
  const czesci = opisCzesci(tender);
  const cpv = opisCpv(tender.cpv);

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{tender.title}</Text>
      {tender.organization ? <Text style={styles.organizacja}>{tender.organization}</Text> : null}

      {/* Metryczka źródła — skąd to jest i jak świeże. */}
      <View style={styles.zrodloBox}>
        <Text style={styles.zrodloNazwa}>{t(pelnaNazwaZrodla(tender.zrodlo?.kod))}</Text>
        <PodpisZrodla zrodlo={tender.zrodlo} />
        <PrzyciskOryginalu tender={tender} />
      </View>

      <View style={styles.karta}>
        <Wiersz
          styles={styles}
          etykieta={t('Termin składania ofert', 'Submission deadline')}
          wartosc={`${formatDate(tender.deadline)} · ${termin.etykieta}`}
        />
        <Wiersz styles={styles} etykieta={t('Województwo', 'Voivodeship')} wartosc={tender.region_nazwa} />
        <Wiersz
          styles={styles}
          etykieta={t('Wartość zamówienia', 'Contract value')}
          wartosc={formatBudget(tender.budget, tender.currency) || t('nie podano w ogłoszeniu', 'not stated in the notice')}
        />
        <Wiersz styles={styles} etykieta={cpv.etykieta} wartosc={cpv.wartosc} />
        <Wiersz
          styles={styles}
          etykieta={t('Wadium', 'Bid bond')}
          wartosc={wadium?.wartosc}
        />
        <Wiersz styles={styles} etykieta={t('Kryterium oceny', 'Award criterion')} wartosc={kryterium?.wartosc} />
        <Wiersz styles={styles} etykieta={t('Części zamówienia', 'Lots')} wartosc={czesci?.wartosc} />
        <Wiersz styles={styles} etykieta={t('Numer sprawy', 'Reference number')} wartosc={tender.numer} />
        <Wiersz
          styles={styles}
          etykieta={t('Opublikowano', 'Published')}
          wartosc={tender.published_at ? formatDate(tender.published_at) : null}
          ostatni
        />
      </View>

      <ZrodlaAlternatywne zrodla={tender.zrodla_alternatywne} />

      {/*
        Uczciwie: to ogłoszenie NIE jest dopasowaniem, więc nie ma tu wyniku
        procentowego ani zakładek. Zamiast udawać, że są, pokazujemy drogę do
        tego, żeby takie ogłoszenia trafiały do feedu same.
      */}
      <View style={styles.notka}>
        <Text style={styles.notkaTekst}>
          {t(
            'To ogłoszenie pochodzi z pełnego rynku, a nie z Twoich dopasowań — dlatego nie ma tu wyniku dopasowania ani zakładki. Dopisz do profilu słowa i kody CPV z tej branży, a podobne ogłoszenia zaczną przychodzić same.',
            'This notice comes from the full market, not from your matches — hence no match score and no bookmark here. Add this trade’s keywords and CPV codes to your profile and similar notices will start arriving on their own.',
          )}
        </Text>
        <Button
          title={t('Uzupełnij profil', 'Update profile')}
          variant="ghost"
          onPress={() => navigation.navigate('Account')}
          style={styles.notkaPrzycisk}
        />
      </View>
    </Screen>
  );
}

const tworzStyleSzczegolow = tworzStyle((k) => ({
  tytul: { fontSize: 20, fontWeight: '800', color: k.text, lineHeight: 27 },
  organizacja: { fontSize: 14, color: k.textMuted, marginTop: spacing.xs },
  zrodloBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
  },
  zrodloNazwa: { fontSize: 14, fontWeight: '800', color: k.text },
  karta: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    backgroundColor: k.surface,
    paddingHorizontal: spacing.md,
  },
  wiersz: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  wierszOstatni: { borderBottomWidth: 0 },
  wierszEtykieta: { fontSize: 12, color: k.textMuted, fontWeight: '700' },
  wierszWartosc: { fontSize: 15, color: k.text, marginTop: 2, lineHeight: 21 },
  notka: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: k.wyroznienie,
  },
  notkaTekst: { fontSize: 13, color: k.text, lineHeight: 19 },
  notkaPrzycisk: { marginTop: spacing.sm },
}));
