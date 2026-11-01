import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { wersjeDoZastapienia } from '../lib/wersjeTed.js';
import { tenders } from '../db/repos.js';

/*
 * WERSJE OGŁOSZEŃ TED (2026-11-01, `lib/wersjeTed.js`). Starsza wersja postępowania dostaje `zastapiony_przez`
 * (schodzi z puli dopasowań, jak kopia z platformy zastąpiona przez BZP) i termin aktualnej wersji — razem z kopiami
 * w Zapisanych (przypomnienie) i w feedach (znacznik, po którym feed ukrywa duplikat, gdy konto ma też aktualną).
 * Bez wpisu w historii zmian: aktualna wersja to osobny dokument, a stara tylko ustępuje.
 *   • po pobraniu TED (`fetchTenders`): postępowania nowo zapisanych ogłoszeń,
 *   • `/admin/wersje-ted`: otwarte TED z 30 dni, do `maks` starych wersji na wywołanie (powtórka idzie dalej).
 */
const ROWNOLEGLE = 8;

export async function runWersjeTed({ postepowania = null, teraz = Date.now(), maks = Infinity, przetargi = tenders } = {}) {
  const wynik = { ok: true, postepowan: 0, z_wersjami: 0, zastapione: 0, kopie: 0, bledy: 0, zostalo: 0 };
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
  for (const dokumenty of grupy.values()) {
    const { aktualna, starsze } = wersjeDoZastapienia(dokumenty);
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
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runWersjeTed: zakończono');
  return wynik;
}
