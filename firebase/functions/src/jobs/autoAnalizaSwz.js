import { logger } from '../lib/logger.js';
import { nowIso } from '../lib/ids.js';
import { planEfektywny } from '../lib/plan.js';
import { poczatekDobyWarszawskiej } from '../lib/czasPolski.js';
import { users, matches, tenders, powiazaniaSwz, autoSwz, alerty } from '../db/repos.js';
import { terminPytan } from '../lib/przypomnieniePytan.js';
import { czySwz } from '../services/eZamowieniaDokumenty.js';
import { wywolajModulPrzetargowy } from '../services/mostRailway.js';
import { liniePdf } from '../services/tekstPdf.js';
import { czytajDocx } from '../lib/kontrolaPlikowOferty.js';

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
/*
 * SWZ ponad 5 MB (2026-11-02: 1 z 31 analiz od 20.10 kończyła się „SWZ ma 16 MB — limit 5 MB”, a przetarg zostawał bez
 * analizy — próba jest jedna). Do 25 MB czytamy tekst TUTAJ (pdfjs) i wysyłamy go jako `swz`; backend przyjmuje tekst
 * do 2 mln znaków i 50 tys. linii, a do AI i tak idzie najwyżej 120 tys. znaków. Strony do cytatów przepadają — trudno.
 */
export const MAKS_BAJTOW_DUZEJ_SWZ = 25 * 1024 * 1024;
export const MAKS_ZNAKOW_SWZ_TEKSTEM = 400_000;
const MAKS_LINII_SWZ_TEKSTEM = 40_000;
export const LIMIT_POBRANIA_MS = 25_000;
/*
 * Analiza AI dłuższej SWZ trwa ponad domyślne 30 s mostu — pierwszy przebieg na produkcji (28.10) skończył
 * 3 z 4 analiz na „aborted due to timeout”, choć backend dostał żądanie i liczył dalej (koszt poniesiony,
 * postępowanie bez powiązania). Dla analizy limit 240 s; przebieg pilnuje budżetu czasu przed każdą pozycją.
 */
export const LIMIT_ANALIZY_MS = 240_000;

/*
 * Źródła plików (2026-10-29): e-Zamówienia (BZP) i platformazakupowa.pl — tam załączniki z publicznymi
 * linkami ma szczegół pobrany przez selekcję (`pz_szczegol.zalaczniki`; sonda: 23 z 40 ma SWZ w PDF).
 * Adres pliku pochodzi z cudzej strony, więc pobieramy WYŁĄCZNIE z tych domen.
 */
export const DOZWOLONE_HOSTY = /^https:\/\/([a-z0-9-]+\.)*(ezamowienia\.gov\.pl|platformazakupowa\.pl)\//i;
export const ZRODLA_AUTO_SWZ = new Set(['bzp', 'ted', 'platformazakupowa']);

/** Dokumenty przetargu w jednym kształcie (`nazwa`, `plik`, `rozszerzenie`, `url`, `rozmiar_kb?`). */
export function dokumentyPrzetargu(tender) {
  // TED (2026-11-01): ogłoszenia unijne z Polski — te same pliki z e-Zamówień (`idPostepowaniaEz`).
  if (tender?.source === 'bzp' || tender?.source === 'ted') return Array.isArray(tender.ez_dokumenty) ? tender.ez_dokumenty : [];
  if (tender?.source === 'platformazakupowa') {
    return (tender.pz_szczegol?.zalaczniki ?? []).filter((z) => z?.url).map((z) => {
      const nazwa = String(z.nazwa ?? '');
      const rozszerzenie = String(z.rozszerzenie ?? (nazwa.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '')).toLowerCase() || null;
      return { id: z.url, nazwa, plik: nazwa, rozszerzenie, url: z.url, rozmiar_kb: typeof z.rozmiar_kb === 'number' ? z.rozmiar_kb : null };
    });
  }
  return [];
}

