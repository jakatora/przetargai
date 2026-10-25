import { MAKS_BAJTOW_PLIKU_SWZ } from './plikBase64.js';

/*
 * ZAŁĄCZNIKI Z PLATFORMAZAKUPOWA.PL → RADAR SWZ JEDNYM DOTKNIĘCIEM (2026-10-25). Szczegół platformy
 * daje listę plików z linkami; zamiast kazać użytkownikowi pobrać SWZ i wgrać go do Radaru, apka
 * sama wybiera pliki wyglądające na specyfikację, a Radar po otwarciu dociąga PDF z linku.
 * Czysta logika: które załączniki to kandydaci na SWZ i jakie parametry dostaje Radar.
 */
const WZORZEC_SWZ = /\b(swz|siwz|specyfikacj|warunk[oó]w zam[oó]wienia|opz|opis przedmiotu)/i;
const DOMENA = /^https:\/\/([a-z0-9-]+\.)*platformazakupowa\.pl\//i;
export const MAKS_KANDYDATOW_SWZ = 3;

/** Czy link do pliku prowadzi na platformę (inne hosty odrzucamy — nie ściągamy z dowolnego adresu). */
export function linkPlatformy(url) {
  return typeof url === 'string' && DOMENA.test(url);
}

/**
 * Załączniki PDF wyglądające na SWZ, najpierw te z „SWZ/SIWZ” w nazwie, potem reszta
 * specyfikacji; do 5 MB (limit backendu), z linkiem na platformę. Najwyżej 3.
 */
export function swzZZalacznikow(zalaczniki) {
  const lista = Array.isArray(zalaczniki) ? zalaczniki : [];
  const pdf = lista.filter((z) => z && linkPlatformy(z.url)
    && (String(z.rozszerzenie ?? '').toLowerCase() === 'pdf' || /\.pdf$/i.test(String(z.nazwa ?? '')))
    && (typeof z.rozmiar_kb !== 'number' || z.rozmiar_kb * 1024 <= MAKS_BAJTOW_PLIKU_SWZ)
    && WZORZEC_SWZ.test(String(z.nazwa ?? '')));
  const waga = (z) => (/(^|[^a-z])(swz|siwz)/i.test(z.nazwa) ? 0 : 1); // „SWZ_remont” też liczy się jako SWZ
  return pdf.sort((a, b) => waga(a) - waga(b)).slice(0, MAKS_KANDYDATOW_SWZ);
}

/** Parametry Radaru SWZ otwieranego z załącznika platformy (nazwa, termin, przetarg + link do PDF). */
export function parametryRadaruZPlatformy({ tender, zalacznik } = {}) {
  if (!tender?.id || !linkPlatformy(zalacznik?.url)) return null;
  const params = { tenderId: tender.id, pdfUrl: zalacznik.url, pdfNazwa: String(zalacznik.nazwa ?? 'SWZ.pdf') };
  if (typeof tender.title === 'string' && tender.title.trim()) params.nazwa = tender.title;
  if (typeof tender.deadline === 'string' && tender.deadline) params.termin = tender.deadline;
  return params;
}
