import { useState } from 'react';
import { Text } from 'react-native';
import Button from './Button';
import { api } from '../api/client';
import { useStyle, tworzStyle } from '../context/ThemeContext';
import { spacing } from '../theme';

/**
 * „Wyślij jako Word na mój e-mail" (2026-10-25). Pisma podpisuje się kwalifikowanym podpisem
 * na komputerze, więc plik .docx w skrzynce to krótsza droga niż tekst w schowku telefonu.
 * Plik składa backend (`POST /eksport/pismo`), adres bierze z konta — przycisk nie zna adresu
 * i nie może wysłać nikomu obcemu. Stan tylko tutaj; ekrany przekazują `{ nazwa, tresc }`.
 */
export default function PrzyciskWord({ nazwa, tresc, variant = 'ghost', style, poWyslaniu }) {
  const styles = useStyle(tworzStyleWord);
  const [stan, setStan] = useState({ laduje: false, komunikat: null, ok: false });

  async function wyslij() {
    if (!tresc || !String(tresc).trim()) return;
    setStan({ laduje: true, komunikat: null, ok: false });
    try {
      const w = await api.wyslijPismoWord({ nazwa, tresc });
      const komunikat = w.tryb_degradacji
        ? 'Wysyłka e-maili jest chwilowo niedostępna — skorzystaj z „Udostępnij / skopiuj".'
        : `Wysłano plik ${w.plik} na ${w.do}. Otwórz na komputerze, podpisz i złóż na platformie.`;
      setStan({ laduje: false, komunikat, ok: !w.tryb_degradacji });
      if (!w.tryb_degradacji) poWyslaniu?.(w);
    } catch (err) {
      setStan({ laduje: false, komunikat: err.message, ok: false });
    }
  }

  return (
    <>
      <Button title="Wyślij jako Word na mój e-mail" variant={variant} loading={stan.laduje} onPress={wyslij} style={style} />
      {stan.komunikat ? <Text style={stan.ok ? styles.ok : styles.blad}>{stan.komunikat}</Text> : null}
    </>
  );
}

const tworzStyleWord = tworzStyle((k) => ({
  ok: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 18 },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 18 },
}));
