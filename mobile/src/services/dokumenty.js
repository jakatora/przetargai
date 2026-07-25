import { Platform, Share } from 'react-native';

/**
 * „Pobranie/zapis" wygenerowanego pisma (wniosek o protokół, notatki pod odwołanie…).
 *
 * Projekt nie ma expo-file-system/-sharing, więc bez nowych natywnych zależności:
 *  - web → prawdziwe pobranie pliku .txt (Blob + <a download>),
 *  - natywnie → arkusz udostępniania (zapis do Plików / wysyłka), jak „Udostępnij".
 *
 * Best-effort: zamknięcie arkusza przez użytkownika NIE jest błędem — pismo i tak
 * zostało wygenerowane. Wspólne dla ekranów, które oferują pobranie dokumentu
 * (kontrola oferty zwycięzcy: {@link ../screens/MatchDetailScreen} i
 * {@link ../screens/WynikKontroliScreen}), żeby nie dublować tej samej logiki.
 *
 * @param {{ tresc: string, typMime: string, nazwaPliku: string, tytul: string }} dok
 *   dokument z generatora (np. {@link ../lib/wniosekProtokol wygeneruj_wniosek_o_protokol}
 *   albo {@link ../lib/notatkiOdwolanie wygeneruj_notatki_odwolanie}).
 */
export async function pobierzDokument(dok) {
  if (Platform.OS === 'web') {
    const blob = new Blob([dok.tresc], { type: dok.typMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dok.nazwaPliku;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  try {
    await Share.share({ message: dok.tresc, title: dok.tytul });
  } catch {
    /* użytkownik zamknął arkusz — pismo i tak wygenerowane */
  }
}
