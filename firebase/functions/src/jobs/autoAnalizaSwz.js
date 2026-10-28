import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { planEfektywny } from '../lib/plan.js';
import { poczatekDobyWarszawskiej } from '../lib/czasPolski.js';
import { users, matches, tenders, powiazaniaSwz, autoSwz, alerty } from '../db/repos.js';
import { terminPytan } from '../lib/przypomnieniePytan.js';
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
/*
 * Analiza AI dłuższej SWZ trwa ponad domyślne 30 s mostu — pierwszy przebieg na produkcji (28.10) skończył
 * 3 z 4 analiz na „aborted due to timeout”, choć backend dostał żądanie i liczył dalej (koszt poniesiony,
 * postępowanie bez powiązania). Dla analizy limit 240 s; przebieg pilnuje budżetu czasu przed każdą pozycją.
 */
export const LIMIT_ANALIZY_MS = 240_000;

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

  let analiza;
  try {
    analiza = await modul(user, { metoda: 'POST', sciezka: `/swz/postepowania/${postepowanieId}/analiza`, dane: { swz_pdf_base64: pdf }, limitMs: LIMIT_ANALIZY_MS });
  } catch (err) {
    // Zerwanie/limit czasu PO wysłaniu: backend zapisał treść SWZ przed AI i najpewniej dokończy analizę —
    // wiążemy postępowanie (checklista i plan już z niego korzystają), żeby koszt nie poszedł na marne.
    await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: tender.title ?? null });
    return { status: 'tresc_bez_analizy', postepowanie_id: postepowanieId, blad: `analiza AI: ${err.message}` };
  }
  // 400 = PDF bez warstwy tekstowej / za długi — backend NIE zapisał treści: bez powiązania (pusta analiza
  // tylko by myliła). Inne wyniki (201, 429 limit, 503 budżet/AI) — treść SWZ zapisana przed AI, więc
  // checklista i plan działania z niej korzystają: wiążemy i zapisujemy, czy pytania powstały.
  if (analiza.status === 400 || analiza.status === 413) return { status: 'nieczytelny_pdf', postepowanie_id: postepowanieId, blad: analiza.dane?.error?.message ?? `HTTP ${analiza.status}` };
  await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: tender.title ?? null });
  return analiza.status === 201
    ? { status: 'gotowe', postepowanie_id: postepowanieId, liczba_pytan: Number(analiza.dane?.liczba ?? 0) }
    : { status: 'tresc_bez_analizy', postepowanie_id: postepowanieId, blad: `analiza AI: HTTP ${analiza.status}` };
}

/**
 * Naprawa po limicie czasu z pierwszego przebiegu (28.10): backend założył postępowanie i liczył analizę,
 * a my zapisaliśmy „blad” bez powiązania. Szukamy postępowania o nazwie przetargu na liście klienta
 * (GET — bez płatnego AI) i wiążemy je. Jedna próba na znacznik (`naprawa_o`).
 */
export async function naprawPoLimicie(user, tender, { modul = wywolajModulPrzetargowy, teraz = nowIso() } = {}) {
  const lista = await modul(user, { metoda: 'GET', sciezka: '/swz/postepowania' });
  const nazwa = String(tender.title ?? 'Przetarg').slice(0, 300);
  const kandydaci = lista.status === 200 ? (lista.dane?.postepowania ?? []).filter((p) => p?.nazwa === nazwa && p?.id) : [];
  const p = kandydaci[kandydaci.length - 1] ?? null;
  if (!p) {
    await autoSwz.zakoncz(user.id, tender.id, { status: 'blad', blad: 'limit czasu; postępowania nie odnaleziono', naprawa_o: teraz, teraz });
    return false;
  }
  await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId: p.id, nazwa: tender.title ?? null });
  const pytan = Number(p.liczba_pytan ?? 0);
  await autoSwz.zakoncz(user.id, tender.id, { status: pytan > 0 ? 'gotowe' : 'tresc_bez_analizy', postepowanie_id: String(p.id), liczba_pytan: pytan, naprawa_o: teraz, teraz });
  return true;
}

