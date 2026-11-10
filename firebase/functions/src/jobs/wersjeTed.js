import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { wersjeDoZastapienia, porzadekPublikacji, alertNowejWersjiTed } from '../lib/wersjeTed.js';
import { tenders, evaluations, saved, users, alerty } from '../db/repos.js';
import { sendPush } from '../services/push.js';
import { sendEmail } from '../services/email.js';
import { dostarcz } from './monitorWyszukiwan.js';

/*
 * WERSJE OGŁOSZEŃ TED (2026-11-01, `lib/wersjeTed.js`). Starsza wersja postępowania dostaje `zastapiony_przez`
 * (schodzi z puli dopasowań, jak kopia z platformy zastąpiona przez BZP) i termin aktualnej wersji — razem z kopiami
 * w Zapisanych (przypomnienie) i w feedach (znacznik, po którym feed ukrywa duplikat, gdy konto ma też aktualną).
 * Bez wpisu w historii zmian: aktualna wersja to osobny dokument, a stara tylko ustępuje. Ślad oceny i dopasowanie
 * konta przechodzą na aktualną wersję (`evaluations.przeniesNaWersje`) — inaczej selekcja oceniałaby ją od nowa (AI)
 * i ogłaszała jako nowy przetarg.
 *   • po pobraniu TED (`fetchTenders`): postępowania nowo zapisanych ogłoszeń,
 *   • `/admin/wersje-ted`: otwarte TED z 30 dni, do `maks` starych wersji na wywołanie (powtórka idzie dalej).
 * Alert „Zmiana ogłoszenia w zapisanym przetargu” (2026-11-10, `powiadamiaj`): konta, które zapisały albo analizowały
 * starszą wersję, gdy aktualna jeszcze przyjmuje oferty. Tylko po pobraniu TED — uzupełnianie wstecz nie budzi.
 */
const ROWNOLEGLE = 8;

export async function runWersjeTed({
  postepowania = null, teraz = Date.now(), maks = Infinity, przetargi = tenders, oceny = evaluations,
  powiadamiaj = false, zapisane = saved, konta = users, alertyRepo = alerty, wyslijPush = sendPush, wyslijEmail = sendEmail,
} = {}) {
  const wynik = { ok: true, postepowan: 0, z_wersjami: 0, zastapione: 0, kopie: 0, przeniesione_oceny: 0, przeniesione_dopasowania: 0, alerty: 0, bledy: 0, zostalo: 0 };
  const grupy = new Map();
  if (postepowania) {
    for (const pid of new Set([...postepowania].filter(Boolean))) grupy.set(pid, await przetargi.tedPoPostepowaniu(pid));
  } else {
    for (const t of await przetargi.tedDoWersji(new Date(teraz - 30 * 86_400_000).toISOString())) {
      if (t.postepowanie_id) grupy.set(t.postepowanie_id, [...(grupy.get(t.postepowanie_id) ?? []), t]);
    }
  }
  wynik.postepowan = grupy.size;
  const zadania = [];
  // Przeniesienie ocen obejmuje też wersje oznaczone wcześniej (idempotentne) — 1.11 uzupełnianie wstecz
  // oznaczyło 2626 wersji, zanim ta część powstała.
  const wszystkieStare = [];
  for (const dokumenty of grupy.values()) {
    const { aktualna, starsze } = wersjeDoZastapienia(dokumenty);
    for (const d of dokumenty) if (aktualna && d.id !== aktualna.id) wszystkieStare.push({ staraId: d.id, aktualna });
    if (!starsze.length) continue;
    wynik.z_wersjami += 1;
    for (const stara of starsze) zadania.push({ stara, aktualna });
  }
  wynik.zostalo = Math.max(0, zadania.length - maks);
  const doZrobienia = zadania.slice(0, maks);
  const zastapione = [];
  for (let i = 0; i < doZrobienia.length; i += ROWNOLEGLE) {
    await Promise.all(doZrobienia.slice(i, i + ROWNOLEGLE).map(async ({ stara, aktualna }) => {
      try {
        wynik.kopie += await przetargi.zastapWersje(stara.id, aktualna);
        wynik.zastapione += 1;
        zastapione.push({ stara, aktualna });
      } catch (err) {
        wynik.bledy += 1;
        logger.warn({ err: err.message, stara: stara.id, aktualna: aktualna.id }, 'Wersje TED: nie udało się oznaczyć starej wersji');
      }
    }));
  }
  if (powiadamiaj && zastapione.length) {
    try {
      wynik.alerty = await powiadomONowychWersjach({ zastapione, teraz, przetargi, zapisane, konta, alertyRepo, wyslijPush, wyslijEmail });
    } catch (err) {
      wynik.bledy += 1;
      logger.warn({ err: err.message }, 'Wersje TED: alerty o nowych wersjach nie powiodły się');
    }
  }
  // Ocena i dopasowanie przechodzą na aktualną wersję — selekcja nie płaci drugi raz za AI ani nie ogłasza
  // „nowego przetargu”, który konto już zna (~139 wersji TED dziennie).
  try {
    // Od najnowszej starej wersji — gdy kilka wskazuje tę samą aktualną, przechodzi stan najświeższej.
    wszystkieStare.sort((a, b) => porzadekPublikacji(b.staraId) - porzadekPublikacji(a.staraId));
    const p = await oceny.przeniesNaWersje(wszystkieStare);
    wynik.przeniesione_oceny = p.oceny;
    wynik.przeniesione_dopasowania = p.dopasowania;
  } catch (err) {
    wynik.bledy += 1;
    logger.warn({ err: err.message, par: wszystkieStare.length }, 'Wersje TED: przeniesienie ocen nie powiodło się');
  }
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runWersjeTed: zakończono');
  return wynik;
}

