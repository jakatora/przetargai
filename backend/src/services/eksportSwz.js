import { AppError } from '../lib/errors.js';
import { opisZrodla, mapaStron } from '../lib/zrodlaSwz.js';

export function tekstCytatu(cytat) {
  if (!cytat) return 'Brak potwierdzonego fragmentu źródła.';
  const z = cytat.zrodlo ?? {};
  return [
    `„${cytat.tekst}”`,
    `${cytat.potwierdzony ? 'Cytat potwierdzony' : 'Fragment niepotwierdzony'}; ${z.rodzaj === 'pierwsza_analiza' ? 'pierwsza analiza (może zawierać tylko fragmenty SWZ)' : z.numer ? `wersja ${z.numer}` : 'treść analizy'}`,
    cytat.strona ? `strona ${cytat.strona}` : 'numer strony niedostępny',
    cytat.linia ? `linia ${cytat.linia}` : null,
    z.url, z.hash ? `SHA256: ${z.hash}` : null,
  ].filter(Boolean).join('\n');
}

/** Eksport wyłącznie z istniejących danych; nie wywołuje modelu ani nie wysyła maili. */
export function zbudujEksportSwz({ postepowanie, wersje, pytania, zmiany, wymagania, teraz = new Date().toISOString() }, { maksBajtow = 20 * 1024 * 1024 } = {}) {
  const dane = {
    format: 'przetargai-swz-1', wyeksportowano: teraz,
    postepowanie: { id: postepowanie.id, nazwa: postepowanie.nazwa, data_ogloszenia: postepowanie.data_ogloszenia, termin_skladania_ofert: postepowanie.termin_skladania_ofert },
    wersje: wersje.map((w) => ({ ...opisZrodla(w), tresc: w.tresc ?? null, strony: mapaStron(w.strony, w.tresc) })),
    pytania, zmiany, wymagania,
  };
  const tekst = [
    'PrzetargAI — historia SWZ', postepowanie.nazwa, `Eksport: ${teraz}`,
    'Treść pierwszej analizy jest odrębnym źródłem i może zawierać tylko fragmenty SWZ. Brak numeru strony oznacza, że aplikacja nie ma mapy stron tego źródła.',
    '\nWERSJE I ŹRÓDŁA',
    ...dane.wersje.map((w) => [w.rodzaj === 'pierwsza_analiza' ? 'Pierwsza analiza' : `Wersja ${w.numer}`, w.data, w.url, `SHA256: ${w.hash}`, w.tresc ?? '(brak zapisanej treści)'].filter(Boolean).join('\n')),
    '\nZMIANY',
    ...zmiany.map((z) => [z.data_publikacji, z.opis_skutku, z.diff, ...(z.porownanie?.cytaty ?? []).map(tekstCytatu), z.porownanie?.pominiete ? `Dalszych linii zmiany bez osobnych odnośników: ${z.porownanie.pominiete}; pełna różnica powyżej.` : null].filter(Boolean).join('\n')),
    '\nWYMAGANIA DOKUMENTÓW (POMOCNICZA LISTA Z PARSERA)',
    ...wymagania.map((w) => `${w.nazwa}\n${tekstCytatu(w.cytat)}`),
    '\nPYTANIA',
    ...pytania.map((p) => `${p.status}: ${p.tresc}\n${p.zrodlo ? tekstCytatu(p.zrodlo) : `Starsze pytanie — źródło nie zostało zweryfikowane. ${p.fragment_swz ?? ''}`}`),
  ].join('\n\n');
  const json = JSON.stringify(dane, null, 2);
  // Ograniczamy również opakowanie JSON transportowane przez most Cloud Functions.
  if ([tekst, json].some((tresc) => Buffer.byteLength(JSON.stringify({ tresc })) > maksBajtow)) throw new AppError(413, 'EKSPORT_ZA_DUZY', 'Historia SWZ przekracza limit 20 MB — skontaktuj się z obsługą, aby otrzymać pełne archiwum.');
  const nazwa = `PrzetargAI-SWZ-${postepowanie.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60)}`;
  return { nazwa, tekst, json };
}
