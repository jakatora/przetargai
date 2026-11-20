import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Zapis lokalnego eksportu; bez wysyłki na serwer i bez automatycznego maila. */
export async function zapiszEksportSwz({ nazwa, tresc, typ_mime: typMime }) {
  if (!/^PrzetargAI-SWZ-[a-zA-Z0-9-]+\.(txt|json)$/.test(nazwa ?? '') || typeof tresc !== 'string'
    || (nazwa.endsWith('.json') ? typMime !== 'application/json' : typMime !== 'text/plain')) {
    throw new Error('Serwer nie zwrócił poprawnego eksportu historii SWZ.');
  }
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([tresc], { type: `${typMime};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nazwa;
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Udostępnianie pliku jest niedostępne na tym urządzeniu.');
  const plik = new File(Paths.cache, nazwa);
  plik.create({ overwrite: true });
  plik.write(tresc);
  // Odbiorca może czytać URI już po zamknięciu arkusza; nie kasujemy go przedwcześnie.
  // Kolejny eksport tego postępowania zastępuje prywatną kopię w cache aplikacji.
  await Sharing.shareAsync(plik.uri, { mimeType: typMime, dialogTitle: nazwa, UTI: typMime === 'application/json' ? 'public.json' : 'public.plain-text' });
}
