/*
 * Odczyt wybranego pliku (uri z expo-document-picker) do base64 bez dokładania natywnego
 * expo-file-system: fetch(file://) → Blob → FileReader.readAsDataURL (RN ma oba).
 * Zdejmujemy prefiks „data:...;base64," — backend oczekuje samej treści base64.
 * Ten sam mechanizm co w Sejfie dokumentów; tu wspólny dla Radaru SWZ (plik SWZ).
 */
export async function czytajPlikBase64(uri) {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nie udało się odczytać wybranego pliku.'));
    reader.onload = () => {
      const wynik = String(reader.result || '');
      const przecinek = wynik.indexOf(',');
      resolve(przecinek >= 0 ? wynik.slice(przecinek + 1) : wynik);
    };
    reader.readAsDataURL(blob);
  });
}

/** Limit pliku SWZ zgodny z backendem (lib/umowaEkstrakcja.js: 5 MB). */
export const MAKS_BAJTOW_PLIKU_SWZ = 5 * 1024 * 1024;

/** Czy wybrany plik nadaje się do wysłania jako SWZ (PDF do 5 MB). Czysta, testowalna. */
export function sprawdzPlikSwz(plik) {
  if (!plik || typeof plik !== 'object') return { ok: false, blad: 'Nie wybrano pliku.' };
  const nazwa = String(plik.name ?? '');
  const typ = String(plik.mimeType ?? '');
  if (!/\.pdf$/i.test(nazwa) && !/pdf/i.test(typ)) return { ok: false, blad: 'Wybierz plik PDF — inne formaty (DOCX, ZIP) wklej jako tekst.' };
  if (typeof plik.size === 'number' && plik.size > MAKS_BAJTOW_PLIKU_SWZ) return { ok: false, blad: 'Plik ma ponad 5 MB — wklej tylko rozdziały o warunkach i dokumentach.' };
  return { ok: true, blad: null };
}