const SWZ_UJEDNOLICONA = /po\s*zmian|ujednolicon|jednolit|zmienion\w*\s+(swz|siwz|specyfikacj)|(swz|siwz)\s*[-–_]?\s*zmienion|aktualn\w*\s+(swz|siwz|wersj)/i;
const PISMO_O_ZMIANIE = /^\s*(zmiana|zmiany|informacja|wyja[sś]nieni|pismo|modyfikacj|odpowied)/i;

/** Najlepszy kandydat na SWZ: PDF z SWZ/specyfikacją, najpierw NIE „Załącznik… do SWZ”. */
export function wybierzSwz(dokumenty) {
  const kandydaci = (Array.isArray(dokumenty) ? dokumenty : []).filter((d) => d?.url && DOZWOLONE_HOSTY.test(d.url) && czySwz(d)
    && !(typeof d.rozmiar_kb === 'number' && d.rozmiar_kb * 1024 > MAKS_BAJTOW_DUZEJ_SWZ));
  const zalacznik = (d) => /za[lł][aą]cznik/i.test(`${d.nazwa ?? ''} ${d.plik ?? ''}`);
  const maly = (d) => !(typeof d.rozmiar_kb === 'number' && d.rozmiar_kb * 1024 > MAKS_BAJTOW_PDF);
  // Wersja ujednolicona po zmianach (2026-11-02, 2026/BZP 00508332: analiza wzięła skan „SWZ” z 29.10, a obok była
  // „SWZ po zmianach” z 2.11 z tekstem) — najnowsza przed oryginałem. Pismo „Zmiana SWZ” to lista zmian, nie SWZ.
  const poZmianach = kandydaci
    .filter((d) => !zalacznik(d) && SWZ_UJEDNOLICONA.test(`${d.nazwa ?? ''} ${d.plik ?? ''}`) && !PISMO_O_ZMIANIE.test(String(d.nazwa ?? d.plik ?? '')))
    .sort((a, b) => String(b.opublikowano ?? '').localeCompare(String(a.opublikowano ?? '')));
  // Plik ≤ 5 MB idzie do backendu jako PDF (strony do cytatów); większy — czytany tekstem, gdy innego nie ma.
  return poZmianach.find(maly) ?? poZmianach[0] ?? kandydaci.find((d) => !zalacznik(d) && maly(d)) ?? kandydaci.find((d) => !zalacznik(d)) ?? null;
}

/*
 * WZÓR UMOWY W ANALIZIE (2026-11-02). Analiza AI na backendzie szuka też sprzeczności SWZ ↔ wzór umowy
 * (`backend/src/services/analizaSwz.js`), ale auto-SWZ wysyłało sam PDF SWZ — nie było z czym porównać. Pomiar 2.11:
 * 46 z 300 przetargów z listą e-Zamówień ma osobny wzór umowy / projektowane postanowienia w PDF albo .docx
 * (.doc i .zip nie czytamy). Pobieramy go obok SWZ i wysyłamy jako tekst (`umowa`); błąd = analiza bez umowy, jak dotąd.
 * Koszt: backend tnie łączną treść dokumentów do 120 tys. znaków, więc wywołanie AI nie rośnie ponad dotychczasowy sufit.
 * Tak samo PRZEDMIAR robót w PDF (11 z 92 przetargów z dokumentami; .zip i .xlsx nie czytamy) — sprzeczności SWZ ↔ przedmiar
 * (ilości, klasy materiału). Oba pliki pobierane równolegle.
 */
const WZOR_UMOWY = /wz[oó]r\w*\s+umow|projekt\w*\s+umow|projektowane\s+postanowienia|istotne\s+postanowienia|postanowienia\s+umow|\b[pi]pu\b|(^|[\s_.\-–])umowa($|[\s_.\-–])/i;
const NIE_WZOR = /zmian\w*\s+umow|aneks|do\s+umowy|rozwi[aą]zani/i;
export const MAKS_ZNAKOW_DOKUMENTU = 200_000;

const rozszerzenieDokumentu = (d) => String(d?.rozszerzenie ?? (String(d?.plik ?? d?.nazwa ?? '').match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '')).toLowerCase();

