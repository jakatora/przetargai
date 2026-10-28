import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { planEfektywny } from '../lib/plan.js';
import { poczatekDobyWarszawskiej } from '../lib/czasPolski.js';
import { users, matches, tenders, powiazaniaSwz, autoSwz } from '../db/repos.js';
import { czySwz } from '../services/eZamowieniaDokumenty.js';
import { wywolajModulPrzetargowy } from '../services/mostRailway.js';

/*
 * AUTOMATYCZNA ANALIZA SWZ (2026-10-28). Selekcja wybiera przetarg z BZP i dociąga z e-Zamówień listę
 * dokumentów — ale analizę specyfikacji klient musiał uruchomić sam w Radarze SWZ. Teraz dla klientów
 * planu Standard (także próby) to zadanie robi to za nich: pobiera PDF SWZ, zakłada postępowanie
 * w Radarze (backend Railway przez most), uruchamia analizę i wiąże ją z przetargiem. Plan działania
 * i checklista „Co musisz mieć do dnia składania” od razu korzystają z tej SWZ.
 *
 * Koszt (płatne AI na backendzie): tylko Standard; najwyżej MAKS_NA_KLIENTA_DOBE analiz na klienta
 * na dobę i MAKS_NA_PRZEBIEG na przebieg; backend ma własne bramki (miesięczny budżet wspólny → 503,
 * dobowy limit użytkownika → 429). Idempotencja: znacznik `users/{uid}/auto_swz/{tenderId}` tworzony
 * TRANSAKCYJNIE przed płatnym wywołaniem — ponowienie Schedulera ani druga instancja nie zdublują
 * analizy. Jedna próba na przetarg (porażka zostaje zapisana; klient może uruchomić Radar ręcznie).
 */
export const MAKS_NA_PRZEBIEG = 6;
export const MAKS_NA_KLIENTA_DOBE = 2;
export const OKNO_WYBRANYCH_MS = 48 * 3_600_000;
export const MAKS_BAJTOW_PDF = 5 * 1024 * 1024;
export const LIMIT_POBRANIA_MS = 25_000;

/** Najlepszy kandydat na SWZ: PDF z SWZ/specyfikacją, najpierw NIE „Załącznik… do SWZ”. */
export function wybierzSwz(dokumenty) {
  const kandydaci = (Array.isArray(dokumenty) ? dokumenty : []).filter((d) => d?.url && czySwz(d));
  const zalacznik = (d) => /za[lł][aą]cznik/i.test(`${d.nazwa ?? ''} ${d.plik ?? ''}`);
  return kandydaci.find((d) => !zalacznik(d)) ?? null;
}

/** Pobranie PDF-a SWZ (≤ 5 MB, nagłówek %PDF) → base64. */
export async function pobierzPdfBase64(url, { fetchFn = fetch, limitMs = LIMIT_POBRANIA_MS } = {}) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)', Accept: 'application/pdf' },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!res.ok) throw Object.assign(new Error(`Pobranie SWZ: HTTP ${res.status}`), { przejsciowy: res.status >= 500 || res.status === 429 });
  const bufor = Buffer.from(await res.arrayBuffer());
  if (bufor.length > MAKS_BAJTOW_PDF) throw Object.assign(new Error(`SWZ ma ${Math.round(bufor.length / 1048576)} MB — limit 5 MB`), { przejsciowy: false });
  if (bufor.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('Pobrany plik nie jest PDF-em'), { przejsciowy: false });
  return bufor.toString('base64');
}

/**
 * Analiza jednego przetargu dla jednego klienta. Zakłada, że znacznik jest już zajęty.
 * @returns {Promise<{status: string, postepowanie_id?: string, liczba_pytan?: number, blad?: string}>}
 */
