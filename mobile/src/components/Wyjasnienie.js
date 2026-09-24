import { View, Text } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { tonNaKolor } from './PodpisZrodla';
import { skrotWyjasnienia, wierszeWyjasnienia, opisDlaCzytnika } from '../lib/wyjasnienieDopasowania';

/**
 * Znaczniki „dlaczego to widzę" na KARCIE (P1-4).
 *
 * Najwyżej dwa i tylko te sygnały, które zadziałały — karta konkuruje o uwagę
 * z tytułem ogłoszenia, a rząd znaczników „wszystko po trochu" uczy przewijać
 * wzrokiem miejsce, w którym czasem stoi ważna informacja.
 */
export function ZnacznikiWyjasnienia({ wyjasnienie }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWyjasnienia);
  const { t } = useJezyk();

  const skrot = skrotWyjasnienia(wyjasnienie);
  if (!skrot.length) return null;

  return (
    <View style={styles.skrotRzad}>
      {skrot.map((s) => (
        <Text
          key={s.typ}
          style={[styles.znacznik, { color: tonNaKolor(kolory, s.ton), borderColor: tonNaKolor(kolory, s.ton) }]}
        >
          {s.znak} {t(s.tekst)}
        </Text>
      ))}
    </View>
  );
}

/**
 * Pełne wyjaśnienie w SZCZEGÓŁACH: cztery sygnały, każdy ze swoją podpowiedzią.
 *
 * Podpowiedź jest tu najważniejsza — to jedyne miejsce w aplikacji, które mówi
 * użytkownikowi, co konkretnie zmienić w profilu, żeby feed wyglądał inaczej.
 */
export default function Wyjasnienie({ wyjasnienie }) {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleWyjasnienia);
  const { t, jezyk } = useJezyk();

  const wiersze = wierszeWyjasnienia(wyjasnienie);
  if (!wiersze.length) return null;

  return (
    <View style={styles.karta}>
      <Text style={styles.tytul}>{t('Dlaczego widzisz ten przetarg', 'Why you see this tender')}</Text>
      {wyjasnienie?.podsumowanie ? (
        <Text style={styles.podsumowanie}>{t(wyjasnienie.podsumowanie)}</Text>
      ) : null}

      {wiersze.map((w, i) => (
        <View
          key={w.typ}
          style={[styles.wiersz, i === wiersze.length - 1 && styles.wierszOstatni]}
          accessible
          accessibilityLabel={opisDlaCzytnika(
            { etykieta: w.etykieta, szczegol: w.szczegol, sila: sila(w.znak) },
            jezyk,
          )}
        >
          <Text style={[styles.znak, { color: tonNaKolor(kolory, w.ton) }]}>{w.znak}</Text>
          <View style={styles.trescWiersza}>
            <Text style={styles.etykieta}>{t(w.etykieta)}</Text>
            <Text style={styles.szczegol}>{t(w.szczegol)}</Text>
            {w.podpowiedz ? (
              <Text style={styles.podpowiedz}>→ {t(w.podpowiedz)}</Text>
            ) : null}
          </View>
        </View>
      ))}

      {/*
        Uczciwość wobec rachunku: to wyjaśnienie liczy się z profilu i ogłoszenia,
        bez wywołania AI. Użytkownik płacący za plan ma prawo wiedzieć, co kosztuje.
      */}
      <Text style={styles.stopka}>
        {t(
          'Wyliczone z Twojego profilu i danych ogłoszenia — bez użycia AI.',
          'Computed from your profile and the notice data — no AI involved.',
        )}
      </Text>
    </View>
  );
}

/** Odwrotność `znakSygnalu` — do etykiety dla czytnika ekranu. */
function sila(znak) {
  if (znak === '✓') return 'mocny';
  if (znak === '~') return 'czesciowy';
  if (znak === '–') return 'brak';
  return 'informacja';
}

/**
 * Konkretny następny krok przy PUSTYM feedzie (P1-4). Nie „zajrzyj później",
 * tylko jedno zdanie o tym, co odblokuje wyniki.
 */
export function NastepnyKrok({ podpowiedz, onPress }) {
  const styles = useStyle(tworzStyleWyjasnienia);
  const { t } = useJezyk();
  if (!podpowiedz) return null;

  return (
    <View
      style={styles.krok}
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${t(podpowiedz.tytul)}. ${t(podpowiedz.opis)}`}
    >
      <Text style={styles.krokTytul}>{t(podpowiedz.tytul)}</Text>
      <Text style={styles.krokOpis}>{t(podpowiedz.opis)}</Text>
      {onPress ? (
        <Text style={styles.krokCta} onPress={onPress}>
          {podpowiedz.kod === 'obejrzyj_wszystkie'
            ? t('Pokaż wszystkie przetargi →', 'Show all tenders →')
            : t('Przejdź do profilu →', 'Go to profile →')}
        </Text>
      ) : null}
    </View>
  );
}

const tworzStyleWyjasnienia = tworzStyle((k) => ({
  skrotRzad: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  znacznik: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  karta: {
    backgroundColor: k.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  tytul: { fontSize: 16, fontWeight: '800', color: k.text },
  podsumowanie: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: spacing.xs },
  wiersz: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: k.border,
  },
  wierszOstatni: { borderBottomWidth: 0 },
  znak: { fontSize: 15, fontWeight: '800', width: 16, textAlign: 'center' },
  trescWiersza: { flex: 1 },
  etykieta: { fontSize: 13, fontWeight: '800', color: k.text },
  szczegol: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 2 },
  podpowiedz: { fontSize: 13, color: k.blue, fontWeight: '700', marginTop: 4, lineHeight: 18 },
  stopka: { fontSize: 11, color: k.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },
  krok: {
    backgroundColor: k.wyroznienie,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: k.blue,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  krokTytul: { fontSize: 16, fontWeight: '800', color: k.blue },
  krokOpis: { fontSize: 13, color: k.text, lineHeight: 19 },
  krokCta: { fontSize: 14, fontWeight: '800', color: k.blue, marginTop: 6 },
}));
