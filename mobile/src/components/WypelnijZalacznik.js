import { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { api } from '../api/client';
import * as storage from '../lib/storage';
import { pobierzDokument } from '../services/dokumenty';
import { KLUCZ_DANYCH_WYKONAWCY } from '../lib/dokumentyOferty';
import { daneDoWypelnienia, opisWypelnienia } from '../lib/wypelnianieZalacznika';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing } from '../theme';

/**
 * „Wypełnij moimi danymi” przy formularzu zamawiającego (.docx) — 2026-10-31, z analizy konkurencji
 * (Mimira). Serwer wpisuje dane firmy w miejsca z kropkami; cenę, terminy i podpis zostawia.
 * Telefon: plik idzie e-mailem na adres konta (podpis i tak na komputerze). Web/Windows: pobranie.
 * Bez danych firmy prowadzi do „Dokumentów do oferty”, gdzie wpisuje się je raz.
 */
export default function WypelnijZalacznik({ dokument, navigation }) {
  const styles = useStyle(tworzStyleWypelniania);
  const { t } = useJezyk();
  const [stan, setStan] = useState({ laduje: false, komunikat: null, blad: false });

  async function wypelnij() {
    if (stan.laduje) return;
    let dane = null;
    try { dane = daneDoWypelnienia(await storage.getItem(KLUCZ_DANYCH_WYKONAWCY)); } catch { dane = null; }
    if (!dane) {
      setStan({ laduje: false, komunikat: t('Najpierw wpisz dane firmy w „Dokumentach do oferty” — raz, potem wypełniamy każdy formularz.', 'First enter your company data in “Bid documents” — once, then we fill every form.'), blad: true });
      navigation?.navigate('DokumentyOferty');
      return;
    }
    setStan({ laduje: true, komunikat: null, blad: false });
    const cialo = { url: dokument.url, nazwa: dokument.nazwa, dane };
    try {
      if (Platform.OS === 'web') {
        const { blob, nazwaPliku, typMime } = await api.wypelnijZalacznikPlik(cialo);
        await pobierzDokument({ tresc: blob, typMime, nazwaPliku: nazwaPliku ?? `${dokument.nazwa}.docx`, tytul: dokument.nazwa });
        setStan({ laduje: false, komunikat: t('Pobrano wypełniony formularz. Sprawdź dane, wpisz cenę i podpisz.', 'Downloaded the filled form. Check the data, enter the price and sign.'), blad: false });
      } else {
        const w = await api.wypelnijZalacznikEmail(cialo);
        setStan({ laduje: false, komunikat: w.tryb_degradacji ? t('Wysyłka e-maili jest chwilowo niedostępna — spróbuj za chwilę.', 'E-mail sending is temporarily unavailable — try again shortly.') : opisWypelnienia(w, t), blad: Boolean(w.tryb_degradacji) });
      }
    } catch (err) {
      setStan({ laduje: false, komunikat: err.message, blad: true });
    }
  }

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={wypelnij} disabled={stan.laduje} hitSlop={6}>
        <Text style={styles.akcja}>{stan.laduje ? t('Wypełniamy…', 'Filling…') : t('Wypełnij moimi danymi →', 'Fill with my data →')}</Text>
      </Pressable>
      {stan.komunikat ? <Text style={stan.blad ? styles.blad : styles.ok}>{stan.komunikat}</Text> : null}
    </View>
  );
}

const tworzStyleWypelniania = tworzStyle((k) => ({
  akcja: { fontSize: 13, fontWeight: '700', color: k.blue, marginTop: spacing.xs },
  ok: { fontSize: 12, color: k.sukcesAkcent, lineHeight: 17, marginTop: 4 },
  blad: { fontSize: 12, color: k.danger, lineHeight: 17, marginTop: 4 },
}));
