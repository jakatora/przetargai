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
export default function PrzyciskWord({ nazwa, tresc, pisma, tytul, title, variant = 'ghost', style, poWyslaniu }) {
  const styles = useStyle(tworzStyleWord);
  const [stan, setStan] = useState({ laduje: false, komunikat: null, ok: false });
  // Jedno pismo ({nazwa, tresc}) albo pakiet (`pisma` = [{nazwa, tresc}], jeden e-mail, osobne pliki).
  const lista = Array.isArray(pisma) ? pisma.filter((p) => p && String(p.tresc ?? '').trim()) : null;

  async function wyslij() {
    if (lista ? lista.length === 0 : (!tresc || !String(tresc).trim())) return;
    setStan({ laduje: true, komunikat: null, ok: false });
    try {
      const w = lista ? await api.wyslijPismaWord({ pisma: lista, tytul }) : await api.wyslijPismoWord({ nazwa, tresc });
      const pliki = Array.isArray(w.pliki) ? w.pliki : [w.plik];
      const komunikat = w.tryb_degradacji
        ? 'Wysyłka e-maili jest chwilowo niedostępna — skorzystaj z „Udostępnij / skopiuj".'
        : (pliki.length > 1
          ? `Wysłano ${pliki.length} plików Word na ${w.do}. Otwórz na komputerze, podpisz i złóż na platformie.`
          : `Wysłano plik ${pliki[0]} na ${w.do}. Otwórz na komputerze, podpisz i złóż na platformie.`);
      setStan({ laduje: false, komunikat, ok: !w.tryb_degradacji });
      if (!w.tryb_degradacji) poWyslaniu?.(w);
    } catch (err) {
      setStan({ laduje: false, komunikat: err.message, ok: false });
    }
  }

  return (
    <>
      <Button title={title ?? (lista ? 'Wyślij cały pakiet jako Word na mój e-mail' : 'Wyślij jako Word na mój e-mail')} variant={variant} loading={stan.laduje} onPress={wyslij} style={style} />
      {stan.komunikat ? <Text style={stan.ok ? styles.ok : styles.blad}>{stan.komunikat}</Text> : null}
    </>
  );
}

const tworzStyleWord = tworzStyle((k) => ({
  ok: { fontSize: 13, color: k.green, fontWeight: '600', marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 18 },
  blad: { fontSize: 13, color: k.danger, marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 18 },
}));
