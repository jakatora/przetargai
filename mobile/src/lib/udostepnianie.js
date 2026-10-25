import { Platform, Share } from 'react-native';
import { trybUdostepniania } from './trybUdostepniania.js';

/*
 * Udostępnianie tekstu (dokumenty, pisma, wnioski) na KAŻDEJ platformie (2026-10-25).
 * Na telefonie `Share.share` otwiera arkusz systemowy. W wersji Windows (Electron / eksport
 * web) `navigator.share` nie istnieje, więc RN-web rzucało, a ekrany łapały to jako
 * „anulowane" — użytkownik desktopu nie dostawał ŻADNEGO dokumentu. Tu: bez `navigator.share`
 * kopiujemy tekst do schowka i mówimy o tym (okno `alert`, które Electron obsługuje).
 * Decyzja o trybie jest czystą funkcją (testowana); reszta to cienkie wywołania platformy.
 */

export { trybUdostepniania };

/**
 * @param {{message: string, title?: string, url?: string}} dane
 * @returns {Promise<{sposob: 'share'|'schowek', anulowano: boolean}>}
 */
export async function udostepnijTekst({ message, title, url } = {}) {
  const nav = globalThis.navigator;
  const tryb = trybUdostepniania({
    platformaWeb: Platform.OS === 'web',
    maShare: typeof nav?.share === 'function',
    maClipboard: typeof nav?.clipboard?.writeText === 'function',
  });
  if (tryb === 'schowek') {
    await nav.clipboard.writeText(url ? `${message}\n${url}` : message);
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(`${title ? `${title}\n\n` : ''}Skopiowano do schowka — wklej do Worda, maila albo na platformę zakupową (Ctrl+V).`);
    }
    return { sposob: 'schowek', anulowano: false };
  }
  if (tryb === 'brak') throw new Error('Udostępnianie niedostępne na tej platformie — zaznacz tekst i skopiuj go ręcznie.');
  const wynik = await Share.share({ message, title, ...(url ? { url } : {}) });
  return { sposob: 'share', anulowano: wynik?.action === Share.dismissedAction };
}