/**
 * Konta, które zapisały albo analizowały starszą wersję (Zapisane z 30 dni + analiza SWZ), dostają alert o aktualnej
 * — raz na aktualną wersję (klucz alertu), tylko gdy aktualna jeszcze przyjmuje oferty. Zwraca liczbę nowych alertów.
 */
async function powiadomONowychWersjach({ zastapione, teraz, przetargi, zapisane, konta, alertyRepo, wyslijPush, wyslijEmail }) {
  const od = new Date(teraz - 30 * 86_400_000).toISOString();
  const wpisy = [...await zapisane.otwarteWszystkich(od), ...await zapisane.zaangazowaneWszystkich().catch(() => [])];
  const kontaWersji = new Map();
  for (const w of wpisy) kontaWersji.set(w.tenderId, new Set([...(kontaWersji.get(w.tenderId) ?? []), w.userId]));
  // Aktualna wersja → konta i termin wersji, którą każde konto zapisało (do „było …”).
  const doPowiadomienia = new Map();
  for (const { stara, aktualna } of zastapione) {
    for (const userId of kontaWersji.get(stara.id) ?? []) {
      const wpis = doPowiadomienia.get(aktualna.id) ?? { aktualna, konta: new Map() };
      if (!wpis.konta.has(userId)) wpis.konta.set(userId, stara.deadline ?? null);
      doPowiadomienia.set(aktualna.id, wpis);
    }
  }
  if (!doPowiadomienia.size) return 0;
  const pola = new Map((await przetargi.polaWielu([...doPowiadomienia.keys()], ['title', 'organization', 'deadline'])).map((t) => [t.id, t]));
  const uzytkownicy = new Map();
  let nowe = 0;
  for (const [id, { aktualna, konta: kontaWpisu }] of doPowiadomienia) {
    const tender = { id, ...(pola.get(id) ?? {}), deadline: pola.get(id)?.deadline ?? aktualna.deadline ?? null };
    if (!(Date.parse(tender.deadline ?? '') > teraz)) continue; // po terminie — zmiana już nic nie zmienia
    for (const [userId, staryTermin] of kontaWpisu) {
      const alert = alertNowejWersjiTed({ tender, staryTermin });
      const { nowy } = await alertyRepo.dodaj(userId, alert, nowIso());
      if (!nowy) continue;
      nowe += 1;
      if (!uzytkownicy.has(userId)) uzytkownicy.set(userId, await konta.findById(userId).catch(() => null));
      await dostarcz({ user: uzytkownicy.get(userId), alert, wyslijPush, wyslijEmail });
    }
  }
  return nowe;
}
