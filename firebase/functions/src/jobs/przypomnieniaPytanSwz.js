import { logger } from '../lib/logger.js';
import { users, tenders, przypomnieniaPytan } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { terminPytan, wOknie, trescPrzypomnieniaPytan, OKNO_PRZYPOMNIENIA_PYTAN_MS } from '../lib/przypomnieniePytan.js';
import { reguluZrodla } from '../lib/kalendarzPrzetargu.js';

/**
 * Przypomnienia o terminie pytań do SWZ dla „Zapisanych" (funkcja A, 2026-09-29).
 *
 * Uruchamiane w tym samym harmonogramie co przypomnienia o terminie składania
 * (`remindDeadlines`, co 6 h, Europe/Warsaw) — okno wysyłki to ostatnia doba przed
 * terminem pytań, więc każdy termin trafia w co najmniej trzy przebiegi.
 *
 * Niezawodność jak w jobs/remindDeadlines.js:
 *  • rezerwacja w transakcji PRZED wysyłką — ponowny albo równoległy przebieg nie
 *    wyśle drugiego pushu o tym samym terminie,
 *  • `sent` = bilety przyjęte przez Expo; błąd dostawcy odkręca rezerwację do
 *    ponowienia (najwyżej MAKS_PROB_WYSYLKI_PYTAN razy), martwy token kończy próby,
 *  • aktualny dokument przetargu przed wysyłką — anulowany albo z przesuniętym
 *    terminem nie dostaje przypomnienia o nieaktualnej dacie.
 *
 * OGRANICZENIE (review 2026-09-29): gwarancja „jeden push" dotyczy powtórzonych
 * i równoległych przebiegów. Jeśli proces padnie PO przyjęciu pushu przez Expo,
 * a PRZED zapisem „wyslane", rezerwacja po 30 min uznawana jest za osieroconą
 * i push może pójść drugi raz. Expo Push API nie ma klucza idempotencji, więc
 * pełnego „dokładnie raz" nie da się tu zagwarantować — wybraliśmy możliwy
 * duplikat zamiast możliwej utraty przypomnienia.
 *
 * @param {{teraz?: string, wyslij?: typeof sendPush}} [opcje] wstrzykiwane w testach
 */

export const MAKS_PROB_WYSYLKI_PYTAN = 3;
/** Odstęp ponowienia po błędzie dostawcy — w praktyce najbliższy przebieg joba. */
export const ODSTEP_PONOWIENIA_PYTAN_MS = 60 * 60_000;
const TRWALE_BLEDY_PUSH = new Set(['DeviceNotRegistered']);

/** Najdłuższy ustawowy odstęp pytań od składania (TED: 14 dni) — zakres zapytania. */
const MAKS_DNI_PYTAN = Math.max(reguluZrodla('bzp').dniPytania, reguluZrodla('ted').dniPytania);
const MIN_DNI_PYTAN = Math.min(reguluZrodla('bzp').dniPytania, reguluZrodla('ted').dniPytania);
const DZIEN_MS = 86_400_000;

export async function runPrzypomnieniaPytanSwz({ teraz = new Date().toISOString(), wyslij = sendPush } = {}) {
  const startedAt = Date.now();
  const terazMs = Date.parse(teraz);
  const wynik = {
    ok: true, kandydaci: 0, sent: 0, nieudane: 0, porzucone: 0, bezTokenu: 0,
    poza_oknem: 0, bez_terminu: 0, zajete: 0, bledy: 0, durationMs: 0,
  };

  // Termin pytań w oknie ⇔ termin składania w (teraz + N dni, teraz + N dni + doba]
  // dla N z reguły rejestru. Zapytanie bierze sumę przedziałów, dokładny test niżej.
  const kandydaci = await przypomnieniaPytan.kandydaci({
    od: new Date(terazMs + MIN_DNI_PYTAN * DZIEN_MS).toISOString(),
    doKiedy: new Date(terazMs + MAKS_DNI_PYTAN * DZIEN_MS + OKNO_PRZYPOMNIENIA_PYTAN_MS).toISOString(),
  });
  wynik.kandydaci = kandydaci.length;

  const tokenCache = new Map();
  const tokenDla = async (userId) => {
    if (!tokenCache.has(userId)) {
      const u = await users.findById(userId).catch(() => null);
      tokenCache.set(userId, u?.push_token ?? null);
    }
    return tokenCache.get(userId);
  };

  for (const wpis of kandydaci) {
    try {
      await obsluzWpis(wpis, { teraz, wyslij, tokenDla, wynik });
    } catch (err) {
      wynik.bledy++;
      logger.error({ err: err.message, userId: wpis.userId, tenderId: wpis.tenderId },
        'Przypomnienie o terminie pytań do SWZ nie zostało obsłużone');
    }
  }

  wynik.ok = wynik.bledy === 0;
  wynik.durationMs = Date.now() - startedAt;
  logger.info(wynik, 'runPrzypomnieniaPytanSwz: zakończono');
  return wynik;
}

