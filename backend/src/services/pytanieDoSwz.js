import { logger } from '../lib/logger.js';
import { costUsd } from '../lib/pricing.js';
import { aiUsage } from '../db/repos.js';
import { aiBudgetAllows, zarezerwujLimitAiUzytkownika } from './ai.js';
import { serviceUnavailable } from '../lib/errors.js';
import { env } from '../config/env.js';
import { klientAnthropic } from './analizaSwz.js';

/*
 * PYTANIE DO SWZ Z CYTATEM (2026-10-31, z analizy konkurencji: Mimira, Radar Przetargów, Tendium; SEZAM
 * oznacza wnioski bez pokrycia jako „nieudowodnione”). Wykonawca pyta wprost („czy wymagają ISO?”,
 * „ile referencji?”, „czy jest wadium?”) zamiast czytać 80 stron. Odpowiedź ma być WIARYGODNA:
 *  • model dostaje tylko fragmenty SWZ najbliższe pytaniu (koszt) i ma odpowiadać wyłącznie z nich,
 *  • każdy cytat, który zwróci, SPRAWDZAMY deterministycznie w treści SWZ — model nie może „zacytować”
 *    czegoś, czego tam nie ma; bez potwierdzonego cytatu status = „nieudowodnione”,
 *  • „brak_w_swz”, gdy model uczciwie mówi, że SWZ tego nie rozstrzyga.
 * Bramki kosztu jak w analizie SWZ: wspólny budżet AI (503) i dobowy limit użytkownika (429).
 */
export const OPERACJA = 'swz_pytanie';
export const MAKS_ZNAKOW_KONTEKSTU = 24_000;
export const DLUGOSC_FRAGMENTU = 1_200;

const MODEL = () => env.AI_MATCH_MODEL;

