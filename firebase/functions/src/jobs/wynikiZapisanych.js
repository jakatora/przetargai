import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { saved, tenders, users, alerty } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { alertWynikuZapisanego } from '../lib/wynikZapisanego.js';
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * Wyniki ZAPISANYCH przetargów (2026-11-01): okno rozstrzygnięć BZP woła to po zapisie doby. Złączenie po
 * identyfikatorze postępowania (`postepowanie_id` przetargu = `tenderId` wyniku). Klucz alertu = przetarg,
 * więc ten sam wynik w kolejnych przebiegach okna (14 dni) nie wraca drugi raz.
 */

/** Jak daleko wstecz (termin ofert) szukać Zapisanych — wynik w BZP pojawia się po podpisaniu umowy. */
export const DNI_WSTECZ_ZAPISANYCH = 400;
/** Alert tylko o wyniku opublikowanym w ostatnich dniach (okno BZP to 14 dni). */
export const DNI_SWIEZOSCI_WYNIKU = 21;

/**
 * @param {object[]} wyniki sparsowane rozstrzygnięcia (`parsujWynik`) z tego przebiegu
 * @returns {Promise<{wynikow: number, zapisanych: number, dopasowane: number, alerty: number, push: number, email: number, bledy: number}>}
 */
export async function runWynikiZapisanych(wyniki, {
  teraz = Date.now(), zapisane = saved, przetargi = tenders, konta = users, alertyRepo = alerty,
  wyslijPush = sendPush, wyslijEmail = sendEmail,
} = {}) {
  const wynik = { wynikow: 0, zapisanych: 0, dopasowane: 0, alerty: 0, push: 0, email: 0, bledy: 0 };
  const poPostepowaniu = new Map();
  // Wsteczne zasilenie roku (trasa admina) nie może zasypać kont alertami o wynikach sprzed miesięcy.
  const swiezeOd = new Date(teraz - DNI_SWIEZOSCI_WYNIKU * 86_400_000).toISOString().slice(0, 10);
  for (const w of wyniki ?? []) {
    if (w?.tenderId && w.czesci?.length && (!w.opublikowano || w.opublikowano >= swiezeOd)) poPostepowaniu.set(String(w.tenderId), w);
  }
  wynik.wynikow = poPostepowaniu.size;
  if (!poPostepowaniu.size) return wynik;

  const wpisy = await zapisane.otwarteWszystkich(new Date(teraz - DNI_WSTECZ_ZAPISANYCH * 86_400_000).toISOString());
  wynik.zapisanych = wpisy.length;
  if (!wpisy.length) return wynik;
  const stan = new Map((await przetargi.stanMonitoraDokumentow(wpisy.map((w) => w.tenderId))).map((t) => [t.id, t]));
  const uzytkownicy = new Map();
  for (const wpis of wpisy) {
    const t = stan.get(wpis.tenderId);
    const w = t?.postepowanie_id ? poPostepowaniu.get(String(t.postepowanie_id)) : null;
    if (!w) continue;
    wynik.dopasowane += 1;
    try {
      if (!uzytkownicy.has(wpis.userId)) uzytkownicy.set(wpis.userId, await konta.findById(wpis.userId).catch(() => null));
      const user = uzytkownicy.get(wpis.userId);
      const alert = alertWynikuZapisanego({ tenderId: t.id, tender: t, wynik: w, nipKonta: user?.company_nip ?? null });
      if (!alert) continue;
      const { nowy } = await alertyRepo.dodaj(wpis.userId, alert, nowIso());
      if (!nowy) continue;
      wynik.alerty += 1;
      const kanal = await dostarcz({ user, alert, wyslijPush, wyslijEmail });
      if (kanal === 'push') wynik.push += 1;
      if (kanal === 'email') wynik.email += 1;
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, userId: wpis.userId, tenderId: wpis.tenderId }, 'Wyniki zapisanych: alert pominięty');
    }
  }
  return wynik;
}
