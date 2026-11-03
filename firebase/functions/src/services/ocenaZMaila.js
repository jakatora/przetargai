import { env } from '../config.js';
import { magicLinks } from '../db/repos.js';

/*
 * „NIE DLA NAS” Z MAILA (2026-11-03). Selekcja uczy się z odrzuceń z przyczyną (`pracownik_sygnaly` → przykłady dla
 * AI, propozycje zmian karty), ale 3.11 żadne z 32 kont nie miało ani jednego sygnału: odrzucić można tylko w apce,
 * a klient czyta maile. Mail z wybranymi niesie więc przy każdym przetargu link do strony z przyczynami — jeden link
 * na mail (14 dni, cel `ocena_z_maila`), WIELOKROTNY, bo klient odrzuca kilka pozycji z jednej listy. Link pozwala
 * TYLKO odrzucić dopasowanie tego konta.
 */
export const CEL_OCENA = 'ocena_z_maila';
export const OCENA_TTL_MIN = 14 * 24 * 60;

/** Adres bazowy; link do pozycji = bazowy + `&m=<id dopasowania>` (`linkDoPozycji`). */
export async function linkOceny(userId, { linki = magicLinks } = {}) {
  const { token } = await linki.create({ userId, purpose: CEL_OCENA, ttlMinutes: OCENA_TTL_MIN });
  return `${env.APP_URL}/maile/ocena?token=${token}`;
}

export const linkDoPozycji = (bazowy, matchId) => (bazowy && matchId ? `${bazowy}&m=${encodeURIComponent(matchId)}` : null);