/**
 * Alert w Centrum (2026-10-29): analiza utworzyła szkice pytań do zamawiającego, a pytania do SWZ mają
 * ustawowy termin — klient musi się o tym dowiedzieć bez otwierania przetargu. Tylko gdy są pytania.
 * Bez pushu (cisza nocna i nadmiar powiadomień); przypomnienie w ostatniej dobie robi osobne zadanie.
 * Idempotencja: klucz `auto-swz-<tender>` (create).
 */
export function alertAnalizy(tender, liczbaPytan, teraz) {
  if (!(liczbaPytan > 0)) return null;
  const termin = terminPytan({ id: tender.id, source: tender.source, deadline: tender.deadline }, teraz);
  const kiedy = termin?.lokalnie?.etykieta && !termin.minal ? termin.lokalnie.etykieta : null;
  const tytul = String(tender.title ?? 'Przetarg');
  return {
    klucz: `auto-swz-${tender.id}`,
    typ: 'auto_swz',
    tender_id: tender.id,
    tytul: { pl: 'SWZ przeanalizowana — są pytania do zamawiającego', en: 'Tender documents analysed — questions for the buyer' },
    tresc: {
      pl: `${liczbaPytan} szkiców pytań do „${tytul}”.${kiedy ? ` Pytania można zadać do ${kiedy}.` : ''} Sprawdź je w Radarze SWZ.`,
      en: `${liczbaPytan} draft questions for “${tytul}”.${kiedy ? ` Questions can be asked until ${kiedy}.` : ''} Review them in the tender-document radar.`,
    },
    pozycje: [{ tender_id: tender.id, tytul, organizacja: tender.organization ?? null, deadline: tender.deadline ?? null, zrodlo: tender.source ?? 'bzp' }],
  };
}

export async function runAutoAnalizaSwz({
  teraz = nowIso(), maksNaPrzebieg = MAKS_NA_PRZEBIEG, maksNaKlientaDobe = MAKS_NA_KLIENTA_DOBE,
  wczytajUzytkownikow = () => users.all(), modul = wywolajModulPrzetargowy, pobierzPdf = pobierzPdfBase64, budzetMs = 480_000,
} = {}) {
  const start = Date.now();
  const wynik = { ok: true, klienci: 0, kandydaci: 0, analizy: 0, gotowe: 0, bez_analizy: 0, nieczytelne: 0, bledy: 0, naprawione: 0, pominiete_limit: 0, przerwane_budzetem: false };
  const odDoby = poczatekDobyWarszawskiej(teraz);
  const odWybranych = new Date(Date.parse(teraz) - OKNO_WYBRANYCH_MS).toISOString();
  try {
    const klienci = (await wczytajUzytkownikow()).filter((u) => planEfektywny(u, teraz) === 'standard');
    wynik.klienci = klienci.length;
    for (const user of klienci) {
      if (wynik.analizy >= maksNaPrzebieg) break;
      const wybrane = (await matches.wybraneOd(user.id, odWybranych)).filter((m) => m.tender_source === 'bzp');
      // Naprawy po limicie czasu nie kosztują AI i nie liczą się do limitów — przed nimi.
      for (const m of wybrane) {
        const z = await autoSwz.pobierz(user.id, m.tender_id);
        if (z?.status === 'blad' && /timeout|aborted/i.test(z.blad ?? '') && !z.naprawa_o && !await powiazaniaSwz.pobierz(user.id, m.tender_id)) {
          const t = await tenders.findById(m.tender_id);
          if (t && await naprawPoLimicie(user, t, { modul }).catch((err) => { logger.warn({ err: err.message, tender: m.tender_id }, 'Auto-SWZ: naprawa nie powiodła się'); return false; })) wynik.naprawione++;
        }
      }
      let zostalo = maksNaKlientaDobe - await autoSwz.ileOd(user.id, odDoby);
      if (zostalo <= 0) { wynik.pominiete_limit++; continue; }
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
        const alert = rezultat.status === 'gotowe' ? alertAnalizy(tender, rezultat.liczba_pytan, teraz) : null;
        if (alert) {
          await alerty.dodaj(user.id, alert, nowIso())
            .then(({ nowy }) => { if (nowy) wynik.alerty = (wynik.alerty ?? 0) + 1; })
            .catch((err) => logger.warn({ err: err.message, tender: tender.id }, 'Auto-SWZ: alert nie zapisany'));
        }
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
