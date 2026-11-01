import { memo } from 'react';
import { Pressable, View, Text } from 'react-native';
import { radius, spacing, typografia } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useSaved } from '../context/SavedContext';
import { useJezyk } from '../context/JezykContext';
import { formatDate } from '../lib/format';
import { opisTerminu } from '../lib/termin';
import { opisWadium } from '../lib/wadium';
import { znacznikKryteriow } from '../lib/kryteriaOceny';
import { znacznikZmian, znacznikOtwarcia } from '../lib/zmianyDokumentow';
import PodpisZrodla from './PodpisZrodla';
import { ZnacznikiWyjasnienia } from './Wyjasnienie';

/** Przycisk zakładki — ★ zapisany (brand), ☆ do zapisania. Nie nawiguje. */
export function SaveStar({ tenderId, styles, kolory }) {
  const { isSaved, toggle } = useSaved();
  const { t } = useJezyk();
  const zapisany = isSaved(tenderId);
  return (
    <Pressable
      onPress={() => { toggle(tenderId).catch(() => {}); }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityState={{ selected: zapisany }}
      accessibilityLabel={zapisany ? t('Usuń z zapisanych', 'Remove from saved') : t('Zapisz przetarg', 'Save tender')}
      style={styles.gwiazdka}
    >
      <Text style={[styles.gwiazdkaZnak, { color: zapisany ? kolory.blue : kolory.textMuted }]}>
        {zapisany ? '★' : '☆'}
      </Text>
    </Pressable>
  );
}

/**
 * Znacznik wyniku dopasowania (0–100): tonowane tło + liczba w kolorze progu.
 * Spokojniejszy niż pełny kolor, a próg czytelny także bez koloru (liczba + podpis).
 */
export function ScoreBadge({ score, size = 'md' }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const { t } = useJezyk();
  const [tlo, kolor] = score >= 80
    ? [kolory.sukcesTlo, kolory.sukcesAkcent]
    : score >= 60 ? [kolory.wyroznienie, kolory.blue] : [kolory.neutralneTlo, kolory.textMuted];
  const big = size === 'lg';
  return (
    <View
      style={[
        styles.score,
        { backgroundColor: tlo, width: big ? 68 : 54, height: big ? 68 : 54 },
      ]}
    >
      <Text style={[styles.scoreNum, big && styles.scoreNumBig, { color: kolor }]}>{score}</Text>
      <Text style={[styles.scorePct, { color: kolor }]}>{t('% dopas.', '% match')}</Text>
    </View>
  );
}

/**
 * Karta dopasowanego przetargu na liście. `nowe` = dodany po ostatniej wizycie.
 * `onOtworz(match)` zamiast `onPress` — rodzic podaje JEDNĄ stabilną funkcję, więc
 * `memo` naprawdę pomija karty, których dane się nie zmieniły (wpisywanie w
 * wyszukiwarkę, zmiana filtra, gwiazdka jednego przetargu nie renderują całej listy).
 */
function MatchCard({ match, onOtworz, nowe = false }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleKarty);
  const { t } = useJezyk();
  const tender = match.tender;
  /*
   * Przetargi po terminie zostają w feedzie (to historia użytkownika), ale muszą
   * być jawnie odróżnialne — inaczej ktoś szykuje ofertę na zamknięte postępowanie.
   * Pilne (do tygodnia) wyróżniamy, bo w tym produkcie liczy się czas reakcji.
   */
  const termin = opisTerminu(tender.deadline);
  const wadium = opisWadium(tender);
  // Za co są punkty — „Tylko cena” albo „Cena 60% · Gwarancja 40%” bez otwierania przetargu.
  const kryteria = znacznikKryteriow(tender);
  // Wyjaśnienia / zmiany SWZ / nowy termin z monitoringu e-Zamówień (2026-11-01) — „jest co czytać”.
  const zmiany = znacznikZmian(tender);
  const otwarcie = znacznikOtwarcia(tender, t);

  return (
    <Pressable
      onPress={() => onOtworz(match)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, termin.minal && styles.kartaMiniona]}
      accessibilityRole="button"
      accessibilityLabel={t(
        `${tender.title}. Dopasowanie ${match.confidence_score} procent. ${t(termin.etykieta)}.${kryteria ? ` Kryteria: ${kryteria.pl}.` : ''}`,
        `${tender.title}. ${match.confidence_score} percent match. ${t(termin.etykieta)}.${kryteria ? ` Criteria: ${kryteria.en}.` : ''}`,
      )}
    >
      <SaveStar tenderId={tender.id} styles={styles} kolory={kolory} />
      <View style={styles.row}>
        <ScoreBadge score={match.confidence_score} />
        <View style={styles.body}>
          {nowe ? <Text style={styles.noweChip}>{t('Nowe', 'New')}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>
            {tender.title}
          </Text>
          {tender.organization ? (
            <Text style={styles.org} numberOfLines={1}>
              {tender.organization}
            </Text>
          ) : null}
        </View>
      </View>
      {/* Termin i wadium w jednym pasku pod tytułem — to, o co wykonawca pyta najpierw. */}
      <View style={styles.meta}>
        <Text style={styles.deadline}>
          {t('Termin', 'Deadline')}: <Text style={styles.deadlineData}>{formatDate(tender.deadline)}</Text>
        </Text>
        <Text
          style={[
            styles.znacznik,
            termin.minal && styles.znacznikMiniony,
            termin.pilny && styles.znacznikPilny,
          ]}
        >
          {t(termin.etykieta)}
        </Text>
        {wadium ? (
          <Text style={[styles.wadiumChip, wadium.ostrzezenie ? styles.wadiumChipWymaga : styles.wadiumChipBez]}>
            {wadium.ostrzezenie
              ? t(`Wadium ${t(wadium.wartosc)}`, `Bid security ${t(wadium.wartosc)}`)
              : t('Bez wadium', 'No bid security')}
          </Text>
        ) : null}
        {kryteria ? (
          <Text style={[styles.kryteriaChip, !kryteria.tylkoCena && styles.kryteriaChipPozacenowe]} numberOfLines={1}>
            {t(kryteria.pl, kryteria.en)}
          </Text>
        ) : null}
        {zmiany ? (
          <Text style={[styles.kryteriaChip, styles.zmianyChip]} numberOfLines={1}>{t(zmiany.pl, zmiany.en)}</Text>
        ) : null}
        {otwarcie ? <Text style={[styles.kryteriaChip, styles.kryteriaChipPozacenowe]} numberOfLines={1}>{otwarcie}</Text> : null}
      </View>
      {/*
        Dlaczego widzisz ten przetarg (P1-4) — najwyżej dwa znaczniki i tylko
        te sygnały, które zadziałały. Liczone bez AI, z profilu i ogłoszenia.
      */}
      <ZnacznikiWyjasnienia wyjasnienie={match.wyjasnienie} />
      {/*
        Źródło pierwotne + czas ostatniej synchronizacji (P1-3). Bez drugiej
        informacji cichy feed wygląda tak samo przy spokojnym tygodniu
        i przy padniętym pobieraniu.
      */}
      <PodpisZrodla zrodlo={tender.zrodlo} kompakt />
    </Pressable>
  );
}

