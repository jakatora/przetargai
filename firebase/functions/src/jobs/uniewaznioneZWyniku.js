import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders, rozstrzygniecia } from '../db/repos.js';

/*
 * UNIEWAŻNIENIE Z OGŁOSZENIA O WYNIKU (2026-11-01). Anulowanie oznaczała tylko Baza Konkurencyjności — przetarg
 * BZP/TED, którego wynik mówi „wszystkie części unieważnione”, zostawał „otwarty”: wisiał w feedzie, katalogu
 * i selekcji, a Zapisane przypominały o terminie. 1.11 na prod 10 otwartych przetargów miało już taki wynik
 * (np. dostawa gazu, kredyt dla gminy). `tenders.oznaczAnulowany` = poza pulą i katalogiem, przypomnienia wyłączone
 * w kopiach, wpis „anulowanie” w historii (alerty zapisanych wyszukiwań). Przetarg z większą liczbą części niż
 * w wyniku zostaje — wynik mógł objąć tylko część postępowania.
 *   • w `wynikiOknoFetch`: wyniki z tego przebiegu,
 *   • `/admin/uniewaznione`: zapisane rozstrzygnięcia z `dni` (uzupełnienie wstecz).
 */
const wszystkieUniewaznione = (w) => Array.isArray(w?.czesci) && w.czesci.length > 0 && w.czesci.every((c) => c?.uniewaznione);

export async function runUniewaznioneZWyniku({
  wyniki = null, dni = 60, teraz = Date.now(), przetargi = tenders, repoWynikow = rozstrzygniecia,
} = {}) {
  const wynik = { ok: true, wynikow_uniewaznionych: 0, przetargow: 0, oznaczone: 0, pominiete_czesci: 0, bledy: 0 };
  const poPostepowaniu = new Map();
  const dodaj = (w) => {
    const pid = w?.postepowanie_id ?? w?.tenderId;
    if (pid && wszystkieUniewaznione(w)) poPostepowaniu.set(String(pid), w.czesci.length);
  };
  if (wyniki) {
    wyniki.forEach(dodaj);
  } else {
    const od = new Date(teraz - dni * 86_400_000).toISOString().slice(0, 10);
    let kursor = null;
    for (let i = 0; i < 200; i++) {
      const strona = await repoWynikow.strona({ od, kursor, limit: 1000, pola: ['postepowanie_id', 'czesci'] });
      strona.pozycje.forEach(dodaj);
      if (strona.koniec || !strona.kursor) break;
      kursor = strona.kursor;
    }
  }
  wynik.wynikow_uniewaznionych = poPostepowaniu.size;
  for (const [pid, czesciWyniku] of poPostepowaniu) {
    try {
      for (const t of await przetargi.przetargiPostepowania(pid)) {
        if (t.anulowany === true) continue;
        wynik.przetargow += 1;
        if (Number(t.liczba_czesci) > czesciWyniku) { wynik.pominiete_czesci += 1; continue; }
        if (await przetargi.oznaczAnulowany(t.id, { powod: 'uniewaznienie_w_wyniku' })) wynik.oznaczone += 1;
      }
    } catch (err) {
      wynik.bledy += 1;
      logger.warn({ err: err.message, pid }, 'Unieważnienie z wyniku: postępowanie pominięte');
    }
  }
  wynik.ok = wynik.bledy === 0;
  wynik.zakonczony_o = nowIso();
  logger.info(wynik, 'runUniewaznioneZWyniku: zakończono');
  return wynik;
}
