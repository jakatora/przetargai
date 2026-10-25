/*
 * Czysta reguła wyboru kanału udostępniania (bez importu react-native — testowalna wprost):
 * telefon → arkusz systemowy; web z `navigator.share` → arkusz; web bez (Electron/Windows) →
 * schowek; nic → jawny brak. Używa jej `lib/udostepnianie.js`.
 * @returns {'share'|'schowek'|'brak'}
 */
export function trybUdostepniania({ platformaWeb, maShare, maClipboard } = {}) {
  if (!platformaWeb) return 'share';
  if (maShare) return 'share';
  if (maClipboard) return 'schowek';
  return 'brak';
}