export default memo(MatchCard);

const tworzStyleKarty = tworzStyle((k) => ({
  kartaMiniona: { opacity: 0.6 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: k.border,
  },
  znacznik: {
    fontSize: 12,
    fontWeight: '700',
    color: k.textMuted,
    backgroundColor: k.neutralneTlo,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  znacznikPilny: { color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo },
  znacznikMiniony: { color: k.danger, backgroundColor: k.dangerTlo },
  noweChip: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    color: k.blue,
    backgroundColor: k.wyroznienie,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: 6,
  },
  wadiumChip: { fontSize: 12, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.sm, overflow: 'hidden' },
  wadiumChipWymaga: { backgroundColor: k.ostrzezenieTlo, color: k.ostrzezenieTekst },
  wadiumChipBez: { backgroundColor: k.sukcesTlo, color: k.sukcesAkcent },
  kryteriaChip: { fontSize: 12, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.sm, overflow: 'hidden', color: k.textMuted, backgroundColor: k.neutralneTlo, flexShrink: 1 },
  kryteriaChipPozacenowe: { color: k.blue, backgroundColor: k.wyroznienie },
  zmianyChip: { color: k.ostrzezenieTekst, backgroundColor: k.ostrzezenieTlo },
  card: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginBottom: 12,
  },
  pressed: { backgroundColor: k.powierzchniaWtorna, borderColor: k.obramowaniePola },
  gwiazdka: { position: 'absolute', top: 6, right: 6, zIndex: 2, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  gwiazdkaZnak: { fontSize: 22, lineHeight: 26, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 14, paddingRight: 30 },
  score: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: { fontWeight: '800', fontSize: 19, lineHeight: 22, fontVariant: ['tabular-nums'] },
  scoreNumBig: { fontSize: 25, lineHeight: 29 },
  scorePct: { fontSize: 9, fontWeight: '700', textAlign: 'center' },
  body: { flex: 1 },
  title: { ...typografia.karta, color: k.text },
  org: { fontSize: 13, lineHeight: 18, color: k.textMuted, marginTop: 4 },
  deadline: { fontSize: 13, color: k.textMuted },
  deadlineData: { color: k.text, fontWeight: '700' },
}));
