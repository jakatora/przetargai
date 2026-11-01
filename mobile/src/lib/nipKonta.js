import { KLUCZ_DANYCH_WYKONAWCY } from './dokumentyOferty.js';
import { nipDoKonta } from './kartaZNip.js';

/**
 * NIP z telefonu do konta (2026-11-01). Do 1.2.1 NIP z Karty firmy i Dokumentów do oferty zostawał
 * w telefonie, więc serwer nie widział umów firmy (radar „Twoje umowy”, alert o ich następcach).
 * Po aktualizacji apka wysyła go sama przy starcie sesji — bez klikania. Tylko gdy konto NIP-u
 * jeszcze nie ma: zapisanego na serwerze nie nadpisujemy kopią z telefonu. Błędy (brak sieci,
 * NIP ma inne konto) połykamy — to uzupełnienie w tle, nie warunek startu.
 * @returns {Promise<object|null>} świeży użytkownik z serwera albo null
 */
export async function synchronizujNipKonta(user, { storage, api }) {
  if (!user || user.company_nip) return null;
  try {
    const zapis = await storage.getItem(KLUCZ_DANYCH_WYKONAWCY);
    const nip = nipDoKonta(zapis ? JSON.parse(zapis)?.nip : null, null);
    if (!nip) return null;
    const d = await api.ustawNipFirmy(nip);
    return d?.user ?? null;
  } catch {
    return null;
  }
}
