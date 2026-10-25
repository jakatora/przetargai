import { logger } from '../lib/logger.js';
import { oknoEpp as repoOkna, tenders } from '../db/repos.js';
import { pustyLicznik } from '../lib/licznikZrodla.js';
import { kluczOgloszenia, PRIORYTET_ZRODEL } from '../lib/dedupZrodel.js';
import { ZRODLO, pobierzStrone, pobierzSzczegol, normalizujOgloszenieEpp } from '../services/eProPublico.js';

/*
 * OKNO E-PROPUBLICO (2026-10-25). Co 6 h cała lista (strona po stronie, aż do pustej; sufit 100),
 * z odstępem między żądaniami. Nowe ogłoszenie dostaje od razu szczegół (tryb, rodzaj, data
 * publikacji) — budżet szczegółów na przebieg chroni serwis przy pierwszym przejściu. Istniejące
 * dostają tylko aktualizację terminu (`zaktualizujZeZrodla`). Dedup z rejestrami wiodącymi jak
 * w oknie platformazakupowa: wpis BZP/TED/BK już obecny → link poboczny zamiast kopii.
 */
export const MAKS_STRON = 100;
export const MAKS_SZCZEGOLOW_NA_PRZEBIEG = 150;
export const ODSTEP_MS = 1_000;

export async function runOknoEpp({
  fetchFn = fetch, teraz = () => new Date().toISOString(), maksStron = MAKS_STRON, maksSzczegolow = MAKS_SZCZEGOLOW_NA_PRZEBIEG,
  odstepMs = ODSTEP_MS, czekaj = (ms) => new Promise((r) => setTimeout(r, ms)), budzetMs = 480_000,
} = {}) {
  const start = Date.now();
  const licznik = pustyLicznik();
  const wynik = { ok: true, zrodlo: ZRODLO, strony: 0, nowe: 0, zaktualizowane: 0, bez_zmian: 0, scalone_z_rejestrem: 0, szczegoly: 0, bledy_szczegolu: 0, bledy_zapisu: 0, ...licznik };
  let szczegolyPozostalo = maksSzczegolow;
  try {
    for (let strona = 1; strona <= maksStron; strona++) {
      if (Date.now() - start > budzetMs) { wynik.przerwane_budzetem = true; break; }
      if (strona > 1 && odstepMs > 0) await czekaj(odstepMs);
      licznik.zapytania++;
      const { pozycje, odrzucone } = await pobierzStrone(strona, { fetchFn });
      licznik.surowe += pozycje.length + odrzucone;
      licznik.odrzucone += odrzucone;
      if (!pozycje.length) break;
      wynik.strony = strona;
      const znormalizowane = pozycje.map((p) => normalizujOgloszenieEpp(p));
      const istniejace = await tenders.poKluczuDedup(znormalizowane.map((t) => (t ? kluczOgloszenia(t) : null)).filter(Boolean)).catch(() => new Map());
      for (const t of znormalizowane) {
        if (!t) { licznik.odrzucone++; continue; }
        const klucz = kluczOgloszenia(t);
        const wiodacy = klucz ? (istniejace.get(klucz) ?? []).find((d) => d.source !== ZRODLO && PRIORYTET_ZRODEL.indexOf(d.source) < PRIORYTET_ZRODEL.indexOf(ZRODLO)) : null;
        if (wiodacy) {
          try { await tenders.dodajZrodloAlternatywne(wiodacy.id, { source: ZRODLO, externalId: t.externalId, url: t.url }); wynik.scalone_z_rejestrem++; } catch (err) {
            logger.warn({ err: err.message, id: t.externalId }, 'e-ProPublico: dopisanie linku do rejestru wiodącego nie powiodło się');
          }
          continue;
        }
        try {
          const { created, tender } = await tenders.upsert(t);
          if (created) {
            wynik.nowe++;
            if (szczegolyPozostalo > 0) {
              szczegolyPozostalo--;
              if (odstepMs > 0) await czekaj(odstepMs);
              licznik.zapytania++;
              try {
                const sz = await pobierzSzczegol(t.externalId.replace(/^epp:/, ''), { fetchFn });
                // Termin z listy jest wiodący (ten sam, co na szczególe); szczegół uzupełnia go tylko, gdy lista nie podała.
                await tenders.uzupelnijZeSzczegolu(tender.id, { rodzaj: sz.rodzaj, publishedAt: sz.opublikowano, tryb_postepowania: sz.tryb, deadline: t.deadline ? undefined : sz.termin });
                wynik.szczegoly++;
              } catch (err) {
                wynik.bledy_szczegolu++;
                logger.warn({ err: err.message, id: t.externalId }, 'e-ProPublico: szczegół nie powiódł się');
              }
            }
            continue;
          }
          if (t.deadline && tender?.deadline !== t.deadline) {
            await tenders.zaktualizujZeZrodla({ externalId: t.externalId, title: t.title, organization: t.organization, deadline: t.deadline, url: t.url });
            wynik.zaktualizowane++;
          } else {
            wynik.bez_zmian++;
          }
        } catch (err) {
          wynik.bledy_zapisu++;
          logger.warn({ err: err.message, id: t.externalId }, 'e-ProPublico: zapis ogłoszenia nie powiódł się');
        }
      }
    }
  } catch (err) {
    wynik.ok = false;
    wynik.error = err.message;
    logger.error({ err: err.message, strony: wynik.strony }, 'e-ProPublico: okno przerwane');
  }
  const koniec = teraz();
  Object.assign(wynik, licznik, { durationMs: Date.now() - start, o: koniec, zakonczony_o: koniec });
  await repoOkna.zapiszPrzebieg(wynik).catch((err) => logger.error({ err: err.message }, 'e-ProPublico: zapis śladu przebiegu nie powiódł się'));
  return wynik;
}
