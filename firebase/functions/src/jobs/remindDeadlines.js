import { logger } from '../lib/logger.js';
import { saved, users, tenders } from '../db/repos.js';
import { sendPush } from '../services/push.js';

/**
 * Wysyła przypomnienia o zbliżających się terminach składania ofert (D-050).
 *
 * Bierze wpisy z „Zapisanych", które mają włączone przypomnienie i są wymagalne
 * (remind_at ≤ teraz, jeszcze niepowiadomione). Wysyła push na token użytkownika
 * i PRZESUWA na następny etap 7→3→1 (runda 11) — po ostatnim etapie kończy.
 *
 * Użytkownik bez push_token (np. nie nadał zgody) jest pomijany, ale wpis i tak
 * PRZESUWA etap — inaczej próbowalibyśmy w kółko. To świadomy kompromis: push.
 *
 * Niezawodność (2026-09-25):
 *  • IDEMPOTENCJA (P2) — etap jest rezerwowany w transakcji PRZED wysyłką
 *    (`saved.zarezerwujEtap`), więc dwa równoległe przebiegi (podwójne wyzwolenie
 *    Cloud Schedulera, ponowienie) nie wysyłają tego samego pusha dwa razy,
 *  • WYNIK WYSYŁKI (P1) — `sendPush` NIE rzuca, zwraca `{sent, failed, bledy}`.
 *    Dotąd etap przesuwał się bez patrzenia na wynik i awaria Expo po cichu kasowała
 *    przypomnienie. Teraz nieudany push odkręca rezerwację i wraca w kolejnym
 *    przebiegu, najwyżej `MAKS_PROB_WYSYLKI` razy. E-maila awaryjnego nie ma:
 *    services/email.js nie ma szablonu przypomnienia o terminie,
 *  • AKTUALNY STAN PRZETARGU (P1) — przed wysyłką doczytujemy dokument przetargu:
 *    anulowany zamyka przypomnienie bez pusha, a termin zmieniony w źródle zastępuje
 *    kopię z wpisu „Zapisanych" (etapy liczą się od nowego terminu).
 */

/** Ile razy próbujemy dostarczyć JEDEN etap, zanim go zamkniemy (z błędem w logu). */
export const MAKS_PROB_WYSYLKI = 3;
/** Odstęp ponowienia — w praktyce kolejny przebieg joba (co 6 h), nie pętla w tym samym. */
export const ODSTEP_PONOWIENIA_MS = 60 * 60_000;
/** Błędy biletów Expo, których ponawianie nic nie da (martwy token urządzenia). */
const TRWALE_BLEDY_PUSH = new Set(['DeviceNotRegistered']);

/** Treść przypomnienia wg etapu (7/3/1 dnia, 0 = ostatnie wezwanie). */
function opisEtapu(etap) {
  if (etap === 7) return 'Zostało 7 dni do składania ofert';
  if (etap === 3) return 'Zostały 3 dni do składania ofert';
  if (etap === 1) return 'Został 1 dzień do składania ofert';
  return 'Termin składania ofert już blisko';
}

export async function runReminderCheck() {
  const startedAt = Date.now();
  const due = await saved.dueReminders();
  const wynik = {
    ok: true, due: due.length, sent: 0, nieudane: 0, porzucone: 0, anulowane: 0,
    przeplanowane: 0, zakonczone: 0, zajete: 0, bezTokenu: 0, bledy: 0, durationMs: 0,
  };
  if (!due.length) {
    wynik.durationMs = Date.now() - startedAt;
    return wynik;
  }

  // Token pobieramy raz na użytkownika (jeden user może mieć kilka wymagalnych).
  const tokenCache = new Map();
  const tokenFor = async (userId) => {
    if (!tokenCache.has(userId)) {
      const u = await users.findById(userId).catch(() => null);
      tokenCache.set(userId, u?.push_token ?? null);
    }
    return tokenCache.get(userId);
  };

  for (const wpis of due) {
    try {
      await obsluzWpis(wpis, wynik, tokenFor);
    } catch (err) {
      // Nie przerywamy całej partii przez jedno przypomnienie. Błąd (np. Firestore)
      // kończy przebieg `ok: false` → Cloud Scheduler ponowi, a rezerwacja etapu
      // pilnuje, żeby już obsłużone wpisy nie poszły drugi raz.
      wynik.bledy++;
      logger.error({ err: err.message, userId: wpis.userId, tenderId: wpis.tenderId },
        'Przypomnienie o terminie nie zostało obsłużone');
    }
  }

  wynik.ok = wynik.bledy === 0;
  wynik.durationMs = Date.now() - startedAt;
  logger.info(wynik, 'runReminderCheck: zakończono');
  return wynik;
}

