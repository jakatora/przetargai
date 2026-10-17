import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import { bladKrytycznyAi } from '../lib/stanAi.js';
import { alarmAi as znacznikAlarmu } from '../db/repos.js';
import { sendEmail, alarmAiEmail } from '../services/email.js';

const DZIEN_W_POLSCE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });

/**
 * Mail do właściciela, gdy AI w cyklu padło z powodu, który sam nie minie
 * (brak kredytów, odrzucony klucz). Incydent 2026-10-12: oceny AI nie działały
 * 6 dni, bo jedynym śladem były logi, których nikt nie czyta.
 *
 * Najwyżej jeden mail na dobę kalendarzową (czas polski): cron biega raz dziennie
 * i bywa ponawiany, a alarm ma przypominać codziennie, dopóki problem trwa — nie
 * zasypywać skrzynki. Nieudana wysyłka zwalnia znacznik, żeby ponowienie dosłało.
 * Limity, przeciążenia i timeouty NIE wysyłają maili — mijają same, a widać je w `/health`.
 *
 * `wyslij` i `znacznik` są wstrzykiwane w testach.
 */
export async function alarmujAwarieAi(ai, { wyslij = sendEmail, znacznik = znacznikAlarmu, teraz = new Date() } = {}) {
  const typ = bladKrytycznyAi(ai);
  if (!typ) return { wyslano: false, powod: 'brak_bledu_krytycznego' };

  const dzien = DZIEN_W_POLSCE.format(teraz);
  if (!await znacznik.zarezerwuj(dzien)) return { wyslano: false, powod: 'juz_wyslany_dzis' };

  let wynik;
  try {
    wynik = await wyslij({
      to: env.ALARM_EMAIL,
      ...alarmAiEmail({
        typ,
        udane: ai.udane,
        nieudane: ai.nieudane,
        ostatniBlad: ai.ostatni_blad,
        healthUrl: `${env.APP_URL}/health`,
      }),
    });
  } catch (err) {
    wynik = { sent: false, error: err.message };
  }

  if (!wynik?.sent) {
    await znacznik.zwolnij(dzien);
    logger.error({ typ, error: wynik?.error, degraded: wynik?.degraded ?? false },
      'Alarm o awarii AI NIE został wysłany — ponowienie przebiegu spróbuje znowu');
    return { wyslano: false, powod: 'wysylka_nieudana' };
  }

  // Stan „wysłany" jest informacyjny — sam znacznik dnia już blokuje dubel.
  await znacznik.potwierdz(dzien, { emailId: wynik.id ?? null, typ }).catch((err) =>
    logger.warn({ err: err.message }, 'Alarm AI wysłany, ale nie udało się oznaczyć znacznika'));
  logger.warn({ typ, dzien, nieudane: ai.nieudane }, 'Wysłano alarm o awarii AI');
  return { wyslano: true, typ };
}
