import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { tenders, rozstrzygniecia } from '../db/repos.js';

/*
 * UNIEWAŻNIENIE Z OGŁOSZENIA O WYNIKU (2026-11-01). Anulowanie oznaczała tylko Baza Konkurencyjności — przetarg
 * BZP/TED, którego wynik mówi „wszystkie części unieważnione”, zostawał „otwarty”: wisiał w feedzie, katalogu
 * i selekcji, a Zapisane przypominały o terminie. `tenders.oznaczAnulowany` = poza pulą i katalogiem, przypomnienia
 * wyłączone w kopiach, wpis „anulowanie” w historii (alerty zapisanych wyszukiwań).
 *
 * 🚨 FAŁSZYWE UNIEWAŻNIENIE JEST GORSZE NIŻ BRAK: przetarg znika, choć przyjmuje oferty. Pierwsza wersja (1.11)
 * brała jeden wynik i nieznaną liczbę części za „całość” — wynik TED dla jednej z czterech części anulował cały
 * przetarg (929 z 942 oznaczonych miało nieznaną liczbę części; cofnięte). Teraz oznaczamy tylko, gdy:
 *   • WSZYSTKIE wyniki postępowania (nie tylko z tego przebiegu) mają wyłącznie unieważnione części,
 *   • liczba części przetargu jest ZNANA (BZP: `liczba_czesci`; TED: terminy części w `raw_data`) i wyniki
 *     obejmują co najmniej tyle różnych części,
 *   • przetarg opublikowano nie później niż pierwszy wynik (ponowne ogłoszenie z tym samym identyfikatorem zostaje).
 *   • w `wynikiOknoFetch`: postępowania z wyników tego przebiegu, `/admin/uniewaznione`: z rozstrzygnięć z `dni`.
 */
const wszystkieUniewaznione = (w) => Array.isArray(w?.czesci) && w.czesci.length > 0 && w.czesci.every((c) => c?.uniewaznione);

/** Liczba części przetargu albo null (nie wiemy). TED: jeden termin na część w zapisanych polach ogłoszenia. */
export function liczbaCzesciPrzetargu(t) {
  const n = Number(t?.liczba_czesci);
  if (Number.isInteger(n) && n > 0) return n;
  if (t?.source !== 'ted' || typeof t.raw_data !== 'string') return null;
  try {
    const terminy = JSON.parse(t.raw_data)?.['deadline-receipt-tender-date-lot'];
    return Array.isArray(terminy) && terminy.length ? terminy.length : null;
  } catch {
    return null;
  }
}

/**
 * Czy przetarg jest na pewno unieważniony w całości.
 * @param {object} t przetarg (`liczba_czesci`, `source`, `raw_data`, `published_at`)
 * @param {{czesci: {numer?: number, uniewaznione?: boolean}[], opublikowano?: string}[]} wynikiPostepowania
 */
export function pewnieUniewazniony(t, wynikiPostepowania) {
  const wyniki = (wynikiPostepowania ?? []).filter((w) => Array.isArray(w?.czesci) && w.czesci.length);
  if (!wyniki.length || !wyniki.every(wszystkieUniewaznione)) return false;
  const czesci = liczbaCzesciPrzetargu(t);
  if (!czesci) return false;
  const numery = new Set(wyniki.flatMap((w) => w.czesci.map((c, i) => c?.numer ?? i + 1)));
  if (numery.size < czesci) return false;
  const pierwszyWynik = wyniki.map((w) => String(w.opublikowano ?? '').slice(0, 10)).filter(Boolean).sort()[0];
  const opublikowano = String(t?.published_at ?? '').slice(0, 10);
  return !(pierwszyWynik && opublikowano && opublikowano > pierwszyWynik);
}

export async function runUniewaznioneZWyniku({
  wyniki = null, dni = 60, teraz = Date.now(), przetargi = tenders, repoWynikow = rozstrzygniecia,
} = {}) {
  const wynik = { ok: true, postepowan: 0, przetargow: 0, oznaczone: 0, niepewne: 0, bledy: 0 };
  const kandydaci = new Set();
  const dodaj = (w) => {
    const pid = w?.postepowanie_id ?? w?.tenderId;
    if (pid && wszystkieUniewaznione(w)) kandydaci.add(String(pid));
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
  wynik.postepowan = kandydaci.size;
  for (const pid of kandydaci) {
    try {
      const lista = (await przetargi.przetargiPostepowania(pid)).filter((t) => t.anulowany !== true);
      if (!lista.length) continue;
      const wszystkieWyniki = await repoWynikow.wszystkieDlaPostepowania(pid);
      for (const t of lista) {
        wynik.przetargow += 1;
        if (!pewnieUniewazniony(t, wszystkieWyniki)) { wynik.niepewne += 1; continue; }
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