async function obsluzWpis(wpis, { teraz, wyslij, tokenDla, wynik }) {
  // 1) Aktualny stan przetargu — wpis „Zapisanych" to kopia z chwili zapisu.
  const tender = await tenders.findById(wpis.tender_id ?? wpis.tenderId).catch(() => null);
  const pozycja = terminPytan({
    id: wpis.tenderId,
    source: tender?.source ?? wpis.tender_source ?? 'bzp',
    deadline: tender?.deadline ?? wpis.tender_deadline ?? null,
    anulowany: tender?.anulowany === true,
  }, teraz);
  if (!pozycja) { wynik.bez_terminu++; return; }
  if (!wOknie(pozycja, teraz)) { wynik.poza_oknem++; return; }

  // 2) Rezerwacja PRZED wysyłką.
  const rez = await przypomnieniaPytan.zarezerwuj(wpis.userId, wpis.tenderId, { termin: pozycja.at, teraz });
  if (rez.stan !== 'zarezerwowane') { wynik.zajete++; return; }

  const zakoncz = (stan, { proby = rez.proby, ponowPo = null } = {}) => przypomnieniaPytan.zakoncz(
    wpis.userId, wpis.tenderId, { termin: pozycja.at, teraz, stan, proby, ponowPo },
  );

  // 3) Bez tokenu nie ma dokąd wysłać — spróbujemy w kolejnym przebiegu okna.
  const token = await tokenDla(wpis.userId);
  if (!token) {
    await zakoncz('bez_tokenu');
    wynik.bezTokenu++;
    return;
  }

  const tresc = trescPrzypomnieniaPytan({
    tenderId: wpis.tenderId,
    tytul: tender?.title || wpis.tender_title,
    pozycja,
  });
  const push = await wyslij(token, tresc)
    .catch((err) => ({ sent: 0, failed: 1, bledy: { [err.message]: 1 } }));

  if (push.sent > 0) {
    await zakoncz('wyslane');
    wynik.sent++;
    return;
  }

  // Token nie w formacie Expo — odrzucony przed wysyłką; ponawianie nic nie da.
  const kody = Object.keys(push.bledy ?? {});
  if (!push.failed || (kody.length && kody.every((k) => TRWALE_BLEDY_PUSH.has(k)))) {
    await zakoncz('porzucone');
    wynik.porzucone++;
    logger.warn({ userId: wpis.userId, tenderId: wpis.tenderId, bledy: push.bledy },
      'Przypomnienie o pytaniach do SWZ niedostarczalne — koniec prób');
    return;
  }

  // 4) Błąd dostawcy to NIE sukces: ponowienie z limitem prób.
  const proby = rez.proby + 1;
  if (proby >= MAKS_PROB_WYSYLKI_PYTAN) {
    await zakoncz('porzucone', { proby });
    wynik.porzucone++;
    logger.error({ userId: wpis.userId, tenderId: wpis.tenderId, proby, bledy: push.bledy },
      'Przypomnienie o pytaniach do SWZ NIE dostarczone po wyczerpaniu prób');
    return;
  }
  await zakoncz('ponowienie', {
    proby,
    ponowPo: new Date(Date.parse(teraz) + ODSTEP_PONOWIENIA_PYTAN_MS).toISOString(),
  });
  wynik.nieudane++;
  logger.warn({ userId: wpis.userId, tenderId: wpis.tenderId, proba: proby, bledy: push.bledy },
    'Push o pytaniach do SWZ nie doszedł — wróci w kolejnym przebiegu');
}