export async function analizujDlaKlienta(user, tender, swz, { modul = wywolajModulPrzetargowy, pobierzPdf = pobierzPdfBase64 } = {}) {
  const pdf = await pobierzPdf(swz.url);
  const nowe = await modul(user, {
    metoda: 'POST', sciezka: '/swz/postepowania',
    dane: { nazwa: String(tender.title ?? 'Przetarg').slice(0, 300), ...(tender.deadline ? { termin_skladania_ofert: tender.deadline } : {}) },
  });
  const postepowanieId = nowe.dane?.postepowanie?.id;
  if (nowe.status !== 201 || !postepowanieId) return { status: 'blad', blad: `założenie postępowania: HTTP ${nowe.status}` };

  const analiza = await modul(user, { metoda: 'POST', sciezka: `/swz/postepowania/${postepowanieId}/analiza`, dane: { swz_pdf_base64: pdf } });
  // 400 = PDF bez warstwy tekstowej / za długi — backend NIE zapisał treści: bez powiązania (pusta analiza
  // tylko by myliła). Inne wyniki (201, 429 limit, 503 budżet/AI) — treść SWZ zapisana przed AI, więc
  // checklista i plan działania z niej korzystają: wiążemy i zapisujemy, czy pytania powstały.
  if (analiza.status === 400 || analiza.status === 413) return { status: 'nieczytelny_pdf', postepowanie_id: postepowanieId, blad: analiza.dane?.error?.message ?? `HTTP ${analiza.status}` };
  await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: tender.title ?? null });
  return analiza.status === 201
    ? { status: 'gotowe', postepowanie_id: postepowanieId, liczba_pytan: Number(analiza.dane?.liczba ?? 0) }
    : { status: 'tresc_bez_analizy', postepowanie_id: postepowanieId, blad: `analiza AI: HTTP ${analiza.status}` };
}

export async function runAutoAnalizaSwz({
  teraz = nowIso(), maksNaPrzebieg = MAKS_NA_PRZEBIEG, maksNaKlientaDobe = MAKS_NA_KLIENTA_DOBE,
  wczytajUzytkownikow = () => users.all(), modul = wywolajModulPrzetargowy, pobierzPdf = pobierzPdfBase64, budzetMs = 420_000,
} = {}) {
  const start = Date.now();
  const wynik = { ok: true, klienci: 0, kandydaci: 0, analizy: 0, gotowe: 0, bez_analizy: 0, nieczytelne: 0, bledy: 0, pominiete_limit: 0, przerwane_budzetem: false };
  const odDoby = poczatekDobyWarszawskiej(teraz);
  const odWybranych = new Date(Date.parse(teraz) - OKNO_WYBRANYCH_MS).toISOString();
  try {
    const klienci = (await wczytajUzytkownikow()).filter((u) => planEfektywny(u, teraz) === 'standard');
    wynik.klienci = klienci.length;
    for (const user of klienci) {
      if (wynik.analizy >= maksNaPrzebieg) break;
      let zostalo = maksNaKlientaDobe - await autoSwz.ileOd(user.id, odDoby);
      if (zostalo <= 0) { wynik.pominiete_limit++; continue; }
      const wybrane = (await matches.wybraneOd(user.id, odWybranych)).filter((m) => m.tender_source === 'bzp');
      for (const m of wybrane) {
        if (zostalo <= 0 || wynik.analizy >= maksNaPrzebieg) break;
        if (Date.now() - start > budzetMs) { wynik.przerwane_budzetem = true; break; }
        if (await autoSwz.pobierz(user.id, m.tender_id)) continue;
        if (await powiazaniaSwz.pobierz(user.id, m.tender_id)) continue;
        const tender = await tenders.findById(m.tender_id);
        const swz = wybierzSwz(tender?.ez_dokumenty);
        if (!swz) continue;
        wynik.kandydaci++;
        // Zajęcie PRZED płatnym wywołaniem — create() w transakcji: druga instancja dostaje false.
        if (!await autoSwz.zajmij(user.id, tender.id, { dokument: swz.id, teraz })) continue;
        wynik.analizy++;
        zostalo--;
        let rezultat;
        try {
          rezultat = await analizujDlaKlienta(user, tender, swz, { modul, pobierzPdf });
        } catch (err) {
          rezultat = { status: 'blad', blad: err.message };
        }
        if (rezultat.status === 'gotowe') wynik.gotowe++;
        else if (rezultat.status === 'tresc_bez_analizy') wynik.bez_analizy++;
        else if (rezultat.status === 'nieczytelny_pdf') wynik.nieczytelne++;
        else wynik.bledy++;
        await autoSwz.zakoncz(user.id, tender.id, { ...rezultat, teraz: nowIso() });
        logger.info({ uid: user.id, tender: tender.id, ...rezultat }, 'Auto-SWZ: przetarg przeanalizowany');
      }
    }
  } catch (err) {
    wynik.ok = false;
    wynik.error = err.message;
    logger.error({ err: err.message }, 'Auto-SWZ: przebieg przerwany');
  }
  Object.assign(wynik, { durationMs: Date.now() - start, zakonczony_o: nowIso() });
  await autoSwz.zapiszPrzebieg(wynik).catch((err) => logger.warn({ err: err.message }, 'Auto-SWZ: zapis śladu nie powiódł się'));
  return wynik;
}
