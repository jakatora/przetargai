import { logger } from '../lib/logger.js';
import { users, matches } from '../db/repos.js';
import { sendEmail, weeklyDigestEmail } from '../services/email.js';

/**
 * Cotygodniowy przegląd e-mail (D-057, roadmap developerski #10).
 *
 * Cel: retencja. Push o nowych przetargach dostają tylko użytkownicy z tokenem;
 * e-mail dociera do KAŻDEGO i przypomina o dopasowaniach z tygodnia — bez logowania
 * do apki łatwo je przegapić.
 *
 * Zasady „bez spamu":
 *  • wysyłamy TYLKO do kont, które w minionym tygodniu miały ≥1 nowe dopasowanie
 *    (zero dopasowań = brak maila; nie zawracamy głowy pustką),
 *  • jeden e-mail na użytkownika na przebieg,
 *  • błąd jednego maila nie przerywa całej partii.
 *
 * `now` wstrzykiwane dla testów (determinizm okna 7 dni).
 */
export async function runWeeklyDigest({ now = Date.now(), oknoDni = 7 } = {}) {
  const startedAt = now;
  const sinceIso = new Date(now - oknoDni * 24 * 60 * 60 * 1000).toISOString();

  const wszyscy = await users.all();
  let kandydaci = 0;
  let wyslane = 0;

  for (const user of wszyscy) {
    try {
      const liczba = await matches.countSince(user.id, sinceIso);
      if (liczba <= 0) continue; // brak nowości → nie wysyłamy
      kandydaci++;

      const tytuly = await matches.recentTitlesSince(user.id, sinceIso, 5);
      const tresc = weeklyDigestEmail({ companyName: user.company_name, liczba, tytuly });
      const wynik = await sendEmail({ to: user.email, ...tresc });
      if (wynik.sent) wyslane++;
    } catch (err) {
      logger.error({ err: err.message, userId: user.id }, 'Cotygodniowy przegląd: pominięto użytkownika (błąd)');
    }
  }

  const wynik = { ok: true, uzytkownicy: wszyscy.length, kandydaci, wyslane, durationMs: Date.now() - startedAt };
  logger.info(wynik, 'runWeeklyDigest: zakończono');
  return wynik;
}
