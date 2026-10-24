import { useState } from 'react';
import { Modal, View, Text, Pressable, TextInput } from 'react-native';
import Button from './Button';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import { PRZYCZYNY_KLIENTA, etykietaPrzyczyny } from '../lib/selekcja';

/**
 * Odrzucenie wybranego przetargu z przyczyną (spec §5.1). Przyczyna trafia do nauki
 * (przykłady dla AI, propozycje zmian karty), komentarz jest opcjonalny (≤140 znaków).
 */
export default function ArkuszOdrzucenia({ widoczny, onAnuluj, onOdrzuc, zapisywanie = false }) {
  const { t } = useJezyk();
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleArkusza);
  const [przyczyna, setPrzyczyna] = useState(null);
  const [komentarz, setKomentarz] = useState('');

  function zamknij() {
    setPrzyczyna(null);
    setKomentarz('');
    onAnuluj();
  }

  return (
    <Modal visible={widoczny} transparent animationType="slide" onRequestClose={zamknij}>
      <View style={styles.tlo}>
        <View style={styles.arkusz}>
          <Text style={styles.tytul}>{t('Dlaczego ten przetarg nie pasuje?', 'Why does this tender not fit?')}</Text>
          <Text style={styles.opis}>
            {t('Uczymy się z Twoich odpowiedzi — podobnych przetargów będzie mniej.', 'We learn from your answers — you will see fewer tenders like this.')}
          </Text>
          {PRZYCZYNY_KLIENTA.map((kod) => (
            <Pressable
              key={kod}
              accessibilityRole="radio"
              accessibilityState={{ selected: przyczyna === kod }}
              onPress={() => setPrzyczyna(kod)}
              style={[styles.opcja, przyczyna === kod && styles.opcjaWybrana]}
            >
              <Text style={styles.opcjaTekst}>{t(etykietaPrzyczyny(kod))}</Text>
            </Pressable>
          ))}
          <TextInput
            value={komentarz}
            onChangeText={setKomentarz}
            maxLength={140}
            placeholder={t('Komentarz (opcjonalnie)', 'Comment (optional)')}
            placeholderTextColor={kolory.textMuted}
            style={styles.pole}
            accessibilityLabel={t('Komentarz do odrzucenia', 'Rejection comment')}
          />
          <Button
            title={t('Odrzuć przetarg', 'Reject tender')}
            variant="danger"
            disabled={!przyczyna}
            loading={zapisywanie}
            onPress={() => onOdrzuc(przyczyna, komentarz.trim() || undefined)}
          />
          <Button title={t('Anuluj', 'Cancel')} variant="ghost" onPress={zamknij} style={styles.anuluj} />
        </View>
      </View>
    </Modal>
  );
}

const tworzStyleArkusza = tworzStyle((k) => ({
  tlo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  arkusz: { backgroundColor: k.surface, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  tytul: { fontSize: 18, fontWeight: '700', color: k.text },
  opis: { fontSize: 14, color: k.textMuted, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 20 },
  opcja: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, marginBottom: spacing.xs },
  opcjaWybrana: { borderColor: k.blue, backgroundColor: k.wyroznienie },
  opcjaTekst: { fontSize: 15, color: k.text },
  pole: { borderWidth: 1, borderColor: k.border, borderRadius: radius.md, padding: spacing.sm, color: k.text, marginVertical: spacing.md },
  anuluj: { marginTop: spacing.sm },
}));
