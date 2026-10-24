import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { zrodlaCichoPusteWCyklu } from '../lib/zrodlaCichoPuste.js';
import { alarmZrodla as znacznikAlarmu } from '../db/repos.js';
import { sendEmail, alarmZrodlaEmail } from '../services/email.js';

const DZIEN_W_POLSCE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });

/**
 * Mail do właściciela, gdy BZP albo TED w dzień roboczy nie dało ANI JEDNEGO surowego
 * ogłoszenia mimo cyklu „ok" (przerwa techniczna e-Zamówienia 2026-10-23/24 przeszła
 * niezauważona przez dwa dni — jedynym śladem była flaga w /health, której nikt nie czyta).
 * Najwyżej jeden mail na dobę kalendarzową (czas polski) — ten sam mechanizm znacznika
 * co alarm AI. `wyslij` i `znacznik` wstrzykiwane w testach.
 */
export async function alarmujCichePusteZrodla({ wynik, zakonczonoIso } = {}, { wyslij = sendEmail, znacznik = znacznikAlarmu, teraz = new Date() } = {}) {
  const zrodla = zrodlaCichoPusteWCyklu(wynik, zakonczonoIso ?? teraz.toISOString());
  if (!zrodla.length) return { wyslano: false, powod: 'zrodla_maja_dane' };
  const dzien = DZIEN_W_POLSCE.format(teraz);
  if (!await znacznik.zarezerwuj(dzien)) return { wyslano: false, powod: 'juz_wyslany_dzis' };

  let rezultat;
  try {
    rezultat = await wyslij({ to: env.ALARM_EMAIL, ...alarmZrodlaEmail({ zrodla, healthUrl: `${env.APP_URL}/health` }) });
  } catch (err) {
    rezultat = { sent: false, error: err.message };
  }
  if (!rezultat?.sent) {
    await znacznik.zwolnij(dzien);
    logger.error({ zrodla, error: rezultat?.error }, 'Alarm o cicho pustym źródle NIE został wysłany');
    return { wyslano: false, powod: 'wysylka_nieudana' };
  }
  await znacznik.potwierdz(dzien, { emailId: rezultat.id ?? null, typ: zrodla.join(',') }).catch((err) =>
    logger.warn({ err: err.message }, 'Alarm źródeł wysłany, ale nie udało się oznaczyć znacznika'));
  logger.warn({ zrodla, dzien }, 'Wysłano alarm o cicho pustym źródle');
  return { wyslano: true, zrodla };
}
