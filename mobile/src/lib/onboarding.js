/**
 * Logika decyzji o pokazaniu ekranu powitalnego (first-run onboarding).
 *
 * Czyste, testowalne bez renderera. Sedno aktywacji B2B: dopasowania przetargów
 * zależą od słów kluczowych i kodów CPV w profilu. Nowy użytkownik z pustym profilem
 * zobaczy pusty feed i odejdzie — dlatego aktywnie prowadzimy go do uzupełnienia
 * profilu, zanim trafi na listę.
 *
 * Klucz do storage — zgodny z regułą `[A-Za-z0-9._-]` (SecureStore na natywnym).
 */
export const KLUCZ_ONBOARDING_POMINIETY = 'przetargai.onboarding_pominiety';

/** Czy profil firmy jest pusty (brak słów kluczowych I kodów CPV). */
export function profilPusty(user) {
  const slowa = Array.isArray(user?.keywords) ? user.keywords : [];
  const cpv = Array.isArray(user?.cpv_codes) ? user.cpv_codes : [];
  return slowa.length === 0 && cpv.length === 0;
}

/**
 * Czy pokazać ekran powitalny. TAK, gdy: użytkownik zalogowany, profil pusty i
 * nie pominął onboardingu wcześniej. Gdy uzupełni profil, warunek sam wygasa
 * (bez potrzeby dodatkowej flagi) — flaga „pominięty" chroni tylko przed nękaniem
 * użytkownika, który świadomie wszedł dalej z pustym profilem.
 *
 * @param {object|null} user profil z AuthContext
 * @param {boolean} pominiety czy zapisano wcześniej „pomiń"
 */
export function czyPokazacOnboarding(user, pominiety) {
  if (!user) return false;
  if (pominiety) return false;
  return profilPusty(user);
}
