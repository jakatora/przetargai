import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { wersjeDoZastapienia, porzadekPublikacji } from '../lib/wersjeTed.js';
import { tenders, evaluations } from '../db/repos.js';

/*
 * WERSJE OGŁOSZEŃ TED (2026-11-01, `lib/wersjeTed.js`). Starsza wersja postępowania dostaje `zastapiony_przez`
 * (schodzi z puli dopasowań, jak kopia z platformy zastąpiona przez BZP) i termin aktualnej wersji — razem z kopiami
 * w Zapisanych (przypomnienie) i w feedach (znacznik, po którym feed ukrywa duplikat, gdy konto ma też aktualną).
 * Bez wpisu w historii zmian: aktualna wersja to osobny dokument, a stara tylko ustępuje. Ślad oceny i dopasowanie
 * konta przechodzą na aktualną wersję (`evaluations.przeniesNaWersje`) — inaczej selekcja oceniałaby ją od nowa (AI)
 * i ogłaszała jako nowy przetarg.
 *   • po pobraniu TED (`fetchTenders`): postępowania nowo zapisanych ogłoszeń,
 *   • `/admin/wersje-ted`: otwarte TED z 30 dni, do `maks` starych wersji na wywołanie (powtórka idzie dalej).
 */
const ROWNOLEGLE = 8;

export async function runWersjeTed({ postepowania = null, teraz = Date.now(), maks = Infinity, przetargi = tenders, oceny = evaluations } = {}) {
  const wynik = { ok: true, postepowan: 0, z_wersjami: 0, zastapione: 0, kopie: 0, przeniesione_oceny: 0, przeniesione_dopasowania: 0, bledy: 0, zostalo: 0 };
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
  for (let i = 0; i < doZrobienia.length; i += ROWNOLEGLE) {
    await Promise.all(doZrobienia.slice(i, i + ROWNOLEGLE).map(async ({ stara, aktualna }) => {
      try {
        wynik.kopie += await przetargi.zastapWersje(stara.id, aktualna);
        wynik.zastapione += 1;
      } catch (err) {
        wynik.bledy += 1;
        logger.warn({ err: err.message, stara: stara.id, aktualna: aktualna.id }, 'Wersje TED: nie udało się oznaczyć starej wersji');
      }
    }));
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
