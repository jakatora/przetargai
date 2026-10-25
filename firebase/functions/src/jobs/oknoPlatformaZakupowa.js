import { logger } from '../lib/logger.js';
import { oknoPz as repoOkna, tenders } from '../db/repos.js';
import { pustyLicznik } from '../lib/licznikZrodla.js';
import { ZRODLO, POZYCJI_NA_STRONE, pobierzStrone, normalizujOgloszeniePz } from '../services/platformaZakupowa.js';

/*
 * OKNO PLATFORMAZAKUPOWA.PL (2026-10-25). Co godzinę 2 strony listy po 100 pozycji; kursor
 * strony w checkpoincie (`_health/pz_okno`), więc kolejne przebiegi obchodzą całą listę
 * (~48 stron) i wracają na początek. `tenders.upsert` jest create-only — dla istniejących
 * ogłoszeń termin (lista jest sortowana po terminie, więc zmiany terminu są częste)
 * dociąga `zaktualizujZeZrodla`. Idempotentne: docId = `pz:<id>`.
 */
export const STRON_NA_PRZEBIEG = 2;
export const ODSTEP_MIEDZY_STRONAMI_MS = 2_000;

/** Czysta decyzja: które strony pobrać w tym przebiegu i jaki kursor zapisać po nim. */
export function planStron({ checkpoint, stronNaPrzebieg = STRON_NA_PRZEBIEG }) {
  const start = Math.max(1, Number(checkpoint?.nastepna_strona) || 1);
  return Array.from({ length: stronNaPrzebieg }, (_, i) => start + i);
}

export function kursorPo({ strony, ostatniaPelna }) {
  // Strona niepełna = koniec listy → od nowa od 1; inaczej jedziemy dalej.
  return ostatniaPelna ? strony[strony.length - 1] + 1 : 1;
}

export async function runOknoPz({
  fetchFn = fetch, teraz = () => new Date().toISOString(), stronNaPrzebieg = STRON_NA_PRZEBIEG, odstepMs = ODSTEP_MIEDZY_STRONAMI_MS, czekaj = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const start = Date.now();
  const licznik = pustyLicznik();
  const wynik = { ok: true, zrodlo: ZRODLO, strony: [], nowe: 0, zaktualizowane: 0, bez_zmian: 0, bledy_zapisu: 0, ...licznik };
  const checkpoint = await repoOkna.wczytaj().catch((err) => {
    logger.error({ err: err.message }, 'platformazakupowa: nie udało się wczytać checkpointu');
    return null;
  });
  const strony = planStron({ checkpoint, stronNaPrzebieg });
  let ostatniaPelna = true;
  try {
    for (let i = 0; i < strony.length; i++) {
      const strona = strony[i];
      if (i > 0 && odstepMs > 0) await czekaj(odstepMs);
      licznik.zapytania++;
      const { pozycje, odrzucone } = await pobierzStrone(strona, { fetchFn });
      licznik.surowe += pozycje.length + odrzucone;
      licznik.odrzucone += odrzucone;
      wynik.strony.push(strona);
      for (const poz of pozycje) {
        const t = normalizujOgloszeniePz(poz);
        if (!t) { licznik.odrzucone++; continue; }
        try {
          const { created, tender } = await tenders.upsert(t);
          if (created) { wynik.nowe++; continue; }
          if (t.deadline && tender?.deadline !== t.deadline) {
            await tenders.zaktualizujZeZrodla({ externalId: t.externalId, title: t.title, organization: t.organization, deadline: t.deadline, url: t.url });
            wynik.zaktualizowane++;
          } else {
            wynik.bez_zmian++;
          }
        } catch (err) {
          wynik.bledy_zapisu++;
          logger.warn({ err: err.message, id: poz.id }, 'platformazakupowa: zapis ogłoszenia nie powiódł się');
        }
      }
      if (pozycje.length < POZYCJI_NA_STRONE) { ostatniaPelna = false; break; }
    }
  } catch (err) {
    wynik.ok = false;
    wynik.error = err.message;
    logger.error({ err: err.message, strony: wynik.strony }, 'platformazakupowa: okno przerwane');
  }
  const koniec = teraz();
  Object.assign(wynik, licznik, { nastepna_strona: wynik.ok ? kursorPo({ strony: wynik.strony.length ? wynik.strony : strony, ostatniaPelna }) : strony[0], durationMs: Date.now() - start, o: koniec, zakonczony_o: koniec });
  await repoOkna.zapisz({ nastepna_strona: wynik.nastepna_strona }).catch((err) => logger.error({ err: err.message }, 'platformazakupowa: zapis kursora nie powiódł się'));
  await repoOkna.zapiszPrzebieg(wynik).catch((err) => logger.error({ err: err.message }, 'platformazakupowa: zapis śladu przebiegu nie powiódł się'));
  return wynik;
}