const bezOgonkow = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
/** Normalizacja do porównań: małe litery, bez ogonków, cudzysłowów i różnic w odstępach. */
export function normTekst(s) {
  return bezOgonkow(s).toLowerCase().replace(/[„”"'’`«»]/g, '').replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim();
}

const SLOWA_POMIJANE = new Set(['czy', 'jak', 'jaki', 'jaka', 'jakie', 'ile', 'kiedy', 'gdzie', 'oraz', 'albo', 'jest', 'sa', 'trzeba', 'musze', 'wymagaja', 'wymagane', 'nalezy', 'ktore', 'ktory', 'ktora', 'dla', 'przez', 'przy', 'tego', 'tej', 'ten', 'swz', 'zamawiajacy', 'wykonawca', 'oferta', 'oferty']);
const rdzen = (w) => (w.length > 6 ? w.slice(0, 6) : w);
const slowaPytania = (pytanie) => [...new Set(normTekst(pytanie).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SLOWA_POMIJANE.has(w)).map(rdzen))];

/**
 * Fragmenty SWZ najbliższe pytaniu (w kolejności z dokumentu), łącznie ≤ limit znaków.
 * Krótka SWZ idzie w całości. Bez trafień — początek dokumentu (zwykle informacje ogólne).
 */
export function fragmentyDlaPytania(tresc, pytanie, { limit = MAKS_ZNAKOW_KONTEKSTU, dlugosc = DLUGOSC_FRAGMENTU } = {}) {
  const tekst = String(tresc ?? '');
  if (tekst.length <= limit) return tekst;
  const slowa = slowaPytania(pytanie);
  const kawalki = [];
  for (let i = 0; i < tekst.length; i += dlugosc) kawalki.push({ i, tekst: tekst.slice(i, i + dlugosc + 200) });
  const ocenione = kawalki.map((k) => {
    const n = normTekst(k.tekst);
    return { ...k, punkty: slowa.reduce((s, w) => s + (n.includes(w) ? 1 : 0), 0) };
  });
  const najlepsze = ocenione.filter((k) => k.punkty > 0).sort((a, b) => b.punkty - a.punkty || a.i - b.i);
  const wybrane = [];
  let suma = 0;
  for (const k of (najlepsze.length ? najlepsze : ocenione)) {
    if (suma + k.tekst.length > limit) break;
    wybrane.push(k);
    suma += k.tekst.length;
  }
  return wybrane.sort((a, b) => a.i - b.i).map((k) => k.tekst.trim()).join('\n[…]\n');
}

/** Cytaty modelu → potwierdzone (dosłownie w SWZ po normalizacji) albo nie. */
export function zweryfikujCytaty(cytaty, tresc) {
  const caly = normTekst(tresc);
  return (Array.isArray(cytaty) ? cytaty : [])
    .map((c) => String(c ?? '').trim())
    .filter((c) => c.length >= 8)
    .slice(0, 4)
    .map((tekst) => ({ tekst: tekst.slice(0, 600), potwierdzony: caly.includes(normTekst(tekst)) }));
}

/** Odpowiedź modelu (JSON w tekście) → pola; nieczytelna → null. */
export function parsujOdpowiedz(tekst) {
  const m = String(tekst ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    if (typeof d.odpowiedz !== 'string' || !d.odpowiedz.trim()) return null;
    return { odpowiedz: d.odpowiedz.trim().slice(0, 2000), cytaty: Array.isArray(d.cytaty) ? d.cytaty : [], brak_w_swz: d.brak_w_swz === true };
  } catch {
    return null;
  }
}

const SYSTEM = `Jesteś asystentem wykonawcy w polskim przetargu publicznym. Odpowiadasz na pytanie WYŁĄCZNIE na podstawie podanych fragmentów SWZ.
Zasady:
- Nie zgaduj i nie korzystaj z wiedzy spoza fragmentów. Jeśli fragmenty nie rozstrzygają pytania, ustaw "brak_w_swz": true i napisz krótko, czego brakuje.
- Do każdej odpowiedzi podaj 1–3 cytaty skopiowane DOSŁOWNIE z fragmentów (bez zmian słów i interpunkcji), które ją uzasadniają.
- Odpowiedź po polsku, konkretnie, maks. 5 zdań; kwoty, terminy i liczby przepisz dokładnie.
Zwróć tylko JSON: {"odpowiedz": "...", "cytaty": ["..."], "brak_w_swz": false}`;

/**
 * @param {{tresc: string, pytanie: string}} wejscie
 * @returns {Promise<{odpowiedz: string, status: 'potwierdzone'|'nieudowodnione'|'brak_w_swz', cytaty: {tekst: string, potwierdzony: boolean}[]}>}
 */
export async function zapytajSwz({ tresc, pytanie }) {
  const klient = klientAnthropic();
  if (!klient) throw serviceUnavailable('Pytania do SWZ niedostępne — brak konfiguracji AI (Anthropic).');
  if (!aiBudgetAllows(OPERACJA)) throw serviceUnavailable('Miesięczny budżet AI wyczerpany — pytania do SWZ chwilowo niedostępne.');
  zarezerwujLimitAiUzytkownika(OPERACJA);

  const fragmenty = fragmentyDlaPytania(tresc, pytanie);
  let resp;
  try {
    resp = await klient.messages.create({
      model: MODEL(),
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `PYTANIE: ${pytanie}\n\nFRAGMENTY SWZ:\n${fragmenty}` }],
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Pytanie do SWZ — wywołanie AI nie powiodło się');
    throw serviceUnavailable('Pytanie do SWZ chwilowo niedostępne — spróbuj ponownie za chwilę.');
  }
  const wejscie = resp.usage?.input_tokens ?? 0;
  const wyjscie = resp.usage?.output_tokens ?? 0;
  try {
    aiUsage.record({ operation: OPERACJA, model: MODEL(), inputTokens: wejscie, outputTokens: wyjscie, costUsd: costUsd(MODEL(), wejscie, wyjscie) });
  } catch (err) {
    logger.warn({ err: err.message }, 'pytanieDoSwz: księgowanie kosztu nie powiodło się');
  }

  const tekst = (resp.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const d = parsujOdpowiedz(tekst);
  if (!d) throw serviceUnavailable('Model zwrócił nieczytelną odpowiedź — spróbuj zadać pytanie inaczej.');
  const cytaty = zweryfikujCytaty(d.cytaty, tresc);
  const status = d.brak_w_swz ? 'brak_w_swz' : (cytaty.some((c) => c.potwierdzony) ? 'potwierdzone' : 'nieudowodnione');
  return { odpowiedz: d.odpowiedz, status, cytaty };
}
