import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useJezyk } from '../context/JezykContext';
import { useTheme } from '../context/ThemeContext';

export default function ZrodloSwz({ cytat }) {
  const { t } = useJezyk();
  const { kolory: k } = useTheme();
  const [blad, setBlad] = useState(false);
  if (!cytat) return null;
  const z = cytat.zrodlo ?? {};
  const nazwa = z.rodzaj === 'pierwsza_analiza'
    ? t('Pierwsza analiza', 'Initial analysis')
    : z.numer ? t(`Wersja ${z.numer}`, `Version ${z.numer}`) : t('Treść analizy', 'Analysis input');
  const lokalizacja = [nazwa, cytat.strona ? t(`strona ${cytat.strona}`, `page ${cytat.strona}`) : t('bez numeru strony', 'page number unavailable'), cytat.linia ? t(`linia ${cytat.linia}`, `line ${cytat.linia}`) : null].filter(Boolean).join(' · ');
  const url = typeof z.url === 'string' && /^https?:\/\//i.test(z.url) ? z.url : null;
  return (
    <View style={{ marginTop: 8, padding: 10, borderLeftWidth: 2, borderLeftColor: k.blue }}>
      <Text style={{ color: k.text, fontSize: 13, lineHeight: 19 }}>„{cytat.tekst}”{cytat.skrocony ? '…' : ''}</Text>
      <Text style={{ color: k.textMuted, fontSize: 12, marginTop: 4 }}>{lokalizacja} · {cytat.potwierdzony ? t('potwierdzony w źródle', 'verified in source') : t('fragment niepotwierdzony', 'unverified excerpt')}</Text>
      {url ? <Pressable accessibilityRole="link" onPress={() => { setBlad(false); WebBrowser.openBrowserAsync(url).catch(() => setBlad(true)); }}><Text style={{ color: k.blue, fontSize: 13, marginTop: 6 }}>{t('Otwórz dokument źródłowy', 'Open source document')}</Text></Pressable> : null}
      {blad ? <Text style={{ color: k.danger, fontSize: 12 }}>{t('Nie udało się otworzyć dokumentu. Spróbuj ponownie.', 'Could not open the document. Try again.')}</Text> : null}
    </View>
  );
}