async function obsluzWpis(wpis, wynik, tokenFor) {
  // 1) Aktualny stan przetargu — wpis „Zapisanych" to kopia z chwili zapisu.
  const tender = await tenders.findById(wpis.tender_id ?? wpis.tenderId).catch(() => null);
  if (tender?.anulowany === true) {
    await saved.zakonczPrzypomnienie(wpis.userId, wpis.tenderId, 'anulowany');
    wynik.anulowane++;
    logger.info({ userId: wpis.userId, tenderId: wpis.tenderId }, 'Przypomnienie zamknięte — przetarg anulowany');
    return;
  }

  // 2) Rezerwacja etapu PRZED wysyłką (transakcja, z aktualnym terminem).
  const rez = await saved.zarezerwujEtap(wpis.userId, wpis.tenderId, {
    etap: wpis.remind_etap,
    remindAt: wpis.remind_at,
    termin: tender?.deadline ?? null,
  });
  if (rez.stan === 'przeplanowany') { wynik.przeplanowane++; return; }
  if (rez.stan === 'zakonczony') { wynik.zakonczone++; return; }
  if (rez.stan !== 'zarezerwowany') { wynik.zajete++; return; } // obsłużył inny przebieg / wpis zniknął

  // 3) Wysyłka.
  const token = await tokenFor(wpis.userId);
  if (!token) { wynik.bezTokenu++; return; }

  const push = await sendPush(token, {
    title: opisEtapu(rez.etap),
    body: tender?.title || wpis.tender_title || 'Zapisany przetarg — zbliża się termin składania ofert',
    data: { type: 'deadline_reminder', tender_id: wpis.tenderId, etap: String(rez.etap ?? '') },
  }).catch((err) => ({ sent: 0, failed: 1, bledy: { [err.message]: 1 } }));

  if (push.sent > 0) { wynik.sent++; return; }
  // Token nie w formacie Expo — odrzucony przed wysyłką; ponawianie nic nie zmieni.
  if (!push.failed) { wynik.bezTokenu++; return; }

  const kody = Object.keys(push.bledy ?? {});
  if (kody.length && kody.every((k) => TRWALE_BLEDY_PUSH.has(k))) {
    wynik.porzucone++;
    logger.warn({ userId: wpis.userId, tenderId: wpis.tenderId, bledy: push.bledy },
      'Przypomnienie niedostarczone — martwy token, etap zamknięty bez ponowień');
    return;
  }

  // 4) Awaria przejściowa — odkręcamy rezerwację (z limitem prób).
  const cof = await saved.cofnijEtap(wpis.userId, wpis.tenderId, rez, {
    maksProb: MAKS_PROB_WYSYLKI, odstepMs: ODSTEP_PONOWIENIA_MS,
  });
  if (cof.stan === 'ponowienie') {
    wynik.nieudane++;
    logger.warn({ userId: wpis.userId, tenderId: wpis.tenderId, proba: cof.proby, bledy: push.bledy },
      'Push z przypomnieniem nie doszedł — etap wróci w kolejnym przebiegu');
  } else if (cof.stan === 'porzucony') {
    wynik.porzucone++;
    logger.error({ userId: wpis.userId, tenderId: wpis.tenderId, etap: rez.etap, proby: cof.proby, bledy: push.bledy },
      'Przypomnienie o terminie NIE dostarczone po wyczerpaniu prób — etap zamknięty');
  }
}
