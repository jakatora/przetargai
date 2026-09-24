import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { obserwacjePlanow, alerty, tenders, users } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { sprawdzObserwacje } from '../lib/obserwacjePlanow.js';
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * MONITORING OBSERWOWANYCH PLANÓW — „przetarg z planu właśnie ogłoszono".
 *
 * Biegnie w tej samej funkcji co monitoring zapisanych wyszukiwań (co 2 h), więc
 * po tym, jak okna ogłoszeń (co 3 h) zapiszą nowe przetargi, alert przychodzi
 * najpóźniej po 5 h — ta sama gwarancja co w etapie 5.
 *
 * Koszt: jedno zapytanie o ogłoszenia zamawiającego na NIP (nie na obserwację —
 * kilku obserwujących ten sam plan dzieli odczyt). ZERO płatnego AI: dopasowanie
 * ogłoszenia do planu jest deterministyczne (`lib/zmianyPlanu.js`).
 *
 * Idempotencja jak w monitoringu wyszukiwań: alert ma deterministyczny klucz,
 * powiadomienie wychodzi tylko przy PIERWSZYM zapisie alertu.
 */
export async function runMonitorPlanow({
  teraz = nowIso(),
  wyslijPush = sendPush,
  wyslijEmail = sendEmail,
} = {}) {
  const start = Date.now();
  const wynik = {
    ok: true, aktywnych: 0, sprawdzone: 0, ogloszone: 0, wygasle: 0,
    alerty: 0, push: 0, email: 0, bledy: 0, durationMs: 0,
  };

  const obserwacje = await obserwacjePlanow.aktywne();
  wynik.aktywnych = obserwacje.length;

  const poNipie = new Map();
  const przetargiZamawiajacego = async (nip) => {
    if (!nip) return [];
    if (!poNipie.has(nip)) poNipie.set(nip, await tenders.poNipieZamawiajacego(nip));
    return poNipie.get(nip);
  };
  const uzytkownicy = new Map();
  const uzytkownik = async (id) => {
    if (!uzytkownicy.has(id)) uzytkownicy.set(id, await users.findById(id).catch(() => null));
    return uzytkownicy.get(id);
  };

  for (const o of obserwacje) {
    try {
      const przetargi = await przetargiZamawiajacego(o.zamawiajacy_nip);
      const decyzja = sprawdzObserwacje({ obserwacja: o, przetargi, teraz });

      if (decyzja.alert) {
        const { nowy } = await alerty.dodaj(o.userId, decyzja.alert, teraz);
        wynik.alerty += 1;
        if (nowy) {
          const kanal = await dostarcz({
            user: await uzytkownik(o.userId), alert: decyzja.alert, wyslijPush, wyslijEmail,
          });
          if (kanal === 'push') wynik.push += 1;
          if (kanal === 'email') wynik.email += 1;
        }
      }
      // Checkpoint PO wysyłce — powtórkę odsiewa klucz alertu.
      await obserwacjePlanow.zapiszSprawdzenie(o.userId, o.id, { ...decyzja, teraz });
      if (decyzja.zakonczenie === 'ogloszono') wynik.ogloszone += 1;
      if (decyzja.zakonczenie === 'wygasla') wynik.wygasle += 1;
      wynik.sprawdzone += 1;
    } catch (err) {
      wynik.bledy += 1;
      logger.error({ err: err.message, userId: o.userId, planId: o.plan_id },
        'Monitoring planów: obserwacja pominięta');
    }
  }

  wynik.ok = wynik.bledy === 0;
  wynik.durationMs = Date.now() - start;
  logger.info(wynik, 'runMonitorPlanow: zakończono');
  return wynik;
}
