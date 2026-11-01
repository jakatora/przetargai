import { rozstrzygniecia, umowyWygasajace, tenders } from '../db/repos.js';
import { zbudujKubelkiUmow, pozycjaUmowy, nastepcyUmow, HORYZONT_DNI } from '../lib/umowyWygasajace.js';
import { logger } from '../lib/logger.js';

/**
 * Przeliczenie radaru wygasających umów (2026-10-31) — raz na dobę, bez rejestrów i bez AI:
 * czyta zapisane rozstrzygnięcia z końcem umowy w [dziś, dziś + HORYZONT_DNI], składa kubełki
 * dział CPV × województwo (`lib/umowyWygasajace.js`) i zapisuje je w `umowy_wygasajace`.
 * Od 2026-11-01 dopisuje też następcę umowy: otwarty przetarg, który jest jej nową edycją.
 * Ślad przebiegu w `_health/umowy_wygasajace` (widać go w `/health`).
 */
export async function runUmowyWygasajace({ teraz = Date.now(), repo = rozstrzygniecia, magazyn = umowyWygasajace, przetargi = tenders } = {}) {
  const start = Date.now();
  const od = new Date(teraz).toISOString().slice(0, 10);
  const doDnia = new Date(teraz + HORYZONT_DNI * 86_400_000).toISOString().slice(0, 10);
  let stan;
  try {
    const wyniki = await repo.konczaceSie(od, doDnia);
    // Bez listy otwartych przetargów radar dalej działa — tylko bez linków do nowych edycji.
    let bladNastepcow = null;
    const otwarte = await przetargi.otwarteZNipem().catch((err) => {
      bladNastepcow = err.message;
      logger.warn({ err: err.message }, 'Radar umów: nie odczytano otwartych przetargów — bez następców');
      return [];
    });
    const nastepcy = nastepcyUmow(wyniki, otwarte, { teraz });
    const kubelki = zbudujKubelkiUmow(wyniki, { teraz, nastepcy });
    const kubelkow = await magazyn.zapisz(kubelki);
    const pozycje = wyniki.filter((w) => pozycjaUmowy(w, { odDnia: od, doDnia }));
    stan = {
      zakonczony_o: new Date().toISOString(), od, do: doDnia,
      rozstrzygniec: wyniki.length, umow_cyklicznych: pozycje.length, kubelkow,
      otwartych_przetargow: otwarte.length,
      juz_ogloszonych: pozycje.filter((w) => nastepcy.has(w.externalId)).length,
      blad_nastepcow: bladNastepcow,
      czas_ms: Date.now() - start, ok: true, error: null,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Radar wygasających umów: przeliczenie nie powiodło się');
    stan = { zakonczony_o: new Date().toISOString(), od, do: doDnia, czas_ms: Date.now() - start, ok: false, error: err.message };
  }
  await magazyn.zapiszPrzebieg(stan).catch((err) => logger.error({ err: err.message }, 'Radar umów: nie zapisano śladu przebiegu'));
  return stan;
}
