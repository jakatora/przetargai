import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { api } from '../api/client';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { kwotaKrotko } from '../lib/ktoWygrywa';
import { czyMoznaOtworzycProfil } from '../lib/profilKonkurenta';
import { tonTerminu, opisTerminu, opisUmowy, dataKonca } from '../lib/umowyWygasajace';

/**
 * Wygasające umowy (2026-10-31, z analizy konkurencji: przetargi.info). Umowy z branż (CPV)
 * i regionów Karty firmy, które kończą się w ciągu ~7 miesięcy. Zamawiający niedługo ogłosi ten
 * sam przetarg, a Ty masz czas na kalkulację i referencje. Dane: ogłoszenia o wyniku w BZP
 * (data zawarcia i okres realizacji umowy), przeliczane raz na dobę.
 */
export default function UmowyWygasajaceScreen({ navigation }) {
  const styles = useStyle(tworzStyleUmow);
  const { kolory } = useTheme();
  const { t } = useJezyk();
  const [dane, setDane] = useState(null);
  const [blad, setBlad] = useState(null);
  const [proba, setProba] = useState(0);

  useEffect(() => {
    let aktywny = true;
    setBlad(null);
    api.umowyWygasajace()
      .then((d) => { if (aktywny) setDane(d); })
      .catch((err) => { if (aktywny) setBlad(err.message); });
    return () => { aktywny = false; };
  }, [proba]);

  if (blad) {
    return (
      <Screen>
        <Text style={styles.blad}>{blad}</Text>
        <Button title={t('Spróbuj ponownie', 'Try again')} variant="ghost" onPress={() => setProba((p) => p + 1)} />
      </Screen>
    );
  }
  if (!dane) return <Screen><ActivityIndicator color={kolory.blue} style={styles.spinner} /></Screen>;

  if (!dane.dostepne || !dane.umowy?.length) {
    return (
      <Screen scroll>
        <Text style={styles.tytul}>{t('Wygasające umowy', 'Expiring contracts')}</Text>
        <Text style={styles.opis}>
          {dane.dostepne
            ? t('W Twoich branżach i regionach nie widzimy teraz umów, które kończą się w ciągu 7 miesięcy. Sprawdzimy znowu jutro.', 'No contracts in your industries and regions end within 7 months right now. We check again tomorrow.')
            : t('Dodaj kody CPV i regiony w Karcie firmy — pokażemy umowy, które wkrótce się kończą, czyli przetargi, które zaraz wrócą.', 'Add CPV codes and regions in your company card and we will show contracts that end soon — tenders that will be back.')}
        </Text>
        <Button title={t('Otwórz kartę firmy', 'Open company card')} variant="ghost" onPress={() => navigation.navigate('KartaFirmy')} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.tytul}>{t('Wygasające umowy', 'Expiring contracts')}</Text>
      <Text style={styles.opis}>
        {t(
          'Te umowy kończą się w ciągu 7 miesięcy. Zamawiający niedługo ogłosi ten sam przetarg — przygotuj kalkulację i referencje, zanim zrobi to konkurencja.',
          'These contracts end within 7 months. The buyer will soon tender the same again — prepare your pricing and references before competitors do.',
        )}
      </Text>

      {dane.umowy.map((u) => {
        const ton = tonTerminu(u.dni_do_konca);
        return (
          <View key={u.id} style={styles.karta}>
            <View style={styles.glowa}>
              <Text style={styles.nazwa} numberOfLines={3}>{u.tytul ?? t('Umowa bez tytułu', 'Untitled contract')}</Text>
              <Text style={[styles.odznaka, styles[`ton_${ton}`]]}>{opisTerminu(u.dni_do_konca, t)}</Text>
            </View>
            <Text style={styles.zamawiajacy}>{u.zamawiajacy}{u.miasto ? `, ${u.miasto}` : ''}</Text>
            <Text style={styles.opis}>
              {t(`Koniec umowy: ${dataKonca(u) ?? '—'}`, `Contract ends: ${dataKonca(u) ?? '—'}`)}
              {opisUmowy(u, t, kwotaKrotko) ? ` · ${opisUmowy(u, t, kwotaKrotko)}` : ''}
            </Text>
            {(u.zwyciezcy ?? []).map((z) => (
              <Pressable
                key={z.nip ?? z.nazwa}
                accessibilityRole="button"
                disabled={!czyMoznaOtworzycProfil(z)}
                onPress={() => navigation.navigate('ProfilKonkurenta', { nip: z.nip ?? null, nazwa: z.nazwa })}
                hitSlop={6}
              >
                <Text style={styles.wykonawca}>
                  {t('Wykonuje: ', 'Current contractor: ')}{z.nazwa}
                  {czyMoznaOtworzycProfil(z) ? <Text style={styles.link}>{t('  profil →', '  profile →')}</Text> : null}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      })}

      <Text style={styles.zrodlo}>
        {t(
          'Koniec liczymy z daty zawarcia i okresu realizacji podanych w ogłoszeniu o wyniku w BZP. Pomijamy umowy krótsze niż pół roku i jednorazowe roboty budowlane, a także umowy, które wykonuje Twoja firma. Zamawiający może umowę przedłużyć albo zakończyć wcześniej.',
          'The end date comes from the signing date and term in the BZP award notice. We skip contracts shorter than six months, one-off construction works, and contracts your company performs. The buyer may extend or end a contract early.',
        )}
      </Text>
    </Screen>
  );
}

const tworzStyleUmow = tworzStyle((k) => ({
  spinner: { marginTop: spacing.lg },
  blad: { fontSize: 14, color: k.danger, lineHeight: 20, marginBottom: spacing.md },
  tytul: { fontSize: 22, fontWeight: '800', color: k.text, lineHeight: 28 },
  opis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4 },
  karta: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  glowa: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  nazwa: { flex: 1, fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  odznaka: { fontSize: 11, fontWeight: '800', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, overflow: 'hidden' },
  ton_pilne: { backgroundColor: k.dangerTlo, color: k.danger },
  ton_wkrotce: { backgroundColor: k.ostrzezenieTlo, color: k.ostrzezenieTekst },
  ton_neutralne: { backgroundColor: k.neutralneTlo, color: k.textMuted },
  zamawiajacy: { fontSize: 14, color: k.text, marginTop: spacing.xs },
  wykonawca: { fontSize: 13, color: k.text, marginTop: spacing.xs, lineHeight: 18 },
  link: { fontSize: 13, fontWeight: '700', color: k.blue },
  zrodlo: { fontSize: 12, color: k.textMuted, marginTop: spacing.lg, fontStyle: 'italic', lineHeight: 17 },
}));