/** Wzór umowy (PDF albo .docx) z listy dokumentów — inny plik niż wybrana SWZ. */
export function wybierzUmowe(dokumenty, swz = null) {
  return (Array.isArray(dokumenty) ? dokumenty : []).find((d) => {
    const opis = `${d?.nazwa ?? ''} ${d?.plik ?? ''}`;
    return d?.url && d.url !== swz?.url && DOZWOLONE_HOSTY.test(d.url) && ['pdf', 'docx'].includes(rozszerzenieDokumentu(d))
      && WZOR_UMOWY.test(opis) && !NIE_WZOR.test(opis) && !(typeof d.rozmiar_kb === 'number' && d.rozmiar_kb * 1024 > MAKS_BAJTOW_PDF);
  }) ?? null;
}

/** Przedmiar robót w PDF — inny plik niż SWZ i wzór umowy. */
export function wybierzPrzedmiar(dokumenty, pominiete = []) {
  const zajete = new Set(pominiete.filter(Boolean).map((d) => d.url));
  return (Array.isArray(dokumenty) ? dokumenty : []).find((d) => d?.url && !zajete.has(d.url) && DOZWOLONE_HOSTY.test(d.url)
    && rozszerzenieDokumentu(d) === 'pdf' && /przedmiar/i.test(`${d?.nazwa ?? ''} ${d?.plik ?? ''}`)
    && !(typeof d.rozmiar_kb === 'number' && d.rozmiar_kb * 1024 > MAKS_BAJTOW_PDF)) ?? null;
}

/** Pobranie pliku zamawiającego (≤ 5 MB, tylko dozwolone hosty) → Buffer. */
async function pobierzPlik(url, { fetchFn = fetch, limitMs = LIMIT_POBRANIA_MS, etykieta = 'SWZ', accept = 'application/pdf', maksBajtow = MAKS_BAJTOW_PDF } = {}) {
  if (!DOZWOLONE_HOSTY.test(String(url ?? ''))) throw Object.assign(new Error(`Pobranie ${etykieta}: niedozwolony adres`), { przejsciowy: false });
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrzetargAI/1.0; +https://przetarg-ai.pl)', Accept: accept },
    signal: AbortSignal.timeout(limitMs),
  });
  if (!res.ok) throw Object.assign(new Error(`Pobranie ${etykieta}: HTTP ${res.status}`), { przejsciowy: res.status >= 500 || res.status === 429 });
  const bufor = Buffer.from(await res.arrayBuffer());
  if (bufor.length > maksBajtow) {
    throw Object.assign(new Error(`${etykieta} ma ${Math.round(bufor.length / 1048576)} MB — limit ${Math.round(maksBajtow / 1048576)} MB`), { przejsciowy: false, zaDuzy: true });
  }
  return bufor;
}

/** Pobranie PDF-a SWZ (≤ 5 MB, nagłówek %PDF) → base64. */
export async function pobierzPdfBase64(url, opcje = {}) {
  const bufor = await pobierzPlik(url, opcje);
  if (bufor.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('Pobrany plik nie jest PDF-em'), { przejsciowy: false });
  return bufor.toString('base64');
}

