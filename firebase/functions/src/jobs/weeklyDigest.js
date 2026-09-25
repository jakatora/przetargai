import { logger } from '../lib/logger.js';
import { users, matches, znacznikDigestu } from '../db/repos.js';
import { sendEmail, weeklyDigestEmail } from '../services/email.js';

/**
 * Tydzień ISO 8601 jako klucz znacznika, np. `2026-W39`.
 *
 * Liczony w UTC: job startuje w poniedziałek o 8:00 czasu polskiego (6:00/7:00 UTC),
 * a ponowienia przychodzą w ciągu minut — cały przebieg mieści się w jednym tygodniu
 * ISO niezależnie od strefy. Czysta funkcja, testowana bez emulatora.
 */
export function kluczTygodniaIso(ms) {
  const d = new Date(ms);
  const dzien = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Czwartek tego tygodnia wyznacza rok ISO (poniedziałek = 1 … niedziela = 7).
  dzien.setUTCDate(dzien.getUTCDate() + 4 - (dzien.getUTCDay() || 7));
  const rok = dzien.getUTCFullYear();
  const tydzien = Math.ceil(((dzien.getTime() - Date.UTC(rok, 0, 1)) / 86_400_000 + 1) / 7);
  return `${rok}-W${String(tydzien).padStart(2, '0')}`;
}

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
 *  • jeden e-mail na użytkownika na TYDZIEŃ — nie na przebieg (2026-09-25): znacznik
 *    `meta/digest_<tydzień ISO>` powstaje `create()`-em PRZED wysyłką, więc podwójne
 *    wyzwolenie Cloud Schedulera i ponowienie po błędzie nie wysyłają drugi raz,
 *  • błąd jednego maila nie przerywa całej partii; zwalnia znacznik tego konta
 *    i kończy przebieg `ok: false`, żeby Scheduler go ponowił (index.js) — ponowienie
 *    dosyła tylko brakujące.
 *
 * Kompromis: gdy instancja padnie MIĘDZY znacznikiem a wysyłką, konto nie dostanie
 * przeglądu w tym tygodniu. Brak jednego maila retencyjnego jest mniejszym złem niż
 * dubel u wszystkich.
 *
 * `now` wstrzykiwane dla testów (determinizm okna 7 dni).
 */
export async function runWeeklyDigest({ now = Date.now(), oknoDni = 7 } = {}) {
  const startedAt = Date.now();
  const sinceIso = new Date(now - oknoDni * 24 * 60 * 60 * 1000).toISOString();
  const tydzien = kluczTygodniaIso(now);

  const wszyscy = await users.all();
  let kandydaci = 0;
  let wyslane = 0;
  let juzWyslane = 0;
  let bledy = 0;

  for (const user of wszyscy) {
    try {
      const liczba = await matches.countSince(user.id, sinceIso);
      if (liczba <= 0) continue; // brak nowości → nie wysyłamy
      kandydaci++;

      if (!await znacznikDigestu.zarezerwuj(user.id, tydzien)) {
        juzWyslane++;
        continue;
      }

      let wynik;
      try {
        const tytuly = await matches.recentTitlesSince(user.id, sinceIso, 5);
        const tresc = weeklyDigestEmail({ companyName: user.company_name, liczba, tytuly });
        wynik = await sendEmail({ to: user.email, ...tresc });
      } catch (err) {
        wynik = { sent: false, error: err.message };
      }

      if (wynik.sent) {
        wyslane++;
        // Stan „wysłany" jest informacyjny — sam znacznik już blokuje dubel.
        await znacznikDigestu.potwierdz(user.id, tydzien, { emailId: wynik.id ?? null }).catch((err) =>
          logger.warn({ err: err.message, userId: user.id }, 'Przegląd wysłany, ale nie udało się oznaczyć znacznika'));
        continue;
      }

      // Nic nie wyszło — zwalniamy znacznik, żeby ponowienie (albo włączenie Resend) dosłało.
      await znacznikDigestu.zwolnij(user.id, tydzien);
      // Tryb degradacji (brak RESEND_API_KEY) to stan znany, nie awaria — bez ponowień.
      if (!wynik.degraded) {
        bledy++;
        logger.error({ err: wynik.error, userId: user.id }, 'Cotygodniowy przegląd: wysyłka nie powiodła się — do ponowienia');
      }
    } catch (err) {
      bledy++;
      logger.error({ err: err.message, userId: user.id }, 'Cotygodniowy przegląd: pominięto użytkownika (błąd)');
    }
  }

  const wynik = {
    ok: bledy === 0, tydzien, uzytkownicy: wszyscy.length, kandydaci, wyslane, juzWyslane, bledy,
    durationMs: Date.now() - startedAt,
  };
  logger.info(wynik, 'runWeeklyDigest: zakończono');
  return wynik;
}
