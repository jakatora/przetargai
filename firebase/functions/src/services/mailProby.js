import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { stanProby } from '../lib/plan.js';
import { mailProbyPrzypomnienie, mailProbyKoniec, dniDoKoncaProby } from '../lib/mailProby.js';
import { users } from '../db/repos.js';
import { sendEmail } from './email.js';

/* Maile 7-dniowej próby Standard (spec §15) — w przebiegu 12:00, każdy rodzaj raz. */
const PRZYPOMNIENIE_MS = 48 * 3_600_000;
const KONIEC_WAZNY_MS = 7 * 86_400_000;

export function rodzajMailaProby(user, teraz) {
  const stan = stanProby(user, teraz);
  if (!stan || user?.premium_tier === 'standard' || !user?.email) return null;
  const zostalo = Date.parse(stan.do) - Date.parse(teraz);
  if (zostalo <= 0) return zostalo > -KONIEC_WAZNY_MS && !user.proba_maile?.koniec ? 'koniec' : null;
  return zostalo <= PRZYPOMNIENIE_MS && !user.proba_maile?.przypomnienie ? 'przypomnienie' : null;
}

export async function wyslijMaileProby({ teraz = nowIso(), wyslijEmail = sendEmail, wczytajUzytkownikow = () => users.all() } = {}) {
  const wynik = { wyslane: 0, bledy: 0 };
  for (const user of await wczytajUzytkownikow()) {
    const rodzaj = rodzajMailaProby(user, teraz);
    if (!rodzaj || !await users.zarezerwujMailProby(user.id, rodzaj, teraz)) continue;
    const tresc = rodzaj === 'koniec'
      ? mailProbyKoniec({ linkAplikacji: env.APP_LINK_URL })
      : mailProbyPrzypomnienie({ dniZostalo: dniDoKoncaProby(stanProby(user, teraz).do, teraz), linkAplikacji: env.APP_LINK_URL });
    try {
      const w = await wyslijEmail({ to: user.email, ...tresc });
      if (w?.sent || w?.odrzuconyAdresat) {
        await users.potwierdzMailProby(user.id, rodzaj, teraz);
        if (w.sent) wynik.wyslane++;
      } else {
        await users.zwolnijMailProby(user.id, rodzaj);
        wynik.bledy++;
      }
    } catch (err) {
      await users.zwolnijMailProby(user.id, rodzaj).catch(() => {});
      wynik.bledy++;
      logger.error({ err: err.message, userId: user.id, rodzaj }, 'Mail próby nie wysłany');
    }
  }
  return wynik;
}