/** Tekst SWZ ponad 5 MB (do 25 MB, tylko PDF z warstwą tekstową); null = skan albo nie PDF. */
export async function tekstDuzejSwz(swz, { fetchFn = fetch, czytajPdf = liniePdf } = {}) {
  const bufor = await pobierzPlik(swz.url, { fetchFn, maksBajtow: MAKS_BAJTOW_DUZEJ_SWZ, limitMs: 60_000 });
  if (bufor.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  const tekst = (await czytajPdf(bufor)).slice(0, MAKS_LINII_SWZ_TEKSTEM).join('\n').slice(0, MAKS_ZNAKOW_SWZ_TEKSTEM);
  return tekst.trim() ? tekst : null;
}

/** Tekst dokumentu (PDF z warstwą tekstową albo .docx); null = pusty, skan albo inny format. */
export async function tekstDokumentu(dokument, { fetchFn = fetch, czytajPdf = liniePdf, etykieta = 'dokumentu' } = {}) {
  const bufor = await pobierzPlik(dokument.url, { fetchFn, etykieta, accept: '*/*' });
  let linie = null;
  if (bufor.subarray(0, 5).toString('latin1') === '%PDF-') linie = await czytajPdf(bufor);
  else if (bufor.length > 4 && bufor.readUInt32LE(0) === 0x04034b50) linie = czytajDocx(bufor).linie;
  const tekst = (linie ?? []).join('\n').slice(0, MAKS_ZNAKOW_DOKUMENTU);
  return tekst.trim() ? tekst : null;
}

/**
 * Analiza jednego przetargu dla jednego klienta. Zakłada, że znacznik jest już zajęty.
 * @returns {Promise<{status: string, postepowanie_id?: string, liczba_pytan?: number, blad?: string}>}
 */
export async function analizujDlaKlienta(user, tender, swz, {
  modul = wywolajModulPrzetargowy, pobierzPdf = pobierzPdfBase64, umowa = null, przedmiar = null, czytajDokument = tekstDokumentu,
  czytajDuzaSwz = tekstDuzejSwz,
} = {}) {
  let pdf = null;
  let swzTekstem = null;
  try {
    pdf = await pobierzPdf(swz.url);
  } catch (err) {
    if (!err.zaDuzy) throw err;
    swzTekstem = await czytajDuzaSwz(swz);
    if (!swzTekstem) return { status: 'nieczytelny_pdf', blad: `${err.message}; tekstu nie da się odczytać` };
  }
  const czytaj = (dok, etykieta) => (dok ? czytajDokument(dok, { etykieta }).catch((err) => {
    logger.warn({ err: err.message, tender: tender.id }, `Auto-SWZ: ${etykieta} nie został odczytany — analiza bez niego`);
    return null;
  }) : null);
  const [trescUmowy, trescPrzedmiaru] = await Promise.all([czytaj(umowa, 'wzór umowy'), czytaj(przedmiar, 'przedmiar')]);
  const nazwa = (d) => String(d.nazwa ?? d.plik ?? '').slice(0, 200);
  const zUmowa = {
    ...(trescUmowy ? { umowa: nazwa(umowa) } : {}), ...(trescPrzedmiaru ? { przedmiar: nazwa(przedmiar) } : {}), ...(swzTekstem ? { swz_tekstem: true } : {}),
  };
  const nowe = await modul(user, {
    metoda: 'POST', sciezka: '/swz/postepowania',
    dane: { nazwa: String(tender.title ?? 'Przetarg').slice(0, 300), ...(tender.deadline ? { termin_skladania_ofert: tender.deadline } : {}) },
  });
  const postepowanieId = nowe.dane?.postepowanie?.id;
  if (nowe.status !== 201 || !postepowanieId) return { status: 'blad', blad: `założenie postępowania: HTTP ${nowe.status}` };

  let analiza;
  try {
    analiza = await modul(user, { metoda: 'POST', sciezka: `/swz/postepowania/${postepowanieId}/analiza`, dane: {
      ...(pdf ? { swz_pdf_base64: pdf } : { swz: swzTekstem }),
      ...(trescUmowy ? { umowa: trescUmowy } : {}), ...(trescPrzedmiaru ? { przedmiar: trescPrzedmiaru } : {}),
    }, limitMs: LIMIT_ANALIZY_MS });
  } catch (err) {
    // Zerwanie/limit czasu PO wysłaniu: backend zapisał treść SWZ przed AI i najpewniej dokończy analizę —
    // wiążemy postępowanie (checklista i plan już z niego korzystają), żeby koszt nie poszedł na marne.
    await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: tender.title ?? null });
    return { status: 'tresc_bez_analizy', postepowanie_id: postepowanieId, blad: `analiza AI: ${err.message}`, ...zUmowa };
  }
  // 400 = PDF bez warstwy tekstowej / za długi — backend NIE zapisał treści: bez powiązania (pusta analiza
  // tylko by myliła). Inne wyniki (201, 429 limit, 503 budżet/AI) — treść SWZ zapisana przed AI, więc
  // checklista i plan działania z niej korzystają: wiążemy i zapisujemy, czy pytania powstały.
  if (analiza.status === 400 || analiza.status === 413) return { status: 'nieczytelny_pdf', postepowanie_id: postepowanieId, blad: analiza.dane?.error?.message ?? `HTTP ${analiza.status}` };
  await powiazaniaSwz.ustaw(user.id, tender.id, { postepowanieId, nazwa: tender.title ?? null });
  return analiza.status === 201
    ? { status: 'gotowe', postepowanie_id: postepowanieId, liczba_pytan: Number(analiza.dane?.liczba ?? 0), ...zUmowa }
    : { status: 'tresc_bez_analizy', postepowanie_id: postepowanieId, blad: `analiza AI: HTTP ${analiza.status}`, ...zUmowa };
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
  // Tytuły z BZP bywają już w cudzysłowie („…”) — bez tego treść miała podwójny „„.
  const wTresci = tytul.replace(/^[\s„"“”']+|[\s„"“”']+$/g, '') || tytul;
  return {
    klucz: `auto-swz-${tender.id}`,
    typ: 'auto_swz',
    tender_id: tender.id,
    tytul: { pl: 'SWZ przeanalizowana — są pytania do zamawiającego', en: 'Tender documents analysed — questions for the buyer' },
    tresc: {
      pl: `${liczbaPytan} szkiców pytań do „${wTresci}”.${kiedy ? ` Pytania można zadać do ${kiedy}.` : ''} Sprawdź je w Radarze SWZ.`,
      en: `${liczbaPytan} draft questions for “${wTresci}”.${kiedy ? ` Questions can be asked until ${kiedy}.` : ''} Review them in the tender-document radar.`,
    },
    pozycje: [{ tender_id: tender.id, tytul, organizacja: tender.organization ?? null, deadline: tender.deadline ?? null, zrodlo: tender.source ?? 'bzp' }],
  };
}

export async function runAutoAnalizaSwz({
  teraz = nowIso(), maksNaPrzebieg = MAKS_NA_PRZEBIEG, maksNaKlientaDobe = MAKS_NA_KLIENTA_DOBE,
  wczytajUzytkownikow = () => users.all(), modul = wywolajModulPrzetargowy, pobierzPdf = pobierzPdfBase64, czytajDokument = tekstDokumentu,
  czytajDuzaSwz = tekstDuzejSwz, budzetMs = 480_000,
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
      const wybrane = (await matches.wybraneOd(user.id, odWybranych)).filter((m) => ZRODLA_AUTO_SWZ.has(m.tender_source));
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
        const dokumenty = dokumentyPrzetargu(tender);
        const swz = wybierzSwz(dokumenty);
        if (!swz) continue;
        wynik.kandydaci++;
        // Zajęcie PRZED płatnym wywołaniem — create() w transakcji: druga instancja dostaje false.
        if (!await autoSwz.zajmij(user.id, tender.id, { dokument: swz.id, teraz })) continue;
        wynik.analizy++;
        zostalo--;
        let rezultat;
        try {
          const umowa = wybierzUmowe(dokumenty, swz);
          rezultat = await analizujDlaKlienta(user, tender, swz, {
            modul, pobierzPdf, umowa, przedmiar: wybierzPrzedmiar(dokumenty, [swz, umowa]), czytajDokument, czytajDuzaSwz,
          });
        } catch (err) {
          rezultat = { status: 'blad', blad: err.message };
        }
        if (rezultat.status === 'gotowe') wynik.gotowe++;
        else if (rezultat.status === 'tresc_bez_analizy') wynik.bez_analizy++;
        else if (rezultat.status === 'nieczytelny_pdf') wynik.nieczytelne++;
        else wynik.bledy++;
        if (rezultat.umowa) wynik.z_umowa = (wynik.z_umowa ?? 0) + 1;
        if (rezultat.przedmiar) wynik.z_przedmiarem = (wynik.z_przedmiarem ?? 0) + 1;
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
