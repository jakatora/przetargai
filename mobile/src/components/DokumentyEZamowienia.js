import { useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import Button from './Button';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { swzZZalacznikow, parametryRadaruZPlatformy } from '../lib/zalacznikiPlatformy';

/**
 * Dokumenty postępowania z e-Zamówień (2026-10-26): ogłoszenie BZP ma identyfikator postępowania,
 * a portal oddaje publicznie listę plików (SWZ, załączniki). Selekcja dociąga je dla nowo wybranych
 * dopasowań; w pozostałych przypadkach jedno dotknięcie. SWZ w PDF otwiera Radar SWZ, który pobiera
 * plik sam — użytkownik nie szuka specyfikacji i nic nie wgrywa. Postępowanie prowadzone poza
 * platformą = pusta lista (SWZ jest wtedy na stronie zamawiającego — link „Oryginał” wyżej).
 * Pokazuje się tylko dla `source === 'bzp'` z `postepowanie_id`.
 */
export default function DokumentyEZamowienia({ tender, navigation }) {
  const styles = useStyle(tworzStyleDokumentow);
  const { t } = useJezyk();
  const [stan, setStan] = useState({ laduje: false, dokumenty: Array.isArray(tender?.ez_dokumenty) ? tender.ez_dokumenty : null, blad: null });
  const kod = tender?.zrodlo?.kod ?? tender?.source;
  if (kod !== 'bzp' || !tender?.id || !tender?.postepowanie_id) return null;

  async function pobierz() {
    setStan({ laduje: true, dokumenty: null, blad: null });
    try {
      const w = await api.dokumentyEZamowienia(tender.id);
      setStan({ laduje: false, dokumenty: Array.isArray(w.dokumenty) ? w.dokumenty : [], blad: null });
    } catch (err) {
      setStan({ laduje: false, dokumenty: null, blad: err.message });
    }
  }

  const dokumenty = stan.dokumenty;
  const swz = dokumenty ? swzZZalacznikow(dokumenty) : [];
  return (
    <View style={styles.box}>
      {!dokumenty ? (
        <Button title={t('Pobierz SWZ i załączniki z e-Zamówień', 'Fetch the tender documents from e-Zamówienia')} variant="ghost" loading={stan.laduje} onPress={pobierz} />
      ) : null}
      {stan.blad ? <Text style={styles.blad}>{stan.blad}</Text> : null}
      {dokumenty ? (
        dokumenty.length ? (
          <View style={styles.lista}>
            <Text style={styles.etykieta}>{t('Dokumenty postępowania', 'Procedure documents')} ({dokumenty.length})</Text>
            {navigation ? swz.map((z) => (
              <Button
                key={`radar-${z.url}`}
                title={t(`Pytania do SWZ z „${z.nazwa}” — Radar SWZ`, `Questions on “${z.nazwa}” — tender document radar`)}
                onPress={() => navigation.navigate('RadarSwz', parametryRadaruZPlatformy({ tender, zalacznik: z }))}
              />
            )) : null}
            {dokumenty.map((d, i) => (
              <Pressable key={`${d.url ?? d.nazwa}-${i}`} accessibilityRole="link" disabled={!d.url} onPress={() => Linking.openURL(d.url).catch(() => {})} style={styles.dokument}>
                <Text style={d.url ? styles.dokumentLink : styles.dokumentTekst} numberOfLines={2}>
                  {d.nazwa}{d.rozszerzenie ? ` · ${d.rozszerzenie.toUpperCase()}` : ''}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.podpis}>{t('Pliki pobierają się z ezamowienia.gov.pl — bez logowania.', 'Files download from ezamowienia.gov.pl — no sign-in needed.')}</Text>
          </View>
        ) : (
          <Text style={styles.podpis}>{t('To postępowanie nie jest prowadzone na e-Zamówieniach — SWZ znajdziesz pod linkiem do oryginału.', 'This procedure is not run on e-Zamówienia — the tender documents are at the original link.')}</Text>
        )
      ) : null}
    </View>
  );
}

const tworzStyleDokumentow = tworzStyle((k) => ({
  box: { marginTop: spacing.sm },
  etykieta: { fontWeight: '700', color: k.text, fontSize: 13 },
  lista: { marginTop: spacing.xs, gap: 6 },
  dokument: { backgroundColor: k.surface, borderWidth: 1, borderColor: k.border, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: spacing.sm },
  dokumentLink: { fontSize: 13, color: k.blue, fontWeight: '600' },
  dokumentTekst: { fontSize: 13, color: k.text },
  podpis: { fontSize: 12, color: k.textMuted, marginTop: spacing.xs, lineHeight: 17 },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.xs },
}));
